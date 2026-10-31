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
      }, () => {});   // (a font that never comes, or the page left meanwhile)
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

