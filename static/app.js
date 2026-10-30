(function() {
  'use strict';

  // ===== DATA (injected by build.py) =====
  const SYSTEMATIC_INDEX = /*__SYSTEMATIC_INDEX__*/[];

  // The big ones come as JSON blocks before this script (<script
  // type="application/json">), read when first needed: JSON parses much
  // faster than a script's literals, and most of it is not needed to show
  // the page
  function pageData(id) {
    let value;
    return () => value || (value = JSON.parse(document.getElementById(id).textContent));
  }

  const SUBJECT_INDEX = pageData('data-subject-index')();   // the cards' index chips need it

  const referenciasIndex = pageData('data-referencias-index');

  const consultaIndex = pageData('data-consulta-index');

  const SUMMARIES_MAP = /*__SUMMARIES_MAP__*/{};

  // Notes of the correlates, each once; a badge carries its index (data-n)
  const correlatoNotas = pageData('data-correlato-notas');

  const INFO_HTML = /*__INFO_HTML__*/"";

  // ===== MINIMAP / TOOLTIP COLORS =====
  // The level colors come from style.css (:root --nivel-*), so a new palette
  // there reaches the minimap and its tooltips too
  const rootStyle = getComputedStyle(document.documentElement);
  const cssVar = name => rootStyle.getPropertyValue(name).trim();
  const MINIMAP_COLORS = {
    norma:   { bg: cssVar('--nivel-norma'),     text: '#fff' },
    tit:     { bg: cssVar('--nivel-titulo'),    text: '#fff' },
    cap:     { bg: cssVar('--nivel-capitulo'),  text: '#fff' },
    sec:     { bg: cssVar('--nivel-secao'),     text: cssVar('--nivel-secao-texto') },
    subsec:  { bg: cssVar('--nivel-subsecao'),  text: '#fff' },
    article: { bg: cssVar('--rubrica'),         text: '#fff' },
  };

  // ===== MARKER COLOR PALETTE (fixed order for auto-assignment) =====
  const MARKER_PALETTE = [
    { name: 'coral',    bg: '#ff6b6b', bgLight: '#ffe0e0', text: '#fff' },
    { name: 'sky',      bg: '#4dabf7', bgLight: '#d0ebff', text: '#fff' },
    { name: 'lime',     bg: '#51cf66', bgLight: '#d3f9d8', text: '#fff' },
    { name: 'amber',    bg: '#fcc419', bgLight: '#fff3bf', text: '#333' },
    { name: 'violet',   bg: '#9775fa', bgLight: '#e5dbff', text: '#fff' },
    { name: 'pink',     bg: '#f06595', bgLight: '#ffdeeb', text: '#fff' },
    { name: 'teal',     bg: '#20c997', bgLight: '#c3fae8', text: '#fff' },
    { name: 'orange',   bg: '#ff922b', bgLight: '#ffe8cc', text: '#fff' },
  ];

  // ===== STATE =====
  let selectedCard = null;
  let manualSelect = false;
  let markersList = [];
  let searchFilter = true;
  let currentSearch = '';
  // The chip in the search bar, whose articles the search runs within (one
  // at a time): a subject of the remissivo { kind: 'subject', label, refs },
  // or the marked articles { kind: 'markers', label }
  let scope = null;
  let scopeOpening = false;      // it was just put there (doSearch goes to its start)
  let scopeStartCard = null;     // and starts at this article (the one it was opened from)
  let zoomScale = 1;
  let zoomTimeout = null;
  let searchMatches = [];
  let searchIdx = 0;
  let indexMatches = null;   // the indexes' entries with the search terms (see searchIndexes)
  let currentRefCategory = 0;
  let markerTooltipTimer = null;
  let footnoteTooltipTimer = null;
  let scrollRafId = null;
  // The history's steps (see BACK AND FORWARD)
  const STEP_LOAD = Date.now().toString(36);
  let stepCount = 0;
  let stepId = STEP_LOAD + ':0';
  const steps = new Map();       // step id → the state kept when it was left
  const stepKinds = new Map();   // step id → what it opened ('drawer', 'panel'), or 'rem'
  let stepTaken = false;         // in this action
  let restoring = false;
  let silentPops = 0;            // backs that only take a step out
  let indexRenders = 0;          // the index panel drawn so many times

  // ===== DOM REFS =====
  const $cards = document.getElementById('cards-container');
  const $searchInput = document.getElementById('search-input');
  const $btnFilter = document.getElementById('btn-filter');
  const $btnClearSearch = document.getElementById('btn-clear-search');
  const $btnIndex = document.getElementById('btn-index');
  const $markerNav = document.getElementById('marker-nav');
  const $indexOverlay = document.getElementById('index-overlay');
  const $indexPanel = document.getElementById('index-panel');
  const $indexContent = document.getElementById('index-content');
  const $indexSearch = document.getElementById('index-search');
  const $searchChip = document.getElementById('search-chip');
  const $chipLabel = document.getElementById('chip-label');
  const $zoomIndicator = document.getElementById('zoom-indicator');
  const $searchNav = document.getElementById('search-nav');
  const $searchCounter = document.getElementById('search-counter');
  const $breadcrumb = document.getElementById('breadcrumb');
  const $searchTicks = document.getElementById('search-ticks');
  const $searchTickTooltip = document.getElementById('search-tick-tooltip');
  const $minimap = document.getElementById('minimap');
  const $minimapCanvas = document.getElementById('minimap-canvas');
  const $minimapViewport = document.getElementById('minimap-viewport');
  const $minimapTooltip = document.getElementById('minimap-tooltip');
  const $minimapHighlight = document.getElementById('minimap-highlight');
  const $markerTooltip = document.getElementById('marker-tooltip');
  const $footnoteTooltip = document.getElementById('footnote-tooltip');

  // Cards never get added or removed after load: query them once.
  // Callers must not mutate these arrays.
  const ALL_CARDS = Array.from($cards.querySelectorAll('.card'));
  const ARTICLE_CARDS = Array.from($cards.querySelectorAll('.card-artigo'));
  function getAllCards() {
    return ALL_CARDS;
  }
  function getArticleCards() {
    return ARTICLE_CARDS;
  }
  function visibleOnly(cards) {
    return cards.filter(c => !c.classList.contains('filtered-out'));
  }

  // ===== CARD HEIGHT ESTIMATES (content-visibility) =====
  // Off-screen cards are not laid out (style.css), so until drawn once they
  // take the height estimated here; the minimap, the search ticks and long
  // jumps rely on it. Per block: [fixed px, px per line], fitted against the
  // real layout at 1280 and 390 px wide (median error ~4% per card, the
  // page's total height within 1%).
  // Refit whenever fonts, sizes or the card's bands change.
  const CARD_EST_BASE = 18;
  // the index band at the foot (indexBandHeight): its line, and open, the
  // rows of its table — each as tall as its subject's lines (in the left
  // column) or its sub-subjects' (packed in the right one)
  const IDX_BAND_PX = 12, IDX_SUM_PX = 18, IDX_OPEN_PX = 2;
  const IDX_ROW_PX = 7, IDX_HEAD_TOP_PX = 3, IDX_HEAD_LINE_PX = 16, IDX_SUB_LINE_PX = 26.4;
  const CARD_EST_CHAR_PX = 7.75;
  function cardBlockCoef(el) {
    const cl = el.classList;
    if (cl.contains('art-compact-label') || cl.contains('footnote-box')) return null;   // hidden
    if (cl.contains('law-badge')) return null;   // takes no height of its own
    if (el.tagName === 'BR') return [48, 0];
    if (cl.contains('old-version')) return [-6, 30];
    if (cl.contains('idx-backlinks')) return null;   // indexBandHeight
    if (cl.contains('rem-backlinks')) return [18, 0];
    if (cl.contains('art-summary')) return [17, 0];      // the band at the top
    return [0, 30];
  }
  function blockTextLength(el) {
    let n = el.textContent.length;
    for (const r of el.querySelectorAll('[data-label]')) {   // chips drawn by ::before
      n += r.dataset.label.length + 3;
    }
    return n;
  }
  // Per card, [fixed px, px per line, characters] of each block: read once
  // (the text does not change), so a pinch zoom only redoes the arithmetic
  let cardEstBlocks = null;
  let cardEstBand = null;   // the index band at the foot (indexBandHeight)
  let idxOpen = false;      // the index bands open (setIndexOpen), or folded to their line
  // In compact mode an article is its label, badge and rubrica on lines of
  // 1.3em (--card-hc): their characters, per article card (titles keep theirs)
  let cardEstCompact = null;
  const COMPACT_LINE_EM = 1.3;
  // A heading is a ribbon, further in at each level (both margins, and its
  // 28px paddings): "TÍTULO I" on a line, then the name (after the <br>) on
  // lines of roman capitals (Cinzel), the small first line ("TÍTULO I")
  // a little taller than the others. A norma's cover: its name in large
  // letters, then the line naming it (data-sub) at 78% of the width. Fitted
  // 30/10/2026 (14 of 574 headings a line off).
  let cardEstTitle = null;
  const TITLE_CHAR_PX = 11.8, TITLE_LINE_PX = 21.4, TITLE_FIRST_PX = 23.6;
  const TITLE_INSET = { 'nivel-capitulo': 28, 'nivel-secao': 56, 'nivel-subsecao': 84 };
  const COVER_CHAR_PX = 13.5, COVER_LINE_PX = 35.6, COVER_SUB_CHAR_PX = 7, COVER_SUB_LINE_PX = 16.7;

  // The index band's height, open: its table's rows, the subject wrapped in
  // its column and the sub-subjects packed in lines beside it, as the browser
  // will. Widths measured on a canvas with the band's fonts, no layout; redone
  // with the width or the zoom.
  let idxMetrics = null, idxFontWait = false;   // read again at each estimate (the zoom changes them)
  let idxMetricsLast = null;   // the same, kept (with the groups' widths) while they don't change
  const idxWidths = new Map();
  const idxCanvas = document.createElement('canvas').getContext('2d');
  function idxMeasure() {
    const row = $cards.querySelector('.idx-row'), sub = $cards.querySelector('.idx-row > .idx-sub');
    if (!row || !sub) return null;
    const px = v => parseFloat(v) || 0;
    // the font and what the box adds to the text's width (the subject's
    // negative margin puts it in the left column: not counted)
    const box = (el, margins) => {
      const c = getComputedStyle(el);
      return {
        font: c.fontStyle + ' ' + c.fontWeight + ' ' + c.fontSize + ' ' + c.fontFamily,
        extra: (margins ? px(c.marginLeft) + px(c.marginRight) : 0) + px(c.paddingLeft) + px(c.paddingRight)
          + px(c.borderLeftWidth) + px(c.borderRightWidth),
        spacing: px(c.letterSpacing),
      };
    };
    const head = row.querySelector('.idx-head');
    const rc = getComputedStyle(row);
    const m = { head: box(head, false), sub: box(sub, true), col: px(rc.paddingLeft), headW: px(getComputedStyle(head).width) };
    m.key = [m.head.font, m.head.spacing, m.sub.font, m.sub.extra, m.col, m.headW].join('|');
    if (idxMetricsLast && idxMetricsLast.key === m.key) return idxMetricsLast;
    idxMetricsLast = m;
    // measured before the fonts came, the widths are the fallback's: once more when they come
    if (!idxFontWait && !(document.fonts.check(m.head.font) && document.fonts.check(m.sub.font))) {
      idxFontWait = true;
      Promise.all([document.fonts.load(m.head.font), document.fonts.load(m.sub.font)]).then(() => {
        idxWidths.clear();
        idxMetricsLast = null;
        preserveScroll(estimateCardHeights);
        forgetCardHeights();
      });
    }
    return m;
  }
  function idxTextWidth(m, b, text) {
    const key = b.font + '|' + text;
    let w = idxWidths.get(key);
    if (w === undefined) {
      idxCanvas.font = b.font;
      idxWidths.set(key, w = idxCanvas.measureText(text).width);
    }
    return w + b.extra + b.spacing * text.length;
  }
  // A subject's row: its width (the subject's text) and its sub-subjects'
  function idxRowItems(m, row) {
    if (row.idxM === m) return row.idxItems;
    const items = [];
    for (const el of row.children) {
      const sub = el.classList.contains('idx-sub');
      items.push(idxTextWidth(m, sub ? m.sub : m.head, sub ? el.dataset.show : el.dataset.label));
    }
    row.idxM = m;
    row.idxItems = items;
    return items;
  }
  function indexBandHeight(band, width) {
    if (!idxOpen) return IDX_BAND_PX + IDX_SUM_PX;
    if (!idxMetrics) idxMetrics = idxMeasure();
    const m = idxMetrics, rows = band.querySelectorAll(':scope > .idx-row');
    let h = IDX_BAND_PX + IDX_SUM_PX + IDX_OPEN_PX;
    if (!m) return h + (IDX_ROW_PX + IDX_SUB_LINE_PX) * rows.length;
    const room = width - m.col;
    for (const row of rows) {
      const items = idxRowItems(m, row);
      const heads = Math.max(1, Math.ceil(items[0] / m.headW));
      let subs = 0, at = 0;
      for (let k = 1; k < items.length; k++) {
        const w = items[k];
        if (!subs || at + w > room) { subs++; at = 0; }
        if (w > room) { subs += Math.ceil(w / room) - 1; at = room; }   // its text wraps
        else at += w;
      }
      h += IDX_ROW_PX + Math.max(IDX_HEAD_TOP_PX + heads * IDX_HEAD_LINE_PX, subs * IDX_SUB_LINE_PX);
    }
    return h;
  }

  function estimateCardHeights() {
    if (!cardEstBlocks) {
      cardEstTitle = ALL_CARDS.map(card => {
        if (!card.classList.contains('card-titulo')) return null;
        const segs = [0];
        for (const n of card.childNodes) {
          if (n.nodeName === 'BR') segs.push(0);
          else segs[segs.length - 1] += n.textContent.trim().length;
        }
        if (card.classList.contains('nivel-norma')) return { cover: segs[0], sub: (card.dataset.sub || '').length };
        const level = [...card.classList].find(c => c in TITLE_INSET);
        return { segs, inset: TITLE_INSET[level] || 0 };
      });
      cardEstBlocks = ALL_CARDS.map(card => {
        const blocks = [];
        for (const el of card.children) {
          const coef = cardBlockCoef(el);
          if (coef) blocks.push([coef[0], coef[1], coef[1] ? blockTextLength(el) : 0]);
        }
        return blocks;
      });
      cardEstBand = ALL_CARDS.map(card => card.querySelector(':scope > .idx-backlinks'));
      cardEstCompact = ALL_CARDS.map(card => {
        if (!card.classList.contains('card-artigo')) return -1;
        let n = 0;
        for (const el of card.querySelectorAll(':scope > .art-compact-label, :scope > .art-summary, :scope > .law-badge')) {
          n += el.textContent.length + 2;
        }
        return n;
      });
    }
    const z = zoomScale;
    const textWidth = $cards.clientWidth - 24 - 32 * z - 3;
    // the band's lines, packed to the real width (the card's, less its padding)
    idxMetrics = null;
    const bandCard = cardEstBand.find(Boolean);
    let bandWidth = 0;
    if (bandCard && !compactMode) {
      const c = getComputedStyle(bandCard.parentNode);
      bandWidth = bandCard.parentNode.clientWidth - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight);
    }
    const charsPerLine = Math.max(10, textWidth / (CARD_EST_CHAR_PX * z));
    const compactPerLine = Math.max(10, (textWidth + 8 * z) / (CARD_EST_CHAR_PX * z));
    // Each card restyled costs: only the estimate the mode uses, and only if it changed
    const setEst = (i, prop, set, v) => {
      if (set[i] !== v) ALL_CARDS[i].style.setProperty(prop, (set[i] = v) + 'px');
    };
    const titleWidth = $cards.clientWidth - 24;
    const coverWidth = titleWidth - 44 * z;
    const perLine = (width, charPx) => Math.max(10, width / (charPx * z));
    ALL_CARDS.forEach((card, i) => {
      const t = cardEstTitle[i];
      if (t && t.segs) {
        const per = perLine(titleWidth - t.inset - 56 * z, TITLE_CHAR_PX);
        // (the four without a number are their name alone)
        const numbered = t.segs.length > 1;
        let lines = 0;
        for (const n of t.segs.slice(numbered ? 1 : 0)) lines += Math.max(1, Math.ceil(n / per));
        setEst(i, '--card-h', cardEstSet, Math.round(((numbered ? TITLE_FIRST_PX : 0) + lines * TITLE_LINE_PX) * z));
        return;
      }
      if (t) {
        const name = Math.max(1, Math.ceil(t.cover / perLine(coverWidth, COVER_CHAR_PX)));
        const sub = t.sub ? 8 + COVER_SUB_LINE_PX * z * Math.ceil(t.sub / perLine(coverWidth * .78, COVER_SUB_CHAR_PX)) : 0;
        setEst(i, '--card-h', cardEstSet, Math.round(name * COVER_LINE_PX * z + sub));
        return;
      }
      const nc = cardEstCompact[i];
      if (compactMode && nc >= 0) {
        const lines = Math.max(1, Math.ceil(nc / compactPerLine));
        setEst(i, '--card-hc', cardEstSetC, Math.round(lines * COMPACT_LINE_EM * 16 * z));
        return;
      }
      let h = CARD_EST_BASE;
      for (const [fixed, perLine, n] of cardEstBlocks[i]) h += fixed + perLine * Math.ceil(n / charsPerLine);
      if (cardEstBand[i]) h += indexBandHeight(cardEstBand[i], bandWidth);
      // contain-intrinsic-size is the content height: padding and border come on top
      setEst(i, '--card-h', cardEstSet, Math.round(Math.max(4, (h - 32) * z - 3)));
    });
  }
  const cardEstSet = [], cardEstSetC = [];   // the values given to each card
  // Heights remembered at the old zoom or width would stay wrong until each
  // card is drawn again: once the zoom or width settles, make the browser
  // forget them (callers re-estimate first)
  // Only cards drawn since the last time remember one: just those are reset
  // (restyling all ~1,000 cards costs as much as the zoom itself). Without
  // the event that tells them apart, all of them.
  // A zoom (reestimate) re-estimates only then: a pinch or a wheel burst
  // would restyle every card at each step, for heights no one sees meanwhile
  let cardSizeResetTimer;
  let reestimatePending = false;
  const CV_STATE_EVENTS = 'ContentVisibilityAutoStateChangeEvent' in window;
  const cardsDrawn = new Set();   // drawn since the last reset
  const cardsShown = new Set();   // drawn now
  function forgetCardHeights(reestimate) {
    if (reestimate) reestimatePending = true;
    clearTimeout(cardSizeResetTimer);
    cardSizeResetTimer = setTimeout(() => {
      const reset = CV_STATE_EVENTS ? [...cardsDrawn] : null;
      const mark = on => preserveScroll(() => {
        if (on && reestimatePending) {
          reestimatePending = false;
          estimateCardHeights();
        }
        if (reset) for (const card of reset) card.classList.toggle('cv-reset', on);
        else $cards.classList.toggle('cv-reset', on);
      });
      mark(true);
      cardsDrawn.clear();
      for (const card of cardsShown) cardsDrawn.add(card);
      // The remembered sizes are dropped at the next rendering update
      requestAnimationFrame(() => requestAnimationFrame(() => {
        mark(false);
        scheduleMinimap();
      }));
    }, 400);
  }

  const whenIdle = window.requestIdleCallback || (cb => setTimeout(() => {
    const start = performance.now();
    cb({ timeRemaining: () => Math.max(0, 10 - (performance.now() - start)) });
  }, 50));

  // Heading level of a .card-titulo: 'norma' | 'tit' | 'cap' | 'sec' | 'subsec' | ''
  function headingLevel(card) {
    const sec = card.dataset.section || '';
    if (sec.startsWith('norma')) return 'norma';
    if (sec.startsWith('tit') || sec === 'adt' || sec === 'dgt') return 'tit';
    if (sec.startsWith('cap')) return 'cap';
    if (sec.startsWith('subsec')) return 'subsec';
    if (sec.startsWith('sec')) return 'sec';
    return '';
  }

  // Precedentes Regimentais: article cards with data-law="PREC", numbered
  // "number/year" ("2/2004"; "0/1997" = sem número)
  function isPrecCard(card) {
    return card.dataset.law === 'PREC';
  }
  function precLabel(art) {
    const [n, y] = art.split('/');
    return n === '0' ? 'sem número, de ' + y : 'nº ' + n + '/' + y;
  }
  // "LOM Art. 42" / "Precedente nº 2/2004"
  function cardRefLabel(card) {
    if (isPrecCard(card)) return 'Precedente ' + precLabel(card.dataset.art);
    return (card.dataset.law ? card.dataset.law + ' ' : '') + 'Art. ' + card.dataset.art;
  }

  // Programmatic smooth scrolls across very long distances animate for ~1.5s
  // through 100k+ px of content and stall slow machines; jump instead.
  const FAR_SCROLL_SCREENS = 3;
  let scrollToYCall = 0;
  let smoothScrolling = false; // a smooth scrollToY that moves may still be animating
  window.addEventListener('scrollend', () => { smoothScrolling = false; });

  function cancelScrollCorrection() {
    scrollToYCall++;
  }

  function scrollToY(top, behavior) {
    const call = ++scrollToYCall;
    if (behavior === 'smooth' && Math.abs(top - window.scrollY) > FAR_SCROLL_SCREENS * window.innerHeight) {
      behavior = 'instant';
    }
    // Only a smooth scroll that actually moves ends with a 'scrollend'
    const root = document.documentElement;
    const dest = Math.max(0, Math.min(top, root.scrollHeight - root.clientHeight));
    smoothScrolling = behavior === 'smooth' && Math.abs(dest - window.scrollY) >= 1;
    const from = window.scrollY;
    window.scrollTo({ top, behavior });
    if (behavior === 'instant') {
      holdLanding(call);
      if (Math.abs(window.scrollY - from) >= FAR_SCROLL_SCREENS * window.innerHeight) farJump(from, window.scrollY);
    }
    else if (smoothScrolling) window.addEventListener('scrollend', () => holdLanding(call), { once: true });
  }

  // A far jump lands at once (above): the text comes out of a blur, and on
  // the minimap a trail runs from where the reading was to where it landed,
  // with a ring opening there, so the jump's way is seen
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
  function farJump(from, to) {
    if (REDUCED_MOTION.matches) return;
    $cards.animate([{ opacity: .12, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0)' }],
      { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    const map = document.getElementById('minimap');
    if (!map || !map.offsetHeight) return;
    const docH = document.documentElement.scrollHeight, mapH = map.clientHeight;
    const y0 = (from + window.innerHeight / 2) / docH * mapH;
    const y1 = (to + window.innerHeight / 2) / docH * mapH;
    const down = to > from;
    const trail = document.createElement('div');
    trail.className = 'mm-trail' + (down ? '' : ' up');
    trail.style.top = Math.min(y0, y1) + 'px';
    trail.style.height = Math.max(4, Math.abs(y1 - y0)) + 'px';
    map.appendChild(trail);
    // it grows from the start and shrinks into the end
    const start = down ? 'inset(0 0 100% 0)' : 'inset(100% 0 0 0)';
    const end = down ? 'inset(100% 0 0 0)' : 'inset(0 0 100% 0)';
    trail.animate([{ clipPath: start }, { clipPath: 'inset(0 0 0 0)', offset: .5 }, { clipPath: end }],
      { duration: 950, easing: 'cubic-bezier(.4,0,.2,1)' }).onfinish = () => trail.remove();
    const ring = document.createElement('div');
    ring.className = 'mm-landing';
    ring.style.top = y1 + 'px';
    map.appendChild(ring);
    ring.animate([{ transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(.2)', opacity: 1, offset: .4 },
      { transform: 'scale(2.6)', opacity: 0 }], { duration: 1300, easing: 'ease-out' }).onfinish = () => ring.remove();
  }

  // Cards drawn for the first time around the landing spot change height
  // (estimate → real, see estimateCardHeights) and push what was just put on
  // screen. Hold the card under the reading line where it landed until they
  // settle. This also undoes a jump made while an earlier smooth scroll is
  // still animating, which lands one animation step past the target (Chrome).
  function holdLanding(call) {
    const anchor = findSelectionCard();
    if (!anchor) return;
    const want = anchor.getBoundingClientRect().top;
    let frames = 0, still = 0;
    requestAnimationFrame(function hold() {
      if (call !== scrollToYCall) return;
      const delta = anchor.getBoundingClientRect().top - want;
      if (Math.abs(delta) >= 1) { window.scrollBy({ top: delta, behavior: 'instant' }); still = 0; }
      else still++;
      if (++frames < 40 && still < 4) requestAnimationFrame(hold);
    });
  }
  // The reader taking over the scroll ends any hold (capture: before a key
  // or click handler starts a new one)
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    window.addEventListener(type, cancelScrollCorrection, { capture: true, passive: true });
  }

  // ===== SCROLL SELECTION =====
  function getReadingLineY() {
    return window.innerHeight * 0.25;
  }

  function scrollToReadingLine(card, behavior = 'smooth') {
    if (scrollRafId) cancelAnimationFrame(scrollRafId);
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      const rect = card.getBoundingClientRect();
      const target = window.scrollY + rect.top - getReadingLineY();
      scrollToY(Math.max(0, target), behavior);
    });
  }

  function scrollToFirstMark(card, behavior = 'smooth') {
    if (scrollRafId) cancelAnimationFrame(scrollRafId);
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      // First highlight that is actually rendered (hits inside hidden
      // elements, e.g. the compact-mode label, have no box)
      let rect = null;
      for (const hit of getCardHits(card)) {
        if (hitHasBox(hit)) { rect = hitRect(hit); break; }
      }
      // None (a chip without text): its first dispositivo in the card
      if (!rect) {
        const unit = card.classList.contains('scope-unit') ? null : card.querySelector('.scope-unit');
        rect = (unit || card).getBoundingClientRect();
      }
      const target = window.scrollY + rect.top - getReadingLineY();
      scrollToY(Math.max(0, target), behavior);
      registerNearbyHits();
    });
  }

  // Index of the first card whose rect satisfies pred, assuming cards are in
  // document order (visible cards stack vertically, so tops/bottoms increase).
  function firstCardWhere(cards, pred) {
    let lo = 0, hi = cards.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pred(cards[mid].getBoundingClientRect())) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  // Card under the reading line, or the nearest one (earlier card wins ties)
  function findSelectionCard() {
    const lineY = getReadingLineY();
    const cards = visibleOnly(ALL_CARDS);
    const i = firstCardWhere(cards, r => r.bottom >= lineY);
    const next = cards[i];
    if (next && next.getBoundingClientRect().top <= lineY) return next;
    const prev = cards[i - 1];
    if (!prev) return next || null;
    if (!next) return prev;
    const distPrev = lineY - prev.getBoundingClientRect().bottom;
    const distNext = next.getBoundingClientRect().top - lineY;
    return distNext < distPrev ? next : prev;
  }

  function updateSelection() {
    if (manualSelect) return;
    const best = findSelectionCard();
    if (best && best !== selectedCard) {
      selectCard(best, false);
    }
  }

  function selectCard(card, manual) {
    if (selectedCard) selectedCard.classList.remove('selected');
    selectedCard = card;
    if (card) card.classList.add('selected');
    if (resultsActive) markCurrentResult(card);
    if (manual) {
      manualSelect = true;
      setTimeout(() => { manualSelect = false; }, 50);
    }
  }

  function preserveScroll(fn) {
    cancelScrollCorrection();
    const card = selectedCard;
    const topBefore = card ? card.getBoundingClientRect().top : null;
    fn();
    if (card && topBefore !== null && !card.classList.contains('filtered-out')) {
      const topAfter = card.getBoundingClientRect().top;
      window.scrollBy(0, topAfter - topBefore);
    }
  }

  // ===== BREADCRUMB (scroll context) =====
  const headerEl = document.getElementById('header');

  function getHeadingShortTitle(el) {
    // Collect main text (before <br>) and subtitle (after <br>)
    let mainText = '', subtitle = '', pastBr = false;
    for (const node of el.childNodes) {
      if (node.nodeName === 'BR') { pastBr = true; continue; }
      if (node.nodeType === Node.TEXT_NODE) {
        if (!pastBr) mainText += node.textContent;
        else subtitle += node.textContent;
      }
    }
    mainText = mainText.trim();
    subtitle = subtitle.trim();
    // Strip type-word prefix (TÍTULO, CAPÍTULO, SEÇÃO, SUBSEÇÃO) — user deduces from color
    const num = mainText.replace(/^(T[IÍ]TULO|CAP[IÍ]TULO|SE[CÇ][AÃ]O|SUBSE[CÇ][AÃ]O)\s*/i, '').trim();
    if (subtitle) return (num ? num + '-' : '') + subtitle;
    return num || mainText;
  }

  // Reads only (no DOM writes): what the breadcrumb should show, or null
  function computeBreadcrumb() {
    if (compactMode) return null;

    // Find the last article card whose top is at or above the header bottom.
    // Using "last above" (instead of "straddles") ensures the breadcrumb stays
    // visible even when a gap or a title card sits exactly at the header line.
    const headerBottom = headerEl.getBoundingClientRect().bottom;
    const articles = visibleOnly(ARTICLE_CARDS);
    const card = articles[firstCardWhere(articles, r => r.top > headerBottom) - 1];
    if (!card) return null;

    // Find the last unit-id hidden behind the header
    const unitIds = card.querySelectorAll('.unit-id[data-path]');
    let currentUnit = null;
    for (const uid of unitIds) {
      if (uid.closest('.old-version')) continue;
      if (uid.getBoundingClientRect().bottom <= headerBottom) {
        currentUnit = uid;
      }
    }

    // Ancestor headings out of view: filtered-out (display:none, definitely
    // above) or scrolled above header
    const headings = collectAncestorHeadings(card).filter(h =>
      h.el.classList.contains('filtered-out') || h.el.getBoundingClientRect().bottom <= headerBottom);

    // Only show breadcrumb when at least one ancestor title is out of view
    if (headings.length === 0) return null;

    return { card, headings, path: currentUnit ? currentUnit.dataset.path : '' };
  }

  let breadcrumbShown = null; // content currently built in $breadcrumb

  function sameBreadcrumb(a, b) {
    return !!(a && b && a.card === b.card && a.path === b.path &&
      a.headings.length === b.headings.length &&
      a.headings.every((h, i) => h.el === b.headings[i].el));
  }

  function updateBreadcrumb() {
    applyBreadcrumb(computeBreadcrumb());
  }

  function applyBreadcrumb(bc) {
    if (!bc) {
      $breadcrumb.classList.remove('visible', 'open');
      return;
    }
    const { card, headings } = bc;
    // Rebuild only when the content changes (scroll fires every frame)
    if (sameBreadcrumb(bc, breadcrumbShown)) {
      $breadcrumb.classList.add('visible');
      breadcrumbCard = card;
      return;
    }
    breadcrumbShown = bc;

    // Build breadcrumb DOM
    $breadcrumb.innerHTML = '';
    $breadcrumb.classList.toggle('bc-phone', PHONE.matches);
    if (PHONE.matches) {
      buildPhoneBreadcrumb(bc);
      $breadcrumb.classList.add('visible');
      breadcrumbCard = card;
      return;
    }

    function addSep() {
      const sep = document.createElement('span');
      sep.className = 'bc-sep';
      sep.textContent = '\u203A';
      $breadcrumb.appendChild(sep);
    }

    headings.forEach((h, i) => {
      if (i > 0) addSep();
      const span = document.createElement('span');
      span.className = 'bc-item bc-' + h.level;
      if (h.level === 'norma') span.dataset.nrm = h.el.dataset.nrm || 'RI';   // its color (CSS)
      span.textContent = getHeadingShortTitle(h.el);
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        const top = h.el.getBoundingClientRect().top + window.scrollY;
        scrollToY(top - getReadingLineY(), 'smooth');
      });
      $breadcrumb.appendChild(span);
    });

    if (headings.length > 0) addSep();
    const artSpan = document.createElement('span');
    artSpan.className = 'bc-item bc-article';
    const lawPrefix = card.dataset.law;
    artSpan.textContent = isPrecCard(card) ? precLabel(card.dataset.art)
      : (lawPrefix ? lawPrefix + '\u00a0' : '') + card.dataset.art;
    artSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      const top = card.getBoundingClientRect().top + window.scrollY;
      scrollToY(top - getReadingLineY(), 'smooth');
    });
    $breadcrumb.appendChild(artSpan);

    if (bc.path) {
      const parts = bc.path.split(',');
      addSep();
      const pathSpan = document.createElement('span');
      pathSpan.className = 'bc-path';
      pathSpan.textContent = parts.join(' \u203A ');
      $breadcrumb.appendChild(pathSpan);
    }

    $breadcrumb.classList.add('visible');
    breadcrumbCard = card;
  }

  let breadcrumbCard = null;

  // On a phone, one line: the levels by their numbers ("RI", "II", "IV"),
  // the deepest with its name, each on its level's color, and the article;
  // a tap opens the whole path under it, each heading on its color, and a
  // heading there goes to it. The line never wraps over the text.
  const PHONE = window.matchMedia('(max-width: 600px)');
  function bcHeadingParts(h) {
    const name = getHeadingShortTitle(h.el);
    if (h.level === 'norma') return [SYS_NORM_SHORT[name] || name, name];
    const m = name.match(/^([IVXLC]+[-A-Z]*|ÚNIC[OA])(?:-(.*))?$/i);
    if (!m) return ['', sysCase(name)];
    const num = /^ÚNIC/i.test(m[1]) ? 'Único' : m[1];
    return [num, m[2] ? sysCase(m[2]) : ''];
  }
  const BC_LEVEL_WORD = { tit: 'Título', cap: 'Capítulo', sec: 'Seção', subsec: 'Subseção' };
  function buildPhoneBreadcrumb(bc) {
    const { card, headings } = bc;
    const line = document.createElement('div');
    line.className = 'bc-line';
    line.setAttribute('role', 'button');
    line.setAttribute('aria-expanded', 'false');
    line.title = 'Ver onde você está';
    headings.forEach((h, i) => {
      const [num, name] = bcHeadingParts(h);
      const span = document.createElement('span');
      span.className = 'bc-item bc-' + h.level + (i === headings.length - 1 ? ' bc-last' : '');
      if (h.level === 'norma') span.dataset.nrm = h.el.dataset.nrm || 'RI';
      span.textContent = i === headings.length - 1 && h.level !== 'norma' && name
        ? (num ? num + ' · ' : '') + name : num || name;
      line.appendChild(span);
    });
    const art = document.createElement('span');
    art.className = 'bc-item bc-article';
    art.textContent = isPrecCard(card) ? precLabel(card.dataset.art)
      : (card.dataset.law ? card.dataset.law + '\u00a0' : '') + 'Art.\u00a0' + card.dataset.art;
    const more = document.createElement('span');
    more.className = 'bc-more';
    more.setAttribute('aria-hidden', 'true');
    line.append(art, more);

    const list = document.createElement('div');
    list.className = 'bc-list';
    const go = el => {
      $breadcrumb.classList.remove('open');
      const top = el.getBoundingClientRect().top + window.scrollY;
      scrollToY(top - getReadingLineY(), 'smooth');
    };
    headings.forEach((h, i) => {
      const [num, name] = bcHeadingParts(h);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bc-row bc-' + h.level;
      row.style.setProperty('--d', i);
      row.textContent = h.level === 'norma' ? name
        : [BC_LEVEL_WORD[h.level] && num ? BC_LEVEL_WORD[h.level] + ' ' + num : num, name].filter(Boolean).join(' — ');
      row.addEventListener('click', e => { e.stopPropagation(); go(h.el); });
      list.appendChild(row);
    });
    const artRow = document.createElement('button');
    artRow.type = 'button';
    artRow.className = 'bc-row bc-article';
    artRow.style.setProperty('--d', headings.length);
    const summary = card.querySelector(':scope > .art-summary');
    artRow.textContent = art.textContent.replace(/\u00a0/g, ' ')
      + (bc.path ? ', ' + bc.path.split(',').join(', ') : '')
      + (summary ? ' — ' + summary.textContent.trim() : '');
    artRow.addEventListener('click', e => { e.stopPropagation(); go(card); });
    list.appendChild(artRow);
    $breadcrumb.append(line, list);
  }
  PHONE.addEventListener('change', () => {
    breadcrumbShown = null;
    $breadcrumb.classList.remove('open');
    document.body.classList.remove('hide-top');
    updateBreadcrumb();
  });

  $breadcrumb.addEventListener('click', (e) => {
    if ($breadcrumb.classList.contains('bc-phone')) {
      if (!e.target.closest('.bc-line')) return;
      const open = $breadcrumb.classList.toggle('open');
      e.target.closest('.bc-line').setAttribute('aria-expanded', String(open));
      return;
    }
    if (e.target.closest('.bc-item')) return;
    if (breadcrumbCard) {
      const top = breadcrumbCard.getBoundingClientRect().top + window.scrollY;
      scrollToY(top - getReadingLineY(), 'smooth');
    }
  });

  // Selection, breadcrumb, minimap viewport and nearby search highlights for
  // the current scroll position. Reads all geometry before writing anything,
  // so the frame lays out once.
  function syncToScroll() {
    manualSelect = false;
    const viewport = readMinimapViewport();
    const best = findSelectionCard();
    const bc = computeBreadcrumb();
    registerNearbyHits();
    if (best && best !== selectedCard) selectCard(best, false);
    applyBreadcrumb(bc);
    applyMinimapViewport(viewport);
    if (best) showNorma(best);
  }

  // The norma being read gives its color to the window (style.css, --bg)
  function showNorma(card) {
    const law = card.dataset.law || card.dataset.nrm;
    const root = document.documentElement;
    if (law) { if (root.dataset.nrm !== law) root.dataset.nrm = law; }
    else if (root.dataset.nrm) delete root.dataset.nrm;
  }

  // A card drawn for the first time above the screen changes height
  // (estimate → real). Chrome's scroll anchoring keeps the text being read
  // still; WebKit (so every iOS browser) lets it jump. There, compensate by
  // hand right after layout and before paint (ResizeObserver), and only when
  // first draws are all that changed: zoom, filters and the compact mode
  // move the cards themselves.
  const UA = navigator.userAgent;
  if (/AppleWebKit\//.test(UA) && !/Chrome\/|Edg\//.test(UA) && window.ResizeObserver) {
    const lastHeight = new Map();
    const firstDraws = new ResizeObserver(entries => {
      let shift = 0, onlyFirstDraws = true;
      for (const e of entries) {
        const card = e.target;
        const h = e.borderBoxSize[0].blockSize;
        const before = lastHeight.get(card);
        lastHeight.set(card, h);
        if (before === undefined) continue;
        const compactArt = compactMode && card.classList.contains('card-artigo');
        const estimate = parseFloat(card.style.getPropertyValue(compactArt ? '--card-hc' : '--card-h'))
          + (compactArt ? 16 : 32) * zoomScale;
        if (Math.abs(before - estimate) > 1) { onlyFirstDraws = false; continue; }
        if (card.getBoundingClientRect().top < 0) shift += h - before;
      }
      if (onlyFirstDraws && shift && Math.abs(shift) < window.innerHeight / 2) {
        window.scrollBy({ top: shift, behavior: 'instant' });
      }
    });
    ALL_CARDS.forEach(card => firstDraws.observe(card));
  }

  // On a phone, the header goes away while reading down and comes back on
  // the way up (or at the top); it stays while the search, its results or
  // the index are in use, and through jumps (a search, a remissão). A thin
  // bar at the top shows how far into the document the reading is.
  const $readProgress = document.createElement('div');
  $readProgress.id = 'read-progress';
  document.body.appendChild($readProgress);
  let lastScrollY = window.scrollY;
  window.addEventListener('scroll', () => {
    if (!PHONE.matches) return;
    const y = window.scrollY;
    const dy = y - lastScrollY;
    lastScrollY = y;
    const root = document.documentElement;
    $readProgress.style.transform = 'scaleX(' + Math.min(1, y / Math.max(1, root.scrollHeight - root.clientHeight)) + ')';
    const busy = resultsDrawerOpen || document.activeElement === $searchInput
      || $indexPanel.classList.contains('open') || $breadcrumb.classList.contains('open') || smoothScrolling;
    if (y <= 80 || busy || dy < -6) document.body.classList.remove('hide-top');
    else if (dy > 6 && dy < window.innerHeight) document.body.classList.add('hide-top');
  }, { passive: true });
  $searchInput.addEventListener('focus', () => document.body.classList.remove('hide-top'));
  // the long hint doesn't fit a phone's search field
  const SEARCH_HINT = $searchInput.placeholder;
  const setSearchHint = () => { $searchInput.placeholder = PHONE.matches ? 'Buscar ou r43…' : SEARCH_HINT; };
  setSearchHint();
  PHONE.addEventListener('change', setSearchHint);

  let scrollTick = false;
  window.addEventListener('scroll', () => {
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => {
      syncToScroll();
      scrollTick = false;
    });
  });

  $cards.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    if (e.target.closest('.footnote-ref') || e.target.closest('.footnote-box') || e.target.closest('.unit-id')) return;
    selectCard(card, true);
  });

  // ===== SEARCH =====
  function stripAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function accentInsensitivePattern(str) {
    const map = {
      'a': '[aáàâãä]', 'e': '[eéèêë]', 'i': '[iíìîï]',
      'o': '[oóòôõö]', 'u': '[uúùûü]', 'c': '[cç]', 'n': '[nñ]',
    };
    return str.replace(/[a-z]/gi, ch => map[ch.toLowerCase()] || ch);
  }

  // ===== SEARCH HIGHLIGHTS =====
  // Matches are painted with the CSS Custom Highlight API, which doesn't touch
  // the DOM: no relayout of the whole document per keystroke and nothing to
  // undo. StaticRange (not Range) because thousands of live ranges slow down
  // every later DOM mutation. <mark> elements are used instead:
  //  - in browsers without the API, and in forced-colors mode (::highlight
  //    gets the text-selection colors there, <mark> gets Mark/MarkText);
  //  - inside user-select:none text, where WebKit doesn't paint highlights
  //    (and paints the next selectable text instead).
  const HIGHLIGHT_API = !!(window.CSS && CSS.highlights && typeof Highlight === 'function'
    && typeof StaticRange === 'function')
    && !(window.matchMedia && matchMedia('(forced-colors: active)').matches);
  // Card text with -webkit-user-select:none in style.css (.art-compact-label
  // only in compact mode); keep in sync
  const UNSELECTABLE_TEXT = '.art-summary, .art-compact-label, .diff-toggle, .footnote-ref';
  const searchHighlight = HIGHLIGHT_API ? new Highlight() : null;
  // The short words of a query with other words ("prazo de votação"): a
  // fainter mark (see SHORT_WORDS)
  const weakHighlight = HIGHLIGHT_API ? new Highlight() : null;
  if (HIGHLIGHT_API) {
    CSS.highlights.set('search', searchHighlight);
    CSS.highlights.set('search-weak', weakHighlight);
  }
  let weakRanges = new Set();
  const highlightOf = range => weakRanges.has(range) ? weakHighlight : searchHighlight;

  let cardHits = new Map();       // card → hits in document order (StaticRange or <mark>)
  let textNodeHits = new Map();   // text node → [[start, end], ...] of its StaticRange hits
  let markedTextNodes = [];       // [original text node, first, last node that replaced it]
  let rangeTargets = new Map();   // observed element → its StaticRange hits
  let cardTargets = new Map();    // card → its observed elements

  // Chrome redoes work for every registered range on each frame that changes
  // style or layout (scrolling, hover...), so only ranges within
  // HIGHLIGHT_MARGIN_SCREENS of the visible area are registered. They are
  // tracked per card, or per block (child of the card) in cards with more
  // than MAX_RANGES_PER_CARD_TARGET ranges.
  const HIGHLIGHT_MARGIN_SCREENS = 1;
  const MAX_RANGES_PER_CARD_TARGET = 64;
  const highlightObserver = HIGHLIGHT_API
    ? new IntersectionObserver(applyHighlightEntries, { rootMargin: HIGHLIGHT_MARGIN_SCREENS * 100 + '% 0px' })
    : null;

  function applyHighlightEntries(entries) {
    for (const entry of entries) {
      for (const range of rangeTargets.get(entry.target) || []) {
        if (entry.isIntersecting) highlightOf(range).add(range);
        else highlightOf(range).delete(range);
      }
    }
  }

  function trackRanges(card, ranges) {
    const targets = [];
    const perBlock = ranges.length > MAX_RANGES_PER_CARD_TARGET;
    for (const range of ranges) {
      let target = card;
      if (perBlock) {
        target = range.startContainer.parentElement;
        while (target !== card && target.parentElement !== card) target = target.parentElement;
      }
      let list = rangeTargets.get(target);
      if (!list) {
        rangeTargets.set(target, list = []);
        targets.push(target);
        highlightObserver.observe(target);
      }
      list.push(range);
    }
    cardTargets.set(card, targets);
  }

  // The observer reports after the frame is painted, and not at all while the
  // main thread is busy: register what is near the viewport right away. The
  // band must not exceed the observer's, or it never reports them leaving.
  function registerNearbyHits() {
    if (!HIGHLIGHT_API || !searchMatches.length) return;
    applyHighlightEntries(highlightObserver.takeRecords());
    const vh = window.innerHeight;
    const bandTop = -HIGHLIGHT_MARGIN_SCREENS * vh;
    const bandBottom = (1 + HIGHLIGHT_MARGIN_SCREENS) * vh;
    // The binary search needs visible cards
    const matches = visibleOnly(searchMatches);
    for (let i = firstCardWhere(matches, r => r.bottom >= bandTop); i < matches.length; i++) {
      const card = matches[i];
      if (card.getBoundingClientRect().top > bandBottom) break;
      for (const target of cardTargets.get(card) || []) {
        const r = target.getBoundingClientRect();
        if (!r.height || r.bottom < bandTop || r.top > bandBottom) continue;
        for (const range of rangeTargets.get(target)) {
          const hl = highlightOf(range);
          if (!hl.has(range)) hl.add(range);
        }
      }
    }
  }

  if (HIGHLIGHT_API) {
    // Printing lays out the whole document at once: register every range
    // while it lasts, then observe again (the observer reports each target's
    // current state, trimming back to the viewport)
    window.addEventListener('beforeprint', () => {
      highlightObserver.disconnect();
      for (const ranges of rangeTargets.values()) {
        for (const range of ranges) highlightOf(range).add(range);
      }
    });
    window.addEventListener('afterprint', () => {
      for (const target of rangeTargets.keys()) highlightObserver.observe(target);
    });
  }

  function getCardHits(card) {
    return cardHits.get(card) || [];
  }

  function isMarkHit(hit) {
    return hit.nodeType === Node.ELEMENT_NODE;
  }

  // Element containing a hit (for .closest() lookups)
  function hitElement(hit) {
    return isMarkHit(hit) ? hit : hit.startContainer.parentElement;
  }

  function hitBox(hit) {
    if (isMarkHit(hit)) return hit;
    const range = document.createRange();
    range.setStart(hit.startContainer, hit.startOffset);
    range.setEnd(hit.endContainer, hit.endOffset);
    return range;
  }

  function hitHasBox(hit) {
    return hitBox(hit).getClientRects().length > 0;
  }

  function hitRect(hit) {
    return hitBox(hit).getBoundingClientRect();
  }

  function clearHighlights() {
    if (HIGHLIGHT_API) {
      highlightObserver.takeRecords();
      highlightObserver.disconnect();
      searchHighlight.clear();
      weakHighlight.clear();
    }
    weakRanges = new Set();
    // Put back the exact text nodes that <mark>s replaced
    for (const [textNode, first, last] of markedTextNodes) {
      const parent = first.parentNode;
      if (!parent) continue;
      parent.insertBefore(textNode, first);
      for (let n = first, next; n; n = next) {
        next = n === last ? null : n.nextSibling;
        parent.removeChild(n);
      }
    }
    markedTextNodes = [];
    cardHits = new Map();
    textNodeHits = new Map();
    rangeTargets = new Map();
    cardTargets = new Map();
  }

  // Text nodes of a card, skipping footnote boxes unless requested and the
  // indent hints ("7§1I", decoration repeating the dispositivo's path)
  function cardTextWalker(card, includeFootnotes) {
    return document.createTreeWalker(card, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT
        : n.classList.contains('indent-path') || n.classList.contains('rem-box') ? NodeFilter.FILTER_REJECT
        : (!includeFootnotes && n.classList.contains('footnote-box') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP),
    });
  }

  // Normalized text per card, [without footnotes, with footnotes]. Built on
  // first use (and warmed when idle); a card's text only changes when a diff
  // panel opens or closes, which calls invalidateCardText.
  const cardTextCache = new Map();

  function getCardText(card, includeFootnotes) {
    let entry = cardTextCache.get(card);
    if (!entry) cardTextCache.set(card, entry = [null, null]);
    const i = includeFootnotes ? 1 : 0;
    if (entry[i] === null) {
      let text = '';
      const walker = cardTextWalker(card, includeFootnotes);
      while (walker.nextNode()) text += walker.currentNode.data;
      // the right form of the official text's typos (data-busca): the search finds the
      // provision by the right word, and the reader still sees the faithful text
      if (card.dataset.busca) text += ' \u0000 ' + card.dataset.busca;
      entry[i] = stripAccents(text.toLowerCase()).replace(/\xa0/g, ' ');
    }
    return entry[i];
  }

  function invalidateCardText(card) {
    if (card) cardTextCache.delete(card);
  }

  function parseSearchTerms(input) {
    const phrases = [];
    const words = [];
    const normalized = stripAccents(input.toLowerCase());
    const re = /"([^"]+)"/g;
    let match;
    let remaining = normalized;
    while ((match = re.exec(normalized)) !== null) {
      const phrase = match[1].trim();
      if (phrase) phrases.push(phrase);
      remaining = remaining.replace(match[0], ' ');
    }
    remaining.split(/\s+/).filter(Boolean).forEach(w => words.push(w));
    return { phrases, words };
  }

  // Terms of a single character match nearly every article, so they don't
  // trigger a text search (typing "r222" goes through "r" first)
  const MIN_TERM_LENGTH = 2;

  // The prefix of an article asked for in the search bar: its law (data-law)
  const NAV_LAWS = { r: '', l: 'LOM' };

  // What doSearch will do with a term:
  //  'empty' → clear; 'nav' → go to an article: r43, r183a, rADT1 in the
  //  Regimento, l43, l229-B, lADT15A in the Lei Orgânica;
  //  'short' → no term reaches MIN_TERM_LENGTH; 'text' → text search.
  // A "n " prefix (notas) includes footnotes in the search.
  function classifyQuery(term) {
    if (!term) return { kind: 'empty' };
    let includeFootnotes = false;
    const footnoteMatch = term.match(/^n\s+(.+)$/i);
    if (footnoteMatch) {
      includeFootnotes = true;
      term = footnoteMatch[1];
    }
    const m = term.match(/^([rl])(adt)?(\d+)(?:-?([a-z]))?$/i);
    if (m) {
      const art = (m[2] ? 'ADT' : '') + m[3] + (m[4] ? '-' + m[4].toUpperCase() : '');
      return { kind: 'nav', law: NAV_LAWS[m[1].toLowerCase()], art };
    }
    const { phrases, words } = parseSearchTerms(term);
    let longest = 0;
    for (const t of phrases.concat(words)) longest = Math.max(longest, t.length);
    if (longest < MIN_TERM_LENGTH) return { kind: 'short' };
    return { kind: 'text', includeFootnotes, phrases, words, longest };
  }

  // Short words (de, da, em, a...) count only as whole words: "de" alone
  // was in Presidente, ordem, idade... Among other words ("prazo de votação")
  // they get a fainter mark, and neither the jumps, the results list nor the
  // snippets go to them.
  const SHORT_WORDS = new Set(['a', 'o', 'e', 'as', 'os', 'ao', 'aos', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
    'para', 'por', 'pelo', 'pela', 'com', 'um', 'uma', 'que', 'se']);
  const WHOLE_WORD = p => '(?<![\\p{L}\\p{N}])' + p + '(?![\\p{L}\\p{N}])';
  const wholeWordRes = new Map();
  function hasWord(text, w) {
    if (!SHORT_WORDS.has(w)) return text.includes(w);
    let re = wholeWordRes.get(w);
    if (!re) wholeWordRes.set(w, re = new RegExp(WHOLE_WORD(w), 'u'));
    return re.test(text);
  }

  function buildHighlightRegex(phrases, words) {
    const esc = t => accentInsensitivePattern(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // Phrases first (longer matches take priority in alternation)
    const allPatterns = [
      ...phrases.map(p => esc(p).replace(/ +/g, '[\\s\\xa0]+')),
      ...words.map(t => SHORT_WORDS.has(t) ? WHOLE_WORD(esc(t)) : esc(t))
    ];
    const regex = new RegExp('(' + allPatterns.join('|') + ')', 'giu');
    // the short words that get the fainter mark (none if the query has only them)
    regex.weak = new Set(words.some(w => !SHORT_WORDS.has(w))
      ? words.filter(w => SHORT_WORDS.has(w) && !phrases.includes(w)) : []);
    return regex;
  }

  function isWeakMatch(regex, match) {
    return regex.weak.size > 0 && regex.weak.has(stripAccents(match.toLowerCase()));
  }

  function highlightText(card, regex, includeFootnotes) {
    const found = []; // [text node, [[start, end, weak], ...]]
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const tn = walker.currentNode;
      let spans = null;
      let m;
      regex.lastIndex = 0;
      while ((m = regex.exec(tn.data)) !== null) {
        if (!m[0].length) { regex.lastIndex++; continue; }
        (spans || (spans = [])).push([m.index, m.index + m[0].length, isWeakMatch(regex, m[0])]);
      }
      if (!spans) continue;
      if (!includeFootnotes && tn.parentElement.closest('.footnote-box')) continue;
      if (tn.parentElement.closest('.indent-path, .rem-box')) continue;
      found.push([tn, spans]);
    }
    if (!found.length) return;

    const hits = [];
    const ranges = [];
    for (const [tn, spans] of found) {
      // (the weak ones are painted, but aren't hits: see SHORT_WORDS)
      if (HIGHLIGHT_API && !tn.parentElement.closest(UNSELECTABLE_TEXT)) {
        const strong = spans.filter(sp => !sp[2]);
        if (strong.length) textNodeHits.set(tn, strong);
        for (const [start, end, weak] of spans) {
          const range = new StaticRange({ startContainer: tn, startOffset: start, endContainer: tn, endOffset: end });
          if (weak) weakRanges.add(range);
          else hits.push(range);
          ranges.push(range);
        }
        continue;
      }
      const data = tn.data;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const [start, end, weak] of spans) {
        if (start > last) frag.appendChild(document.createTextNode(data.slice(last, start)));
        const mark = document.createElement('mark');
        mark.textContent = data.slice(start, end);
        frag.appendChild(mark);
        if (weak) mark.className = 'weak';
        else hits.push(mark);
        last = end;
      }
      if (last < data.length) frag.appendChild(document.createTextNode(data.slice(last)));
      markedTextNodes.push([tn, frag.firstChild, frag.lastChild]);
      tn.parentNode.replaceChild(frag, tn);
    }
    cardHits.set(card, hits);
    if (ranges.length) trackRanges(card, ranges);
  }

  function resetSearchNav() {
    indexMatches = null;
    resultsShownFor = null;
    hideResults();
    searchMatches = [];
    searchIdx = 0;
    $searchNav.classList.remove('open', 'index-only');
    $searchInput.classList.remove('has-nav');
    updateSearchTicks();
    scheduleMinimap();
  }

  // Selection and breadcrumb normally follow scroll events; after un-filtering
  // without a scroll (no scroll anchoring in WebKit) they must be refreshed
  function refreshScrollState() {
    requestAnimationFrame(syncToScroll);
  }

  // The articles of the chip in the search bar, out of these cards
  function inScope(cards) {
    if (scope.kind === 'subject') {
      const keys = new Set(scope.refs.map(r => (r.law_prefix || '') + ':' + r.art));
      return cards.filter(c => keys.has((c.dataset.law || '') + ':' + c.dataset.art));
    }
    const marked = new Set(markersList.map(m => {
      const el = $cards.querySelector(`.unit-id[data-uid="${m.uid}"]`);
      return el && el.closest('.card-artigo');
    }));
    return cards.filter(c => marked.has(c));
  }

  // An article asked for in the search bar (r43, l23...)
  function goToArticle(target) {
    revealCard(target);   // hidden by a filter: shown anyway
    const targetY = target.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.25;
    scrollToY(targetY, 'smooth');
    selectCard(target, true);
  }

  // Searches the search bar's terms, within the articles of its chip (if
  // any); with a chip and no terms, its articles are the results
  function doSearch(term) {
    // A run for the input's current value supersedes the pending one; runs
    // for an older term (currentSearch, from marker changes) leave it
    // pending so the newer term still applies
    if (term === $searchInput.value.trim()) cancelPendingSearch();
    if (scrollRafId) { cancelAnimationFrame(scrollRafId); scrollRafId = null; }
    // (the state before it, if it opens the drawer)
    const before = !restoring && !resultsWide.matches && !resultsDrawerOpen ? stepState() : null;
    currentSearch = term;
    clearHighlights();
    const cards = getAllCards();
    const hiddenBefore = cards.filter(c => c.classList.contains('filtered-out'));
    cards.forEach(c => c.classList.remove('filtered-out'));

    const opening = scopeOpening;
    const startCard = scopeStartCard;
    scopeOpening = false;
    scopeStartCard = null;
    const query = classifyQuery(term);
    $btnClearSearch.style.display = query.kind === 'empty' && !scope ? 'none' : 'flex';

    let navTarget = null;
    if (query.kind === 'nav') {
      // (the Regimento's cards have no data-law)
      navTarget = $cards.querySelector(`.card-artigo[data-art="${query.art}"]`
        + (query.law ? `[data-law="${query.law}"]` : ':not([data-law])'));
    }

    const text = query.kind === 'text';
    if (!text && !scope) {
      if (navTarget) goToArticle(navTarget);
      resetSearchNav();
      if (query.kind !== 'nav' && hiddenBefore.some(c => !c.classList.contains('filtered-out'))) refreshScrollState();
      return;
    }

    const articleCards = scope ? inScope(getArticleCards()) : getArticleCards();
    let matched = articleCards;
    if (text) {
      const { phrases, words, includeFootnotes } = query;
      const regex = buildHighlightRegex(phrases, words);
      matched = [];
      for (const card of articleCards) {
        const cardText = getCardText(card, includeFootnotes);
        if (phrases.every(p => cardText.includes(p)) && words.every(t => hasWord(cardText, t))) {
          matched.push(card);
          highlightText(card, regex, includeFootnotes);
          // Open footnote boxes that contain highlights
          if (includeFootnotes) {
            for (const hit of getCardHits(card)) {
              const box = hitElement(hit).closest('.footnote-box');
              if (box) box.classList.add('open');
            }
          }
        }
      }
      // The same terms again (a filter or the chip changed): the same
      // object, so the list keeps its indexes' part. The indexes are searched
      // whole, a chip or not: they lead to other subjects.
      const indexKey = JSON.stringify([phrases, words]);
      // the query as typed (without quotes nor the "n " prefix), for the fichas' search terms
      const typed = normIndexText((includeFootnotes ? term.replace(/^\s*n\s+/i, '') : term).replace(/"/g, ' ')).trim();
      if (!indexMatches || indexMatches.key !== indexKey) indexMatches = searchIndexes(phrases, words, regex, indexKey, typed);
    } else {
      indexMatches = null;
    }

    if (searchFilter) {
      const matchedSet = new Set(matched);
      for (const card of cards) {
        if (card.classList.contains('filtered-out')) continue;
        if (card.classList.contains('card-titulo') || !matchedSet.has(card)) {
          card.classList.add('filtered-out');
        }
      }
      showContextHeadings();
    }

    searchMatches = matched;
    // A new search (terms, chip) shows its results (the sidebar, or on
    // small screens the drawer, below the search bar), even if the list was
    // closed for an earlier one. The same one run again (a filter changed)
    // leaves it as is. A chip alone (just opened, or its terms cleared)
    // goes straight to its articles, without the drawer over them.
    const shownFor = (scope ? scope.kind + ':' + scope.label : '') + '\u0000' + (text ? term : '');
    if (shownFor !== resultsShownFor) {
      resultsShownFor = shownFor;
      resultsHidden = false;
      if (!resultsWide.matches) {
        if (text && !resultsDrawerOpen) takeStep('drawer', before);
        resultsDrawerOpen = text;
      }
    }
    showResults();

    // Where it goes: the article asked for; the one the chip was opened
    // from; the first result of new terms or of a chip just opened. Its
    // terms cleared or a filter changed, the chip's reading goes on where
    // it was (unless that article got hidden).
    let i = 0;
    let go = true;
    if (navTarget) {
      i = matched.indexOf(navTarget);
    } else if (startCard && matched.includes(startCard)) {
      i = matched.indexOf(startCard);
    } else if (!text && !opening) {
      go = !selectedCard || selectedCard.classList.contains('filtered-out');
      i = go ? 0 : matched.indexOf(selectedCard);
    }
    searchIdx = i;

    if (matched.length > 0) {
      $searchNav.classList.add('open');
      $searchNav.classList.remove('index-only');
      $searchInput.classList.add('has-nav');
      updateSearchCounter();
      updateSearchTicks();
      if (navTarget) {
        goToArticle(navTarget);
      } else if (go) {
        scrollToFirstMark(matched[i]);
        selectCard(matched[i], true);
      } else {
        refreshScrollState();
      }
    } else {
      // Found only in the indexes, or nothing in the chip's articles: the
      // counter (which opens the list) says so
      const shown = indexMatches !== null && indexMatches.count > 0 || scope !== null;
      $searchNav.classList.toggle('open', shown);
      $searchNav.classList.toggle('index-only', shown);
      $searchInput.classList.toggle('has-nav', shown);
      if (shown) updateSearchCounter();
      updateSearchTicks();
      if (navTarget) goToArticle(navTarget);
    }
    scheduleMinimap();
  }

  // Text search waits for a pause in typing: intermediate terms ("p", "pr",
  // "pre"...) are the expensive ones and the next key throws them away.
  // Clearing and article navigation stay immediate.
  const SEARCH_DELAY_MS = 200;
  const SHORT_TERM_SEARCH_DELAY_MS = 400; // terms of up to 3 characters
  let searchTimer = null;

  function cancelPendingSearch() {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
  }

  function flushPendingSearch() {
    if (searchTimer) doSearch($searchInput.value.trim());
  }

  $searchInput.addEventListener('input', (e) => {
    const term = e.target.value.trim();
    cancelPendingSearch();
    const query = classifyQuery(term);
    if (query.kind === 'empty' || query.kind === 'short') {
      // Like Esc and the clear button: the cards shown again above must not
      // move the article being read (closing the results sidebar at the same
      // time defeats the browser's scroll anchoring)
      preserveScroll(() => doSearch(term));
      return;
    }
    if (query.kind !== 'text') {
      doSearch(term);
      return;
    }
    searchTimer = setTimeout(() => {
      searchTimer = null;
      doSearch($searchInput.value.trim());
    }, query.longest <= 3 ? SHORT_TERM_SEARCH_DELAY_MS : SEARCH_DELAY_MS);
  });

  $searchInput.addEventListener('keydown', (e) => {
    // Backspace in the empty bar takes its chip out, as in a field of tags
    if (e.key === 'Backspace' && scope && !$searchInput.value) {
      e.preventDefault();
      removeScope();
      return;
    }
    if (e.key !== 'Enter') return;
    flushPendingSearch();
    if (searchMatches.length) {
      e.preventDefault();
      navigateSearch(e.shiftKey ? -1 : 1);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if ($searchInput.value || scope) clearSearchBar();
      $searchInput.focus();
    }
    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault();
      $searchInput.focus();
      $searchInput.select();
    }
  });

  // Clearing the bar takes out its terms and its chip
  function clearSearchBar() {
    $searchInput.value = '';
    closeScope();
    preserveScroll(() => doSearch(''));
  }

  $btnClearSearch.addEventListener('click', clearSearchBar);

  $btnFilter.addEventListener('click', () => {
    searchFilter = !searchFilter;
    $btnFilter.classList.toggle('active', searchFilter);
    preserveScroll(() => doSearch($searchInput.value.trim()));
  });

  // searchIdx is -1 when the selected article isn't one of the results
  function updateSearchCounter() {
    $searchCounter.textContent = searchMatches.length
      ? (searchIdx < 0 ? '–' : searchIdx + 1) + ' / ' + searchMatches.length
      : indexMatches && indexMatches.count ? indexMatches.count + ' no índice'
      : scope && scope.kind === 'markers' ? '0 nos marcados' : '0 no assunto';
  }

  function updateSearchTicks() {
    $searchTicks.innerHTML = '';
    $searchTickTooltip.classList.remove('visible');
    $searchTickTooltip.innerHTML = '';
    if (!searchMatches.length) return;
    const docH = document.documentElement.scrollHeight;
    const vpH = window.innerHeight;
    const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 56;
    const trackH = vpH - headerH;
    const frag = document.createDocumentFragment();
    searchMatches.forEach((card, i) => {
      const pct = card.offsetTop / docH;
      const tick = document.createElement('div');
      tick.className = 'tick' + (i === searchIdx ? ' current' : '');
      tick.style.top = (pct * trackH) + 'px';
      tick.addEventListener('click', () => {
        // While a search is pending, ticks belong to the previous term
        if (searchTimer) { flushPendingSearch(); return; }
        searchIdx = i;
        updateSearchCounter();
        updateTickCurrent();
        scrollToFirstMark(searchMatches[i]);
        selectCard(searchMatches[i], true);
      });
      tick.addEventListener('mouseenter', () => {
        if (searchTimer) return;
        buildSearchTickTooltip(searchMatches[i]);
        $searchTickTooltip.classList.add('visible');
        // Position: show tooltip, measure, then center on tick
        $searchTickTooltip.style.top = '0px';
        const tickRect = tick.getBoundingClientRect();
        const ttRect = $searchTickTooltip.getBoundingClientRect();
        let top = tickRect.top + tickRect.height / 2 - ttRect.height / 2;
        // Clamp to viewport
        if (top < 4) top = 4;
        if (top + ttRect.height > vpH - 4) top = vpH - 4 - ttRect.height;
        $searchTickTooltip.style.top = top + 'px';
      });
      tick.addEventListener('mouseleave', () => {
        $searchTickTooltip.classList.remove('visible');
      });
      frag.appendChild(tick);
    });
    $searchTicks.appendChild(frag);
  }

  function updateTickCurrent() {
    const ticks = $searchTicks.children;
    for (let i = 0; i < ticks.length; i++) {
      ticks[i].classList.toggle('current', i === searchIdx);
    }
  }

  function navigateSearch(delta) {
    flushPendingSearch();
    if (!searchMatches.length) return;
    searchIdx = searchIdx < 0 ? (delta > 0 ? 0 : searchMatches.length - 1)
      : (searchIdx + delta + searchMatches.length) % searchMatches.length;
    updateSearchCounter();
    updateTickCurrent();
    scrollToFirstMark(searchMatches[searchIdx]);
    selectCard(searchMatches[searchIdx], true);
  }

  let tickResizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(tickResizeTimer);
    tickResizeTimer = setTimeout(() => {
      if (searchMatches.length) updateSearchTicks();
    }, 150);
  });

  document.getElementById('search-prev').addEventListener('click', () => navigateSearch(-1));
  document.getElementById('search-next').addEventListener('click', () => navigateSearch(1));

  // ===== RESULTS LIST =====
  // Every matched dispositivo with just the text around its matches, grouped
  // by article: a sidebar on wide screens, a drawer (opened from the counter
  // or the index panel) on small ones. Groups are appended as the list is
  // scrolled towards its end, and get their entries when they come near its
  // visible part.
  const $resultsPanel = document.getElementById('results-panel');
  const $resultsList = document.getElementById('results-list');
  const $resultsTitle = document.getElementById('results-title');
  const $resultsSummary = document.getElementById('results-summary');
  const $resultsClose = document.getElementById('results-close');
  const $indexResultsLink = document.getElementById('index-results-link');
  // Sidebar breakpoint: keep in sync with style.css
  const resultsWide = window.matchMedia('(min-width: 1180px)');
  const RESULT_UNITS_SHOWN = 3;       // per article; the rest behind "+N trechos"
  const RESULTS_FILLED_UPFRONT = 12;  // groups filled when the list is built
  const RESULTS_SLICE_MS = 8;         // appending groups in one go
  const RESULTS_END_SLICE_MS = 50;    // the same, with the end of the list in view,
  const RESULTS_END_SLICE_MAX = 300;  // and at most these groups (they're laid out
                                      // and filled in the same frame)
  const REVEAL_SETTLE_MS = 1500;      // keeps the current group in view while neighbors fill
  const SNIPPET_CONTEXT = 70;         // characters around each match
  const SNIPPET_WHOLE_UNDER = 240;    // shorter texts are shown whole
  const SNIPPET_WINDOWS = 3;
  // Matches there don't make entries nor count as occurrences
  const RESULT_NOISE = '.art-compact-label, .indent-path, .footnote-ref, .diff-toggle, .footnote-close, .diff-panel, .rem-box';
  // Not part of a dispositivo's text in a snippet (the entry's label shows
  // the .unit-id and "Nota N:" ones)
  const SNIPPET_SKIP = RESULT_NOISE + ', .unit-id, .footnote-box > strong';

  let resultsActive = false;        // a text search is showing its results
  let resultsBuiltFor = null;       // the searchMatches array the list shows
  let resultsBuildPending = false;
  let resultsPanelShown = false;
  let resultsDrawerOpen = false;
  let resultsHidden = false;        // sidebar closed by the user, until the next search
  let resultsShownFor = null;       // the search term that last showed the list
  // (closing it was remembered across visits before)
  try { localStorage.removeItem('regimento-results-hidden'); } catch (e) {}
  let resultGroups = new Map();     // card → its group element in the list
  let indexPart = null;             // the list's element with the indexes' results
  let indexPartFor = null;          // the indexMatches it shows
  const groupCards = new WeakMap(); // group element → card
  const filledGroups = new WeakSet();
  let resultsAppended = 0;          // searchMatches with a group in the list so far
  let resultsLaw = null;            // law of the last appended group
  let cardLawTitles = null;         // card → title of its law
  let currentResultGroup = null;
  let revealGroup = null;           // group kept in view until revealUntil
  let revealUntil = 0;
  let revealPending = false;        // a reveal was skipped (list hidden, mouse on it)
  let mouseOnResults = false;

  // Entries of the groups near the visible part of the list
  const resultsFillObserver = new IntersectionObserver(entries => {
    let filled = false;
    for (const entry of entries) {
      if (entry.isIntersecting && fillResultGroup(groupCards.get(entry.target))) filled = true;
    }
    if (filled) keepRevealedGroupInView();
  }, { root: $resultsList, rootMargin: '100% 0px' });

  // More groups when the end of the list comes near. With the end itself in
  // view after a scroll (a drag or fling to the end), bigger slices: fewer
  // rounds of appending and filling what was appended.
  const resultsMoreObserver = new IntersectionObserver(entries => {
    if (!entries.some(e => e.isIntersecting) || resultsBuiltFor !== searchMatches) return;
    const last = entries[entries.length - 1];
    // rootBounds includes the 200% margins: the list's own bottom is 2/5 up
    const endInView = $resultsList.scrollTop > 0 && last.rootBounds !== null
      && last.boundingClientRect.top < last.rootBounds.bottom - last.rootBounds.height * 2 / 5;
    const until = endInView
      ? Math.min(searchMatches.length, resultsAppended + RESULTS_END_SLICE_MAX)
      : searchMatches.length;
    appendResultGroups(until, performance.now() + (endInView ? RESULTS_END_SLICE_MS : RESULTS_SLICE_MS));
    observeLastResultGroup();
  }, { root: $resultsList, rootMargin: '200% 0px' });

  function observeLastResultGroup() {
    resultsMoreObserver.disconnect();
    const last = $resultsList.lastElementChild;
    if (last && resultsAppended < searchMatches.length) resultsMoreObserver.observe(last);
  }

  function resultsShown() {
    return resultsActive && (resultsDrawerOpen || (resultsWide.matches && !resultsHidden));
  }

  function showResults() {
    resultsActive = true;
    updateResultsVisibility();
  }

  function hideResults() {
    resultsActive = false;
    resultsDrawerOpen = false;
    updateResultsVisibility();
    clearResultsList();
  }

  // keepIndex: the indexes' results stay (as expanded, focused and scrolled
  // as they are); only the cards' results go
  function clearResultsList(keepIndex) {
    if (!resultsBuiltFor) return;
    resultsFillObserver.disconnect();
    resultsMoreObserver.disconnect();
    resultsBuiltFor = null;
    resultGroups = new Map();
    resultsAppended = 0;
    currentResultGroup = null;
    revealGroup = null;
    revealPending = false;
    if (keepIndex && indexPart && $resultsList.lastChild !== indexPart) {
      const rest = document.createRange();
      rest.setStartAfter(indexPart);
      rest.setEndAfter($resultsList.lastChild);
      rest.deleteContents();
    } else if (!keepIndex) {
      $resultsList.textContent = '';
      indexPart = indexPartFor = null;
    }
    $resultsSummary.textContent = '';
  }

  function updateResultsVisibility() {
    if (!resultsDrawerOpen) dropStep('drawer');
    document.body.classList.toggle('results-open', resultsActive && resultsWide.matches && !resultsHidden);
    document.body.classList.toggle('results-drawer-open', resultsDrawerOpen);
    $indexOverlay.classList.toggle('open', resultsDrawerOpen || $indexPanel.classList.contains('open'));
    $indexResultsLink.hidden = !resultsActive;
    if (resultsActive) {
      const n = searchMatches.length + (indexMatches ? indexMatches.count : 0);
      $indexResultsLink.textContent = 'Lista de resultados da busca (' + n + ') ›';
    }
    const shown = resultsShown();
    $searchCounter.setAttribute('aria-expanded', shown ? 'true' : 'false');
    const becameShown = shown && !resultsPanelShown;
    resultsPanelShown = shown;
    if (!shown) {
      // Hidden (and emptied) under a still mouse, the list gets no pointerleave
      mouseOnResults = false;
      // A hidden list of an older search would flash when shown again
      if (resultsBuiltFor && resultsBuiltFor !== searchMatches) clearResultsList();
      return;
    }
    if (resultsBuiltFor !== searchMatches) {
      scheduleResultsBuild();
    } else if (becameShown) {
      observeLastResultGroup();
      // Shown again as built: the indexes' results first, if the first match
      // is still the selected one
      if (!listStartsWithIndex()) {
        markCurrentResult(selectedCard);
        revealCurrentResult(true);
      }
    }
  }

  // The list starts with the indexes' results, and the first match (right
  // below them) is marked but not scrolled to
  function listStartsWithIndex() {
    return indexMatches !== null && indexMatches.count > 0 && searchMatches.length > 0
      && selectedCard === searchMatches[0];
  }

  // Built after the search result is painted, so typing stays responsive
  function scheduleResultsBuild() {
    if (resultsBuildPending) return;
    resultsBuildPending = true;
    requestAnimationFrame(() => setTimeout(() => {
      resultsBuildPending = false;
      if (resultsShown() && resultsBuiltFor !== searchMatches) buildResultsList();
    }, 0));
  }

  function openResults() {
    if (resultsWide.matches) {
      setResultsHidden(false);
    } else {
      if (stepKinds.get(stepId) !== 'drawer') takeStep('drawer');
      resultsDrawerOpen = true;
      updateResultsVisibility();
      $resultsClose.focus({ preventScroll: true });
    }
  }

  // byKeyboard: the x activated by a key. A click focuses the x too, but a
  // mouse user's next Space should scroll the page, not reopen the list.
  function closeResults(byKeyboard) {
    const hadFocus = byKeyboard === true && $resultsPanel.contains(document.activeElement);
    if (resultsDrawerOpen) {
      resultsDrawerOpen = false;
      updateResultsVisibility();
    } else {
      setResultsHidden(true);
    }
    // The counter is hidden when there are no results
    if (hadFocus) {
      ($searchNav.classList.contains('open') ? $searchCounter : $searchInput).focus({ preventScroll: true });
    }
  }

  function setResultsHidden(hidden) {
    resultsHidden = hidden;
    preserveScroll(updateResultsVisibility);
  }

  function buildResultsList() {
    // Rebuilt for the same search (a subject or section opened from the list
    // runs it again): the indexes' results are the same, and stay as they are
    const keepIndex = indexPart !== null && indexPartFor === indexMatches;
    const scrollTop = $resultsList.scrollTop;
    clearResultsList(keepIndex);
    resultsBuiltFor = searchMatches;
    resultsLaw = null;
    if (!keepIndex) $resultsList.scrollTop = 0;

    let hits = 0;
    const noisy = new Map(); // element → inside RESULT_NOISE
    for (const card of searchMatches) {
      for (const hit of getCardHits(card)) {
        const el = hitElement(hit);
        let noise = noisy.get(el);
        if (noise === undefined) noisy.set(el, noise = el.closest(RESULT_NOISE) !== null);
        if (!noise) hits++;
      }
    }
    const nPrec = searchMatches.filter(isPrecCard).length;
    const nArt = searchMatches.length - nPrec;
    const nIndex = indexMatches ? indexMatches.count : 0;
    const counts = [];
    if (nArt) counts.push(nArt + (nArt === 1 ? ' artigo' : ' artigos'));
    if (nPrec) counts.push(nPrec + (nPrec === 1 ? ' precedente' : ' precedentes'));
    // A subject alone has no occurrences: its dispositivos are the entries
    const text = classifyQuery(currentSearch).kind === 'text';
    const summary = [];
    if (searchMatches.length) summary.push(counts.join(', '));
    if (searchMatches.length && text) summary.push(hits + (hits === 1 ? ' ocorrência' : ' ocorrências'));
    if (nIndex) summary.push(nIndex + ' no índice');
    $resultsSummary.textContent = summary.join(' · ');
    if (nIndex && !keepIndex) appendIndexResults();
    if (!searchMatches.length) {
      const empty = document.createElement('div');
      empty.className = 'res-empty';
      empty.textContent = (nIndex ? 'Nenhum resultado no texto das normas'
        : text ? 'Nenhum resultado para “' + currentSearch + '”' : 'Nenhum artigo visível')
        + (!scope ? '' : scope.kind === 'markers' ? ' nos marcados' : ' em “' + scope.label + '”');
      $resultsList.appendChild(empty);
      if (keepIndex) $resultsList.scrollTop = scrollTop;
      return;
    }

    appendResultGroups(searchMatches.length, performance.now() + RESULTS_SLICE_MS);
    // The top of the list shows filled right away (the observer reports later)
    for (const card of searchMatches.slice(0, RESULTS_FILLED_UPFRONT)) fillResultGroup(card);
    observeLastResultGroup();
    // The list stays where it was (on the indexes' result just used), or
    // starts at its top with the indexes' results: the selected match is
    // marked, not scrolled to
    if (keepIndex) $resultsList.scrollTop = scrollTop;
    markCurrentResult(selectedCard, !keepIndex && !listStartsWithIndex());
  }

  // Appends groups for searchMatches[resultsAppended, until), stopping early
  // at the deadline (a performance.now() time); the list's first group is
  // always appended
  function appendResultGroups(until, deadline = Infinity) {
    const frag = document.createDocumentFragment();
    while (resultsAppended < until) {
      if (resultsAppended && performance.now() >= deadline) break;
      const card = searchMatches[resultsAppended++];
      const lawTitle = resultLawTitle(card);
      if (lawTitle !== resultsLaw) {
        resultsLaw = lawTitle;
        if (lawTitle) {
          const sep = document.createElement('div');
          sep.className = 'res-law';
          sep.dataset.nrm = card.dataset.law || 'RI';
          sep.setAttribute('role', 'heading');
          sep.setAttribute('aria-level', '3');
          sep.textContent = lawTitle;
          frag.appendChild(sep);
        }
      }
      const group = buildResultGroup(card);
      resultGroups.set(card, group);
      frag.appendChild(group);
      resultsFillObserver.observe(group);
    }
    $resultsList.appendChild(frag);
  }

  // Title of the law (norma heading) an article belongs to
  function resultLawTitle(card) {
    if (!cardLawTitles) {
      cardLawTitles = new Map();
      let title = '';
      for (const c of ALL_CARDS) {
        if (c.classList.contains('card-titulo')) {
          if (headingLevel(c) === 'norma') title = getHeadingShortTitle(c);
        } else {
          cardLawTitles.set(c, title);
        }
      }
    }
    return cardLawTitles.get(card) || '';
  }

  function buildResultGroup(card) {
    const group = document.createElement('div');
    group.className = 'res-group';
    groupCards.set(group, card);
    const head = document.createElement('button');
    head.className = 'res-head';
    const lawPrefix = card.dataset.law;
    if (lawPrefix) {
      const tag = document.createElement('span');
      tag.className = 'res-law-tag ' + lawPrefix;
      const matched = getCardHits(card).some(hit => hitElement(hit).closest('.law-badge'));
      tag.innerHTML = matched ? '<mark>' + escapeHtml(lawPrefix) + '</mark>' : escapeHtml(lawPrefix);
      head.appendChild(tag);
    }
    head.appendChild(document.createTextNode(isPrecCard(card) ? precLabel(card.dataset.art) : 'Art. ' + card.dataset.art));
    const summary = card.querySelector('.art-summary');
    if (summary) {
      const sum = document.createElement('span');
      sum.className = 'res-sum';
      if (summary.querySelector('mark')) {
        const { text, spans } = unitTextAndMatches(summary);
        sum.innerHTML = ' — ' + markSpans(text, 0, text.length, spans);
      } else {
        sum.textContent = ' — ' + summary.textContent;
      }
      head.appendChild(sum);
    }
    head.addEventListener('click', e => goToResult(card, null, e));
    group.appendChild(head);
    return group;
  }

  // Returns whether the group got its entries now
  function fillResultGroup(card) {
    const group = resultGroups.get(card);
    if (!group || filledGroups.has(group)) return false;
    filledGroups.add(group);
    resultsFillObserver.unobserve(group);
    const units = resultUnits(card);
    const shown = units.slice(0, RESULT_UNITS_SHOWN);
    for (const unit of shown) group.appendChild(buildResultEntry(card, unit));
    if (units.length > shown.length) {
      const more = document.createElement('button');
      more.className = 'res-expand';
      const rest = units.length - shown.length;
      more.textContent = '+ ' + rest + (rest === 1 ? ' trecho' : ' trechos');
      more.addEventListener('click', () => {
        for (const unit of units.slice(RESULT_UNITS_SHOWN)) group.insertBefore(buildResultEntry(card, unit), more);
        more.remove();
      });
      group.appendChild(more);
    }
    return true;
  }

  // Dispositivos (paragraphs, notes) of a card with matches, in order. The
  // summary and the law badge are shown in the group header instead. A
  // chip without terms: the ones the subject cites or that are marked (none
  // when the subject cites the whole article, which is the group header).
  function resultUnits(card) {
    if (!getCardHits(card).length) return Array.from(card.querySelectorAll('.scope-unit'));
    const units = [];
    const seen = new Set();
    for (const hit of getCardHits(card)) {
      const el = hitElement(hit);
      if (el.closest('.art-summary, .law-badge, ' + RESULT_NOISE)) continue;
      const unit = el.closest('.footnote-box') || el.closest('.art-para') || el.closest('p');
      if (!unit || !card.contains(unit) || seen.has(unit)) continue;
      seen.add(unit);
      units.push(unit);
    }
    return units;
  }

  function buildResultEntry(card, unit) {
    const entry = document.createElement('button');
    entry.className = 'res-entry' + (unit.classList.contains('old-version') ? ' res-old' : '');
    const label = document.createElement('span');
    label.className = 'res-label';
    label.innerHTML = unitLabelHtml(unit);
    const text = document.createElement('span');
    text.className = 'res-text';
    const { text: unitText, spans } = unitTextAndMatches(unit);
    text.innerHTML = snippetHtml(unitText, spans);
    entry.append(label, ' ', text);
    entry.addEventListener('click', e => goToResult(card, unit, e));
    return entry;
  }

  function formatUnitPath(path) {
    return path.split(',').map(p => p === '§ú' ? 'Parágrafo único' : p).join(' › ');
  }

  function unitLabel(unit) {
    if (unit.classList.contains('leg-box')) {
      // legislação correlata: the provision it belongs to (the paragraph right before the box)
      const owner = unit.previousElementSibling;
      const base = owner && owner.tagName === 'P' ? unitLabel(owner) : '';
      return (base ? base + ' › ' : '') + 'Legislação correlata';
    }
    if (unit.classList.contains('footnote-box')) return 'Nota ' + (unit.dataset.note || '');
    if (unit.closest('.card-prec') && !unit.classList.contains('old-version')) return '';  // running text
    if (unit.classList.contains('old-version')) {
      return 'redação anterior' + (unit.dataset.ident ? ' · ' + unit.dataset.ident : '');
    }
    const uid = unit.querySelector('.unit-id[data-path]');
    if (uid) return formatUnitPath(uid.dataset.path);
    if (!unit.classList.contains('art-para')) return 'caput';
    // Continuation of the dispositivo above (e.g. a quoted oath)
    for (let p = unit.previousElementSibling; p; p = p.previousElementSibling) {
      if (p.tagName !== 'P' || p.classList.contains('old-version')) continue;
      const prev = p.querySelector('.unit-id[data-path]');
      if (prev) return formatUnitPath(prev.dataset.path);
      if (!p.classList.contains('art-para')) return 'caput';
    }
    return '';
  }

  // The label as HTML. When the card's own label (.unit-id, "Nota N:") has
  // matches, its last part is that label with them highlighted.
  function unitLabelHtml(unit) {
    const label = unitLabel(unit);
    const own = unit.classList.contains('footnote-box') ? unit.querySelector(':scope > strong')
      : unit.classList.contains('old-version') ? null : unit.querySelector('.unit-id');
    const { text, spans } = own ? unitTextAndMatches(own) : { text: '', spans: [] };
    if (!spans.length) return escapeHtml(label);
    const parts = label.split(' › ');
    parts.pop();
    const ownHtml = markSpans(text, 0, text.replace(/[\s:]+$/, '').length, spans);
    return parts.map(escapeHtml).concat(ownHtml).join(' › ');
  }

  // Text of a dispositivo (without its label) and where its matches are
  function unitTextAndMatches(unit) {
    let text = '';
    const spans = [];
    const walker = document.createTreeWalker(unit, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT
        : n.matches(SNIPPET_SKIP) ? NodeFilter.FILTER_REJECT
        : /^(BR|DIV|P)$/.test(n.tagName) ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP,
    });
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n.nodeType !== Node.TEXT_NODE) {
        text += ' '; // line breaks and blocks (notes)
        continue;
      }
      const base = text.length;
      if (n.parentElement.tagName === 'MARK' && !n.parentElement.classList.contains('weak')) {
        spans.push([base, base + n.data.length]);
      } else {
        for (const [s, e] of textNodeHits.get(n) || []) spans.push([base + s, base + e]);
      }
      text += n.data;
    }
    return { text, spans };
  }

  // The text around the matches: whole if short, else up to SNIPPET_WINDOWS
  // excerpts of SNIPPET_CONTEXT characters on each side
  function snippetHtml(text, spans) {
    const start = /^[\s—–-]*/.exec(text)[0].length; // the " — " after the label
    const end = text.trimEnd().length;
    const windows = [];
    if (text.slice(start, end).replace(/\s+/g, ' ').length <= SNIPPET_WHOLE_UNDER) {
      windows.push([start, end]);
    } else if (!spans.length) {
      windows.push([start, start + SNIPPET_WHOLE_UNDER]);
    } else {
      for (const [s, e] of spans) {
        let a = Math.max(start, s - SNIPPET_CONTEXT);
        let b = Math.min(end, e + SNIPPET_CONTEXT);
        while (a > start && !/\s/.test(text[a - 1])) a--;
        while (b < end && !/\s/.test(text[b])) b++;
        const last = windows[windows.length - 1];
        if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
        else windows.push([a, b]);
      }
    }
    const shown = windows.slice(0, SNIPPET_WINDOWS);
    let html = shown[0][0] > start ? '… ' : '';
    shown.forEach(([a, b], i) => {
      if (i) html += ' … ';
      html += markSpans(text, a, b, spans);
    });
    if (shown[shown.length - 1][1] < end) html += ' …';
    if (windows.length > shown.length) {
      html += ' <span class="res-more-matches">(+' + (windows.length - shown.length) + ')</span>';
    }
    return html;
  }

  // text[a, b) as HTML, with the spans inside it as <mark>
  function markSpans(text, a, b, spans) {
    const plain = s => escapeHtml(s.replace(/\s+/g, ' '));
    let html = '';
    let pos = a;
    for (const [s, e] of spans) {
      if (e <= pos || s >= b) continue;
      const ms = Math.max(s, pos);
      const me = Math.min(e, b);
      html += plain(text.slice(pos, ms)) + '<mark>' + plain(text.slice(ms, me)) + '</mark>';
      pos = me;
    }
    return html + plain(text.slice(pos, b));
  }

  function goToResult(card, unit, event) {
    takeStep();
    const fromDrawer = resultsDrawerOpen;
    const i = searchMatches.indexOf(card);
    if (i >= 0) {
      searchIdx = i;
      updateSearchCounter();
      updateTickCurrent();
    }
    if (resultsDrawerOpen) {
      resultsDrawerOpen = false;
      updateResultsVisibility();
    }
    if (unit && unit.classList.contains('footnote-box')) unit.classList.add('open');
    if (unit && unit.getClientRects().length) scrollToReadingLine(unit);
    else scrollToFirstMark(card);
    selectCard(card, true);
    // A click: the user sees that group, nothing to reveal when the mouse leaves
    if (event && event.detail > 0) revealPending = false;
    // After a click or tap, PageDown and the arrows should scroll the page,
    // not the list. Keyboard activation keeps the focus on the sidebar list
    // (the drawer closes).
    if (fromDrawer || (event && event.detail > 0)) {
      card.tabIndex = -1;
      card.focus({ preventScroll: true });
    }
  }

  // Highlights the group of the selected card and scrolls the list to it
  // (unless reveal is false)
  function markCurrentResult(card, reveal = true) {
    if (resultsBuiltFor !== searchMatches || !card) return;
    if (!resultsShown()) {
      // Nothing appended nor measured in a hidden list: it's revealed when shown
      const group = resultGroups.get(card);
      if (group) setCurrentResultGroup(group);
      return;
    }
    if (resultsAppended < searchMatches.length) {
      const want = Math.min(searchMatches.length, searchMatches.indexOf(card) + 1 + 20);
      if (want > resultsAppended) {
        appendResultGroups(want);
        observeLastResultGroup();
      }
    }
    const group = resultGroups.get(card);
    if (!group || group === currentResultGroup) return;
    setCurrentResultGroup(group);
    if (reveal) revealCurrentResult(false);
  }

  function setCurrentResultGroup(group) {
    if (currentResultGroup) currentResultGroup.classList.remove('current');
    currentResultGroup = group;
    if (group) group.classList.add('current');
  }

  // Scrolls the list to the current group, unless the mouse is on it (then
  // it waits for the mouse to leave)
  function revealCurrentResult(force) {
    const group = currentResultGroup;
    if (!group) {
      revealPending = false;
      return;
    }
    if (!resultsShown()) {
      revealPending = true;
      return;
    }
    if (mouseOnResults && !force) {
      revealPending = !groupInView(group);
      return;
    }
    revealPending = false;
    // Groups above it that the observer fills later would push it out of view:
    // fill them now, and keep it in view for a while
    fillResultGroup(groupCards.get(group));
    const view = $resultsList.clientHeight;
    let top = group;
    for (let g = group.previousElementSibling; g && group.offsetTop - top.offsetTop < 2 * view;) {
      for (let i = 0; g && i < 8; i++, g = g.previousElementSibling) {
        const card = groupCards.get(g);
        if (card) fillResultGroup(card);
        top = g;
      }
    }
    revealGroup = group;
    revealUntil = performance.now() + REVEAL_SETTLE_MS;
    scrollListToGroup(group);
  }

  function keepRevealedGroupInView() {
    if (!revealGroup) return;
    if (performance.now() > revealUntil) {
      revealGroup = null;
      return;
    }
    scrollListToGroup(revealGroup);
  }

  // Its top, and up to half the list's height of it, in the visible part
  function groupInView(group) {
    const top = group.offsetTop;
    const view = $resultsList.clientHeight;
    const scrollTop = $resultsList.scrollTop;
    return top >= scrollTop && top + Math.min(group.offsetHeight, view / 2) <= scrollTop + view;
  }

  function scrollListToGroup(group) {
    if (!groupInView(group)) {
      $resultsList.scrollTop = Math.max(0, group.offsetTop - $resultsList.clientHeight / 3);
    }
  }

  // Scrolling the list stops keeping the current group in view
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    $resultsList.addEventListener(type, () => { revealGroup = null; }, { passive: type === 'wheel' || type === 'touchstart' });
  }
  // The mouse on the list (touch leaves :hover stuck, so not :hover)
  $resultsList.addEventListener('pointerenter', e => {
    if (e.pointerType === 'mouse') mouseOnResults = true;
  });
  $resultsList.addEventListener('pointerleave', e => {
    if (e.pointerType !== 'mouse') return;
    mouseOnResults = false;
    if (revealPending) revealCurrentResult(false);
  });

  $searchCounter.addEventListener('click', () => {
    if (resultsShown()) closeResults();
    else openResults();
  });
  $resultsClose.addEventListener('click', e => closeResults(e.detail === 0));
  $indexResultsLink.addEventListener('click', () => {
    // the panel's step is the drawer's now: back closes it
    if (!resultsWide.matches && stepKinds.get(stepId) === 'panel') stepKinds.set(stepId, 'drawer');
    closeIndex();
    openResults();
  });
  resultsWide.addEventListener('change', () => {
    resultsDrawerOpen = false;
    preserveScroll(updateResultsVisibility);
  });

  // ===== INDEX RESULTS =====
  // The entries of the consulta rápida and of the three indexes (sistemático,
  // remissivo, referências) with every term of the search, at the top of the
  // results list. Matched by their own text: a prazo or quórum by its value,
  // label and note, plus its section's words ("prazo vista"); a section by its
  // title, a subject by its name (a sub-subject together with its subject's),
  // a norm of the legislação correlata by its name and ementa.
  // Precedents (leaves of the sistemático) and the provisions' texts are in
  // the cards, which the search already lists.
  const INDEX_GROUPS_SHOWN = 3;   // per index; the rest behind "+ N"
  const QUICK_SHOWN = 4;          // entries of the consulta rápida
  const QUICK_LIST_SHOWN = 3;     // lines of a ficha (cabe aparte, a rito's steps)
  const QUICK_TEMA_SHOWN = 8;     // lines of a tema (Grande Expediente: duration, time, apartes...)
  const INDEX_ENTRIES_SHOWN = 2;  // per group (sub-subjects, prazos)
  const ART_LINKS_SHOWN = 6;      // a norm's provisions (legislação correlata)
  const LEGISLACAO = 'Legislação correlata';
  let indexItems = null;          // the indexes' entries and their normalized text

  function normIndexText(s) {
    return stripAccents(s.toLowerCase()).replace(/\s+/g, ' ');
  }

  function htmlToText(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    return t.content.textContent.replace(/\s+/g, ' ').trim();
  }

  // Fields matched together are joined by a character no term has: words
  // may be in different fields, a phrase must be in one
  const FIELD_SEP = '\u0000';

  function getIndexItems() {
    if (indexItems) return indexItems;
    const sys = [];
    (function walk(nodes, ctx) {
      for (const node of nodes) {
        if (node.art || !node.title) continue;
        sys.push({ node, ctx, text: normIndexText(node.title) });
        // "TÍTULO I — DA CÂMARA MUNICIPAL" → "TÍTULO I" in its children's context
        if (node.children) walk(node.children, ctx.concat(node.title.split(' — ')[0]));
      }
    })(SYSTEMATIC_INDEX, []);

    const subj = sortedSubjects()
      .map(entry => {
        const text = normIndexText(entry.subject);
        return {
          entry,
          text,
          children: (entry.children || []).map(ch => {
            const own = normIndexText(ch.sub_subject);
            return { ch, text: own, withSubject: text + FIELD_SEP + own };
          }),
        };
      });

    const refs = [];
    for (const cat of referenciasIndex()) {
      const leg = cat.category === LEGISLACAO;
      for (const group of cat.groups) {
        const title = normIndexText(group.title);
        const entries = group.entries.map(e => ({ e, text: htmlToText(e.html) }));
        if (leg) {
          // the ementa (the entry without an article), then the provisions
          const ementa = entries.filter(x => !x.e.art_ref).map(x => x.text);
          refs.push({ cat, leg, group, ementa: ementa.join(' '), entries: entries.filter(x => x.e.art_ref),
                      text: [title].concat(ementa.map(normIndexText)).join(FIELD_SEP) });
        } else {
          for (const x of entries) x.withTitle = title + FIELD_SEP + normIndexText(x.text);
          refs.push({ cat, leg, group, entries });
        }
      }
    }
    // The consulta rápida: each entry by its visible text (own) and with its
    // section's words, which aren't written ("prazo", "quórum")
    const quick = [];
    for (const sec of consultaIndex()) {
      for (const item of sec.items) {
        const own = normIndexText(quickTexts(item).join(FIELD_SEP));
        const terms = normIndexText(item.terms || '');
        quick.push({ sec, item, own, label: normIndexText(item.label), terms,
                     text: own + FIELD_SEP + normIndexText(sec.terms) + FIELD_SEP + terms });
      }
    }
    return indexItems = { sys, subj, refs, quick };
  }

  // The indexes' entries with every phrase and word (as parseSearchTerms
  // returns them): {sections: [{title, hits, build}], count, regex, key}
  function searchIndexes(phrases, words, regex, key, typed) {
    const has = text => phrases.every(p => text.includes(p)) && words.every(w => text.includes(w));
    const { sys, subj, refs, quick } = getIndexItems();

    // Those with more of the terms in their own text (or in their search terms,
    // the synonyms: "derrubada" for the veto) first, more yet in the label
    // ("prazo vista": the pedido de vista before every other prazo;
    // "aparte": the shorter label, cabe aparte, before the tempos that mention it;
    // a tema with every term in its name before all: "posse", the ficha of the posse)
    const terms = phrases.concat(words);
    // a ficha is found also by the word's stem, in another number or gender
    // ("prejudicado": the ficha "Proposição prejudicada"; "apartes": the ficha "Aparte")
    // (the stem starts a word and ends it within 3 letters: "comissão" finds
    // "Comissões", not "Subcomissões"; "público" finds "pública", not "publicação")
    // (only words of letters: "1/5" and "§" are matched as typed; -ão/-ões and -al/-ais leave a stem of 3 letters
    // or more, "moções" finds "Moção"; the plural -s and the last vowel, 4 or more: "meses" doesn't find "mesa")
    const stem = w => {
      if (w.length < 5) return w;
      const m = w.replace(/(oes|aos|aes|ao|ais|eis|al|el)$/, '');
      if (m !== w) return m.length >= 3 ? m : w;
      const s = w.replace(/(es|s)$/, '').replace(/[aoe]$/, '');
      return s.length >= 4 ? s : w;
    };
    // (a word of up to 3 letters, often a sigla, is the whole word or its plural: "PL" doesn't find "Plano")
    const stemRes = words.map(w => !/^[a-z]+$/.test(w) ? null
      : w.length <= 3 ? new RegExp('(^|[^a-z0-9])' + w + 's?($|[^a-z0-9])')
      : new RegExp('(^|[^a-z0-9])(' + stem(w) + '[a-z]{0,3}|' + w + ')($|[^a-z0-9])'));
    const wordIn = (k, text) => stemRes[k] ? stemRes[k].test(text) : text.includes(words[k]);
    const isTema = it => it.sec.key === 'temas';
    const byStem = text => phrases.every(p => text.includes(p)) && words.every((w, k) => wordIn(k, text));
    // in a ficha's name a word counts only from a word's start ("lei" is not in "Eleição")
    // (and so does a word of up to 3 letters in any name: "PL" is not in "Plano Diretor")
    const inLabel = (it, k) => k >= phrases.length && (isTema(it) || words[k - phrases.length].length <= 3)
      ? wordIn(k - phrases.length, it.label) : it.label.includes(terms[k]);
    // a connective of the query needs not be in the name: "prazo do parecer" names "Prazos de parecer das Comissões"
    const CONNECTIVES = new Set(['a', 'o', 'e', 'as', 'os', 'ao', 'aos', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
      'para', 'por', 'pelo', 'pela', 'com', 'um', 'uma']);
    const loose = k => k >= phrases.length && CONNECTIVES.has(terms[k]) && terms.some(t => !CONNECTIVES.has(t));
    const temaNamed = it => isTema(it) && terms.every((t, k) => loose(k) || inLabel(it, k)) ? 1 : 0;
    // a ficha whose search terms have the whole query, as typed ("caso omisso", "sorteado"), from a word's start,
    // before those that only mention it, unless the query is a single word many fichas list ("sessão", "prazo"):
    // there the name decides
    const query = (typed || terms.join(' ')).trim();
    const queryRe = query ? new RegExp('(^|[^a-z0-9])' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      + (query.length <= 3 ? '($|[^a-z0-9])' : '')) : null;
    const termedBy = queryRe ? quick.filter(it => isTema(it) && queryRe.test(it.terms)).length : 0;
    const temaTermed = it => isTema(it) && queryRe && (terms.length > 1 || termedBy <= 2) && queryRe.test(it.terms) ? 1 : 0;
    const quickHits = quick.filter(it => has(it.text) || (isTema(it) && byStem(it.text)))
      .map((it, i) => ({ it, i, score: terms.reduce((n, t, k) => n + (inLabel(it, k) ? 2 : it.own.includes(t) || it.terms.includes(t) ? 1 : 0), 0) + temaNamed(it) + temaTermed(it) }))
      .sort((a, b) => b.score - a.score || (b.score > terms.length ? a.it.label.length - b.it.label.length : 0) || a.i - b.i);

    const sysHits = sys.filter(it => has(it.text));

    // Subjects found by their name first, then those found by a sub-subject
    // (names also by the stem, as the fichas: "apartes" finds APARTE; those
    // with the very word first: "comissões", COMISSÕES before COMISSÃO DE...).
    // Found by its name, a subject brings all its sub-subjects, those with
    // the terms first, so it doesn't look smaller than it is ("veto": none of
    // VETO's sub-subjects says veto). The subject named just the query, in any
    // number, before all ("prefeito": PREFEITO before CASSAÇÃO DE MANDATO DE
    // PREFEITO, which it would follow in alphabetical order)
    const nameIsQuery = [], byName = [], byStemName = [], bySub = [];
    const hasName = text => has(text) || byStem(text);
    const stems = text => text.split(' ').map(stem).join(' ');
    const queryStems = stems(query);
    for (const it of subj) {
      const exact = has(it.text);
      const self = exact || byStem(it.text);
      const subs = it.children.filter(c => hasName(self ? c.text : c.withSubject));
      const hit = { it, subs: subs.concat(it.children.filter(c => !subs.includes(c))), byName: true };
      if (self && stems(it.text) === queryStems) nameIsQuery.push(hit);
      else if (self) (exact ? byName : byStemName).push(hit);
      else if (subs.length) bySub.push({ it, subs, byName: false });
    }
    // the very word before another number ("comissão": COMISSÃO, then COMISSÕES)
    nameIsQuery.sort((a, b) => (b.it.text === query) - (a.it.text === query));
    byName.unshift(...nameIsQuery);
    byName.push(...byStemName);

    const refHits = [];
    for (const it of refs) {
      if (it.leg) {
        if (has(it.text)) refHits.push({ it, entries: it.entries });
      } else {
        const entries = it.entries.filter(x => has(x.withTitle));
        if (entries.length) refHits.push({ it, entries });
      }
    }

    const sections = [
      { title: 'Consulta rápida', where: 'na consulta rápida', hits: quickHits, build: buildQuickResult, shown: QUICK_SHOWN },
      { title: 'Índice sistemático',where: 'no índice sistemático', hits: sysHits, build: buildSysResult },
      { title: 'Índice remissivo', where: 'no índice remissivo', hits: byName.concat(bySub), build: buildSubjectResult },
      { title: 'Referências', where: 'nas referências', hits: refHits, build: buildRefResult },
    ].filter(s => s.hits.length);
    const named = new Set(quickHits.filter(h => temaNamed(h.it)).map(h => h.it.item));
    return { sections, count: sections.reduce((n, s) => n + s.hits.length, 0), regex, key, named };
  }

  // The indexes' part of the list, in one element at its top (kept when the
  // list is rebuilt for the same indexMatches: see buildResultsList)
  function appendIndexResults() {
    indexPart = document.createElement('div');
    indexPart.className = 'res-idx-part';
    indexPartFor = indexMatches;
    for (const sec of indexMatches.sections) {
      const head = document.createElement('div');
      head.className = 'res-idx';
      head.setAttribute('role', 'heading');
      head.setAttribute('aria-level', '3');
      head.textContent = sec.title + ' · ' + sec.hits.length;
      indexPart.appendChild(head);
      const more = appendWithMore(indexPart, sec.hits, sec.shown || INDEX_GROUPS_SHOWN, sec.build, ['resultado', 'resultados'], 'res-idx-more');
      if (more) more.setAttribute('aria-label', more.textContent + ' ' + sec.where);
    }
    $resultsList.appendChild(indexPart);
  }

  // Appends build(item) of the first `shown` items to parent, the rest behind
  // a "+ N" button (returned). noun: [singular, plural], or the button's text
  // from the hidden items.
  function appendWithMore(parent, items, shown, build, noun, cls) {
    for (const item of items.slice(0, shown)) parent.appendChild(build(item));
    const rest = items.length - shown;
    if (rest <= 0) return null;
    const more = document.createElement('button');
    more.className = 'res-expand' + (cls ? ' ' + cls : '');
    more.textContent = typeof noun === 'function' ? noun(items.slice(shown)) : '+ ' + rest + ' ' + noun[rest === 1 ? 0 : 1];
    more.addEventListener('click', () => {
      const hadFocus = document.activeElement === more;
      const added = items.slice(shown).map(build);
      more.before(...added);
      // the keyboard goes on from the first entry shown now (or, if none of
      // them does anything, from the next one in the list)
      let next = null;
      if (hadFocus) {
        for (const el of added) {
          next = el.matches('button') ? el : el.querySelector('button');
          if (next) break;
        }
        if (!next) {
          const last = added[added.length - 1];
          next = Array.from($resultsList.querySelectorAll('button')).find(b =>
            b !== more && last.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        }
      }
      more.remove();
      if (next) next.focus();
    });
    parent.appendChild(more);
    return more;
  }

  // text as HTML with the search's matches marked; whole, or (long texts)
  // just around the matches
  function indexMarkHtml(text, snippet) {
    const re = indexMatches.regex;
    const spans = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      if (!m[0].length) { re.lastIndex++; continue; }
      if (!isWeakMatch(re, m[0])) spans.push([m.index, m.index + m[0].length]);
    }
    return snippet ? snippetHtml(text, spans) : markSpans(text, 0, text.length, spans);
  }

  // label: what the group is (a subject, a norm), for screen readers
  // entering one of its entries
  function indexGroup(label) {
    const group = document.createElement('div');
    group.className = 'res-group res-idx-group';
    if (label) {
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', label);
    }
    return group;
  }

  // A button of the list: go() moves the page (and returns the element to
  // focus, if not the selected card). Without go (nothing to open), plain text.
  function indexButton(cls, html, go) {
    const el = document.createElement(go ? 'button' : 'div');
    el.className = cls + (go ? '' : ' res-inert');
    el.innerHTML = html;
    if (go) el.addEventListener('click', e => goToIndexResult(e, go));
    return el;
  }

  function goToIndexResult(event, go) {
    takeStep();
    const fromDrawer = resultsDrawerOpen;
    if (resultsDrawerOpen) {
      resultsDrawerOpen = false;
      updateResultsVisibility();
    }
    const target = go() || selectedCard;
    // As in goToResult: after a click or tap, the keys scroll the page
    // (keyboard activation keeps the focus on the sidebar list, which keeps
    // its indexes' part when the search runs again)
    if (target && (fromDrawer || (event && event.detail > 0))) {
      if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  }

  // A section of the sistemático: "TÍTULO III › CAPÍTULO II — DAS COMISSÕES PERMANENTES (art. 46–79)"
  function buildSysResult(hit) {
    const { node, ctx } = hit;
    let html = ctx.length ? '<span class="res-ctx">' + escapeHtml(ctx.join(' › ')) + ' › </span>' : '';
    html += indexMarkHtml(node.title);
    if (node.art_range && !(node.children && node.children.length)) {
      html += ' <span class="res-sum">' + escapeHtml(node.art_range) + '</span>';
    }
    const group = indexGroup();
    group.appendChild(indexButton('res-head', html, () => navigateToSection(node.section_id)));
    return group;
  }

  // A subject of the remissivo: its sub-subjects with the terms (and their
  // "vide") and, found by its name, its articles, all its sub-subjects and
  // its "vide"; each puts the subject in the search bar
  function buildSubjectResult(hit) {
    const { entry } = hit.it;
    const group = indexGroup(entry.subject);
    const allRefs = collectAllRefs(entry);
    group.appendChild(indexButton('res-head', indexMarkHtml(entry.subject) + (hit.byName ? refsHtml(entry.refs) : ''),
      allRefs.length ? () => { openSubject({ subject: entry.subject, refs: allRefs }); } : null));
    const items = [];
    for (const sub of hit.subs) {
      items.push({ sub });
      for (const vide of sub.ch.vides || []) items.push({ vide });
    }
    if (hit.byName) for (const vide of entry.vides || []) items.push({ vide });
    // "+ 5 subassuntos", "+ 12 subassuntos, 3 vide", "+ 2 outros"
    const more = hidden => {
      const subs = hidden.filter(item => item.sub).length, vides = hidden.length - subs;
      if (!subs) return '+ ' + vides + (vides > 1 ? ' outros' : ' outro');
      return '+ ' + subs + ' subassunto' + (subs > 1 ? 's' : '') + (vides ? ', ' + vides + ' vide' : '');
    };
    appendWithMore(group, items, INDEX_ENTRIES_SHOWN, ({ sub, vide }) => {
      if (vide) {
        const target = findVide(vide);
        return indexButton('res-entry res-vide', 'vide ' + escapeHtml(target.label),
          target.refs.length ? () => { openSubject({ subject: target.label, refs: target.refs }); } : null);
      }
      const ch = sub.ch;
      const refs = subjectRefs(entry, ch.sub_subject);
      return indexButton('res-entry', '— ' + indexMarkHtml(ch.sub_subject) + refsHtml(ch.refs),
        refs.length ? () => { openSubject({ subject: entry.subject + ' — ' + ch.sub_subject, refs }); } : null);
    }, more);
    return group;
  }

  // The articles, one per line in two columns, as the index's tab shows
  // them: the dispositivo with its norma's badge ("RI art. 46"), its dica
  function refsHtml(refs) {
    if (!refs || !refs.length) return '';
    let html = '';
    for (const r of formatRefsList(refs)) {
      html += '<span class="res-ref">' + refCellHtml(r)[0]
        + '<span class="res-ref-hint">' + (r.hint ? indexMarkHtml(r.hint) : '') + '</span></span>';
    }
    return '<span class="res-refs">' + html + '</span>';
  }

  // The subject (or sub-subject) a "vide" points to ("ASSUNTO" or
  // "ASSUNTO|subassunto"), and its articles
  let subjectsByKey = null;
  function findVide(vide, seen = new Set([vide])) {
    if (!subjectsByKey) subjectsByKey = new Map(SUBJECT_INDEX.map(e => [normIndexText(e.subject), e]));
    const [subject, sub] = vide.split('|').map(s => s.trim());
    const entry = subjectsByKey.get(normIndexText(subject));
    if (!entry) return { label: sub ? subject + ' — ' + sub : subject, refs: [] };
    if (!sub) return { label: entry.subject, refs: collectAllRefs(entry) };
    return { label: entry.subject + ' — ' + sub, refs: subjectRefs(entry, sub, seen) };
  }

  // The articles of a sub-subject. One without its own (a heading, as
  // "vantagens" or "cargo"): those of the sub-subjects under it ("vantagens:
  // adicional", "cargo em comissão") and of its "vide", as the index shows
  // around it.
  function subjectRefs(entry, sub, seen = new Set()) {
    const key = normIndexText(sub);
    const children = entry.children || [];
    const ch = children.find(c => normIndexText(c.sub_subject) === key);
    if (ch && ch.refs.length) return ch.refs;
    const refs = [];
    for (const c of children) {
      const k = normIndexText(c.sub_subject);
      if (k !== key && (k.startsWith(key + ':') || k.startsWith(key + ' '))) refs.push(...c.refs);
    }
    for (const vide of (ch && ch.vides) || []) {
      if (seen.has(vide)) continue;   // "cargo" and "função" point to each other
      seen.add(vide);
      refs.push(...findVide(vide, seen).refs);
    }
    // once each, in order
    const keys = new Set();
    return refs.filter(r => {
      const k = (r.law_prefix || '') + ':' + r.art + ':' + (r.detail || '');
      return !keys.has(k) && keys.add(k);
    });
  }

  // A group of the referências: a prazo or quórum (its entries with the
  // terms), or a norm of the legislação correlata (its ementa and the
  // provisions it's linked to)
  function buildRefResult(hit) {
    const { it, entries } = hit;
    const group = indexGroup(it.group.title);
    const head = document.createElement('div');
    head.className = 'res-head res-idx-title';
    head.innerHTML = '<span class="res-law-tag">' + escapeHtml(it.cat.category) + '</span>' + indexMarkHtml(it.group.title);
    group.appendChild(head);
    if (!it.leg) {
      appendWithMore(group, entries, INDEX_ENTRIES_SHOWN, x => indexButton('res-entry',
        (x.e.art_ref ? '<span class="res-label">' + escapeHtml(refEntryLabel(x.e)) + '</span> ' : '')
          + '<span class="res-text">' + indexMarkHtml(x.text, true) + '</span>',
        x.e.art_ref ? () => goToRefEntry(x.e, false) : null,
      ), ['trecho', 'trechos']);
      return group;
    }
    if (it.ementa) {
      const ementa = document.createElement('div');
      ementa.className = 'res-ementa';
      ementa.innerHTML = indexMarkHtml(it.ementa, true);
      ementa.title = it.ementa;
      group.appendChild(ementa);
    }
    // The provisions as links in a line, their text on hover
    const links = document.createElement('div');
    links.className = 'res-artlinks';
    appendWithMore(links, entries, ART_LINKS_SHOWN, x => {
      const btn = indexButton('res-artlink', escapeHtml(refEntryLabel(x.e)), () => goToRefEntry(x.e, true));
      btn.title = x.text;
      return btn;
    }, ['dispositivo', 'dispositivos']);
    group.appendChild(links);
    return group;
  }

  // ===== CONSULTA RÁPIDA =====
  // Prazos, quóruns, tempos, datas (kind "valor": the number large, its unit
  // under it) and hipóteses, ritos (kind "ficha": text, list or steps), from
  // consulta-rapida.yaml (see src/consulta.py). The same element in the
  // Referências tab and at the top of the search results.

  // The texts of an entry the search matches (and marks)
  function quickTexts(item) {
    return [item.v, item.u, item.label, item.text, item.obs].filter(Boolean)
      .concat((item.list || []).map(x => x.text), item.steps || []);
  }

  function buildQuickResult(hit) {
    const { sec, item } = hit.it;
    return quickItemEl(sec, item, text => indexMarkHtml(text), true);
  }

  // The provision of a reference ({law, art, path}), shown even if a filter
  // hides it, highlighted if it's a part of the article. Returns the element to focus.
  function goToQuickRef(ref) {
    const card = remCard(ref);
    if (!card) return null;
    revealCard(card);
    const p = ref.path ? remUnitP(card, ref.path) : null;
    scrollToReadingLine(p || card);
    selectCard(card, true);
    if (p) remFlash(p);
    return p || card;
  }

  // From the search list (its drawer closes) or from the tab (the index closes)
  function quickGo(go, inSearch) {
    return e => {
      if (inSearch) { goToIndexResult(e, go); return; }
      takeStep();
      closeIndex();
      go();
    };
  }

  // The references of an entry, as links: "art. 63, § 4º", "LOM art. 138, § 6º"
  function quickRefsEl(refs, inSearch) {
    const el = document.createElement('div');
    el.className = 'q-refs';
    for (const ref of refs) {
      const btn = document.createElement('button');
      btn.className = 'q-ref';
      btn.textContent = ref.label;
      btn.addEventListener('click', quickGo(() => goToQuickRef(ref), inSearch));
      el.appendChild(btn);
    }
    return el;
  }

  // mark(text) → HTML: the search's matches marked, or just escaped
  function quickItemEl(sec, item, mark, inSearch) {
    const el = document.createElement('div');
    el.className = 'q-item q-' + sec.kind + (inSearch ? ' res-group res-idx-group' : '');
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', sec.title + ': ' + (item.v ? (item.v + ' ' + item.u).trim() + ', ' : '') + item.label);

    if (sec.kind === 'valor') {
      const val = document.createElement('div');
      val.className = 'q-val' + (item.v.length > 12 ? ' q-xlong' : item.v.length > 6 ? ' q-long' : '');
      // "1º fev–30 jun · 1º ago–15 dez": a line each
      val.innerHTML = '<span class="q-n">' + item.v.split(' · ').map(x => mark(x)).join('<br>') + '</span>'
        + (item.u ? '<span class="q-u">' + mark(item.u) + '</span>' : '');
      el.appendChild(val);
    }
    const body = document.createElement('div');
    body.className = 'q-body';
    if (inSearch) {
      const tag = document.createElement('div');
      tag.className = 'q-sec';
      tag.textContent = sec.title;
      body.appendChild(tag);
    }
    // the label opens the first article cited
    const first = item.refs[0];
    const label = document.createElement(first ? 'button' : 'div');
    label.className = 'q-label';
    label.innerHTML = mark(item.label)
      + (item.cf ? ' <span class="q-cf" title="artigo ainda não confirmado">†</span>' : '');
    if (first) label.addEventListener('click', quickGo(() => goToQuickRef(first), inSearch));
    body.appendChild(label);
    for (const [cls, text] of [['q-text', item.text], ['q-obs', item.obs]]) {
      if (!text) continue;
      const div = document.createElement('div');
      div.className = cls;
      div.innerHTML = mark(text);
      body.appendChild(div);
    }
    // a rito's steps (numbered by the CSS); a ficha's lines (in the search,
    // those with the terms first). Divs, not li: the "+ N" button goes among them.
    const lists = [];
    if (item.steps) lists.push(['q-steps', item.steps, step => {
      const line = document.createElement('div');
      line.className = 'q-line';
      line.innerHTML = mark(step);
      return line;
    }, ['passo', 'passos']]);
    if (item.list) {
      let lines = item.list;
      if (inSearch) {
        const re = indexMatches.regex;
        const found = x => { re.lastIndex = 0; return re.test(x.text); };
        // a tema searched by its name keeps the ficha's order (general to particular)
        if (!(sec.key === 'temas' && indexMatches.named && indexMatches.named.has(item)))
          lines = lines.filter(found).concat(lines.filter(x => !found(x)));
      }
      lists.push(['q-list', lines, x => {
        const line = document.createElement('div');
        line.className = 'q-line';
        line.innerHTML = mark(x.text) + (x.tag ? ' <span class="q-tag">' + escapeHtml(x.tag) + '</span>' : '');
        if (x.refs.length) line.appendChild(quickRefsEl(x.refs, inSearch));
        return line;
      }, ['linha', 'linhas']]);
    }
    for (const [cls, items, build, noun] of lists) {
      const list = document.createElement('div');
      list.className = cls;
      // a tema's ficha shows more lines in the search, where it sums up the
      // subject; in the Referências tab, the first ones, so the fichas don't fill the tab
      if (inSearch) appendWithMore(list, items, sec.key === 'temas' ? QUICK_TEMA_SHOWN : QUICK_LIST_SHOWN, build, noun);
      else if (sec.key === 'temas') appendWithMore(list, items, QUICK_LIST_SHOWN, build, noun);
      else items.forEach(x => list.appendChild(build(x)));
      body.appendChild(list);
    }
    if (item.refs.length) body.appendChild(quickRefsEl(item.refs, inSearch));
    el.appendChild(body);
    return el;
  }

  // The consulta rápida in the Referências tab: its sections, with links to
  // each one at the top (fixed, the section being read marked), the entries
  // as cards in a grid; with a filter, the entries with its terms
  function renderConsulta(filter) {
    const toc = document.createElement('div');
    toc.className = 'q-toc';
    $indexContent.appendChild(toc);
    const heads = [];
    for (const sec of consultaIndex()) {
      const items = sec.items.filter(item => !filter
        || textMatchesFilter(quickTexts(item).join(' ') + ' ' + sec.terms + ' ' + (item.terms || ''), filter));
      if (!items.length) continue;
      const noun = items.length === 1 ? ' item' : ' itens';
      const head = document.createElement('div');
      head.className = 'ref-group-title q-head';
      head.innerHTML = escapeHtml(sec.title) + '<small>' + items.length + noun + '</small>';
      $indexContent.appendChild(head);
      const link = document.createElement('button');
      link.className = 'q-toc-link';
      link.innerHTML = escapeHtml(sec.title) + '<small>' + items.length + '</small>';
      link.addEventListener('click', () => head.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      toc.appendChild(link);
      heads.push([head, link]);
      // the fichas by group ("Fases da sessão", "Listas de hipóteses"), each with its subtitle
      let group = null;
      let grid = null;
      for (const item of items) {
        // a ficha without group after grouped ones goes under "Outros", not under the group above
        const g = item.group || (group ? 'Outros' : null);
        if (g && g !== group) {
          group = g;
          grid = null;
          const sub = document.createElement('div');
          sub.className = 'q-subhead';
          sub.textContent = group;
          $indexContent.appendChild(sub);
        }
        if (!grid) {
          grid = document.createElement('div');
          grid.className = 'q-grid';
          $indexContent.appendChild(grid);
        }
        grid.appendChild(quickItemEl(sec, item, escapeHtml, false));
      }
    }
    if (!toc.childNodes.length) {
      toc.className = 'q-empty';
      toc.textContent = 'Nada na consulta rápida com esses termos.';
      return;
    }
    // the section being read, marked in the links
    const mark = () => {
      if (!toc.isConnected) { $indexContent.removeEventListener('scroll', mark); return; }
      const top = toc.getBoundingClientRect().bottom + 8;
      let cur = heads[0];
      for (const h of heads) if (h[0].getBoundingClientRect().top <= top) cur = h;
      for (const [, link] of heads) link.classList.toggle('on', link === cur[1]);
    };
    $indexContent.addEventListener('scroll', mark, { passive: true });
    requestAnimationFrame(mark);
  }

  // "Art. 105, XII", "Art. 4-C ADT, I"
  function refEntryLabel(entry) {
    const ref = entry.art_ref || '';
    return (entry.law ? entry.law + ' art. ' : 'Art. ') +
      (ref.startsWith('ADT') ? ref.slice(3).replace(/^([^,\s]+)/, '$1 ADT') : ref);
  }

  // The article of an entry of the referências (of the Regimento), shown
  // even if a filter hides it; for the legislação correlata, its provision,
  // with the norms' box open. Returns the element to focus.
  function goToRefEntry(entry, leg) {
    if (!entry.art_ref) return null;
    const art = entry.art_ref.replace(/[º°ª]/g, '').split(/[,\s]/)[0].trim();
    const card = remCard({ law: entry.law || 'RI', art });
    if (!card) return null;
    revealCard(card);
    let target = card;
    if (leg) {
      const p = entry.path ? remUnitP(card, entry.path) : remCaputP(card);
      const ref = p && p.querySelector('.leg-ref');
      const box = ref && card.querySelector(`.leg-box[data-note="${ref.dataset.note}"]`);
      if (box) box.classList.add('open');
      if (p) target = p;
    }
    scrollToReadingLine(target);
    selectCard(card, true);
    return target;
  }

  // A card hidden by a filter (search, subject, markers) shown again, with its headings
  function revealCard(card) {
    if (!card.classList.contains('filtered-out')) return;
    card.classList.remove('filtered-out');
    showContextHeadings();
    scheduleMinimap();
  }

  // ===== MARKERS (click-on-identifier system) =====
  function loadMarkers() {
    try {
      const saved = localStorage.getItem('regimento-markers-v2');
      if (saved) markersList = JSON.parse(saved);
    } catch (e) {}
  }

  function saveMarkers() {
    localStorage.setItem('regimento-markers-v2', JSON.stringify(markersList));
  }

  function getNextColorIdx() {
    const used = new Set(markersList.map(m => m.colorIdx));
    for (let i = 0; i < MARKER_PALETTE.length; i++) {
      if (!used.has(i)) return i;
    }
    return markersList.length % MARKER_PALETTE.length;
  }

  function findMarker(uid) {
    return markersList.find(m => m.uid === uid);
  }

  function toggleMarker(uid) {
    const existing = findMarker(uid);
    if (existing) {
      markersList = markersList.filter(m => m.uid !== uid);
    } else {
      markersList.push({ uid, colorIdx: getNextColorIdx() });
    }
    saveMarkers();
    applyMarkers();
    // In the bar, the marked articles follow (the last one unmarked, it goes)
    if (scope && scope.kind === 'markers') {
      if (markersList.length === 0) closeScope();
      else markScopeUnits();
      preserveScroll(() => doSearch(currentSearch));
    }
    renderMarkerNav();
  }

  function clearAllMarkers() {
    markersList = [];
    saveMarkers();
    applyMarkers();
    if (scope && scope.kind === 'markers') {
      closeScope();
      preserveScroll(() => doSearch(currentSearch));
    }
    renderMarkerNav();
  }

  // The funnel of the markers: the marked articles in the search bar, or out of it
  function toggleMarkersScope() {
    if (scope && scope.kind === 'markers') removeScope();
    else openScope({ kind: 'markers', label: 'Marcados' });
  }

  function applyMarkers() {
    $cards.querySelectorAll('.unit-id').forEach(el => {
      el.style.backgroundColor = '';
      el.style.color = '';
    });
    $cards.querySelectorAll('.art-compact-label').forEach(el => {
      el.style.backgroundColor = '';
      el.style.color = '';
    });

    for (const marker of markersList) {
      const el = $cards.querySelector(`.unit-id[data-uid="${marker.uid}"]`);
      if (!el) continue;
      const palette = MARKER_PALETTE[marker.colorIdx];
      el.style.backgroundColor = palette.bg;
      el.style.color = palette.text;
      // Also color the compact label if this is the caput (first unit-id in the card)
      const card = el.closest('.card-artigo');
      if (card && card.querySelector('.unit-id') === el) {
        const compactLabel = card.querySelector('.art-compact-label');
        if (compactLabel) {
          compactLabel.style.backgroundColor = palette.bg;
          compactLabel.style.color = palette.text;
        }
      }
    }
  }

  function renderMarkerNav() {
    hideMarkerTooltip();
    $markerNav.innerHTML = '';

    for (const marker of markersList) {
      const palette = MARKER_PALETTE[marker.colorIdx];
      const el = $cards.querySelector(`.unit-id[data-uid="${marker.uid}"]`);
      let label = el ? el.textContent.trim() : marker.uid;
      if (el) {
        const card = el.closest('.card-artigo');
        if (card && isPrecCard(card)) {
          label = 'Prec.' + card.dataset.art;
        } else if (card) {
          const lawPrefix = card.dataset.law;
          const pre = lawPrefix ? lawPrefix + ':' : '';
          if (el.dataset.path) {
            // Use hierarchical path: "I,b,2" → "13,I,b,2"
            label = pre + 'Art.' + card.dataset.art + ',' + el.dataset.path;
          } else if (!label.startsWith('Art.')) {
            // Sub-units without path: prepend article number
            label = pre + 'Art.' + card.dataset.art + ',' + label;
          } else if (lawPrefix) {
            // Caput of other laws: prepend law prefix
            label = lawPrefix + ':' + label;
          }
        }
      }
      // Compact label: remove Art., º, spaces, abbreviate Parágrafo único → §ú
      label = label.replace(/Parágrafo único/gi, '§ú');
      label = label.replace(/Art\.\s*/g, '');
      label = label.replace(/\u00ba/g, '').replace(/\s+/g, '');

      const btn = document.createElement('button');
      btn.className = 'marker-btn';
      btn.style.background = palette.bg;
      btn.style.color = palette.text;
      btn.textContent = label;
      btn.title = 'Ir para ' + label;
      btn.addEventListener('click', () => {
        hideMarkerTooltip();
        const target = $cards.querySelector(`.unit-id[data-uid="${marker.uid}"]`);
        if (target) {
          const card = target.closest('.card');
          if (card) {
            scrollToReadingLine(target);
            selectCard(card, true);
          }
        }
      });
      // Tooltip listeners
      ((uid, pal) => {
        btn.addEventListener('mouseenter', () => showMarkerTooltip(btn, uid, pal));
        btn.addEventListener('mouseleave', () => hideMarkerTooltip());
        btn.addEventListener('touchstart', (e) => {
          markerTooltipTimer = setTimeout(() => {
            e.preventDefault();
            showMarkerTooltip(btn, uid, pal);
          }, 500);
        }, { passive: false });
        btn.addEventListener('touchend', () => hideMarkerTooltip());
        btn.addEventListener('touchmove', () => hideMarkerTooltip());
      })(marker.uid, palette);
      $markerNav.appendChild(btn);
    }

    if (markersList.length > 0) {
      const filterBtn = document.createElement('button');
      filterBtn.id = 'marker-filter-btn';
      const inBar = scope !== null && scope.kind === 'markers';
      filterBtn.className = inBar ? 'visible active' : 'visible';
      filterBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 1h14L10 7v5l-4 2V7z"/></svg>';
      filterBtn.title = inBar ? 'Tirar os marcados da busca' : 'Buscar nos artigos marcados';
      filterBtn.addEventListener('click', toggleMarkersScope);
      $markerNav.appendChild(filterBtn);

      const copyBtn = document.createElement('button');
      copyBtn.id = 'marker-copy-btn';
      copyBtn.className = 'visible';
      copyBtn.innerHTML = COPY_ICON;
      copyBtn.title = 'Copiar o texto dos dispositivos marcados';
      copyBtn.addEventListener('click', () => copyMarkedText(copyBtn));
      $markerNav.appendChild(copyBtn);

      const clearBtn = document.createElement('button');
      clearBtn.id = 'marker-clear-all';
      clearBtn.className = 'visible';
      clearBtn.innerHTML = '&times;';
      clearBtn.title = 'Remover todos os marcadores';
      clearBtn.addEventListener('click', clearAllMarkers);
      $markerNav.appendChild(clearBtn);
    }
  }

  // ===== COPY THE MARKED PROVISIONS =====
  // The text of the marked provisions, ready to paste in a working text: first the
  // citation ("conforme disposto nos arts. 6º, II e 13, II, c, do Regimento Interno:"), then,
  // per article, in the page's order: the marked provisions whole; the ones above
  // them (the article, the inciso of an alínea) by their identifier alone; "[...]"
  // on a line of its own where provisions are left out. A marked provision with
  // nothing marked under it comes with all of its own (the caput alone: the whole
  // article), as when it's cited.
  const COPY_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">'
    + '<rect x="5.5" y="5.5" width="8.5" height="9" rx="1.5"/><path d="M10.5 3.5V3a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3v6.5A1.5 1.5 0 0 0 3.5 11H4"/></svg>';
  const COPIED_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.5 8.5l3.5 3.5 7.5-8"/></svg>';
  // each norm's name, and its "of" ("do Regimento Interno")
  const COPY_LAWS = {
    RI: ['Regimento Interno', 'do'], ADT: ['Ato das Disposições Transitórias do Regimento Interno', 'do'],
    LOM: ['Lei Orgânica do Município', 'da'], CE: ['Constituição do Estado de São Paulo', 'da'],
    CF: ['Constituição Federal', 'da'],
  };
  // "a", "a e b", "a, b e c"; "a e b, e c" when an item before the last has its own "e"
  const joinE = items => items.length < 2 ? items.join('')
    : items.slice(0, -1).join(', ') + (items.slice(0, -1).some(x => x.includes(' e ')) ? ', e ' : ' e ')
      + items[items.length - 1];

  function copyMarkedText(btn) {
    const uids = new Set(markersList.map(m => m.uid));
    const cards = [];
    for (const uid of uids) {
      const el = $cards.querySelector(`.unit-id[data-uid="${uid}"]`);
      const card = el && el.closest('.card-artigo');
      if (card && !cards.includes(card)) cards.push(card);
    }
    cards.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const lawOf = card => card.dataset.law || (card.dataset.art.startsWith('ADT') ? 'ADT' : 'RI');
    // more than one norm: each one's name before its articles
    const named = new Set(cards.map(lawOf).filter(l => COPY_LAWS[l])).size > 1;
    const lines = [];
    const groups = [];   // the citation's: { law, cites }, a norm at a time
    let law = null;
    for (const card of cards) {
      const l = lawOf(card);
      // a blank line between the norms, and around each precedent
      if (lines.length && ((l !== law && named) || isPrecCard(card) || law === 'PREC')) lines.push('');
      if (l !== law && named && COPY_LAWS[l]) lines.push(COPY_LAWS[l][0]);
      if (l !== law) groups.push({ law: l, cites: [] });
      law = l;
      lines.push(...copyCardLines(card, uids));
      groups[groups.length - 1].cites.push(isPrecCard(card) ? precLabel(card.dataset.art) : copyCitation(card, uids));
    }
    if (lines.length) lines.unshift('conforme disposto ' + joinE(groups.map(g => {
      const many = g.cites.length > 1;
      if (g.law === 'PREC') return (many ? 'nos Precedentes Regimentais ' : 'no Precedente Regimental ') + joinE(g.cites);
      const [name, of] = COPY_LAWS[g.law];
      // "art. 6º do", "art. 6º, II, do"
      const comma = g.cites[g.cites.length - 1].includes(',') ? ', ' : ' ';
      return (many ? 'nos arts. ' : 'no art. ') + joinE(g.cites) + comma + of + ' ' + name;
    })) + ':');
    if (!lines.length) return;
    copyToClipboard(lines.join('\n')).then(ok => {
      btn.innerHTML = ok ? COPIED_ICON : COPY_ICON;
      btn.title = ok ? 'Copiado' : 'Não foi possível copiar';
      btn.classList.toggle('copied', ok);
      setTimeout(() => {
        btn.innerHTML = COPY_ICON;
        btn.title = 'Copiar o texto dos dispositivos marcados';
        btn.classList.remove('copied');
      }, 1600);
    });
  }

  // An article as cited: "6º" (the whole), "13, II, c", "13, I, a e b, e II, c",
  // "25, caput e parágrafo único": the provisions grouped by what's above them
  function copyCitation(card, uids) {
    const ids = [...card.querySelectorAll(':scope > p:not(.old-version) .unit-id')];
    const num = ids[0].textContent.replace(/\s+/g, ' ').trim().replace(/^Art(igo)?\.?\s*/, '');
    const paths = ids.filter(id => uids.has(id.dataset.uid)).map(id => id.dataset.path || '');
    if (paths.length === 1 && paths[0] === '') return num;
    const root = [];
    for (const path of paths) {
      let level = root;
      for (const seg of path ? path.split(',') : ['caput']) {
        let node = level.find(n => n.seg === seg);
        if (!node) level.push(node = { seg, kids: [] });
        level = node.kids;
      }
    }
    const cite = nodes => joinE(nodes.map(n => (n.seg === '§ú' ? 'parágrafo único' : n.seg)
      + (n.kids.length ? ', ' + cite(n.kids) : '')));
    return num + ', ' + cite(root);
  }

  function copyCardLines(card, uids) {
    const ownText = p => p.querySelector('.unit-id').textContent.replace(/\s+/g, ' ').trim();
    if (isPrecCard(card)) {
      // a precedent comes whole: its title, then its text
      return [...card.querySelectorAll(':scope > p:not(.old-version)')]
        .map(p => p.querySelector('.unit-id') ? ownText(p) : copyUnitText(p));
    }
    const units = [];
    for (const p of card.querySelectorAll(':scope > p:not(.old-version)')) {
      const id = p.querySelector('.unit-id');
      if (id) units.push({ p, path: id.dataset.path || '', marked: uids.has(id.dataset.uid) });
    }
    // b under a: a's path is a prefix of b's ("" = the caput, above all)
    const under = (b, a) => a === '' ? b !== '' : b.startsWith(a + ',');
    const marked = units.filter(u => u.marked);
    const whole = new Set();
    for (const m of marked) {
      const inner = marked.some(o => under(o.path, m.path));
      for (const u of units) if (u === m || (!inner && under(u.path, m.path))) whole.add(u);
    }
    const lines = [];
    let gap = false;
    for (const u of units) {
      const above = !whole.has(u) && [...whole].some(w => under(w.path, u.path));
      if (!whole.has(u) && !above) { gap = true; continue; }
      if (gap && lines.length) lines.push('[...]');
      gap = false;
      const ident = ownText(u.p);
      const text = whole.has(u) ? copyUnitText(u.p) : '';
      lines.push(text ? ident + ' — ' + text : u.path ? ident + ' —' : ident);
    }
    return lines;
  }

  // A provision's text without its identifier, gutter, badges and notes (but a
  // revoked one keeps the note that revoked it)
  function copyUnitText(p) {
    const clone = p.cloneNode(true);
    const revoked = p.querySelector('s') || p.closest('.card').classList.contains('revoked');
    clone.querySelectorAll('.unit-id, .indent-path, .rem-imp, .rem-back, sup.footnote-ref'
      + (revoked ? '' : ', .amendment-note')).forEach(el => el.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim()
      .replace(/^[—–-]\s*/, '').replace(/\s+([.;:,])/g, '$1');
  }

  function copyToClipboard(text) {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      return ok;
    };
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true, fallback);
    }
    return Promise.resolve(fallback());
  }

  // ===== MARKER TOOLTIP =====
  function buildMarkerTooltip(uid, palette) {
    $markerTooltip.innerHTML = '';
    const span = $cards.querySelector(`.unit-id[data-uid="${uid}"]`);
    if (!span) return false;
    const card = span.closest('.card-artigo');
    if (!card) return false;

    // Heading ancestor chips (título, capítulo, seção…)
    const ancestors = collectAncestorHeadings(card);
    for (const a of ancestors) {
      const chip = document.createElement('div');
      chip.className = 'mtt-chip';
      const c = MINIMAP_COLORS[a.level];
      chip.style.background = c.bg;
      chip.style.color = c.text;
      chip.style.borderLeftColor = c.bg;
      chip.textContent = getHeadingShortTitle(a.el);
      $markerTooltip.appendChild(chip);
    }

    const path = span.dataset.path || '';
    // Build ancestor chain: e.g. path "I,a" → ['', 'I', 'I,a']
    const parts = path ? path.split(',') : [];
    const chain = [''];
    for (let i = 0; i < parts.length; i++) {
      chain.push(parts.slice(0, i + 1).join(','));
    }

    for (let i = 0; i < chain.length; i++) {
      const segPath = chain[i];
      let p;
      if (segPath === '') {
        // Caput: first <p> child of card (skip old versions)
        p = card.querySelector(':scope > p:not(.old-version)');
      } else {
        // Find the unit-id with this path, then its parent <p>/<div>
        const seg = card.querySelector(`.unit-id[data-path="${segPath}"]`);
        if (seg) p = seg.closest('.art-para') || seg.parentElement;
      }
      if (!p) continue;

      // Extract clean text: clone, remove .indent-path elements, get textContent
      const clone = p.cloneNode(true);
      clone.querySelectorAll('.indent-path').forEach(el => el.remove());
      let text = clone.textContent.trim();

      // Split label from rest: e.g. "Art. 13 —" or "I —" or "a)"
      let label = '';
      let rest = text;
      const dashIdx = text.indexOf('\u00a0\u2014');
      const dashIdx2 = text.indexOf(' \u2014');
      const splitIdx = dashIdx >= 0 ? dashIdx : dashIdx2;
      if (splitIdx >= 0 && splitIdx < 40) {
        label = text.slice(0, splitIdx);
        rest = text.slice(splitIdx);
      }

      const chip = document.createElement('div');
      chip.className = 'mtt-chip' + (i === chain.length - 1 ? ' mtt-target' : '');
      if (i === chain.length - 1) {
        chip.style.borderLeftColor = palette.bg;
      }
      if (label) {
        chip.innerHTML = '<b>' + escapeHtml(label) + '</b>' + escapeHtml(rest);
      } else {
        chip.textContent = rest;
      }
      $markerTooltip.appendChild(chip);
    }
    return $markerTooltip.children.length > 0;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ===== SEARCH TICK TOOLTIP HELPERS =====
  // Text node as HTML, with search highlights (highlight API) as <mark>
  function textWithMarks(textNode) {
    const text = textNode.textContent;
    const spans = textNodeHits.get(textNode);
    if (!spans) return escapeHtml(text);
    let html = '';
    let last = 0;
    for (const [start, end] of spans) {
      html += escapeHtml(text.slice(last, start)) + '<mark>' + escapeHtml(text.slice(start, end)) + '</mark>';
      last = end;
    }
    return html + escapeHtml(text.slice(last));
  }

  // A clone doesn't carry the StaticRange highlights of the original: turn
  // them into <mark>s (same structure, so the text nodes pair up)
  function markHighlightsInClone(original, clone) {
    if (!textNodeHits.size) return;
    const originals = document.createTreeWalker(original, NodeFilter.SHOW_TEXT);
    const copies = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    const pairs = [];
    while (originals.nextNode() && copies.nextNode()) {
      if (textNodeHits.has(originals.currentNode)) pairs.push([originals.currentNode, copies.currentNode]);
    }
    for (const [textNode, copy] of pairs) {
      const tpl = document.createElement('template');
      tpl.innerHTML = textWithMarks(textNode);
      copy.parentNode.replaceChild(tpl.content, copy);
    }
  }

  function extractTextWithMarks(node) {
    let html = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        html += textWithMarks(child);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.tagName === 'MARK' && !child.classList.contains('weak')) {
          html += '<mark>' + escapeHtml(child.textContent) + '</mark>';
        } else if (child.classList.contains('indent-path') || child.classList.contains('unit-id')) {
          continue;
        } else {
          html += extractTextWithMarks(child);
        }
      }
    }
    return html;
  }

  // Nearest preceding heading card of each level, in DOM order. Depends only
  // on the (static) card order, so it's computed once per card. Callers must
  // not mutate the returned array.
  const ancestorHeadingsCache = new Map();

  function collectAncestorHeadings(card) {
    const cached = ancestorHeadingsCache.get(card);
    if (cached) return cached;
    const levelOrder = ['norma', 'tit', 'cap', 'sec', 'subsec'];
    // Only headings above the ones already found: once a title is found, the
    // chapters and sections before it belong to the previous title
    let minIdx = levelOrder.length;
    const ancestors = [];
    let prev = card.previousElementSibling;
    while (prev && minIdx > 0) {
      if (prev.classList.contains('card-titulo')) {
        const level = headingLevel(prev);
        const idx = levelOrder.indexOf(level);
        if (idx >= 0 && idx < minIdx) {
          minIdx = idx;
          ancestors.push({ el: prev, level });
        }
      }
      prev = prev.previousElementSibling;
    }
    ancestors.reverse();
    ancestorHeadingsCache.set(card, ancestors);
    return ancestors;
  }

  function buildSearchTickTooltip(card) {
    $searchTickTooltip.innerHTML = '';
    if (!card) return;

    // --- Part 1: Breadcrumb chips (heading ancestors + article) ---
    const ancestors = collectAncestorHeadings(card);
    for (const a of ancestors) {
      const chip = document.createElement('div');
      chip.className = 'mm-chip';
      const c = MINIMAP_COLORS[a.level];
      chip.style.background = c.bg;
      chip.style.color = c.text;
      chip.textContent = getHeadingShortTitle(a.el);
      $searchTickTooltip.appendChild(chip);
    }

    // Article chip
    if (card.classList.contains('card-artigo')) {
      const artNum = card.dataset.art || '';
      const lawPrefix = card.dataset.law;
      const key = lawPrefix ? lawPrefix + ':' + artNum : artNum;
      const summary = SUMMARIES_MAP[key] || '';
      const prefix = cardRefLabel(card);
      const chip = document.createElement('div');
      chip.className = 'mm-chip';
      chip.style.background = MINIMAP_COLORS.article.bg;
      chip.style.color = MINIMAP_COLORS.article.text;
      chip.textContent = summary ? prefix + ' \u2014 ' + summary : prefix;
      $searchTickTooltip.appendChild(chip);
    }

    // --- Part 2: Match unit chips ---
    const hits = getCardHits(card);
    if (!hits.length) return;

    // Collect unique matched paragraphs
    const matchedPaths = [];
    const seenPaths = new Set();
    for (const hit of hits) {
      const m = hitElement(hit);
      // Skip marks inside footnotes
      if (m.closest('.footnote-box')) continue;
      const oldVer = m.closest('.old-version');
      const p = m.closest('.art-para') || m.closest('p');
      if (!p) continue;
      // Use element identity for old-version (no data-path), path string otherwise
      const uid = p.querySelector('.unit-id');
      const key = oldVer ? 'old:' + (p.dataset.ident || '') + ':' + p.textContent.slice(0, 40) : (uid ? (uid.dataset.path || '') : '');
      if (p.classList.contains('prec-para')) {
        // a precedent's running text: each paragraph is its own target
        if (!seenPaths.has(p)) { seenPaths.add(p); matchedPaths.push({ path: '', p, isOld: false, prec: true }); }
        continue;
      }
      if (!seenPaths.has(key)) {
        seenPaths.add(key);
        matchedPaths.push({ path: uid ? (uid.dataset.path || '') : '', p, isOld: !!oldVer });
      }
    }

    if (!matchedPaths.length) return;

    // Sort by depth (caput first)
    matchedPaths.sort((a, b) => {
      const da = a.path ? a.path.split(',').length : 0;
      const db = b.path ? b.path.split(',').length : 0;
      return da - db;
    });

    // Divider between breadcrumb and match chips
    const divider = document.createElement('div');
    divider.className = 'stt-divider';
    $searchTickTooltip.appendChild(divider);

    // Build chain of ancestor + target chips, deduplicating
    const renderedPaths = new Set();

    for (const { path, p, isOld, prec } of matchedPaths) {
      if (prec) {
        const chip = document.createElement('div');
        chip.className = 'mtt-chip mtt-target';
        chip.innerHTML = extractTextWithMarks(p);
        $searchTickTooltip.appendChild(chip);
        continue;
      }
      // Old-version paragraphs: show caput ancestor, then strikethrough chip
      if (isOld) {
        // Render caput as ancestor if not already shown
        if (!renderedPaths.has('')) {
          renderedPaths.add('');
          const caputP = card.querySelector(':scope > p:not(.old-version)');
          if (caputP) {
            const caputChip = document.createElement('div');
            caputChip.className = 'mtt-chip';
            const uidSpan = caputP.querySelector('.unit-id');
            const clone = caputP.cloneNode(true);
            clone.querySelectorAll('.indent-path').forEach(el => el.remove());
            clone.querySelectorAll('.unit-id').forEach(el => el.remove());
            const caputLabel = uidSpan ? uidSpan.textContent : '';
            const caputRest = clone.textContent.trim();
            if (caputLabel) {
              caputChip.innerHTML = '<b>' + escapeHtml(caputLabel) + '</b> ' + escapeHtml(caputRest);
            } else {
              caputChip.textContent = caputRest;
            }
            $searchTickTooltip.appendChild(caputChip);
          }
        }
        const chip = document.createElement('div');
        chip.className = 'mtt-chip mtt-target mtt-old';
        const rawHtml = extractTextWithMarks(p);
        // Try to split label (e.g. "Art. 38 -") from rest
        const text = p.textContent.trim();
        const dashIdx = text.indexOf(' - ');
        if (dashIdx >= 0 && dashIdx < 40) {
          const label = text.slice(0, dashIdx);
          chip.innerHTML = '<b>' + escapeHtml(label) + '</b>' + rawHtml.slice(rawHtml.indexOf(escapeHtml(label)) + escapeHtml(label).length);
        } else {
          chip.innerHTML = rawHtml;
        }
        $searchTickTooltip.appendChild(chip);
        continue;
      }

      const parts = path ? path.split(',') : [];
      const chain = [''];
      for (let i = 0; i < parts.length; i++) {
        chain.push(parts.slice(0, i + 1).join(','));
      }

      for (let i = 0; i < chain.length; i++) {
        const segPath = chain[i];
        if (renderedPaths.has(segPath)) continue;
        renderedPaths.add(segPath);

        const isTarget = segPath === path;
        let segP;
        if (segPath === '') {
          segP = card.querySelector(':scope > p:not(.old-version)');
        } else {
          const seg = card.querySelector('.unit-id[data-path="' + segPath + '"]');
          if (seg) segP = seg.closest('.art-para') || seg.parentElement;
        }
        if (!segP) continue;

        const chip = document.createElement('div');
        chip.className = 'mtt-chip' + (isTarget ? ' mtt-target' : '');

        if (isTarget) {
          // Label comes from .unit-id; rest from extractTextWithMarks (which skips .unit-id)
          const uidSpan = segP.querySelector('.unit-id');
          const label = uidSpan ? uidSpan.textContent : '';
          const rawHtml = extractTextWithMarks(segP);
          if (label) {
            chip.innerHTML = '<b>' + escapeHtml(label) + '</b>' + rawHtml;
          } else {
            chip.innerHTML = rawHtml;
          }
        } else {
          // Plain text for ancestor segments
          const clone = segP.cloneNode(true);
          clone.querySelectorAll('.indent-path').forEach(el => el.remove());
          const text = clone.textContent.trim();
          let label = '', rest = text;
          const dashIdx = text.indexOf('\u00a0\u2014');
          const dashIdx2 = text.indexOf(' \u2014');
          const splitIdx = dashIdx >= 0 ? dashIdx : dashIdx2;
          if (splitIdx >= 0 && splitIdx < 40) {
            label = text.slice(0, splitIdx);
            rest = text.slice(splitIdx);
          }
          if (label) {
            chip.innerHTML = '<b>' + escapeHtml(label) + '</b>' + escapeHtml(rest);
          } else {
            chip.textContent = rest;
          }
        }

        $searchTickTooltip.appendChild(chip);
      }
    }
  }

  function showMarkerTooltip(btn, uid, palette) {
    if (!buildMarkerTooltip(uid, palette)) return;
    $markerTooltip.classList.add('visible');
    // Position to the left of the button, vertically centered
    const br = btn.getBoundingClientRect();
    const tr = $markerTooltip.getBoundingClientRect();
    let left = br.left - tr.width - 8;
    let top = br.top + br.height / 2 - tr.height / 2;
    // Clamp to viewport
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    if (top + tr.height > window.innerHeight - 4) {
      top = window.innerHeight - 4 - tr.height;
    }
    $markerTooltip.style.left = left + 'px';
    $markerTooltip.style.top = top + 'px';
  }

  function hideMarkerTooltip() {
    $markerTooltip.classList.remove('visible');
    $markerTooltip.innerHTML = '';
    if (markerTooltipTimer) {
      clearTimeout(markerTooltipTimer);
      markerTooltipTimer = null;
    }
  }

  $cards.addEventListener('click', (e) => {
    const unitId = e.target.closest('.unit-id');
    if (unitId) {
      e.stopPropagation();
      toggleMarker(unitId.dataset.uid);
      return;
    }
    // Compact mode: tap on article label to toggle marker on caput
    const compactLabel = e.target.closest('.art-compact-label');
    if (compactLabel && compactMode) {
      e.stopPropagation();
      const card = compactLabel.closest('.card-artigo');
      if (card) {
        const firstUid = card.querySelector('.unit-id');
        if (firstUid) toggleMarker(firstUid.dataset.uid);
      }
      return;
    }
  });

  // ===== REMISSÕES =====
  // A citation ("artigo 369") is a trigger (span.rem-exp, around the text and its
  // original links) with data-ref = the cited provisions ("369", "LOM:42,§ 7º",
  // "18,VI"; several separated by ";"), and data-rev / data-tach = the revoked or
  // struck ones. A correlate in another norm (implicit remissão) is a badge
  // (span.rem-imp) at the end of the provision, on both sides, with data-tipo
  // (eq / det / fund / div), data-side (src / tgt) and data-n (its note in
  // the page's correlatoNotas: the badge is on both sides, the note only once). The preview is
  // built from the target's card in this same page, so it always shows the
  // wording in force. Hover (desktop) shows a floating preview; click/tap or
  // Enter pins a box under the provision.
  const HOVER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  // Official texts, for "fonte oficial" (anchors artN exist on these pages)
  const REM_SOURCES = {
    RI: 'https://app-plpconsulta-prd.azurewebsites.net/Forms/MostrarArquivo?ID=168&TipArq=1',
    LOM: 'https://app-plpconsulta-prd.azurewebsites.net/Forms/MostrarArquivo?ID=68&TipArq=1',
    CE: 'https://www.al.sp.gov.br/repositorio/legislacao/constituicao/1989/compilacao-constituicao-0-05.10.1989.html',
    CF: 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm',
  };
  const $header = document.getElementById('header');
  const $remPop = document.createElement('div');
  $remPop.id = 'rem-pop';
  document.body.appendChild($remPop);
  const $remReturn = document.createElement('button');
  $remReturn.id = 'rem-return';
  $remReturn.type = 'button';
  document.body.appendChild($remReturn);
  let remHideTimer = null, remShowTimer = null, remReturnTo = null, remPopTrigger = null;
  // Kind of correlate, as read from the origin and from the target side
  const REM_TIPO = {
    eq: ['≈ Mesma regra', '≈ Mesma regra'],
    det: ['Detalha a norma correlata', 'Detalhado na norma correlata'],
    fund: ['↑ Fundamento na norma superior', '↓ Aplicado na norma correlata'],
    div: ['≠ Divergência', '≠ Divergência'],
    sim: ['⇄ Regra federal correspondente', '⇄ Regra municipal correspondente'],
    exc: ['Regra geral', 'Exceção à regra geral'],
  };
  // A box belongs to one trigger: a citation and a badge may point to the same place
  function remKey(trigger) {
    if (trigger.classList.contains('idx-back')) return 'idx:' + trigger.dataset.label;
    return (trigger.classList.contains('rem-imp') ? 'imp:' : '') + trigger.dataset.ref;
  }
  // The color of the preview and of the box: the norma it points to (its first
  // target's), or the index's
  function remKind(trigger) {
    return trigger.classList.contains('idx-back') ? 'idx' : '';
  }
  function remNorm(trigger) {
    return trigger.classList.contains('idx-back') ? '' : parseRemRef(trigger.dataset.ref.split(';')[0]).law;
  }
  function remPanel(trigger) {
    return trigger.classList.contains('idx-back') ? buildIdxPanel(trigger) : buildRemPanel(trigger);
  }

  function parseRemRef(s) {
    let law = 'RI';
    const m = s.match(/^([A-Z]{2,}):(.+)$/);
    if (m) { law = m[1]; s = m[2]; }
    const parts = s.split(',');
    return { law, art: parts.shift().trim(), path: parts.map(x => x.trim()).join(',') };
  }
  function remCard(r) {
    return r.law === 'RI'
      ? $cards.querySelector(`.card-artigo[data-art="${r.art}"]:not([data-law])`)
      : $cards.querySelector(`.card-artigo[data-art="${r.art}"][data-law="${r.law}"]`);
  }
  function remUnitP(card, path) {
    if (path === 'caput') return remCaputP(card);   // the index's
    for (const u of card.querySelectorAll(':scope > p .unit-id[data-path]')) {
      if (u.dataset.path === path) return u.closest('p');
    }
    // revoked or struck: the last old version at that path
    const olds = card.querySelectorAll(`:scope > .old-version[data-path="${CSS.escape(path)}"]`);
    return olds.length ? olds[olds.length - 1] : null;
  }
  function remCaputP(card) { return card.querySelector(':scope > p:not(.art-para):not(.old-version)'); }
  function remFmtPath(path) {
    return path.split(',').map(x => x === '§ú' ? 'parágrafo único' : x).join(', ');
  }
  function remArtLabel(art) { return art.startsWith('ADT') ? art.slice(3) + ' ADT' : art; }
  function remRefLabel(r) {
    if (r.law === 'PREC') return 'Precedente ' + precLabel(r.art);
    return (r.law !== 'RI' ? r.law + ' ' : '') + 'Art. ' + remArtLabel(r.art) + (r.path ? ', ' + remFmtPath(r.path) : '');
  }
  function remSourceUrl(g) {
    if (g.law === 'PREC') {
      // each precedent has its own page (the link of its title in the DOCX)
      const card = remCard(g);
      return (card && card.dataset.src) || null;
    }
    const base = REM_SOURCES[g.law];
    if (!base) return null;
    if (g.law === 'CE') return base;   // the ALESP page has no anchors
    if (!g.art.startsWith('ADT')) return base + '#art' + g.art.replace('-', '');
    const n = g.art.slice(3);
    if (g.law === 'LOM') return base + '#' + encodeURIComponent('DisposiçõesTransitóriasart' + n);
    if (g.law === 'RI') return base + '#art' + n.replace('-', '') + 'adt';
    return base;
  }
  // A copy of a paragraph for the preview, without the page's controls
  function remClone(p) {
    const c = p.cloneNode(true);
    c.querySelectorAll('.footnote-ref, .footnote-box, .indent-path, .diff-toggle, .rem-backlinks, .rem-imp')
      .forEach(n => n.remove());
    c.querySelectorAll('.unit-id').forEach(u => {
      u.classList.replace('unit-id', 'rem-uid');
      u.removeAttribute('data-uid');
      u.removeAttribute('data-path');
    });
    c.classList.remove('selected', 'diff-open', 'rem-flash');
    c.removeAttribute('data-path');
    c.removeAttribute('id');
    return c;
  }

  // What to show of the target: the whole article (caput + provisions in force),
  // or the provision(s) with their ancestors (caput → § → inciso), "[…]" for gaps.
  // Several targets in one article ("incisos III, IV e V do art. 18") become one block.
  function remExcerpt(g) {
    const card = remCard(g);
    if (!card) return null;
    // a precedent: its text, without the title (already in the group's head)
    const vig = [...card.querySelectorAll(isPrecCard(card) ? ':scope > p.prec-para' : ':scope > p:not(.old-version)')];
    const pick = new Set(), hits = new Set();
    if (g.paths.includes('')) vig.forEach(p => pick.add(p));
    for (const path of g.paths.filter(Boolean)) {
      const segs = path.split(',');
      const cap = remCaputP(card);
      if (cap) pick.add(cap);
      for (let i = 1; i < segs.length; i++) {
        const a = remUnitP(card, segs.slice(0, i).join(','));
        if (a && !a.classList.contains('old-version')) pick.add(a);
      }
      const t = remUnitP(card, path);
      if (!t) return null;
      pick.add(t); hits.add(t);
    }
    const order = [...card.querySelectorAll(':scope > p')];
    const frag = document.createDocumentFragment();
    let last = -1;
    for (const p of [...pick].sort((x, y) => order.indexOf(x) - order.indexOf(y))) {
      const i = vig.indexOf(p);
      if (last >= 0 && i > last + 1) {
        const gp = document.createElement('p');
        gp.className = 'rem-gap';
        gp.textContent = '[…]';
        frag.appendChild(gp);
      }
      const c = remClone(p);
      if (hits.has(p)) c.classList.add('rem-hit');
      frag.appendChild(c);
      if (i >= 0) last = i;
    }
    const sint = card.querySelector('.art-summary');
    return { card, frag, sint: sint ? sint.textContent : '' };
  }

  function remGroupLabel(g) {
    if (g.law === 'PREC') return 'Precedente ' + precLabel(g.art);
    const ps = g.paths.filter(Boolean).map(remFmtPath);
    const tail = ps.length > 1 ? ps.slice(0, -1).join(', ') + ' e ' + ps[ps.length - 1] : ps.join('');
    const sep = g.paths.includes('') ? ' e ' : ', ';
    return 'Art. ' + remArtLabel(g.art) + (tail ? sep + tail : '');
  }

  function buildRemPanel(trigger) {
    const revoked = new Set((trigger.dataset.rev || '').split(';').filter(Boolean));
    const struck = new Set((trigger.dataset.tach || '').split(';').filter(Boolean));
    const groups = [];
    for (const ref of trigger.dataset.ref.split(';')) {
      const r = parseRemRef(ref);
      let g = groups.find(x => x.law === r.law && x.art === r.art);
      if (!g) groups.push(g = { law: r.law, art: r.art, paths: [], revoked: false, struck: false });
      g.paths.push(r.path);
      if (revoked.has(ref)) g.revoked = true;
      if (struck.has(ref)) g.struck = true;
    }
    const wrap = document.createDocumentFragment();
    const tipo = trigger.dataset.tipo;
    if (tipo && REM_TIPO[tipo]) {
      // correlate: what links the two provisions comes first
      const n = document.createElement('div');
      n.className = 'rem-note t-' + tipo;
      const k = document.createElement('span');
      k.className = 'rem-kind';
      // "correspondente" inside one norm (data-mesma: RI–RI, LOM–LOM) is no federal
      // rule: parts of one procedure or parallel rules, linked both ways
      // and with the Constituição Estadual (data-esfera) it is the state rule; a CF and a
      // CE of the same wording in one badge (data-esfera="ambas") are the two rules
      k.textContent = tipo === 'sim' && trigger.dataset.mesma ? '⇄ Dispositivo correspondente'
        : tipo === 'sim' && trigger.dataset.esfera === 'ambas' && trigger.dataset.side !== 'tgt' ? '⇄ Regras federal e estadual correspondentes'
        : tipo === 'sim' && trigger.dataset.esfera && trigger.dataset.side !== 'tgt' ? '⇄ Regra estadual correspondente'
        : REM_TIPO[tipo][trigger.dataset.side === 'tgt' ? 1 : 0];
      n.appendChild(k);
      if (trigger.dataset.status === 'proposta') {
        const pr = document.createElement('span');
        pr.className = 'rem-proposta';
        pr.textContent = 'proposta, ainda não revisada';
        n.appendChild(pr);
      }
      if (trigger.dataset.n) n.appendChild(document.createTextNode(correlatoNotas()[+trigger.dataset.n]));
      wrap.appendChild(n);
    }
    for (const g of groups) {
      const ex = remExcerpt(g);
      const group = document.createElement('section');
      group.className = 'rem-group';
      const head = document.createElement('div');
      head.className = 'rem-head';
      const law = document.createElement('span');
      law.className = 'rem-law ' + g.law;
      law.textContent = g.law;
      const label = document.createElement('span');
      label.textContent = remGroupLabel(g);
      head.append(law, label);
      const status = g.revoked || (ex && ex.card.classList.contains('revoked')) ? 'revogado'
        : g.struck ? 'sem efeito' : '';
      if (status) {
        const rv = document.createElement('span');
        rv.className = 'rem-revoked';
        rv.textContent = status;
        head.appendChild(rv);
      }
      if (ex && ex.sint) {
        const s = document.createElement('span');
        s.className = 'rem-sint';
        s.textContent = '— ' + ex.sint;
        head.appendChild(s);
      }
      group.appendChild(head);
      const body = document.createElement('div');
      body.className = 'rem-body';
      if (ex) body.appendChild(ex.frag);
      else body.textContent = 'Dispositivo não encontrado nesta página.';
      group.appendChild(body);
      const foot = document.createElement('div');
      foot.className = 'rem-foot';
      const first = { law: g.law, art: g.art, path: g.paths[0] };
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = 'Ir para ' + remRefLabel(first) + ' ›';
      go.addEventListener('click', ev => { ev.stopPropagation(); remGoTo(first, trigger); });
      foot.appendChild(go);
      const src = remSourceUrl(g);
      if (src) {
        const a = document.createElement('a');
        a.href = src; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = 'fonte oficial ↗';
        foot.appendChild(a);
      }
      group.appendChild(foot);
      wrap.appendChild(group);
    }
    return wrap;
  }

  function showRemPop(trigger) {
    remPopTrigger = trigger;
    $remPop.replaceChildren(remPanel(trigger));
    // its color (style.css), as in the pinned box
    for (const c of [...$remPop.classList]) if (c.startsWith('t-')) $remPop.classList.remove(c);
    if (remKind(trigger)) $remPop.classList.add('t-' + remKind(trigger));
    if (remNorm(trigger)) $remPop.dataset.nrm = remNorm(trigger);
    else delete $remPop.dataset.nrm;
    $remPop.style.maxHeight = 'none';
    $remPop.classList.add('visible');
    // The side with more room, never over the trigger, the header or the breadcrumb
    const rr = trigger.getBoundingClientRect();
    let topLimit = $header ? $header.getBoundingClientRect().bottom : 0;
    if ($breadcrumb && $breadcrumb.classList.contains('visible')) {
      topLimit = Math.max(topLimit, $breadcrumb.getBoundingClientRect().bottom);
    }
    topLimit += 6;
    if (trigger.classList.contains('idx-line') && placeRemPopBeside(trigger, topLimit)) return;
    const below = window.innerHeight - rr.bottom - 14;
    const above = rr.top - topLimit - 8;
    const natural = $remPop.getBoundingClientRect().height;
    const cap = window.innerHeight * 0.6;
    const useBelow = Math.min(natural, cap) <= below || below >= above;
    const h = Math.max(80, Math.min(natural, cap, useBelow ? below : above));
    $remPop.style.maxHeight = h + 'px';
    const viewW = document.documentElement.clientWidth;
    const left = Math.min(Math.max(8, rr.left), viewW - $remPop.offsetWidth - 8);
    $remPop.style.left = left + 'px';
    $remPop.style.top = (useBelow ? rr.bottom + 6 : rr.top - 6 - h) + 'px';
  }
  // A line of an index box: beside its text, if there is room, so that the
  // lines under it stay free to hover
  function placeRemPopBeside(line, topLimit) {
    const range = document.createRange();
    range.selectNodeContents(line);
    const tr = range.getBoundingClientRect();
    const left = tr.right + 14;
    if (left + $remPop.offsetWidth > document.documentElement.clientWidth - 8) return false;
    const natural = $remPop.getBoundingClientRect().height;
    const h = Math.max(80, Math.min(natural, window.innerHeight * 0.6, window.innerHeight - 8 - topLimit));
    $remPop.style.maxHeight = h + 'px';
    $remPop.style.left = left + 'px';
    $remPop.style.top = Math.max(topLimit, Math.min(tr.top - 8, window.innerHeight - 8 - h)) + 'px';
    return true;
  }
  // An entry of the index opens its box inside the band at the card's foot;
  // anything else, right under its provision
  function remBoxOpen(trigger) {
    const key = remKey(trigger);
    const band = trigger.closest('.idx-backlinks');
    if (band) return [...band.querySelectorAll(':scope > .rem-box')].find(b => b.dataset.for === key) || null;
    const p = trigger.closest('p');
    for (let box = p && p.nextElementSibling; box && box.classList.contains('rem-box'); box = box.nextElementSibling) {
      if (box.dataset.for === key) return box;
    }
    return null;
  }
  function hideRemPop() {
    clearTimeout(remShowTimer);
    $remPop.classList.remove('visible');
  }

  // The chip (or citation) whose box is open stays marked until the box closes
  const remBoxTrigger = new WeakMap();
  function closeRemBox(box) {
    const t = remBoxTrigger.get(box);
    if (t) { t.classList.remove('rem-open'); t.setAttribute('aria-expanded', 'false'); }
    box.remove();
  }

  // Click/tap: pins the preview in a box under the provision (the only mode on touch)
  function toggleRemBox(trigger) {
    const open = remBoxOpen(trigger);
    if (open) { closeRemBox(open); return; }
    const b = document.createElement('div');
    b.className = 'rem-box' + (remKind(trigger) ? ' t-' + remKind(trigger) : '');
    if (remNorm(trigger)) b.dataset.nrm = remNorm(trigger);
    b.dataset.for = remKey(trigger);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'rem-close';
    close.setAttribute('aria-label', 'Fechar');
    close.textContent = '×';
    b.append(close, remPanel(trigger));
    const band = trigger.closest('.idx-backlinks');
    if (band) band.appendChild(b);
    else {
      // after the boxes already open there, in reading order
      let after = trigger.closest('p') || trigger.closest('.rem-backlinks');
      while (after.nextElementSibling && after.nextElementSibling.classList.contains('rem-box')) {
        after = after.nextElementSibling;
      }
      after.after(b);
    }
    remBoxTrigger.set(b, trigger);
    trigger.classList.add('rem-open');
    trigger.setAttribute('aria-expanded', 'true');
  }

  // Highlight the target once the smooth scroll gets there
  function remFlash(el, scrolls = true) {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      el.classList.remove('rem-flash'); void el.offsetWidth; el.classList.add('rem-flash');
    };
    if (!scrolls) { go(); return; }
    if ('onscrollend' in window) window.addEventListener('scrollend', go, { once: true });
    setTimeout(go, 1500);
  }
  // Scroll el to the middle of the screen (a jump, not an animation, when far:
  // see scrollToY); returns whether the page moves
  function remScrollTo(el) {
    const r = el.getBoundingClientRect();
    const y = window.scrollY + r.top - (window.innerHeight - Math.min(r.height, window.innerHeight)) / 2;
    const moves = Math.abs(y - window.scrollY) >= 2;
    if (moves) scrollToY(y, 'smooth');
    return moves && Math.abs(y - window.scrollY) <= FAR_SCROLL_SCREENS * window.innerHeight;
  }

  function remGoTo(r, trigger) {
    const card = remCard(r);
    if (!card) return;
    const target = (r.path && remUnitP(card, r.path)) || card;
    takeStep('rem');
    card.classList.remove('filtered-out');   // the target may be hidden by a filter
    remReturnTo = trigger;
    const src = trigger.closest('.card-artigo');
    const up = trigger.closest('p') && trigger.closest('p').querySelector('.unit-id');
    if (src) {
      const from = { law: src.dataset.law || 'RI', art: src.dataset.art, path: (up && up.dataset.path) || '' };
      $remReturn.textContent = '← voltar ao ' + remRefLabel(from);
      $remReturn.classList.add('visible');
    }
    hideRemPop();
    const smooth = remScrollTo(target);
    // the keyboard goes on from the target, not from the citation
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    remFlash(target, smooth);
  }
  $remReturn.addEventListener('click', () => {
    // as back: the jump's step out of the history (forward goes to it again)
    if (stepKinds.get(stepId) === 'rem') {
      steps.set(stepId, stepState());
      dropStep('rem');
    }
    if (remReturnTo && remReturnTo.isConnected) {
      const smooth = remScrollTo(remReturnTo);
      if (remReturnTo.tabIndex >= 0) remReturnTo.focus({ preventScroll: true });
      remFlash(remReturnTo.closest('p') || remReturnTo, smooth);
    }
    $remReturn.classList.remove('visible');
  });

  $cards.addEventListener('click', e => {
    const close = e.target.closest('.rem-close');
    if (close) {
      e.stopPropagation();
      closeRemBox(close.closest('.rem-box'));
      return;
    }
    const t = e.target.closest('.rem');
    if (!t) return;
    // Ctrl/Cmd/Shift-click or middle click on the citation's own link: open it, as before
    if (e.target.closest('a[href]') && (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0)) return;
    e.preventDefault(); e.stopPropagation();
    hideRemPop();
    if (t.classList.contains('rem-back')) { remGoTo(parseRemRef(t.dataset.ref), t); return; }
    toggleRemBox(t);
  }, true);
  $cards.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target.classList && e.target.classList.contains('rem') ? e.target : null;
    if (!t) return;
    e.preventDefault();
    hideRemPop();
    if (t.classList.contains('rem-back')) remGoTo(parseRemRef(t.dataset.ref), t);
    else toggleRemBox(t);
  });
  // Esc closes the preview, or the box the focus is in, before clearing the search
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const active = document.activeElement;
    let box = null;
    if (active && active.classList && (active.classList.contains('rem-exp') || active.classList.contains('rem-imp')
        || active.classList.contains('idx-back'))) {
      box = remBoxOpen(active);
    }
    if (!box && active && active.closest) box = active.closest('.rem-box');
    if ($remPop.classList.contains('visible')) hideRemPop();
    else if (box) {
      const t = remBoxTrigger.get(box);
      closeRemBox(box);
      if (t && t.isConnected) t.focus({ preventScroll: true });
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  if (HOVER) {
    $cards.addEventListener('mouseover', e => {
      // (in a box, only the lines of an index entry's: they preview their dispositivo)
      const t = e.target.closest('.rem-exp, .rem-imp, .rem-back, .idx-back, .rem-box .idx-line');
      if (!t || (t.closest('.rem-box') && !t.classList.contains('idx-line'))) return;
      if (e.relatedTarget && t.contains(e.relatedTarget)) return;   // moving inside the trigger
      clearTimeout(remHideTimer); clearTimeout(remShowTimer);
      if (!t.classList.contains('rem-back') && remBoxOpen(t)) return;  // its box is already open
      remShowTimer = setTimeout(() => showRemPop(t), 250);
    });
    $cards.addEventListener('mouseout', e => {
      const t = e.target.closest('.rem, .idx-line');
      if (!t || (e.relatedTarget && t.contains(e.relatedTarget))) return;
      clearTimeout(remShowTimer);
      remHideTimer = setTimeout(hideRemPop, 250);
    });
    $remPop.addEventListener('mouseenter', () => clearTimeout(remHideTimer));
    // A citation inside the preview: go to it (back returns to the original one)
    $remPop.addEventListener('click', e => {
      const t = e.target.closest('.rem-exp');
      if (!t) return;
      if (e.target.closest('a[href]') && (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0)) return;
      e.preventDefault();
      if (remPopTrigger) remGoTo(parseRemRef(t.dataset.ref.split(';')[0]), remPopTrigger);
    });
    $remPop.addEventListener('mouseleave', () => { remHideTimer = setTimeout(hideRemPop, 250); });
  }
  window.addEventListener('scroll', () => { if ($remPop.classList.contains('visible')) hideRemPop(); },
    { passive: true });

  // ===== FOOTNOTES =====
  $cards.addEventListener('click', (e) => {
    const ref = e.target.closest('.footnote-ref');
    if (ref) {
      e.stopPropagation();
      hideFootnoteTooltip();
      const noteId = ref.dataset.note;
      const card = ref.closest('.card');
      const box = card.querySelector(`.footnote-box[data-note="${noteId}"]`);
      if (box) box.classList.toggle('open');
      return;
    }
    const closeBtn = e.target.closest('.footnote-close');
    if (closeBtn) {
      e.stopPropagation();
      closeBtn.closest('.footnote-box').classList.remove('open');
    }
  });

  // ===== FOOTNOTE TOOLTIP =====
  function showFootnoteTooltip(ref) {
    const noteId = ref.dataset.note;
    const card = ref.closest('.card');
    if (!card) return;
    const box = card.querySelector(`.footnote-box[data-note="${noteId}"]`);
    if (!box) return;
    // Clone content without the close button
    const clone = box.cloneNode(true);
    markHighlightsInClone(box, clone);
    const closeBtn = clone.querySelector('.footnote-close');
    if (closeBtn) closeBtn.remove();
    $footnoteTooltip.innerHTML = clone.innerHTML;
    $footnoteTooltip.classList.add('visible');
    // Position below by default (less likely to cover article text).
    // Exception: if the ref is near the top of its card (first line),
    // position above so the tooltip doesn't cover the article body.
    const rr = ref.getBoundingClientRect();
    const tr = $footnoteTooltip.getBoundingClientRect();
    let left = rr.left + rr.width / 2 - tr.width / 2;
    const cardRect = card.getBoundingClientRect();
    const isFirstLine = rr.top - cardRect.top < 60;
    let top;
    if (isFirstLine) {
      // First line: prefer above
      top = rr.top - tr.height - 6;
      if (top < 4) top = rr.bottom + 6;
    } else {
      // Default: prefer below
      top = rr.bottom + 6;
      if (top + tr.height > window.innerHeight - 4) top = rr.top - tr.height - 6;
    }
    // Clamp horizontally
    if (left < 4) left = 4;
    if (left + tr.width > window.innerWidth - 4) left = window.innerWidth - 4 - tr.width;
    $footnoteTooltip.style.left = left + 'px';
    $footnoteTooltip.style.top = top + 'px';
  }

  function hideFootnoteTooltip() {
    $footnoteTooltip.classList.remove('visible');
    $footnoteTooltip.innerHTML = '';
    if (footnoteTooltipTimer) {
      clearTimeout(footnoteTooltipTimer);
      footnoteTooltipTimer = null;
    }
  }

  // Desktop: hover
  $cards.addEventListener('mouseenter', (e) => {
    const ref = e.target.closest('.footnote-ref');
    if (ref) showFootnoteTooltip(ref);
  }, true);
  $cards.addEventListener('mouseleave', (e) => {
    const ref = e.target.closest('.footnote-ref');
    if (ref) hideFootnoteTooltip();
  }, true);

  // Mobile: long-press
  $cards.addEventListener('touchstart', (e) => {
    const ref = e.target.closest('.footnote-ref');
    if (!ref) return;
    footnoteTooltipTimer = setTimeout(() => {
      e.preventDefault();
      showFootnoteTooltip(ref);
    }, 500);
  }, { passive: false });
  $cards.addEventListener('touchend', (e) => {
    if (e.target.closest('.footnote-ref')) hideFootnoteTooltip();
  });
  $cards.addEventListener('touchmove', (e) => {
    if (e.target.closest('.footnote-ref')) hideFootnoteTooltip();
  });

  // ===== INDEX PANEL =====
  let currentIndexTab = 'systematic';

  function openIndex() {
    takeStep('panel');
    // The results drawer (opened by a search, below the header) gives way;
    // the panel links back to it
    if (resultsDrawerOpen) {
      resultsDrawerOpen = false;
      updateResultsVisibility();
    }
    $indexOverlay.classList.add('open');
    $indexPanel.classList.add('open');
    sysNorm = -1;
    sysTitle = null;
    renderIndex();
    if (window.innerWidth > 768) $indexSearch.focus();
  }

  function closeIndex() {
    dropStep('panel');
    $indexOverlay.classList.remove('open');
    $indexPanel.classList.remove('open');
    $sysTip.classList.remove('visible');
    $indexContent.querySelectorAll('.vide-highlight').forEach(el => el.classList.remove('vide-highlight'));
  }

  $btnIndex.addEventListener('click', openIndex);
  $indexOverlay.addEventListener('click', () => {
    closeIndex();
    if (resultsDrawerOpen) closeResults();
  });

  const $btnInfoTab = document.getElementById('btn-info-tab');
  const $indexSearchWrapper = document.getElementById('index-search-wrapper');

  function setIndexTab(name) {
    document.querySelectorAll('.index-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $btnInfoTab.classList.toggle('active', name === 'info');
    currentIndexTab = name;
    $indexSearchWrapper.style.display = name === 'info' ? 'none' : '';
  }

  document.querySelectorAll('.index-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      setIndexTab(tab.dataset.tab);
      renderIndex();
      $indexContent.scrollTop = 0;   // (not where the last tab was)
      if (currentIndexTab === 'systematic') syncSystematicToScroll();
    });
  });

  $btnInfoTab.addEventListener('click', () => {
    setIndexTab('info');
    renderIndex();
  });

  const $btnClearIndexSearch = document.getElementById('btn-clear-index-search');

  // Filtering the remissivo redoes thousands of entries: wait for a pause in
  // the typing, as the search bar does (a short filter matches almost all)
  let indexFilterTimer = null;
  $indexSearch.addEventListener('input', () => {
    $btnClearIndexSearch.style.display = $indexSearch.value.trim() ? 'flex' : 'none';
    clearTimeout(indexFilterTimer);
    const delay = $indexSearch.value.trim().length <= 3 ? SHORT_TERM_SEARCH_DELAY_MS : SEARCH_DELAY_MS;
    indexFilterTimer = setTimeout(renderIndex, delay);
  });

  // Right away (a vide needs its target in the list)
  function setIndexFilter(value) {
    $indexSearch.value = value;
    $btnClearIndexSearch.style.display = value.trim() ? 'flex' : 'none';
    renderIndex();
  }

  $btnClearIndexSearch.addEventListener('click', () => {
    setIndexFilter('');
    $indexSearch.focus();
  });

  // The entries' text lowercased and without accents, once per text
  const filterTextCache = new Map();
  let filterTermsOf = null, filterTerms = [];
  function textMatchesFilter(text, filter) {
    let lower = filterTextCache.get(text);
    if (lower === undefined) filterTextCache.set(text, lower = stripAccents(text.toLowerCase()));
    if (filter !== filterTermsOf) {
      filterTermsOf = filter;
      filterTerms = stripAccents(filter).split(/\s+/);
    }
    return filterTerms.every(term => lower.includes(term));
  }

  // The remissivo and the referências unfiltered are thousands of entries:
  // built once (per category) and put back on each opening, not rebuilt
  const indexDomCache = new Map();

  function renderIndex() {
    indexRenders++;
    clearTimeout(indexFilterTimer);
    indexFill = null;
    // one letter would match nearly every entry: not a filter (as in the search bar)
    let filter = $indexSearch.value.trim().toLowerCase();
    if (filter.length < MIN_TERM_LENGTH) filter = '';
    const cacheKey = filter ? null
      : currentIndexTab === 'subject' ? 'subject'
      : currentIndexTab === 'references' ? 'references:' + currentRefCategory : null;
    $indexPanel.dataset.tab = currentIndexTab;
    $indexContent.classList.remove('sys-two');
    const cached = cacheKey && indexDomCache.get(cacheKey);
    if (cached) {
      $indexContent.replaceChildren(...cached);
      if (cacheKey === 'subject') buildSubjectRail(subjAllLetters);
      $indexContent.querySelectorAll('.vide-highlight').forEach(el => el.classList.remove('vide-highlight'));
      return;
    }
    $indexContent.innerHTML = '';

    if (currentIndexTab === 'info') {
      $indexContent.innerHTML = '<div class="info-content">' + INFO_HTML + '</div>';
      return;
    } else if (currentIndexTab === 'systematic') {
      renderSystematicIndex(filter);
      if (!filter) syncSystematicToScroll();
    } else if (currentIndexTab === 'references') {
      renderReferencesIndex(filter);
    } else {
      renderSubjectIndex(filter);
    }

    if (filter) {
      highlightIndexContent(filter);
    }
    // (the whole remissivo is kept once its last slice is in)
    if (cacheKey && cacheKey !== 'subject') indexDomCache.set(cacheKey, [...$indexContent.childNodes]);
  }

  function highlightIndexContent(filter) {
    const terms = filter.split(/\s+/).filter(Boolean);
    const regex = new RegExp(terms.map(t => accentInsensitivePattern(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('|'), 'gi');
    const walker = document.createTreeWalker($indexContent, NodeFilter.SHOW_TEXT, null);
    const hits = [];
    while (walker.nextNode()) {
      regex.lastIndex = 0;
      if (regex.test(walker.currentNode.data)) hits.push(walker.currentNode);
    }
    // Each match split off its text node into a <mark> (no HTML to parse)
    for (let tn of hits) {
      const spans = [];
      regex.lastIndex = 0;
      for (let m; (m = regex.exec(tn.data)); ) spans.push([m.index, m[0].length]);
      let offset = 0;
      for (const [at, len] of spans) {
        const hit = tn.splitText(at - offset);
        tn = hit.splitText(len);
        offset = at + len;
        const mark = document.createElement('mark');
        hit.replaceWith(mark);
        mark.appendChild(hit);
      }
    }
  }

  // The systematic index: one norma at a time (its tabs at the top). Each
  // título is a bar as long as its number of articles, split in its
  // capítulos: where the bulk of the norma is, and where the reader is. On a
  // wide panel, two columns: the títulos on the left, the hovered (or
  // clicked) one's capítulos and seções on the right; narrow, a título opens
  // them under it. Names in capitals are shown in sentence case.
  const SYS_LEVELS = ['norma', 'tit', 'cap', 'sec', 'subsec'];
  const SYS_LEVEL_NAME = { norma: 'norma', tit: 'titulo', cap: 'capitulo', sec: 'secao', subsec: 'subsecao' };
  const SYS_ABBR = { 'TÍTULO': 'Tít.', 'CAPÍTULO': 'Cap.', 'SEÇÃO': 'Seç.', 'SUBSEÇÃO': 'Subs.' };
  const SYS_NORM_SHORT = { 'Regimento Interno': 'RI', 'Lei Orgânica': 'LOM', 'Constituição Estadual': 'CE',
    'Constituição Federal': 'CF', 'Precedentes Regimentais': 'Precedentes' };
  // ...and its prefix, for its color (CSS: [data-nrm])
  const SYS_NORM_PREFIX = { 'Regimento Interno': 'RI', 'Lei Orgânica': 'LOM', 'Constituição Estadual': 'CE',
    'Constituição Federal': 'CF', 'Precedentes Regimentais': 'PREC' };
  // kept capitalized when a name in capitals is lowercased (the longer first)
  const SYS_PROPER = ['Câmara Municipal', 'Câmara dos Deputados', 'Câmara', 'Mesa', 'Plenário', 'Vereadores', 'Vereador',
    'Vice-Presidentes', 'Presidentes', 'Presidente', 'Secretários Municipais', 'Secretários', 'Comissões Permanentes',
    'Comissões Temporárias', 'Comissões', 'Comissão', 'Município', 'Prefeito', 'Lei Orgânica', 'Regimento Interno',
    'Estado', 'União', 'Distrito Federal', 'República', 'Tribunal de Contas', 'Poder Legislativo', 'Poder Executivo',
    'Poder Judiciário', 'Ministério Público', 'Defensoria Pública', 'Congresso Nacional', 'Senado Federal',
    'Constituição', 'Ordem do Dia', 'Expediente', 'Subprefeituras', 'Orçamento', 'Líderes', 'Vice-Líderes'];
  const SYS_PROPER_RE = SYS_PROPER.map(p => [new RegExp('(^|[^\\p{L}])' + p.toLowerCase() + '(?![\\p{L}])', 'gu'), p]);
  const sysWide = window.matchMedia('(min-width: 720px)');
  let sysTree = null;    // [norma node]; node: {title, id, level, tag, name, kids, parent, arts, first, last, art?, law?}
  let sysNorm = -1;      // the norma shown (-1: the reader's)
  let sysTitle = null;   // the título shown on the right (wide panel)

  function sysCase(name) {
    const letters = name.replace(/[^\p{L}]/gu, '');
    if (!letters || letters !== letters.toUpperCase()) return name;
    let s = name.toLowerCase();
    for (const [re, p] of SYS_PROPER_RE) s = s.replace(re, (m, a) => a + p);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function sysLevelOf(id) {
    if (!id) return '';
    if (id.startsWith('norma')) return 'norma';
    if (id === 'adt' || id === 'dgt' || id.startsWith('tit')) return 'tit';
    if (id.startsWith('cap')) return 'cap';
    if (id.startsWith('subsec')) return 'subsec';
    if (id.startsWith('sec')) return 'sec';
    return '';
  }

  // The tree, with each section's number of articles and first and last
  // article, counted on the cards (once)
  function sysTreeBuild() {
    if (sysTree) return sysTree;
    const byId = new Map();
    const node = (src, parent) => {
      const title = (src.title || src.label || '').replace(/\xa0/g, ' ');
      const n = { title, id: src.section_id || '', kids: [], parent, arts: 0, first: '', last: '' };
      n.level = sysLevelOf(n.id);
      if (src.art) { n.art = src.art; n.law = src.law || ''; }
      const m = title.match(/^(TÍTULO|CAPÍTULO|SEÇÃO|SUBSEÇÃO)\s+([IVXLC]+[-A-Z]*|ÚNIC[OA])\s*[—–-]\s*(.*)$/i);
      n.tag = m ? (SYS_ABBR[m[1].toUpperCase()] || m[1]) + ' ' + (/^ÚNIC/i.test(m[2]) ? 'Único' : m[2]) : '';
      n.name = sysCase(m ? m[3] : title);
      if (n.id) byId.set(n.id, n);
      for (const ch of src.children || []) if (ch.title || ch.art) n.kids.push(node(ch, n));
      return n;
    };
    sysTree = [];
    for (const g of SYSTEMATIC_INDEX) {
      if (sysLevelOf(g.section_id) === 'norma') { sysTree.push(node(g, null)); continue; }
      // the Regimento's títulos come first, without a norma of their own
      if (!sysTree.length) sysTree.push({ title: 'Regimento Interno', name: 'Regimento Interno', id: 'norma1',
        level: 'norma', tag: '', kids: [], parent: null, arts: 0, first: '', last: '' });
      sysTree[sysTree.length - 1].kids.push(node(g, sysTree[sysTree.length - 1]));
    }
    if (sysTree.length && !byId.has('norma1')) byId.set('norma1', sysTree[0]);
    const current = SYS_LEVELS.map(() => null);
    for (const card of ALL_CARDS) {
      if (card.classList.contains('card-titulo')) {
        const i = SYS_LEVELS.indexOf(headingLevel(card));
        if (i < 0) continue;
        current[i] = byId.get(card.dataset.section) || null;
        current.fill(null, i + 1);
      } else if (card.classList.contains('card-artigo')) {
        const art = card.dataset.art.replace(/^ADT/, '');
        for (const n of current) {
          if (!n) continue;
          n.arts++;
          if (!n.first) n.first = art;
          n.last = art;
        }
      }
    }
    return sysTree;
  }

  function sysRange(n) {
    if (!n.first || n.art) return '';
    return 'art. ' + (n.first === n.last ? n.first : n.first + '–' + n.last);
  }

  // The nodes that contain the reader's position (a precedent: its leaf)
  function sysHerePath() {
    const here = new Set();
    const card = selectedCard;
    if (!card) return here;
    let n = null;
    if (isPrecCard(card)) {
      const norm = sysTree.find(x => x.kids.some(k => k.art));
      n = norm && norm.kids.find(k => k.art === card.dataset.art) || null;
    } else {
      const id = getCurrentSectionId();
      const find = list => {
        for (const x of list) {
          if (x.id === id) return x;
          const y = find(x.kids);
          if (y) return y;
        }
        return null;
      };
      n = id ? find(sysTree) : null;
    }
    for (; n; n = n.parent) here.add(n);
    return here;
  }

  function sysFlat(n, out = [], depth = 0) {
    for (const k of n.kids) {
      out.push([k, depth]);
      sysFlat(k, out, depth + 1);
    }
    return out;
  }

  function sysGo(n) {
    takeStep();
    closeIndex();
    if (!n.art) { navigateToSection(n.id); return; }
    const card = $cards.querySelector(`.card-artigo[data-art="${CSS.escape(n.art)}"][data-law="${n.law}"]`);
    if (!card) return;
    revealCard(card);   // hidden by a filter: shown (and its norma), as a remissão does
    scrollToReadingLine(card);
    selectCard(card, true);
  }

  function sysTagHtml(n) {
    return n.tag ? '<span class="sys-tag">' + escapeHtml(n.tag) + '</span>' : '';
  }

  // A row: a capítulo, seção... or a precedent; goes to it
  function sysRowEl(n, depth, here) {
    const el = document.createElement('div');
    el.className = 'sys-row lv-' + (SYS_LEVEL_NAME[n.level] || 'leaf') + (here.has(n) ? ' sys-here' : '');
    el.style.setProperty('--d', depth);
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.innerHTML = sysTagHtml(n) + '<span class="sys-nm">' + escapeHtml(n.art ? n.title : n.name) + '</span>'
      + '<span class="sys-rg">' + escapeHtml(sysRange(n).replace(/^art\. /, '')) + '</span>';
    el.sysNode = n;
    return el;
  }

  // A título: its name and range, and the bar of its capítulos
  function sysTitleEl(t, max, here) {
    const el = document.createElement('div');
    el.className = 'sys-tit lv-titulo' + (here.has(t) ? ' sys-here' : '');
    const top = document.createElement('div');
    top.className = 'sys-top';
    top.tabIndex = 0;
    top.setAttribute('role', 'button');
    top.innerHTML = sysTagHtml(t) + '<span class="sys-nm">' + escapeHtml(t.name) + '</span>'
      + '<span class="sys-rg">' + escapeHtml(sysRange(t)) + '</span>';
    const bar = document.createElement('div');
    bar.className = 'sys-bar' + (t.kids.length ? '' : ' solo');
    bar.style.width = Math.max(t.arts / max * 100, 3) + '%';
    for (const s of t.kids.length ? t.kids : [t]) {
      const seg = document.createElement('i');
      seg.style.flex = Math.max(s.arts, 1);
      if (here.has(s)) seg.className = 'sys-here';
      seg.sysNode = s;
      bar.appendChild(seg);
    }
    el.append(top, bar);
    el.sysNode = t;
    return el;
  }

  function sysNormTabs(here) {
    const tabs = document.createElement('div');
    tabs.className = 'sys-norms';
    sysTree.forEach((n, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = i === sysNorm ? 'on' : '';
      b.dataset.nrm = SYS_NORM_PREFIX[n.title] || 'RI';
      b.title = n.title + ': ' + n.arts + (n.arts === 1 ? ' artigo' : ' artigos');
      b.innerHTML = escapeHtml(SYS_NORM_SHORT[n.title] || n.title) + (here.has(n) ? ' <span class="sys-dot" aria-label="você está aqui">●</span>' : '');
      b.addEventListener('click', () => {
        sysNorm = i;
        sysTitle = null;
        renderIndex();
      });
      tabs.appendChild(b);
    });
    return tabs;
  }

  function renderSystematicIndex(filter) {
    sysTreeBuild();
    const here = sysHerePath();
    if (filter) { renderSysFiltered(filter, here); return; }
    if (sysNorm < 0) sysNorm = Math.max(0, sysTree.findIndex(n => here.has(n)));
    const norm = sysTree[sysNorm];
    $indexContent.appendChild(sysNormTabs(here));
    // the precedents: just their list
    if (!norm.kids.some(k => k.kids.length || k.id)) {
      const list = document.createElement('div');
      list.className = 'sys-list';
      for (const k of norm.kids) list.appendChild(sysRowEl(k, 0, here));
      $indexContent.appendChild(list);
      return;
    }
    const max = Math.max(1, ...norm.kids.map(t => t.arts));
    const intro = document.createElement('div');
    intro.className = 'sys-intro';
    intro.textContent = 'Cada barra mede o título em artigos; cada pedaço é um capítulo.';
    $indexContent.appendChild(intro);
    if (sysWide.matches) {
      $indexContent.classList.add('sys-two');
      if (!sysTitle || !norm.kids.includes(sysTitle)) sysTitle = norm.kids.find(t => here.has(t)) || norm.kids[0];
      const cols = document.createElement('div');
      cols.className = 'sys-cols';
      const left = document.createElement('div');
      left.className = 'sys-left';
      const right = document.createElement('div');
      right.className = 'sys-right';
      for (const t of norm.kids) {
        const el = sysTitleEl(t, max, here);
        if (t === sysTitle) el.classList.add('on');
        left.appendChild(el);
      }
      cols.append(left, right);
      $indexContent.appendChild(cols);
      sysFillRight(right, sysTitle, here);
      return;
    }
    for (const t of norm.kids) {
      const el = sysTitleEl(t, max, here);
      if (t.kids.length) {
        const kids = document.createElement('div');
        kids.className = 'sys-kids';
        kids.hidden = !here.has(t);
        const start = sysRowEl(t, 0, new Set());
        start.classList.add('sys-start');
        start.querySelector('.sys-nm').textContent = 'Início do título';
        kids.appendChild(start);
        for (const [n, d] of sysFlat(t)) kids.appendChild(sysRowEl(n, d, here));
        el.appendChild(kids);
        el.setAttribute('aria-expanded', String(!kids.hidden));
      }
      $indexContent.appendChild(el);
    }
  }

  // The right column: the título, a way to its start, its capítulos and seções
  function sysFillRight(right, t, here) {
    right.replaceChildren();
    right.sysNode = t;
    const head = document.createElement('div');
    head.className = 'sys-head';
    head.tabIndex = 0;
    head.setAttribute('role', 'button');
    head.title = 'Ir ao início do título';
    head.innerHTML = '<div class="sys-k">' + escapeHtml(t.tag || 'Título') + '</div>'
      + '<div class="sys-h">' + escapeHtml(t.name) + '</div>'
      + '<div class="sys-rg">' + escapeHtml(sysRange(t)) + ' · ' + t.arts + (t.arts === 1 ? ' artigo' : ' artigos')
      + '<span class="sys-go">ir ao início ›</span></div>';
    head.sysNode = t;
    right.appendChild(head);
    if (!t.kids.length) {
      const empty = document.createElement('div');
      empty.className = 'sys-empty';
      empty.textContent = 'Sem capítulos: o título vai direto aos artigos.';
      right.appendChild(empty);
    }
    for (const [n, d] of sysFlat(t)) right.appendChild(sysRowEl(n, d, here));
    right.scrollTop = 0;
  }

  // With a filter: the sections that match, under the títulos (and normas) they belong to
  function renderSysFiltered(filter, here) {
    const shown = new Set();
    const visit = n => {
      for (const k of n.kids) {
        if (textMatchesFilter(k.title, filter) || textMatchesFilter(k.name, filter)) {
          for (let x = k; x; x = x.parent) shown.add(x);
        }
        visit(k);
      }
    };
    sysTree.forEach(visit);
    if (!shown.size) {
      $indexContent.innerHTML = '<div class="sys-empty">Nada no índice sistemático com esses termos.</div>';
      return;
    }
    for (const norm of sysTree) {
      if (!shown.has(norm)) continue;
      const h = document.createElement('div');
      h.className = 'sys-norm-h';
      h.dataset.nrm = SYS_NORM_PREFIX[norm.title] || 'RI';
      h.textContent = norm.title;
      $indexContent.appendChild(h);
      for (const [n, d] of sysFlat(norm)) if (shown.has(n)) $indexContent.appendChild(sysRowEl(n, d, here));
    }
  }

  // Wide: the título on the right (and marked on the left)
  function sysShowTitle(tit) {
    const right = $indexContent.querySelector('.sys-right');
    if (!right) return false;
    sysTitle = tit.sysNode;
    $indexContent.querySelectorAll('.sys-tit.on').forEach(x => x.classList.remove('on'));
    tit.classList.add('on');
    if (right.sysNode !== tit.sysNode) sysFillRight(right, tit.sysNode, sysHerePath());
    return true;
  }

  // Clicks and keys in the systematic index
  function sysActivate(e) {
    const seg = e.target.closest('.sys-bar > i');
    if (seg) { e.stopPropagation(); sysGo(seg.sysNode); return true; }
    const row = e.target.closest('.sys-row, .sys-head');
    if (row) { sysGo(row.sysNode); return true; }
    const top = e.target.closest('.sys-top');
    if (!top) return false;
    const tit = top.parentNode;
    const t = tit.sysNode;
    if (sysShowTitle(tit)) return true;
    const kids = tit.querySelector(':scope > .sys-kids');
    if (!kids) { sysGo(t); return true; }
    kids.hidden = !kids.hidden;
    tit.setAttribute('aria-expanded', String(!kids.hidden));
    return true;
  }
  $indexContent.addEventListener('click', e => {
    if (currentIndexTab === 'systematic') sysActivate(e);
  });
  $indexContent.addEventListener('keydown', e => {
    if (currentIndexTab !== 'systematic' || (e.key !== 'Enter' && e.key !== ' ')) return;
    if (!e.target.matches('.sys-row, .sys-head, .sys-top')) return;
    e.preventDefault();
    sysActivate(e);
  });
  // Wide: hovering a título shows it on the right, and it stays there for the
  // mouse to go to it (after a pause on it: crossing other títulos on the way
  // doesn't change it); a piece of a bar names its capítulo
  let sysHoverTimer = 0;
  const $sysTip = document.createElement('div');
  $sysTip.id = 'sys-tip';
  document.body.appendChild($sysTip);
  $indexContent.addEventListener('mouseover', e => {
    if (currentIndexTab !== 'systematic') return;
    const seg = e.target.closest('.sys-bar > i');
    if (seg) {
      const s = seg.sysNode;
      $sysTip.innerHTML = (s.tag ? '<b>' + escapeHtml(s.tag) + '</b> ' : '') + escapeHtml(s.name)
        + '<br><span>' + escapeHtml(sysRange(s)) + ' · ' + s.arts + (s.arts === 1 ? ' artigo' : ' artigos') + '</span>';
      $sysTip.classList.add('visible');
    }
    if (!HOVER) return;
    clearTimeout(sysHoverTimer);
    const tit = e.target.closest('.sys-left .sys-tit');
    if (tit && !tit.classList.contains('on')) sysHoverTimer = setTimeout(() => sysShowTitle(tit), 120);
  });
  $indexContent.addEventListener('mousemove', e => {
    if (!$sysTip.classList.contains('visible')) return;
    const w = $sysTip.offsetWidth;
    $sysTip.style.left = Math.min(e.clientX + 12, window.innerWidth - w - 8) + 'px';
    $sysTip.style.top = (e.clientY + 16) + 'px';
  });
  $indexContent.addEventListener('mouseout', e => {
    if (e.target.closest('.sys-bar > i')) $sysTip.classList.remove('visible');
    if (!e.relatedTarget || !$indexContent.contains(e.relatedTarget)) clearTimeout(sysHoverTimer);
  });
  sysWide.addEventListener('change', () => {
    if ($indexPanel.classList.contains('open') && currentIndexTab === 'systematic') renderIndex();
  });

  function getCurrentSectionId() {
    const card = selectedCard;
    if (!card) return '';
    // Walk backwards — first heading found is the most specific (deepest)
    let prev = card.classList.contains('card-titulo') ? card : card.previousElementSibling;
    while (prev) {
      if (prev.classList.contains('card-titulo') && prev.dataset.section) {
        return prev.dataset.section;
      }
      prev = prev.previousElementSibling;
    }
    return '';
  }

  // The reader's place, in view: the título on the left (wide) and the
  // deepest section or precedent
  function syncSystematicToScroll() {
    const tit = $indexContent.querySelector('.sys-left .sys-tit.sys-here');
    if (tit) tit.scrollIntoView({ behavior: 'instant', block: 'nearest' });
    const rows = $indexContent.querySelectorAll('.sys-row.sys-here');
    const target = rows[rows.length - 1] || $indexContent.querySelector('.sys-tit.sys-here');
    if (target) target.scrollIntoView({ behavior: 'instant', block: 'center' });
  }

  function navigateToSection(sectionId) {
    const card = $cards.querySelector(`.card-titulo[data-section="${sectionId}"]`);
    if (!card) return null;
    // Hidden by the search filter alone: the section is read whole, without it
    if (card.classList.contains('filtered-out') && searchFilter) {
      searchFilter = false;
      $btnFilter.classList.remove('active');
      doSearch($searchInput.value.trim());
    }
    revealCard(card);   // still hidden by another filter: shown anyway
    scrollToReadingLine(card);
    selectCard(card, true);
    return card;
  }

  function formatRefsList(refs) {
    // Returns array of {label, hint, art, lawPrefix} — one per ref, no range compaction
    const result = [];
    for (const r of refs) {
      const label = r.law_prefix === 'PREC' ? 'Precedente ' + precLabel(r.art)
        : (r.law_prefix ? r.law_prefix + ' ' : '') + 'art. ' + r.art + (r.detail ? ', ' + r.detail : '');
      // Hint: from XLSX parentheses → fallback to SUMMARIES_MAP
      let hint = r.hint || '';
      if (!hint) {
        const key = r.law_prefix ? r.law_prefix + ':' + r.art : r.art;
        hint = SUMMARIES_MAP[key] || '';
      }
      result.push({ label, hint, art: r.art, lawPrefix: r.law_prefix || '' });
    }
    return result;
  }

  function collectAllRefs(entry) {
    // Collect all refs from entry (direct + children) for the search bar
    const all = [];
    if (entry.refs) all.push(...entry.refs);
    if (entry.children) {
      for (const ch of entry.children) {
        all.push(...ch.refs);
      }
    }
    return all;
  }

  // "Vide:" of an entry: each link carries its target ("ASSUNTO" or
  // "ASSUNTO|SUBASSUNTO"); the clicks are handled on the panel
  function videsHtml(vides) {
    const links = vides.map(v => {
      // Support "ASSUNTO|SUBASSUNTO" format
      const pipeIdx = v.indexOf('|');
      const subjectPart = pipeIdx !== -1 ? v.slice(0, pipeIdx).trim() : v;
      const subSubjectPart = pipeIdx !== -1 ? v.slice(pipeIdx + 1).trim() : '';
      const text = subSubjectPart ? subjectPart + ' — ' + subSubjectPart : v;
      return '<a class="vide-link" href="#" data-vide="' + escapeAttr(v) + '">' + escapeHtml(text) + '</a>';
    });
    return '<div class="subj-vides"><span class="vide-label">Vide: </span>' + links.join(', ') + '</div>';
  }

  function goToVide(v) {
    const pipeIdx = v.indexOf('|');
    const subjectPart = pipeIdx !== -1 ? v.slice(0, pipeIdx).trim() : v;
    const subSubjectPart = pipeIdx !== -1 ? v.slice(pipeIdx + 1).trim() : '';
    // Build the key to find the target element in the DOM
    const targetKey = subSubjectPart
      ? stripAccents(subjectPart.toLowerCase()) + '|' + stripAccents(subSubjectPart.toLowerCase())
      : stripAccents(subjectPart.toLowerCase());
    // Clear search filter so the target is visible
    if ($indexSearch.value.trim()) setIndexFilter('');
    flushIndexFill();
    // Find the DOM element with matching data-subject-key
    const targetEl = $indexContent.querySelector('[data-subject-key="' + CSS.escape(targetKey) + '"]');
    if (targetEl) {
      // Remove any previous highlights
      $indexContent.querySelectorAll('.vide-highlight').forEach(el => el.classList.remove('vide-highlight'));
      // Highlight and scroll to the target
      targetEl.classList.add('vide-highlight');
      // Entries not yet drawn have an estimated height (style.css): far away,
      // jump; near, glide and then settle on it (those drawn on the way change)
      const far = Math.abs(targetEl.getBoundingClientRect().top - $indexContent.getBoundingClientRect().top)
        > FAR_SCROLL_SCREENS * $indexContent.clientHeight;
      targetEl.scrollIntoView({ behavior: far ? 'instant' : 'smooth', block: 'center' });
      if (!far && 'onscrollend' in window) {
        $indexContent.addEventListener('scrollend',
          () => targetEl.scrollIntoView({ behavior: 'instant', block: 'center' }), { once: true });
      }
    } else {
      // Target not found — put in search bar
      setIndexFilter(subjectPart);
    }
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  // An entry's lines of references, in two columns: the dispositivo (with
  // its norma's badge, as the remissões') and its dica. A line goes to its
  // dispositivo (data-r: its position in refs). And the height they add (px,
  // fitted against the panel's layout: per line of the longer column)
  const SUBJ_HINT_CHARS = 50, SUBJ_REF_CHARS = 20;
  function subjRefsHtml(refs) {
    let html = '<div class="subj-refs">', h = 0;
    formatRefsList(refs).forEach((item, i) => {
      const [cell, n] = refCellHtml(item);
      html += '<div class="subj-ref-line" data-r="' + i + '" role="button" tabindex="0" title="Ir para o dispositivo">'
        + cell + '<span class="ref-hint">' + escapeHtml(item.hint) + '</span></div>';
      h += 21 + 15.5 * (Math.max(1, Math.ceil(item.hint.length / SUBJ_HINT_CHARS), Math.ceil(n / SUBJ_REF_CHARS)) - 1);
    });
    return [html + '</div>', h];
  }
  // The dispositivo's column: its norma's badge and the rest ("art. 46, I"),
  // and how many characters it takes
  function refCellHtml(item) {
    const law = item.lawPrefix || 'RI';
    const ref = law === 'PREC' ? item.label.replace(/^Precedente /, '')
      : item.label.replace(/^[A-Z]+ (?=art\.)/, '').replace(/,(?=\S)/g, ', ');   // "§1,I" → "§1, I"
    return ['<span class="rf"><i class="' + law + '">' + law + '</i>' + escapeHtml(ref) + '</span>', law.length + ref.length + 1];
  }

  // The remissivo is ~700 subjects and 2,000 sub-subjects: written as one
  // HTML string (much faster than node by node), the clicks handled on the
  // panel by the entry's position (data-i, and data-c for a sub-subject)
  let subjectsSorted = null;
  function sortedSubjects() {
    if (!subjectsSorted) {
      const collator = new Intl.Collator('pt-BR');
      subjectsSorted = SUBJECT_INDEX.slice().sort((a, b) => collator.compare(a.subject, b.subject));
    }
    return subjectsSorted;
  }
  // The subjects' initial ("Á" under A; a digit under #)
  function subjLetter(entry) {
    const c = stripAccents(entry.subject.charAt(0)).toUpperCase();
    return /[A-Z]/.test(c) ? c : '#';
  }

  function renderSubjectIndex(filter) {
    sortedSubjects();
    const parts = [];
    // the subjects shown, by letter (each letter's band says how many)
    const shown = subjectsSorted.map(entry => !filter || textMatchesFilter(entry.subject, filter)
      || !!(entry.children && entry.children.some(ch => textMatchesFilter(ch.sub_subject, filter))));
    const perLetter = new Map();
    subjectsSorted.forEach((entry, i) => {
      if (shown[i]) perLetter.set(subjLetter(entry), (perLetter.get(subjLetter(entry)) || 0) + 1);
    });
    let letter = null;
    subjectsSorted.forEach((entry, i) => {
      if (!shown[i]) return;
      const matchSelf = !filter || textMatchesFilter(entry.subject, filter);
      if (subjLetter(entry) !== letter) {
        letter = subjLetter(entry);
        const n = perLetter.get(letter);
        parts.push('<div class="subj-letter" data-letter="' + letter + '">' + letter
          + '<small>' + n + (n === 1 ? ' assunto' : ' assuntos') + '</small></div>');
      }

      const key = stripAccents(entry.subject.toLowerCase());
      // Off-screen entries are not laid out (style.css): their estimated height
      let est = 26 + 18 * (Math.ceil(entry.subject.length / 54) - 1);
      let html = '<div class="subj-title' + (collectAllRefs(entry).length ? '' : ' no-refs') + '">'
        + escapeHtml(entry.subject) + '</div>';

      // Direct refs
      if (entry.refs && entry.refs.length > 0) {
        const [refs, h] = subjRefsHtml(entry.refs);
        html += refs;
        est += h;
      }

      // Vides (cross-references)
      if (entry.vides && entry.vides.length > 0) {
        html += videsHtml(entry.vides);
        est += 17 * Math.ceil((6 + entry.vides.join(', ').length) / 52);
      }

      // Sub-subjects
      if (entry.children) {
        entry.children.forEach((ch, c) => {
          if (filter && !matchSelf && !textMatchesFilter(ch.sub_subject, filter)) return;
          const subKey = key + '|' + stripAccents(ch.sub_subject.toLowerCase());
          html += '<div class="subj-entry subj-sub" data-subject-key="' + escapeAttr(subKey)
            + '" data-c="' + c + '"><div class="subj-title' + (ch.refs && ch.refs.length ? '' : ' no-refs')
            + '">— ' + escapeHtml(ch.sub_subject) + '</div>';
          const [refs, h] = subjRefsHtml(ch.refs);
          html += refs;
          est += 27 + 16 * (Math.ceil((2 + ch.sub_subject.length) / 60) - 1) + h;

          // Vides on sub-subject
          if (ch.vides && ch.vides.length > 0) {
            html += videsHtml(ch.vides);
            est += 17 * Math.ceil((6 + ch.vides.join(', ').length) / 52);
          }
          html += '</div>';
        });
      }

      parts.push('<div class="subj-entry" data-subject-key="' + escapeAttr(key) + '" data-i="' + i
        + '" style="contain-intrinsic-size:auto ' + Math.round(est) + 'px">' + html + '</div>');
    });
    if (!filter) subjAllLetters = perLetter;
    buildSubjectRail(perLetter);
    if (filter) {
      $indexContent.insertAdjacentHTML('beforeend', parts.join(''));
      return;
    }
    // Whole: the first screen right away, the rest in slices after it is
    // painted (and kept for the next openings once complete)
    let next = SUBJECTS_FIRST;
    $indexContent.insertAdjacentHTML('beforeend', parts.slice(0, next).join(''));
    const fill = indexFill = () => {
      if (indexFill !== fill) return;
      const end = flushingIndexFill ? parts.length : next + SUBJECTS_SLICE;
      $indexContent.insertAdjacentHTML('beforeend', parts.slice(next, end).join(''));
      next = end;
      if (next < parts.length) setTimeout(fill, 0);
      else {
        indexFill = null;
        indexDomCache.set('subject', [...$indexContent.childNodes]);
      }
    };
    requestAnimationFrame(() => setTimeout(fill, 0));
  }
  // The letters A–Z beside the remissivo: a click goes to the letter (those
  // without subjects, greyed); the letter being read is marked
  const $subjRail = document.createElement('nav');
  $subjRail.id = 'subj-rail';
  $subjRail.setAttribute('aria-label', 'Letras do índice remissivo');
  $indexPanel.appendChild($subjRail);
  let subjAllLetters = new Map();   // of the whole remissivo (its DOM is kept: see renderIndex)
  function buildSubjectRail(perLetter) {
    $subjRail.replaceChildren();
    for (const l of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = l;
      b.dataset.letter = l;
      b.disabled = !perLetter.has(l);
      $subjRail.appendChild(b);
    }
    $subjRail.style.top = ($indexContent.offsetTop + 6) + 'px';
    syncSubjectRail();
  }
  $subjRail.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    flushIndexFill();
    const band = $indexContent.querySelector('.subj-letter[data-letter="' + b.dataset.letter + '"]');
    if (!band) return;
    // its first subject right under the band (a band may be stuck to the top:
    // not where it is). Entries drawn on the way change from their estimated
    // height, some frames later: held there for a few frames
    const first = band.nextElementSibling || band;
    const jump = () => {
      $indexContent.scrollTop += first.getBoundingClientRect().top - $indexContent.getBoundingClientRect().top
        - band.offsetHeight - 2;
    };
    let frames = 0;
    (function hold() {
      jump();
      if (++frames < 12) requestAnimationFrame(hold);
    })();
  });
  function syncSubjectRail() {
    if (currentIndexTab !== 'subject') return;
    const top = $indexContent.scrollTop + $indexContent.offsetTop + 8;
    let cur = null;
    for (const band of $indexContent.querySelectorAll('.subj-letter')) {
      if (band.offsetTop <= top) cur = band.dataset.letter;
      else break;
    }
    for (const b of $subjRail.children) b.classList.toggle('on', b.dataset.letter === (cur || 'A'));
  }
  $indexContent.addEventListener('scroll', syncSubjectRail, { passive: true });
  $indexContent.addEventListener('keydown', e => {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.matches('.subj-ref-line')) return;
    e.preventDefault();
    e.target.click();
  });

  const SUBJECTS_FIRST = 40;    // entries
  const SUBJECTS_SLICE = 120;
  let indexFill = null;         // the slices still to append (a new rendering cancels them)
  let flushingIndexFill = false;
  function flushIndexFill() {
    if (!indexFill) return;
    flushingIndexFill = true;
    indexFill();
    flushingIndexFill = false;
  }

  $indexContent.addEventListener('click', e => {
    const vide = e.target.closest('.vide-link[data-vide]');
    if (vide) {
      e.preventDefault();
      goToVide(vide.dataset.vide);
      return;
    }
    const line = e.target.closest('.subj-ref-line[data-r]');
    if (line) {
      const at = line.closest('.subj-entry[data-i]');
      const entry = subjectsSorted[+at.dataset.i];
      const sub = line.closest('.subj-entry[data-c]');
      const refs = sub ? entry.children[+sub.dataset.c].refs : entry.refs;
      takeStep();
      closeIndex();
      goToQuickRef(idxRemRef(refs[+line.dataset.r]));
      return;
    }
    const title = e.target.closest('.subj-title:not(.no-refs)');
    const top = title && title.closest('.subj-entry[data-i]');
    if (!top) return;
    const entry = subjectsSorted[+top.dataset.i];
    const sub = title.parentElement.dataset.c;
    takeStep();
    closeIndex();
    if (sub === undefined) {
      openSubject({ subject: entry.subject, refs: collectAllRefs(entry) });
    } else {
      const child = entry.children[+sub];
      openSubject({ subject: entry.subject + ' — ' + child.sub_subject, refs: child.refs });
    }
  });

  function renderReferencesIndex(filter) {
    // The consulta rápida first, then the categories of the referências
    const cats = (consultaIndex().length ? [{ category: 'Consulta rápida', consulta: true }] : []).concat(referenciasIndex());
    if (!cats.length) {
      $indexContent.textContent = 'Nenhuma referência disponível.';
      return;
    }

    // Category buttons
    const catBar = document.createElement('div');
    catBar.className = 'ref-categories';
    cats.forEach((cat, idx) => {
      const btn = document.createElement('button');
      btn.className = 'ref-cat-btn' + (idx === currentRefCategory ? ' active' : '');
      btn.textContent = cat.category;
      btn.addEventListener('click', () => {
        currentRefCategory = idx;
        renderIndex();
      });
      catBar.appendChild(btn);
    });
    $indexContent.appendChild(catBar);

    // Render groups/entries for active category
    const cat = cats[currentRefCategory];
    if (!cat) return;
    if (cat.consulta) {
      renderConsulta(filter);
      return;
    }

    for (const group of cat.groups) {
      const hasMatch = !filter || group.entries.some(e => {
        const text = e.html.replace(/<[^>]*>/g, '');
        return textMatchesFilter(text, filter);
      });
      if (!hasMatch && !textMatchesFilter(group.title, filter)) continue;

      if (group.title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'ref-group-title' + (cat.category === LEGISLACAO ? ' ref-law-title' : '');
        titleEl.textContent = group.title;
        $indexContent.appendChild(titleEl);
      }

      for (const entry of group.entries) {
        const entryText = entry.html.replace(/<[^>]*>/g, '');
        if (filter && !textMatchesFilter(entryText, filter) && !textMatchesFilter(group.title, filter)) continue;

        const entryEl = document.createElement('div');
        // In the legislação, the entry without an article is the norm's ementa
        entryEl.className = 'ref-entry' + (cat.category === LEGISLACAO && !entry.art_ref ? ' ref-law-ementa' : '');

        const textSpan = document.createElement('span');
        textSpan.innerHTML = entry.html;
        entryEl.appendChild(textSpan);

        if (entry.art_ref) {
          const linkEl = document.createElement('a');
          linkEl.className = 'ref-art-link';
          linkEl.href = '#';
          linkEl.textContent = ' — ' + refEntryLabel(entry);
          linkEl.addEventListener('click', (e) => {
            e.preventDefault();
            takeStep();
            closeIndex();
            goToRefEntry(entry, cat.category === LEGISLACAO);
          });
          entryEl.appendChild(linkEl);
        }

        $indexContent.appendChild(entryEl);
      }
    }
  }

  function showContextHeadings() {
    // For each visible article, show its ancestor heading cards for context.
    // Single pass in document order keeping the current heading of each level;
    // a heading resets the levels below it, so headings from other branches
    // (e.g. a capítulo from a previous título) are never picked up.
    const hierarchy = ['norma', 'tit', 'cap', 'sec', 'subsec'];
    const current = [null, null, null, null, null];
    for (const card of getAllCards()) {
      if (card.classList.contains('card-titulo')) {
        const idx = hierarchy.indexOf(headingLevel(card));
        if (idx < 0) continue;
        current[idx] = card;
        for (let i = idx + 1; i < hierarchy.length; i++) current[i] = null;
      } else if (card.classList.contains('card-artigo') && !card.classList.contains('filtered-out')) {
        for (const heading of current) {
          if (heading) heading.classList.remove('filtered-out');
        }
      }
    }
  }

  // ===== CHIP'S DISPOSITIVOS =====
  // The dispositivos of the chip's articles that are the results without
  // terms (.scope-unit): the subject's ones, highlighted, or the marked ones
  function clearScopeUnits() {
    $cards.querySelectorAll('.scope-unit').forEach(el => {
      el.classList.remove('detail-highlight', 'scope-unit');
    });
  }

  function markScopeUnits() {
    clearScopeUnits();
    if (!scope) return;
    if (scope.kind === 'markers') {
      for (const m of markersList) {
        const el = $cards.querySelector(`.unit-id[data-uid="${m.uid}"]`);
        const p = el && el.closest('p');
        if (p) p.classList.add('scope-unit');
      }
      return;
    }
    for (const ref of scope.refs) {
      let card;
      if (ref.law_prefix) {
        card = $cards.querySelector(`.card-artigo[data-art="${ref.art}"][data-law="${ref.law_prefix}"]`);
      } else {
        card = $cards.querySelector(`.card-artigo[data-art="${ref.art}"]:not([data-law])`)
            || $cards.querySelector(`.card-artigo[data-art="${ref.art}"]`);
      }
      if (!card) continue;
      if (!ref.detail) {
        // Artigo inteiro
        card.classList.add('detail-highlight', 'scope-unit');
      } else if (ref.detail.trim().toLowerCase() === 'caput') {
        // Caput: first <p> that isn't .art-para
        const caput = card.querySelector('p:not(.art-para):not(.old-version)');
        if (caput) caput.classList.add('detail-highlight', 'scope-unit');
      } else {
        const dt = ref.detail.trim();
        let found = false;
        for (const uid of card.querySelectorAll('.unit-id')) {
          const path = uid.dataset.path || '';
          const ut = uid.textContent.trim();
          if (path === dt || ut === dt || (dt === '§ú' && ut === 'Parágrafo único')) {
            const p = uid.closest('p');
            if (p) p.classList.add('detail-highlight', 'scope-unit');
            found = true;
            break;
          }
        }
      }
    }
  }

  // ===== CHIP IN THE SEARCH BAR =====
  // A subject of the remissivo opened (from the index, the results list or an
  // article's "No índice remissivo"), or the marked articles (the markers'
  // funnel), go into the search bar as a chip, in place of what was there:
  // its articles are the results, and terms typed after it are searched
  // within them. The bar's filter and arrows serve both; clearing the bar
  // takes the chip out too.
  function openScope(chip, startCard = null) {
    takeStep();
    showChip(chip);
    scopeOpening = true;
    scopeStartCard = startCard;
    $searchInput.value = '';
    doSearch('');
  }

  // The chip in the bar (the caller searches again)
  function showChip(chip) {
    scope = chip;
    const subject = chip.kind === 'subject';
    $searchChip.dataset.kind = chip.kind;
    $chipLabel.textContent = subject ? chip.label : '\u2605 ' + chip.label;
    $searchChip.title = subject ? 'Índice remissivo: ' + chip.label : 'Artigos marcados';
    $searchChip.hidden = false;
    $resultsTitle.textContent = subject ? 'Remissivo: ' + chip.label : 'Artigos marcados';
    updateChipSpace();
    markScopeUnits();
    renderMarkerNav();
  }

  function openSubject(entry, startCard = null) {
    openScope({ kind: 'subject', label: entry.subject, refs: entry.refs }, startCard);
  }

  // The chip out of the bar (the caller searches again)
  function closeScope() {
    if (!scope) return;
    const markers = scope.kind === 'markers';
    scope = null;
    $searchChip.hidden = true;
    $resultsTitle.textContent = 'Resultados';
    updateChipSpace();
    clearScopeUnits();
    if (markers) renderMarkerNav();
  }

  function removeScope() {
    closeScope();
    preserveScroll(() => doSearch($searchInput.value.trim()));
  }

  // The input's text starts after the chip
  const SEARCH_PLACEHOLDER = $searchInput.placeholder;
  function updateChipSpace() {
    $searchInput.style.paddingLeft = scope ? ($searchChip.offsetWidth + 10) + 'px' : '';
    $searchInput.placeholder = !scope ? SEARCH_PLACEHOLDER
      : scope.kind === 'markers' ? 'Buscar nos marcados...' : 'Buscar neste assunto...';
  }

  // The chip's name, whole (the chip may cut it), atop its results
  $chipLabel.addEventListener('click', () => $searchCounter.click());
  document.getElementById('chip-remove').addEventListener('click', () => {
    removeScope();
    $searchInput.focus({ preventScroll: true });
  });
  // Its width is a share of the bar's
  window.addEventListener('resize', () => { if (scope) updateChipSpace(); });

  // ===== BACK AND FORWARD =====
  // The browser's back button undoes a jump, so the search's results and the
  // index panel can be explored: a result of the list (of the indexes or of
  // the articles), a subject or the marked articles put in the bar, a section
  // or provision from the index panel, a remissão. Each jump first keeps the
  // state it leaves in a step of the history: the bar's terms and chip, the
  // list (open or not, its scroll, its indexes' part as it was, with the
  // "+ N" opened), the index panel, the article being read and where it was
  // on the screen. Back puts that back; forward, the state back left.
  // Opening the results drawer (small screens) or the index panel is a step
  // too, so back closes them; closed by hand, their step goes out. Typing is
  // not a step. The states live in the page: after a reload, the steps of
  // before restore nothing.
  history.replaceState({ step: stepId }, '');

  // kind: what the step opens ('drawer', 'panel'), or 'rem' (a remissão's
  // jump, which its "voltar" undoes). state: the one left, if taken before.
  function takeStep(kind, state) {
    if (restoring || stepTaken) return;
    // one per action (a result of the list may open a chip)
    stepTaken = true;
    queueMicrotask(() => { stepTaken = false; });
    steps.set(stepId, state || stepState());
    stepId = STEP_LOAD + ':' + ++stepCount;
    if (kind) stepKinds.set(stepId, kind);
    history.pushState({ step: stepId }, '');
  }

  // The step of the drawer or the panel just closed (or of the remissão gone
  // back from) out of the history
  function dropStep(kind) {
    if (restoring || stepKinds.get(stepId) !== kind) return;
    stepKinds.delete(stepId);
    silentPops++;
    history.back();
  }

  window.addEventListener('popstate', e => {
    const id = e.state && e.state.step;
    if (silentPops) {
      silentPops--;
      if (id) stepId = id;
      return;
    }
    const state = id && steps.get(id);
    if (state) steps.set(stepId, stepState());
    if (id) stepId = id;
    if (state) restoreStep(state);
  });

  function stepState() {
    let card = selectedCard;
    if (!card || card.classList.contains('filtered-out')) card = findSelectionCard();
    // the indexes' part of the list, if it is the one of the bar's terms
    const applied = !searchTimer && currentSearch === $searchInput.value.trim();
    return {
      term: $searchInput.value, scope, filter: searchFilter,
      card, top: card ? card.getBoundingClientRect().top : 0,
      drawer: resultsDrawerOpen, hidden: resultsHidden, listTop: $resultsList.scrollTop,
      indexMatches: applied ? indexMatches : null,
      indexPart: applied && indexPart && indexPart.isConnected && indexPartFor === indexMatches ? indexPart : null,
      panel: !$indexPanel.classList.contains('open') ? null : {
        tab: currentIndexTab, refCategory: currentRefCategory, filter: $indexSearch.value,
        sysNorm, sysTitle, top: $indexContent.scrollTop, renders: indexRenders,
      },
      remBack: $remReturn.classList.contains('visible') ? { label: $remReturn.textContent, to: remReturnTo } : null,
    };
  }

  function restoreStep(s) {
    restoring = true;
    try {
      cancelPendingSearch();
      hideRemPop();
      if (s.term !== $searchInput.value || s.scope !== scope || s.filter !== searchFilter) {
        searchFilter = s.filter;
        $btnFilter.classList.toggle('active', searchFilter);
        if (s.scope !== scope) {
          if (s.scope) showChip(s.scope);
          else closeScope();
        }
        $searchInput.value = s.term;
        // the indexes' part of the list as it was left (the search keeps it)
        if (s.indexMatches) indexMatches = s.indexMatches;
        if (s.indexPart && s.indexPart !== indexPart) {
          clearResultsList();
          $resultsList.replaceChildren(s.indexPart);
          indexPart = s.indexPart;
          indexPartFor = s.indexMatches;
        }
        doSearch(s.term.trim());
      }
      // the list and the panel, open or closed as they were
      resultsHidden = s.hidden;
      resultsDrawerOpen = s.drawer && resultsActive && !resultsWide.matches;
      if (s.panel) restorePanel(s.panel);
      else if ($indexPanel.classList.contains('open')) closeIndex();
      updateResultsVisibility();
      if (resultsShown() && resultsBuiltFor !== searchMatches) buildResultsList();
      // the article being read, where it was on the screen (not where the
      // search goes)
      if (scrollRafId) { cancelAnimationFrame(scrollRafId); scrollRafId = null; }
      if (s.card) {
        revealCard(s.card);
        selectCard(s.card, true);
        scrollToY(window.scrollY + s.card.getBoundingClientRect().top - s.top, 'instant');
      }
      // the list where it was (not on the selected article's group)
      revealGroup = null;
      revealPending = false;
      if (resultsShown()) $resultsList.scrollTop = s.listTop;
      if (s.remBack) {
        $remReturn.textContent = s.remBack.label;
        remReturnTo = s.remBack.to;
      }
      $remReturn.classList.toggle('visible', !!s.remBack);
    } finally {
      restoring = false;
    }
  }

  // Drawn again since it was left: drawn as it was
  function restorePanel(p) {
    if (p.renders !== indexRenders) {
      setIndexTab(p.tab);
      currentRefCategory = p.refCategory;
      $indexSearch.value = p.filter;
      $btnClearIndexSearch.style.display = p.filter.trim() ? 'flex' : 'none';
      sysNorm = p.sysNorm;
      sysTitle = p.sysTitle;
      renderIndex();
      flushIndexFill();
    }
    $indexOverlay.classList.add('open');
    $indexPanel.classList.add('open');
    $indexContent.scrollTop = p.top;
  }

  // ===== NO ÍNDICE REMISSIVO =====
  // At the end of each article, the subjects of the remissivo that cite it (or
  // one of its provisions), grouped: each subject (bold) with its sub-subjects
  // beside it, the groups running one after the other (38% of the entries
  // repeated the subject of another in the same card). Labels via CSS, out of
  // the searchable text. All in alphabetical order. Each entry is
  // a trigger as the correlates' (.rem): hover previews the entry's
  // dispositivos, click opens them in a box in the band, and the box's foot
  // puts the subject in the search bar, starting at this article.

  function renderIndexBacklinks() {
    const byArt = new Map();   // "LOM:42" → [{label, refs, entry, child}]
    const add = (label, own, refs, entry, child = null) => {
      const items = new Map();
      for (const r of own) {
        const key = (r.law_prefix || '') + ':' + r.art;
        if (!items.has(key)) items.set(key, { label, refs, entry, child });
      }
      for (const [key, it] of items) {
        if (!byArt.has(key)) byArt.set(key, []);
        byArt.get(key).push(it);
      }
    };
    for (const entry of SUBJECT_INDEX) {
      if (entry.refs) add(entry.subject, entry.refs, collectAllRefs(entry), entry);
      for (const ch of entry.children || []) {
        add(entry.subject + ' — ' + ch.sub_subject, ch.refs, subjectRefs(entry, ch.sub_subject), entry, ch);
      }
    }
    const collator = new Intl.Collator('pt-BR');   // (localeCompare builds one per call)
    for (const card of ARTICLE_CARDS) {
      const items = byArt.get((card.dataset.law || '') + ':' + card.dataset.art);
      if (!items) continue;
      items.sort((a, b) => collator.compare(a.label, b.label));
      // by subject, in alphabetical order (easier to find one)
      const groups = new Map();
      for (const it of items) {
        const head = it.child ? it.entry.subject : it.label;
        if (!groups.has(head)) groups.set(head, { self: null, subs: [] });
        if (it.child) groups.get(head).subs.push(it);
        else groups.get(head).self = it;
      }
      const band = document.createElement('div');
      band.className = 'rem-backlinks idx-backlinks';
      band.setAttribute('aria-label', 'No índice remissivo');
      const nEntries = items.length;
      const sum = document.createElement('button');
      sum.type = 'button';
      sum.className = 'idx-sum';
      sum.setAttribute('aria-expanded', String(idxOpen));
      sum.dataset.label = 'Índice remissivo · ' + groups.size + (groups.size === 1 ? ' assunto · ' : ' assuntos · ')
        + nEntries + (nEntries === 1 ? ' entrada' : ' entradas');
      sum.setAttribute('aria-label', sum.dataset.label);
      band.appendChild(sum);
      const chip = (it, cls, show) => {
        const c = document.createElement('span');
        c.className = 'rem idx-back ' + cls;
        c.tabIndex = 0;
        c.setAttribute('role', 'button');
        c.setAttribute('aria-expanded', 'false');
        c.dataset.label = it.label;
        if (show) c.dataset.show = show;
        c.idxEntry = it;
        return c;
      };
      for (const [head, g] of [...groups].sort((a, b) => collator.compare(a[0], b[0]))) {
        const row = document.createElement('div');
        row.className = 'idx-row';
        if (g.self) row.appendChild(chip(g.self, 'idx-head'));
        else {
          const h = document.createElement('span');
          h.className = 'idx-head';
          h.dataset.label = head;
          row.appendChild(h);
        }
        for (const it of g.subs) row.appendChild(chip(it, 'idx-sub', it.child.sub_subject));
        band.appendChild(row);
      }
      card.appendChild(band);
    }
  }

  // The entry's box: its dispositivos with their dicas, as the index lists
  // them (a subject with its sub-subjects under it), the ones of this article
  // marked. Hover previews one (desktop), a click goes to it (and "voltar"
  // comes back); the foot
  // puts the entry in the search bar.
  function idxRemRef(r) {
    return { law: r.law_prefix || 'RI', art: r.art, path: r.detail && r.detail !== 'caput' ? r.detail : '' };
  }

  function buildIdxPanel(trigger) {
    const it = trigger.idxEntry;
    const card = trigger.closest('.card');
    const group = document.createElement('section');
    group.className = 'rem-group';
    const head = document.createElement('div');
    head.className = 'rem-head';
    const tag = document.createElement('span');
    tag.className = 'rem-law IDX';
    tag.textContent = 'ÍNDICE';
    const label = document.createElement('span');
    label.textContent = it.label;
    head.append(tag, label);
    group.appendChild(head);

    const body = document.createElement('div');
    body.className = 'rem-body idx-list';
    const addRefs = refs => {
      formatRefsList(refs).forEach((item, i) => {
        const r = refs[i];
        const line = document.createElement('div');
        const here = card && r.art === card.dataset.art && (r.law_prefix || '') === (card.dataset.law || '');
        line.className = 'idx-line' + (here ? ' idx-here' : '');
        line.tabIndex = 0;
        line.setAttribute('role', 'button');
        // in the box, hover previews it (as a citation: data-ref); a click goes to it
        line.dataset.ref = (r.law_prefix ? r.law_prefix + ':' : '') + r.art + (r.detail ? ',' + r.detail : '');
        if (!HOVER) line.title = 'Ir para o dispositivo';
        line.appendChild(document.createTextNode(item.label));
        if (item.hint) {
          const h = document.createElement('span');
          h.className = 'ref-hint';
          h.textContent = ' — ' + item.hint;
          line.appendChild(h);
        }
        const go = ev => { ev.stopPropagation(); remGoTo(idxRemRef(r), trigger); };
        line.addEventListener('click', go);
        line.addEventListener('keydown', ev => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          ev.preventDefault();
          go(ev);
        });
        body.appendChild(line);
      });
    };
    const addVides = vides => {
      if (!vides || !vides.length) return;
      const v = document.createElement('div');
      v.className = 'idx-vides';
      v.textContent = 'Vide: ' + vides.map(x => x.split('|').map(s => s.trim()).join(' — ')).join('; ');
      body.appendChild(v);
    };
    if (it.child) {
      addRefs(it.child.refs);
      addVides(it.child.vides);
    } else {
      addRefs(it.entry.refs || []);
      addVides(it.entry.vides);
      for (const ch of it.entry.children || []) {
        const sub = document.createElement('div');
        sub.className = 'idx-sub';
        sub.textContent = '— ' + ch.sub_subject;
        body.appendChild(sub);
        addRefs(ch.refs || []);
        addVides(ch.vides);
      }
    }
    group.appendChild(body);

    const foot = document.createElement('div');
    foot.className = 'rem-foot';
    const filter = document.createElement('button');
    filter.type = 'button';
    filter.textContent = 'Filtrar por esta entrada do índice';
    filter.addEventListener('click', ev => {
      ev.stopPropagation();
      hideRemPop();
      const box = remBoxOpen(trigger);
      if (box) closeRemBox(box);
      openSubject({ subject: it.label, refs: it.refs }, card);
    });
    const n = document.createElement('span');
    n.className = 'idx-count';
    n.textContent = it.refs.length + (it.refs.length === 1 ? ' dispositivo' : ' dispositivos');
    foot.append(filter, n);
    group.appendChild(foot);
    return group;
  }

  // ===== PINCH-TO-ZOOM =====
  let initialPinchDist = null;
  let initialZoom = 1;

  function setZoom(scale, now) {
    preserveScroll(() => {
      zoomScale = Math.max(0.4, Math.min(2.5, scale));
      document.documentElement.style.setProperty('--zoom-scale', zoomScale);
      if (now) estimateCardHeights();
    });
    // the estimates once the zoom settles (now: at load, before the first layout)
    forgetCardHeights(!now);

    $zoomIndicator.textContent = Math.round(zoomScale * 100) + '%';
    $zoomIndicator.classList.add('show');
    clearTimeout(zoomTimeout);
    zoomTimeout = setTimeout(() => $zoomIndicator.classList.remove('show'), 800);
    scheduleMinimap();

    try { localStorage.setItem('regimento-zoom', zoomScale); } catch (e) {}
  }

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialPinchDist = Math.hypot(dx, dy);
      initialZoom = zoomScale;
    }
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && initialPinchDist !== null) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / initialPinchDist;
      setZoom(initialZoom * ratio);
    }
  }, { passive: false });

  document.addEventListener('touchend', () => {
    initialPinchDist = null;
  });

  document.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    initialZoom = zoomScale;
  });

  document.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    setZoom(initialZoom * e.scale);
  });

  document.addEventListener('gestureend', (e) => {
    e.preventDefault();
  });

  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      setZoom(zoomScale + delta);
    }
  }, { passive: false });

  // ===== COMPACT MODE =====
  const $btnCompact = document.getElementById('btn-compact');
  let compactMode = false;

  function setCompactMode(on) {
    cancelScrollCorrection();
    const card = selectedCard;
    compactMode = on;
    estimateCardHeights();   // the mode's own estimates (style.css)
    // The dozens of short articles drawn around the screen would all be laid
    // out whole at once: let the browser decide afresh which ones to draw
    const drawn = on ? [] : [...cardsShown];
    for (const c of drawn) c.style.contentVisibility = 'hidden';
    $cards.classList.toggle('compact', compactMode);
    $btnCompact.classList.toggle('active', compactMode);
    if (drawn.length) {
      void $cards.offsetHeight;
      for (const c of drawn) c.style.contentVisibility = '';
    }
    if (on) {
      $cards.querySelectorAll('.diff-open').forEach(el => {
        el.classList.remove('diff-open');
        invalidateCardText(el.closest('.card'));
        const panel = el.nextElementSibling;
        if (panel && panel.classList.contains('diff-panel')) panel.remove();
      });
    }
    if (card && !card.classList.contains('filtered-out')) {
      const rect = card.getBoundingClientRect();
      const target = window.scrollY + rect.top - getReadingLineY();
      scrollToY(Math.max(0, target), 'instant');
    }
    updateBreadcrumb();
    if (searchMatches.length) updateSearchTicks();
    scheduleMinimap();
    try { localStorage.setItem('regimento-compact', compactMode ? '1' : '0'); } catch (e) {}
  }

  $btnCompact.addEventListener('click', () => setCompactMode(!compactMode));

  // The index bands at the cards' feet: folded to their line, or all open.
  // The card clicked stays where it was on the screen.
  function setIndexOpen(on, anchor) {
    cancelScrollCorrection();
    const topBefore = anchor ? anchor.getBoundingClientRect().top : null;
    idxOpen = on;
    estimateCardHeights();
    $cards.classList.toggle('idx-open', on);
    for (const b of $cards.querySelectorAll('.idx-sum')) b.setAttribute('aria-expanded', String(on));
    if (anchor) window.scrollBy(0, anchor.getBoundingClientRect().top - topBefore);
    forgetCardHeights();
    updateBreadcrumb();
    if (searchMatches.length) updateSearchTicks();
    scheduleMinimap();
    try { localStorage.setItem('regimento-indice-aberto', on ? '1' : '0'); } catch (e) {}
  }
  $cards.addEventListener('click', e => {
    const b = e.target.closest('.idx-sum');
    if (!b) return;
    e.stopPropagation();
    setIndexOpen(!idxOpen, b.closest('.card'));
  });

  // ===== VERSION DIFF =====
  function wordDiff(oldText, newText) {
    const a = oldText.split(/\s+/).filter(Boolean);
    const b = newText.split(/\s+/).filter(Boolean);
    const m = a.length, n = b.length;
    // LCS table
    const dp = Array.from({length: m + 1}, () => new Uint16Array(n + 1));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
      }
    }
    // Backtrack
    const result = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
        result.push({type: 'eq', text: a[i-1]});
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
        result.push({type: 'ins', text: b[j-1]});
        j--;
      } else {
        result.push({type: 'del', text: a[i-1]});
        i--;
      }
    }
    return result.reverse();
  }

  // Amendment notes ("(Redação dada…)", "(Revogado…)", "(Vide…)"), left out of the
  // comparison on both sides (the old version has them in .amendment-note spans)
  const AMENDMENT_NOTE_RE = /\s*\((?:Reda[çc][ãa]o|Inclu[ií]d|Inserid|Acrescentad|Revogad|Renumerad|Alterad|Vide\b|Suprimid|Declarad|Adin\b|ADI\b|Precedente|NR(?=\))|Vig[êe]ncia|Produ[çc][ãa]o|Novamente|Designad|Restabelecid|Reestabelecid)[^()]*(?:\([^()]*\)[^()]*)*\)/gi;
  // The provision's identifier and separator at the start ("§ 1º -", "IV —", "b)"):
  // the current version shows it in .unit-id, the old one in the text
  const LEADING_IDENT_RE = /^\s*(?:Art\.?\s*\d+\s*[ºª°]?(?:-?[A-H](?=[.\s\-–—]))?|§\s*\d+\s*\.?\s*[ºª°]?(?:-[A-H])?|Par[aá]grafo\s+[uú]nico|[IVXLC]+(?=\s*[-–—])|[a-z]\s?\)|\d+\s*\)|\d+(?=\s*[-–—]))\s*[-–—.:]?\s*/i;

  function extractPlainText(el) {
    // Only the provision's text: no identifier, amendment notes or UI bits
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.amendment-note, .diff-toggle, .footnote-ref, .footnote-box, .unit-id, .indent-path')
      .forEach(n => n.remove());
    return clone.textContent
      .replace(AMENDMENT_NOTE_RE, '')
      .replace(/([.;:,])\s*[.;,]+/g, '$1')      // punctuation left around a removed note
      .replace(LEADING_IDENT_RE, '')
      .replace(/^[\s\-–—]+/, '')
      .trim();
  }

  function findNextVersion(oldEl) {
    const ident = oldEl.dataset.ident || '';
    const path = oldEl.dataset.path || '';
    // A provision in the article (it has a path): the next old version of the same
    // path, or the current version of the same path, wherever it is in the card
    if (path) {
      for (let sib = oldEl.nextElementSibling; sib; sib = sib.nextElementSibling) {
        if (sib.classList.contains('old-version')) {
          if (sib.dataset.path === path) return sib;
          continue;
        }
        const uid = sib.querySelector && sib.querySelector('.unit-id');
        if (uid && uid.dataset.path === path) return sib;
      }
      return null;
    }
    // A precedent's item ("6)", "6 -"): the next wording with the same number
    const item = oldEl.dataset.item || '';
    if (item) {
      for (let sib = oldEl.nextElementSibling; sib; sib = sib.nextElementSibling) {
        if (sib.dataset && sib.dataset.item === item) return sib;
      }
      return null;
    }
    // Old caput versions: the next old caput or the current caput
    if (!/^Art/i.test(ident)) return null;
    // Walk forward through siblings to find the next version (old or current)
    let sib = oldEl.nextElementSibling;
    while (sib) {
      // Skip diff panels
      if (sib.classList.contains('diff-panel')) {
        sib = sib.nextElementSibling;
        continue;
      }
      if (sib.classList.contains('old-version')) {
        // Another old version — return it if same ident (sequential diff)
        const sibIdent = sib.dataset.ident || '';
        if (ident && ident === sibIdent) return sib;
        // Different ident — skip
        sib = sib.nextElementSibling;
        continue;
      }
      // It's a current-version paragraph
      if (!ident) return sib;
      const uid = sib.querySelector('.unit-id');
      if (uid) {
        const uidText = uid.textContent.trim();
        // Match: "Art. 38" ↔ "Art. 38", "§ 1º" ↔ "§ 1º", etc.
        if (ident === uidText || ident.replace(/\s+/g, '') === uidText.replace(/\s+/g, '')) {
          return sib;
        }
      }
      // For caput without .art-para, the first non-old-version <p> is the match
      if (!sib.classList.contains('art-para') && sib.tagName === 'P') {
        return sib;
      }
      break;
    }
    return null;
  }

  function toggleDiff(oldEl) {
    // The diff panel's text is part of the card's searchable text
    invalidateCardText(oldEl.closest('.card'));
    // If already open, close
    if (oldEl.classList.contains('diff-open')) {
      oldEl.classList.remove('diff-open');
      const panel = oldEl.nextElementSibling;
      if (panel && panel.classList.contains('diff-panel')) {
        panel.remove();
      }
      return;
    }

    const nextEl = findNextVersion(oldEl);
    if (!nextEl) return;

    const oldText = extractPlainText(oldEl);
    const newText = extractPlainText(nextEl);

    const diff = wordDiff(oldText, newText);

    const panel = document.createElement('div');
    panel.className = 'diff-panel';
    if (!diff.some(part => part.type !== 'eq')) {
      panel.textContent = 'Sem alteração no texto (só nas notas).';
      oldEl.classList.add('diff-open');
      oldEl.after(panel);
      return;
    }
    for (const part of diff) {
      if (part.type === 'del') {
        const s = document.createElement('span');
        s.className = 'diff-del';
        s.textContent = part.text;
        panel.appendChild(s);
        panel.appendChild(document.createTextNode(' '));
      } else if (part.type === 'ins') {
        const s = document.createElement('span');
        s.className = 'diff-ins';
        s.textContent = part.text;
        panel.appendChild(s);
        panel.appendChild(document.createTextNode(' '));
      } else {
        panel.appendChild(document.createTextNode(part.text + ' '));
      }
    }

    oldEl.classList.add('diff-open');
    oldEl.after(panel);
  }

  // Inject diff-toggle icons into all old-version paragraphs
  function initDiffToggles() {
    $cards.querySelectorAll('.old-version').forEach(el => {
      if (el.querySelector('.diff-toggle')) return;
      if (!findNextVersion(el)) return;
      const btn = document.createElement('span');
      btn.className = 'diff-toggle';
      btn.textContent = '\u21C4';
      btn.title = 'Comparar com versão seguinte';
      el.appendChild(btn);
    });
  }

  // Delegated click handler for diff
  $cards.addEventListener('click', (e) => {
    const toggle = e.target.closest('.diff-toggle');
    if (toggle) {
      e.stopPropagation();
      const oldEl = toggle.closest('.old-version');
      if (oldEl) toggleDiff(oldEl);
      return;
    }
  });

  // ===== MINIMAP =====
  let minimapRafId = null;
  let minimapHeadings = []; // { y, h, color, textColor, label } for tooltip on hover

  function getMinimapColor(card) {
    if (card.classList.contains('card-titulo')) {
      if (card.classList.contains('nivel-norma'))    return MINIMAP_COLORS.norma.bg;
      if (card.classList.contains('nivel-titulo'))   return MINIMAP_COLORS.tit.bg;
      if (card.classList.contains('nivel-capitulo')) return MINIMAP_COLORS.cap.bg;
      if (card.classList.contains('nivel-secao'))    return MINIMAP_COLORS.sec.bg;
      if (card.classList.contains('nivel-subsecao')) return MINIMAP_COLORS.subsec.bg;
      return '#999';
    }
    if (card.classList.contains('card-artigo')) return '#fff';
    return '#eee';
  }

  function buildMinimap() {
    if (!$minimap || !$minimap.offsetWidth) return;

    const canvas = $minimapCanvas;
    const rect = $minimap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const docH = document.documentElement.scrollHeight;
    if (docH <= 0) return;

    const scale = h / docH;
    const cards = getAllCards();
    const pad = 2;
    const barW = w - pad * 2;
    const headings = [];

    // Headings at least 2 px and drawn last: a heading is far shorter than a
    // pixel here, and the article right after it would paint over it
    const titles = [];
    for (const card of cards) {
      if (card.classList.contains('filtered-out')) continue;
      const y = card.offsetTop * scale;
      const isTitle = card.classList.contains('card-titulo');
      const ch = Math.max(isTitle ? 2 : 1, card.offsetHeight * scale);
      if (isTitle) titles.push([y, ch, card]);
      else {
        ctx.fillStyle = getMinimapColor(card);
        ctx.fillRect(pad, y, barW, ch);
      }
      headings.push({ y, h: ch, card });
    }
    for (const [y, ch, card] of titles) {
      ctx.fillStyle = getMinimapColor(card);
      ctx.fillRect(pad, y, barW, ch);
    }

    minimapHeadings = headings;
    updateMinimapViewport();
  }

  function updateMinimapViewport() {
    applyMinimapViewport(readMinimapViewport());
  }

  function readMinimapViewport() {
    if (!$minimap || !$minimap.offsetWidth) return null;
    const mapH = $minimap.getBoundingClientRect().height;
    const docH = document.documentElement.scrollHeight;
    if (docH <= 0) return null;
    const scale = mapH / docH;
    return { top: window.scrollY * scale, height: Math.max(12, window.innerHeight * scale) };
  }

  function applyMinimapViewport(vp) {
    if (!vp) return;
    $minimapViewport.style.top = vp.top + 'px';
    $minimapViewport.style.height = vp.height + 'px';
  }

  function scheduleMinimap() {
    if (minimapRafId) return;
    minimapRafId = requestAnimationFrame(() => {
      minimapRafId = null;
      buildMinimap();
    });
  }

  // Click on minimap → scroll to proportional position
  if ($minimap) {
    $minimap.addEventListener('click', (e) => {
      if (e.target === $minimapViewport) return;
      const rect = $minimap.getBoundingClientRect();
      const pct = (e.clientY - rect.top) / rect.height;
      const docH = document.documentElement.scrollHeight;
      const target = pct * docH - window.innerHeight / 2;
      scrollToY(Math.max(0, target), 'smooth');
    });

    // Drag on minimap for continuous scrolling
    let minimapDragging = false;

    $minimap.addEventListener('mousedown', (e) => {
      cancelScrollCorrection();
      minimapDragging = true;
      e.preventDefault();
      const rect = $minimap.getBoundingClientRect();
      const pct = (e.clientY - rect.top) / rect.height;
      const docH = document.documentElement.scrollHeight;
      window.scrollTo({ top: Math.max(0, pct * docH - window.innerHeight / 2), behavior: 'instant' });
    });

    window.addEventListener('mousemove', (e) => {
      if (!minimapDragging) return;
      const rect = $minimap.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const docH = document.documentElement.scrollHeight;
      window.scrollTo({ top: Math.max(0, pct * docH - window.innerHeight / 2), behavior: 'instant' });
    });

    window.addEventListener('mouseup', () => {
      minimapDragging = false;
    });

    // Tooltip breadcrumb on hover
    let lastTooltipCard = null;

    function buildTooltipBreadcrumb(card) {
      $minimapTooltip.innerHTML = '';

      // Collect ancestor headings (same logic as updateBreadcrumb)
      const levelOrder = ['norma', 'tit', 'cap', 'sec', 'subsec'];
      const foundLevels = new Set();
      const ancestors = [];
      let prev = card.classList.contains('card-titulo') ? card.previousElementSibling : card.previousElementSibling;
      // If card IS a heading, include itself first
      if (card.classList.contains('card-titulo')) {
        const sec = card.dataset.section || '';
        let level = '';
        if (sec.startsWith('norma')) level = 'norma';
        else if (sec.startsWith('tit') || sec === 'adt' || sec === 'dgt') level = 'tit';
        else if (sec.startsWith('cap')) level = 'cap';
        else if (sec.startsWith('subsec')) level = 'subsec';
        else if (sec.startsWith('sec')) level = 'sec';
        if (level) {
          foundLevels.add(level);
          ancestors.push({ el: card, level });
        }
        prev = card.previousElementSibling;
      }
      while (prev && foundLevels.size < levelOrder.length) {
        if (prev.classList.contains('card-titulo')) {
          const sec = prev.dataset.section || '';
          let level = '';
          if (sec.startsWith('norma')) level = 'norma';
          else if (sec.startsWith('tit') || sec === 'adt' || sec === 'dgt') level = 'tit';
          else if (sec.startsWith('cap')) level = 'cap';
          else if (sec.startsWith('subsec')) level = 'subsec';
          else if (sec.startsWith('sec')) level = 'sec';
          if (level && !foundLevels.has(level)) {
            foundLevels.add(level);
            ancestors.push({ el: prev, level });
            if (level === 'norma') break;
          }
        }
        prev = prev.previousElementSibling;
      }
      ancestors.reverse();

      for (const a of ancestors) {
        const chip = document.createElement('div');
        chip.className = 'mm-chip';
        const c = MINIMAP_COLORS[a.level];
        chip.style.background = c.bg;
        chip.style.color = c.text;
        chip.textContent = getHeadingShortTitle(a.el);
        $minimapTooltip.appendChild(chip);
      }

      // Article chip at the bottom
      if (card.classList.contains('card-artigo')) {
        const artNum = card.dataset.art || '';
        const lawPrefix = card.dataset.law;
        const key = lawPrefix ? lawPrefix + ':' + artNum : artNum;
        const summary = SUMMARIES_MAP[key] || '';
        const prefix = cardRefLabel(card);
        const chip = document.createElement('div');
        chip.className = 'mm-chip';
        chip.style.background = MINIMAP_COLORS.article.bg;
        chip.style.color = MINIMAP_COLORS.article.text;
        chip.textContent = summary ? prefix + ' — ' + summary : prefix;
        $minimapTooltip.appendChild(chip);
      }
    }

    $minimap.addEventListener('mousemove', (e) => {
      if (minimapDragging) {
        $minimapTooltip.style.display = 'none';
        $minimapHighlight.style.display = 'none';
        lastTooltipCard = null;
        return;
      }
      const rect = $minimap.getBoundingClientRect();
      const my = e.clientY - rect.top;
      let hit = null;
      for (const entry of minimapHeadings) {
        if (my >= entry.y - 1 && my <= entry.y + entry.h + 1) {
          hit = entry;
          break;
        }
      }
      if (hit) {
        if (hit.card !== lastTooltipCard) {
          lastTooltipCard = hit.card;
          buildTooltipBreadcrumb(hit.card);
        }
        // Position so last chip aligns with the stripe center
        const stripeCenter = hit.y + hit.h / 2;
        $minimapTooltip.style.top = '0px';
        $minimapTooltip.style.display = 'flex';
        const lastChip = $minimapTooltip.lastElementChild;
        const chipMidY = lastChip
          ? lastChip.offsetTop + lastChip.offsetHeight / 2
          : $minimapTooltip.offsetHeight / 2;
        $minimapTooltip.style.top = (stripeCenter - chipMidY) + 'px';
        // Highlight stripe
        $minimapHighlight.style.top = hit.y + 'px';
        $minimapHighlight.style.height = hit.h + 'px';
        $minimapHighlight.style.display = 'block';
      } else {
        $minimapTooltip.style.display = 'none';
        $minimapHighlight.style.display = 'none';
        lastTooltipCard = null;
      }
    });

    $minimap.addEventListener('mouseleave', () => {
      $minimapTooltip.style.display = 'none';
      $minimapHighlight.style.display = 'none';
      lastTooltipCard = null;
    });
  }

  // Resize → rebuild minimap (and re-estimate card heights for the new width)
  let estimatedWidth = $cards.clientWidth;
  window.addEventListener('resize', () => {
    if ($cards.clientWidth !== estimatedWidth) {
      estimatedWidth = $cards.clientWidth;
      preserveScroll(estimateCardHeights);
      forgetCardHeights();
    }
    scheduleMinimap();
  });

  // Cards drawn for the first time replace their estimate with the real
  // height: redraw the minimap once they stop changing (not per scroll stop,
  // as programmatic scrolls end every frame)
  let minimapStaleTimer;
  $cards.addEventListener('contentvisibilityautostatechange', e => {
    if (e.target.classList.contains('card')) {
      if (e.skipped) cardsShown.delete(e.target);
      else cardsShown.add(e.target), cardsDrawn.add(e.target);
    }
    clearTimeout(minimapStaleTimer);
    minimapStaleTimer = setTimeout(scheduleMinimap, 500);
  }, true);

  // ===== INIT =====
  try {
    const savedZoom = localStorage.getItem('regimento-zoom');
    if (savedZoom) setZoom(parseFloat(savedZoom), true);
  } catch (e) {}
  try {
    if (localStorage.getItem('regimento-compact') === '1') setCompactMode(true);
  } catch (e) {}
  try {
    idxOpen = localStorage.getItem('regimento-indice-aberto') === '1';
    $cards.classList.toggle('idx-open', idxOpen);
  } catch (e) {}
  renderIndexBacklinks();
  // After everything that adds blocks to the cards (the saved zoom above
  // already estimated without the backlinks)
  cardEstBlocks = null;
  estimateCardHeights();
  loadMarkers();
  applyMarkers();
  renderMarkerNav();
  updateSelection();
  updateBreadcrumb();
  initDiffToggles();
  scheduleMinimap();
  if (window.innerWidth > 768) $searchInput.focus();

  // Warm what the first results list needs (law titles, fonts and styles of
  // its entries), so its first build is not a long task
  whenIdle(() => {
    resultLawTitle(ALL_CARDS[0]);
    const warm = document.createElement('div');
    warm.style.cssText = 'position:absolute;left:-9999px;top:0;width:300px;visibility:hidden';
    warm.innerHTML = '<div class="res-law">x</div><div class="res-group"><button class="res-head">'
      + '<span class="res-law-tag">x</span>Art. 1<span class="res-sum"> — x</span></button>'
      + '<button class="res-entry"><span class="res-label">x</span> <span class="res-text">x <mark>x</mark>'
      + '</span></button><button class="res-expand">x</button></div>';
    document.body.appendChild(warm);
    void warm.offsetHeight;
    warm.remove();
  });

  // Build the search text cache in idle time, so the first search doesn't pay for it
  let textCacheWarmed = 0;
  whenIdle(function warmCardText(deadline) {
    const sliceEnd = performance.now() + 8;
    while (textCacheWarmed < ARTICLE_CARDS.length && deadline.timeRemaining() > 1 && performance.now() < sliceEnd) {
      getCardText(ARTICLE_CARDS[textCacheWarmed++], false);
    }
    if (textCacheWarmed < ARTICLE_CARDS.length) whenIdle(warmCardText);
  });

})();
