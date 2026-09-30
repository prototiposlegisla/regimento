(function() {
  'use strict';

  // ===== DATA (injected by build.py) =====
  const SYSTEMATIC_INDEX = /*__SYSTEMATIC_INDEX__*/[];

  const SUBJECT_INDEX = /*__SUBJECT_INDEX__*/[];

  const REFERENCIAS_INDEX = /*__REFERENCIAS_INDEX__*/[];

  const SUMMARIES_MAP = /*__SUMMARIES_MAP__*/{};

  const INFO_HTML = /*__INFO_HTML__*/"";

  // ===== MINIMAP / TOOLTIP COLORS =====
  const MINIMAP_COLORS = {
    norma:   { bg: '#222',    text: '#fff' },
    tit:     { bg: '#b71c1c', text: '#fff' },
    cap:     { bg: '#f57c00', text: '#fff' },
    sec:     { bg: '#fdd835', text: '#333' },
    subsec:  { bg: '#2e7d32', text: '#fff' },
    article: { bg: '#555',    text: '#fff' },
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
  let activeSubject = null;
  let subjectIdx = 0;
  let subjectFilter = true;
  let zoomScale = 1;
  let zoomTimeout = null;
  let searchMatches = [];
  let searchIdx = 0;
  let currentRefCategory = 0;
  let markerFilter = false;
  let markerTooltipTimer = null;
  let footnoteTooltipTimer = null;
  let scrollRafId = null;

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
  const $subjectPill = document.getElementById('subject-pill');
  const $pillLabel = document.getElementById('pill-label');
  const $pillCurrent = document.getElementById('pill-current');
  const $pillDropdown = document.getElementById('pill-dropdown');
  const $pillFilter = document.getElementById('pill-filter');
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
    const racesSmoothScroll = smoothScrolling;
    // Only a smooth scroll that actually moves ends with a 'scrollend'
    const root = document.documentElement;
    const dest = Math.max(0, Math.min(top, root.scrollHeight - root.clientHeight));
    smoothScrolling = behavior === 'smooth' && Math.abs(dest - window.scrollY) >= 1;
    window.scrollTo({ top, behavior });
    if (behavior !== 'instant' || !racesSmoothScroll) return;
    // A jump made while an earlier smooth scroll is still animating lands one
    // animation step past the target (Chrome): put it back
    const landed = window.scrollY;
    let frames = 3;
    requestAnimationFrame(function keep() {
      if (call !== scrollToYCall) return;
      if (Math.abs(window.scrollY - landed) >= 1) window.scrollTo({ top: landed, behavior: 'instant' });
      if (--frames) requestAnimationFrame(keep);
    });
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
      if (!rect) rect = card.getBoundingClientRect();
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
      $breadcrumb.classList.remove('visible');
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
    artSpan.textContent = (lawPrefix ? lawPrefix + '\u00a0' : '') + card.dataset.art;
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

  $breadcrumb.addEventListener('click', (e) => {
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
  }

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
  if (HIGHLIGHT_API) CSS.highlights.set('search', searchHighlight);

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
        if (entry.isIntersecting) searchHighlight.add(range);
        else searchHighlight.delete(range);
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
    // A subject filter opened afterwards (search filter off) hides matches
    // without searching again; the binary search needs visible cards
    const matches = visibleOnly(searchMatches);
    for (let i = firstCardWhere(matches, r => r.bottom >= bandTop); i < matches.length; i++) {
      const card = matches[i];
      if (card.getBoundingClientRect().top > bandBottom) break;
      for (const target of cardTargets.get(card) || []) {
        const r = target.getBoundingClientRect();
        if (!r.height || r.bottom < bandTop || r.top > bandBottom) continue;
        for (const range of rangeTargets.get(target)) {
          if (!searchHighlight.has(range)) searchHighlight.add(range);
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
        for (const range of ranges) searchHighlight.add(range);
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
    }
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
        : n.classList.contains('indent-path') ? NodeFilter.FILTER_REJECT
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
  // trigger a text search (typing "a222" goes through "a" first)
  const MIN_TERM_LENGTH = 2;

  // What doSearch will do with a term:
  //  'empty' → clear; 'nav' → go to an article (a43, a44, aADT1, aLO23...);
  //  'short' → no term reaches MIN_TERM_LENGTH; 'text' → text search.
  // A "r " prefix includes footnotes in the search.
  function classifyQuery(term) {
    if (!term) return { kind: 'empty' };
    let includeFootnotes = false;
    const footnoteMatch = term.match(/^r\s+(.+)$/i);
    if (footnoteMatch) {
      includeFootnotes = true;
      term = footnoteMatch[1];
    }
    const artMatch = term.match(/^a([A-Z]{2,})?(\d+[-A-Za-z]*)$/i);
    if (artMatch) return { kind: 'nav', artMatch };
    const { phrases, words } = parseSearchTerms(term);
    let longest = 0;
    for (const t of phrases.concat(words)) longest = Math.max(longest, t.length);
    if (longest < MIN_TERM_LENGTH) return { kind: 'short' };
    return { kind: 'text', includeFootnotes, phrases, words, longest };
  }

  function buildHighlightRegex(phrases, words) {
    // Phrases first (longer matches take priority in alternation)
    const allPatterns = [
      ...phrases.map(p => accentInsensitivePattern(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).replace(/ +/g, '[\\s\\xa0]+')),
      ...words.map(t => accentInsensitivePattern(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    ];
    return new RegExp('(' + allPatterns.join('|') + ')', 'gi');
  }

  function highlightText(card, regex, includeFootnotes) {
    const found = []; // [text node, [[start, end], ...]]
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const tn = walker.currentNode;
      let spans = null;
      let m;
      regex.lastIndex = 0;
      while ((m = regex.exec(tn.data)) !== null) {
        if (!m[0].length) { regex.lastIndex++; continue; }
        (spans || (spans = [])).push([m.index, m.index + m[0].length]);
      }
      if (!spans) continue;
      if (!includeFootnotes && tn.parentElement.closest('.footnote-box')) continue;
      if (tn.parentElement.closest('.indent-path')) continue;
      found.push([tn, spans]);
    }
    if (!found.length) return;

    const hits = [];
    const ranges = [];
    for (const [tn, spans] of found) {
      if (HIGHLIGHT_API && !tn.parentElement.closest(UNSELECTABLE_TEXT)) {
        textNodeHits.set(tn, spans);
        for (const [start, end] of spans) {
          const range = new StaticRange({ startContainer: tn, startOffset: start, endContainer: tn, endOffset: end });
          hits.push(range);
          ranges.push(range);
        }
        continue;
      }
      const data = tn.data;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const [start, end] of spans) {
        if (start > last) frag.appendChild(document.createTextNode(data.slice(last, start)));
        const mark = document.createElement('mark');
        mark.textContent = data.slice(start, end);
        frag.appendChild(mark);
        hits.push(mark);
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
    hideResults();
    searchMatches = [];
    searchIdx = 0;
    $searchNav.classList.remove('open');
    $searchInput.classList.remove('has-nav');
    updateSearchTicks();
    scheduleMinimap();
  }

  // Selection and breadcrumb normally follow scroll events; after un-filtering
  // without a scroll (no scroll anchoring in WebKit) they must be refreshed
  function refreshScrollState() {
    requestAnimationFrame(syncToScroll);
  }

  function doSearch(term) {
    // A run for the input's current value supersedes the pending one; runs
    // for an older term (currentSearch, from marker/subject filters) leave it
    // pending so the newer term still applies
    if (term === $searchInput.value.trim()) cancelPendingSearch();
    if (scrollRafId) { cancelAnimationFrame(scrollRafId); scrollRafId = null; }
    currentSearch = term;
    clearHighlights();
    const cards = getAllCards();
    const hiddenBefore = cards.filter(c => c.classList.contains('filtered-out'));

    if (activeSubject && subjectFilter) {
      applySubjectFilter();
    } else {
      cards.forEach(c => c.classList.remove('filtered-out'));
    }

    if (markerFilter && markersList.length > 0) {
      applyMarkerFilter();
    }

    const query = classifyQuery(term);
    $btnClearSearch.style.display = query.kind === 'empty' ? 'none' : 'flex';

    if (query.kind === 'empty' || query.kind === 'short') {
      resetSearchNav();
      if (hiddenBefore.some(c => !c.classList.contains('filtered-out'))) refreshScrollState();
      return;
    }

    if (query.kind === 'nav') {
      const lawPrefix = query.artMatch[1] ? query.artMatch[1].toUpperCase() : '';
      const artNum = query.artMatch[2];
      let target;
      if (lawPrefix) {
        target = $cards.querySelector(`.card-artigo[data-art="${artNum}"][data-law="${lawPrefix}"]`);
      } else {
        // Search default (no data-law) first, then any
        target = $cards.querySelector(`.card-artigo[data-art="${artNum}"]:not([data-law])`)
              || $cards.querySelector(`.card-artigo[data-art="${artNum}"]`);
      }
      if (target) {
        const targetY = target.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.25;
        scrollToY(targetY, 'smooth');
        selectCard(target, true);
      }
      resetSearchNav();
      return;
    }

    const { phrases, words, includeFootnotes } = query;
    const regex = buildHighlightRegex(phrases, words);
    const articleCards = visibleOnly(getArticleCards());
    const matchedCards = new Set();

    for (const card of articleCards) {
      const text = getCardText(card, includeFootnotes);
      if (phrases.every(p => text.includes(p)) && words.every(t => text.includes(t))) {
        matchedCards.add(card);
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

    if (searchFilter) {
      for (const card of cards) {
        if (card.classList.contains('filtered-out')) continue;
        if (card.classList.contains('card-titulo')) {
          card.classList.add('filtered-out');
          continue;
        }
        if (!matchedCards.has(card)) {
          card.classList.add('filtered-out');
        }
      }
      showContextHeadings();
    }

    searchMatches = articleCards.filter(c => matchedCards.has(c));
    searchIdx = 0;
    showResults();

    if (searchMatches.length > 0) {
      $searchNav.classList.add('open');
      $searchInput.classList.add('has-nav');
      updateSearchCounter();
      updateSearchTicks();
      scrollToFirstMark(searchMatches[0]);
      selectCard(searchMatches[0], true);
    } else {
      $searchNav.classList.remove('open');
      $searchInput.classList.remove('has-nav');
      updateSearchTicks();
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
      if ($searchInput.value) {
        $searchInput.value = '';
        preserveScroll(() => doSearch(''));
      }
      $searchInput.focus();
    }
    if (e.ctrlKey && e.key === 'f') {
      e.preventDefault();
      $searchInput.focus();
      $searchInput.select();
    }
  });

  $btnClearSearch.addEventListener('click', () => {
    $searchInput.value = '';
    preserveScroll(() => doSearch(''));
  });

  $btnFilter.addEventListener('click', () => {
    searchFilter = !searchFilter;
    $btnFilter.classList.toggle('active', searchFilter);
    preserveScroll(() => doSearch($searchInput.value.trim()));
  });

  function updateSearchCounter() {
    $searchCounter.textContent = (searchIdx + 1) + ' / ' + searchMatches.length;
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
    searchIdx = (searchIdx + delta + searchMatches.length) % searchMatches.length;
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
  const RESULT_NOISE = '.art-compact-label, .indent-path, .footnote-ref, .diff-toggle, .footnote-close, .diff-panel';
  // Not part of a dispositivo's text in a snippet (the entry's label shows
  // the .unit-id and "Nota N:" ones)
  const SNIPPET_SKIP = RESULT_NOISE + ', .unit-id, .footnote-box > strong';

  let resultsActive = false;        // a text search is showing its results
  let resultsBuiltFor = null;       // the searchMatches array the list shows
  let resultsBuildPending = false;
  let resultsPanelShown = false;
  let resultsDrawerOpen = false;
  let resultsHidden = false;        // sidebar closed by the user (remembered)
  try { resultsHidden = localStorage.getItem('regimento-results-hidden') === '1'; } catch (e) {}
  let resultGroups = new Map();     // card → its group element in the list
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

  function clearResultsList() {
    if (!resultsBuiltFor) return;
    resultsFillObserver.disconnect();
    resultsMoreObserver.disconnect();
    resultsBuiltFor = null;
    resultGroups = new Map();
    resultsAppended = 0;
    currentResultGroup = null;
    revealGroup = null;
    $resultsList.textContent = '';
    $resultsSummary.textContent = '';
  }

  function updateResultsVisibility() {
    document.body.classList.toggle('results-open', resultsActive && resultsWide.matches && !resultsHidden);
    document.body.classList.toggle('results-drawer-open', resultsDrawerOpen);
    $indexOverlay.classList.toggle('open', resultsDrawerOpen || $indexPanel.classList.contains('open'));
    $indexResultsLink.hidden = !resultsActive;
    if (resultsActive) $indexResultsLink.textContent = 'Lista de resultados da busca (' + searchMatches.length + ') ›';
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
      markCurrentResult(selectedCard);
      revealCurrentResult(true);
    }
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
    try { localStorage.setItem('regimento-results-hidden', hidden ? '1' : '0'); } catch (e) {}
    preserveScroll(updateResultsVisibility);
  }

  function buildResultsList() {
    clearResultsList();
    resultsBuiltFor = searchMatches;
    resultsLaw = null;
    $resultsList.scrollTop = 0;

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
    $resultsSummary.textContent = searchMatches.length
      ? searchMatches.length + (searchMatches.length === 1 ? ' artigo' : ' artigos')
        + ' · ' + hits + (hits === 1 ? ' ocorrência' : ' ocorrências')
      : '';
    if (!searchMatches.length) {
      const empty = document.createElement('div');
      empty.className = 'res-empty';
      empty.textContent = 'Nenhum resultado para “' + currentSearch + '”';
      $resultsList.appendChild(empty);
      return;
    }

    appendResultGroups(searchMatches.length, performance.now() + RESULTS_SLICE_MS);
    // The top of the list shows filled right away (the observer reports later)
    for (const card of searchMatches.slice(0, RESULTS_FILLED_UPFRONT)) fillResultGroup(card);
    observeLastResultGroup();
    markCurrentResult(selectedCard);
  }

  // Appends groups for searchMatches[resultsAppended, until), stopping early
  // at the deadline (a performance.now() time)
  function appendResultGroups(until, deadline = Infinity) {
    const frag = document.createDocumentFragment();
    while (resultsAppended < until && performance.now() < deadline) {
      const card = searchMatches[resultsAppended++];
      const lawTitle = resultLawTitle(card);
      if (lawTitle !== resultsLaw) {
        resultsLaw = lawTitle;
        if (lawTitle) {
          const sep = document.createElement('div');
          sep.className = 'res-law';
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
      tag.className = 'res-law-tag';
      const matched = getCardHits(card).some(hit => hitElement(hit).closest('.law-badge'));
      tag.innerHTML = matched ? '<mark>' + escapeHtml(lawPrefix) + '</mark>' : escapeHtml(lawPrefix);
      head.appendChild(tag);
    }
    head.appendChild(document.createTextNode('Art. ' + card.dataset.art));
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
  // summary and the law badge are shown in the group header instead.
  function resultUnits(card) {
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
    if (unit.classList.contains('footnote-box')) return 'Nota ' + (unit.dataset.note || '');
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
      if (n.parentElement.tagName === 'MARK') {
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
  function markCurrentResult(card) {
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
    revealCurrentResult(false);
  }

  function setCurrentResultGroup(group) {
    if (currentResultGroup) currentResultGroup.classList.remove('current');
    currentResultGroup = group;
    group.classList.add('current');
  }

  // Scrolls the list to the current group, unless the mouse is on it (then
  // it waits for the mouse to leave)
  function revealCurrentResult(force) {
    const group = currentResultGroup;
    if (!group || !resultsShown()) {
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
    closeIndex();
    openResults();
  });
  resultsWide.addEventListener('change', () => {
    resultsDrawerOpen = false;
    preserveScroll(updateResultsVisibility);
  });

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
    if (markerFilter) {
      if (markersList.length === 0) markerFilter = false;
      preserveScroll(() => doSearch(currentSearch));
    }
    renderMarkerNav();
  }

  function clearAllMarkers() {
    markersList = [];
    markerFilter = false;
    saveMarkers();
    applyMarkers();
    renderMarkerNav();
    preserveScroll(() => doSearch(currentSearch));
  }

  function applyMarkerFilter() {
    const markedUids = new Set(markersList.map(m => m.uid));
    const markedCards = new Set();
    for (const uid of markedUids) {
      const el = $cards.querySelector(`.unit-id[data-uid="${uid}"]`);
      if (el) {
        const card = el.closest('.card-artigo');
        if (card) markedCards.add(card);
      }
    }
    const cards = getAllCards();
    for (const card of cards) {
      if (card.classList.contains('filtered-out')) continue;
      if (card.classList.contains('card-titulo')) {
        card.classList.add('filtered-out');
      } else if (card.classList.contains('card-artigo') && !markedCards.has(card)) {
        card.classList.add('filtered-out');
      }
    }
    showContextHeadings();
  }

  function toggleMarkerFilter() {
    markerFilter = !markerFilter;
    renderMarkerNav();
    preserveScroll(() => doSearch(currentSearch));
    scheduleMinimap();
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
        if (card) {
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
      filterBtn.className = markerFilter ? 'visible active' : 'visible';
      filterBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 1h14L10 7v5l-4 2V7z"/></svg>';
      filterBtn.title = 'Mostrar apenas artigos marcados';
      filterBtn.addEventListener('click', toggleMarkerFilter);
      $markerNav.appendChild(filterBtn);

      const clearBtn = document.createElement('button');
      clearBtn.id = 'marker-clear-all';
      clearBtn.className = 'visible';
      clearBtn.innerHTML = '&times;';
      clearBtn.title = 'Remover todos os marcadores';
      clearBtn.addEventListener('click', clearAllMarkers);
      $markerNav.appendChild(clearBtn);
    }
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
        if (child.tagName === 'MARK') {
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
      const prefix = (lawPrefix ? lawPrefix + ' ' : '') + 'Art. ' + artNum;
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

    for (const { path, p, isOld } of matchedPaths) {
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
    $indexOverlay.classList.add('open');
    $indexPanel.classList.add('open');
    renderIndex();
    if (window.innerWidth > 768) $indexSearch.focus();
  }

  function closeIndex() {
    $indexOverlay.classList.remove('open');
    $indexPanel.classList.remove('open');
    $indexContent.querySelectorAll('.vide-highlight').forEach(el => el.classList.remove('vide-highlight'));
  }

  $btnIndex.addEventListener('click', openIndex);
  $indexOverlay.addEventListener('click', () => {
    closeIndex();
    if (resultsDrawerOpen) closeResults();
  });

  const $btnInfoTab = document.getElementById('btn-info-tab');
  const $indexSearchWrapper = document.getElementById('index-search-wrapper');

  document.querySelectorAll('.index-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.index-tab').forEach(t => t.classList.remove('active'));
      $btnInfoTab.classList.remove('active');
      tab.classList.add('active');
      currentIndexTab = tab.dataset.tab;
      $indexSearchWrapper.style.display = '';
      renderIndex();
    });
  });

  $btnInfoTab.addEventListener('click', () => {
    document.querySelectorAll('.index-tab').forEach(t => t.classList.remove('active'));
    $btnInfoTab.classList.add('active');
    currentIndexTab = 'info';
    $indexSearchWrapper.style.display = 'none';
    renderIndex();
  });

  const $btnClearIndexSearch = document.getElementById('btn-clear-index-search');

  $indexSearch.addEventListener('input', () => {
    $btnClearIndexSearch.style.display = $indexSearch.value.trim() ? 'flex' : 'none';
    renderIndex();
  });

  $btnClearIndexSearch.addEventListener('click', () => {
    $indexSearch.value = '';
    $btnClearIndexSearch.style.display = 'none';
    renderIndex();
    $indexSearch.focus();
  });

  function textMatchesFilter(text, filter) {
    const lower = stripAccents(text.toLowerCase());
    return stripAccents(filter).split(/\s+/).every(term => lower.includes(term));
  }

  function renderIndex() {
    const filter = $indexSearch.value.trim().toLowerCase();
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
  }

  function highlightIndexContent(filter) {
    const terms = filter.split(/\s+/).filter(Boolean);
    const regex = new RegExp('(' + terms.map(t => accentInsensitivePattern(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('|') + ')', 'gi');
    const walker = document.createTreeWalker($indexContent, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const tn of textNodes) {
      if (!regex.test(tn.textContent)) continue;
      regex.lastIndex = 0;
      const span = document.createElement('span');
      span.innerHTML = tn.textContent.replace(regex, '<mark>$1</mark>');
      tn.parentNode.replaceChild(span, tn);
    }
  }

  function sysLevelClass(sectionId) {
    if (!sectionId) return '';
    if (sectionId.startsWith('norma')) return 'sys-nivel-norma';
    if (sectionId === 'adt' || sectionId === 'dgt') return 'sys-nivel-titulo';
    if (sectionId.startsWith('tit'))   return 'sys-nivel-titulo';
    if (sectionId.startsWith('cap'))   return 'sys-nivel-capitulo';
    if (sectionId.startsWith('subsec')) return 'sys-nivel-subsecao';
    if (sectionId.startsWith('sec'))   return 'sys-nivel-secao';
    return '';
  }

  function renderSystematicIndex(filter) {
    for (const group of SYSTEMATIC_INDEX) {
      const isLaw = group.section_id && group.section_id.startsWith('norma');

      if (filter && !textMatchesFilter(group.title, filter)) {
        const hasChild = group.children && group.children.some(ch => sysNodeMatches(ch, filter));
        if (!hasChild) continue;
      }

      const div = document.createElement('div');
      div.className = 'sys-group';
      const title = document.createElement('div');
      const lvl = sysLevelClass(group.section_id);
      title.className = (isLaw ? 'sys-title sys-law' : 'sys-title') + (lvl ? ' ' + lvl : '');
      title.textContent = group.title;
      if (group.art_range && (!group.children || !group.children.length)) {
        const rangeSpan = document.createElement('span');
        rangeSpan.className = 'sys-art-range';
        rangeSpan.textContent = ' ' + group.art_range;
        title.appendChild(rangeSpan);
      }
      if (group.section_id) {
        title.dataset.section = group.section_id;
        title.style.cursor = 'pointer';
        title.addEventListener('click', () => {
          closeIndex();
          navigateToSection(group.section_id);
        });
      }
      div.appendChild(title);

      if (group.children) {
        for (const ch of group.children) {
          renderSysNode(ch, div, 12, filter);
        }
      }

      $indexContent.appendChild(div);
    }
  }

  function sysNodeMatches(node, filter) {
    if (!node.title) return false;
    if (textMatchesFilter(node.title, filter)) return true;
    if (node.children) {
      for (const ch of node.children) {
        if (sysNodeMatches(ch, filter)) return true;
      }
    }
    return false;
  }

  function renderSysNode(node, parent, indent, filter) {
    if (!node.title) return;
    if (filter && !sysNodeMatches(node, filter)) return;

    const el = document.createElement('div');
    const lvl = sysLevelClass(node.section_id);
    el.className = 'sys-item' + (lvl ? ' ' + lvl : '');
    el.style.marginLeft = indent + 'px';
    el.textContent = node.title;
    if (node.art_range && (!node.children || !node.children.length)) {
      const rangeSpan = document.createElement('span');
      rangeSpan.className = 'sys-art-range';
      rangeSpan.textContent = ' ' + node.art_range;
      el.appendChild(rangeSpan);
    }

    if (node.section_id) {
      el.dataset.section = node.section_id;
      el.addEventListener('click', () => {
        closeIndex();
        navigateToSection(node.section_id);
      });
    }
    parent.appendChild(el);

    if (node.children) {
      for (const child of node.children) {
        renderSysNode(child, parent, indent + 12, filter);
      }
    }
  }

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

  function syncSystematicToScroll() {
    const sectionId = getCurrentSectionId();
    if (!sectionId) return;
    // Remove previous highlight
    $indexContent.querySelectorAll('.sys-active').forEach(el => el.classList.remove('sys-active'));
    // Find matching element in the index panel
    const target = $indexContent.querySelector('[data-section="' + sectionId + '"]');
    if (!target) return;
    target.classList.add('sys-active');
    target.scrollIntoView({ behavior: 'instant', block: 'center' });
  }

  function navigateToSection(sectionId) {
    const card = $cards.querySelector(`.card-titulo[data-section="${sectionId}"]`);
    if (card) {
      if (card.classList.contains('filtered-out')) {
        searchFilter = false;
        $btnFilter.classList.remove('active');
        doSearch($searchInput.value.trim());
      }
      scrollToReadingLine(card);
      selectCard(card, true);
    }
  }

  function formatRefsList(refs) {
    // Returns array of {label, hint, art, lawPrefix} — one per ref, no range compaction
    const result = [];
    for (const r of refs) {
      const prefix = r.law_prefix ? r.law_prefix + ' ' : '';
      const label = prefix + 'art. ' + r.art + (r.detail ? ', ' + r.detail : '');
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
    // Collect all refs from entry (direct + children) for the pill
    const all = [];
    if (entry.refs) all.push(...entry.refs);
    if (entry.children) {
      for (const ch of entry.children) {
        all.push(...ch.refs);
      }
    }
    return all;
  }

  function renderVides(vides) {
    const container = document.createElement('div');
    container.className = 'subj-vides';
    const label = document.createElement('span');
    label.className = 'vide-label';
    label.textContent = 'Vide: ';
    container.appendChild(label);
    vides.forEach((v, i) => {
      const link = document.createElement('a');
      link.className = 'vide-link';
      // Support "ASSUNTO|SUBASSUNTO" format
      const pipeIdx = v.indexOf('|');
      const subjectPart = pipeIdx !== -1 ? v.slice(0, pipeIdx).trim() : v;
      const subSubjectPart = pipeIdx !== -1 ? v.slice(pipeIdx + 1).trim() : '';
      link.textContent = subSubjectPart ? subjectPart + ' — ' + subSubjectPart : v;
      link.href = '#';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        // Build the key to find the target element in the DOM
        const targetKey = subSubjectPart
          ? stripAccents(subjectPart.toLowerCase()) + '|' + stripAccents(subSubjectPart.toLowerCase())
          : stripAccents(subjectPart.toLowerCase());
        // Clear search filter so the target is visible
        if ($indexSearch.value.trim()) {
          $indexSearch.value = '';
          $indexSearch.dispatchEvent(new Event('input'));
        }
        // Find the DOM element with matching data-subject-key
        const targetEl = $indexContent.querySelector('[data-subject-key="' + CSS.escape(targetKey) + '"]');
        if (targetEl) {
          // Remove any previous highlights
          $indexContent.querySelectorAll('.vide-highlight').forEach(el => el.classList.remove('vide-highlight'));
          // Highlight and scroll to the target
          targetEl.classList.add('vide-highlight');
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          // Target not found — put in search bar
          $indexSearch.value = subjectPart;
          $indexSearch.dispatchEvent(new Event('input'));
        }
      });
      container.appendChild(link);
      if (i < vides.length - 1) {
        container.appendChild(document.createTextNode(', '));
      }
    });
    return container;
  }

  function renderSubjectIndex(filter) {
    const sorted = SUBJECT_INDEX.slice().sort((a, b) => a.subject.localeCompare(b.subject, 'pt-BR'));
    for (const entry of sorted) {
      const matchSelf = !filter || textMatchesFilter(entry.subject, filter);
      const matchChild = !matchSelf && entry.children && entry.children.some(
        ch => textMatchesFilter(ch.sub_subject, filter)
      );
      if (!matchSelf && !matchChild) continue;

      const div = document.createElement('div');
      div.className = 'subj-entry';
      div.dataset.subjectKey = stripAccents(entry.subject.toLowerCase());
      const title = document.createElement('div');
      title.className = 'subj-title';
      title.textContent = entry.subject;
      const allRefs = collectAllRefs(entry);
      if (allRefs.length > 0) {
        title.addEventListener('click', () => {
          closeIndex();
          const pillEntry = { subject: entry.subject, refs: allRefs };
          openSubjectPill(pillEntry);
        });
      } else {
        title.classList.add('no-refs');
      }
      div.appendChild(title);

      // Direct refs
      if (entry.refs && entry.refs.length > 0) {
        const refsContainer = document.createElement('div');
        refsContainer.className = 'subj-refs';
        for (const item of formatRefsList(entry.refs)) {
          const line = document.createElement('div');
          line.className = 'subj-ref-line';
          const labelSpan = document.createTextNode(item.label);
          line.appendChild(labelSpan);
          if (item.hint) {
            const hintSpan = document.createElement('span');
            hintSpan.className = 'ref-hint';
            hintSpan.textContent = ' — ' + item.hint;
            line.appendChild(hintSpan);
          }
          refsContainer.appendChild(line);
        }
        div.appendChild(refsContainer);
      }

      // Vides (cross-references)
      if (entry.vides && entry.vides.length > 0) {
        div.appendChild(renderVides(entry.vides));
      }

      // Sub-subjects
      if (entry.children) {
        for (const ch of entry.children) {
          if (filter && !matchSelf && !textMatchesFilter(ch.sub_subject, filter)) continue;
          const subDiv = document.createElement('div');
          subDiv.className = 'subj-entry';
          subDiv.dataset.subjectKey = stripAccents(entry.subject.toLowerCase()) + '|' + stripAccents(ch.sub_subject.toLowerCase());
          subDiv.style.paddingLeft = '16px';
          const subTitle = document.createElement('div');
          subTitle.className = 'subj-title';
          subTitle.style.fontSize = '13px';
          subTitle.textContent = '— ' + ch.sub_subject;
          if (ch.refs && ch.refs.length > 0) {
            subTitle.addEventListener('click', ((child) => () => {
              closeIndex();
              const pillEntry = { subject: entry.subject + ' — ' + child.sub_subject, refs: child.refs };
              openSubjectPill(pillEntry);
            })(ch));
          } else {
            subTitle.classList.add('no-refs');
          }
          subDiv.appendChild(subTitle);

          const subRefs = document.createElement('div');
          subRefs.className = 'subj-refs';
          for (const item of formatRefsList(ch.refs)) {
            const line = document.createElement('div');
            line.className = 'subj-ref-line';
            const labelSpan = document.createTextNode(item.label);
            line.appendChild(labelSpan);
            if (item.hint) {
              const hintSpan = document.createElement('span');
              hintSpan.className = 'ref-hint';
              hintSpan.textContent = ' — ' + item.hint;
              line.appendChild(hintSpan);
            }
            subRefs.appendChild(line);
          }
          subDiv.appendChild(subRefs);

          // Vides on sub-subject
          if (ch.vides && ch.vides.length > 0) {
            subDiv.appendChild(renderVides(ch.vides));
          }

          div.appendChild(subDiv);
        }
      }

      $indexContent.appendChild(div);
    }
  }

  function renderReferencesIndex(filter) {
    if (!REFERENCIAS_INDEX.length) {
      $indexContent.textContent = 'Nenhuma referência disponível.';
      return;
    }

    // Category buttons
    const catBar = document.createElement('div');
    catBar.className = 'ref-categories';
    REFERENCIAS_INDEX.forEach((cat, idx) => {
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
    const cat = REFERENCIAS_INDEX[currentRefCategory];
    if (!cat) return;

    for (const group of cat.groups) {
      const hasMatch = !filter || group.entries.some(e => {
        const text = e.html.replace(/<[^>]*>/g, '');
        return textMatchesFilter(text, filter);
      });
      if (!hasMatch && !textMatchesFilter(group.title, filter)) continue;

      if (group.title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'ref-group-title';
        titleEl.textContent = group.title;
        $indexContent.appendChild(titleEl);
      }

      for (const entry of group.entries) {
        const entryText = entry.html.replace(/<[^>]*>/g, '');
        if (filter && !textMatchesFilter(entryText, filter) && !textMatchesFilter(group.title, filter)) continue;

        const entryEl = document.createElement('div');
        entryEl.className = 'ref-entry';

        const textSpan = document.createElement('span');
        textSpan.innerHTML = entry.html;
        entryEl.appendChild(textSpan);

        if (entry.art_ref) {
          const linkEl = document.createElement('a');
          linkEl.className = 'ref-art-link';
          linkEl.href = '#';
          linkEl.textContent = ' — Art. ' + entry.art_ref;
          linkEl.addEventListener('click', (e) => {
            e.preventDefault();
            closeIndex();
            // Extract base article number for navigation
            const artNum = entry.art_ref.replace(/[º°ª]/g, '').split(/[,\s]/)[0].trim();
            navigateToArt(artNum, '');
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

  function navigateToArt(artNum, lawPrefix) {
    let card;
    if (lawPrefix) {
      card = $cards.querySelector(`.card-artigo[data-art="${artNum}"][data-law="${lawPrefix}"]`);
    } else {
      card = $cards.querySelector(`.card-artigo[data-art="${artNum}"]:not([data-law])`)
          || $cards.querySelector(`.card-artigo[data-art="${artNum}"]`);
    }
    if (card) {
      scrollToReadingLine(card);
      selectCard(card, true);
    }
    return card;
  }

  // ===== DETAIL HIGHLIGHT =====
  function clearDetailHighlight() {
    $cards.querySelectorAll('.detail-highlight').forEach(el => {
      el.classList.remove('detail-highlight');
    });
  }

  function highlightAllSubjectDetails() {
    clearDetailHighlight();
    if (!activeSubject) return;
    for (const ref of activeSubject.refs) {
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
        card.classList.add('detail-highlight');
      } else if (ref.detail.trim().toLowerCase() === 'caput') {
        // Caput: first <p> that isn't .art-para
        const caput = card.querySelector('p:not(.art-para):not(.old-version)');
        if (caput) caput.classList.add('detail-highlight');
      } else {
        const dt = ref.detail.trim();
        let found = false;
        for (const uid of card.querySelectorAll('.unit-id')) {
          const path = uid.dataset.path || '';
          const ut = uid.textContent.trim();
          if (path === dt || ut === dt || (dt === '§ú' && ut === 'Parágrafo único')) {
            const p = uid.closest('p');
            if (p) p.classList.add('detail-highlight');
            found = true;
            break;
          }
        }
      }
    }
  }

  // ===== SUBJECT PILL =====
  function openSubjectPill(entry) {
    activeSubject = entry;
    subjectIdx = 0;
    subjectFilter = true;
    $pillFilter.classList.add('active');
    $subjectPill.classList.add('open');
    document.body.classList.add('pill-open');
    $pillLabel.textContent = entry.subject;
    if (searchFilter) {
      searchFilter = false;
      $btnFilter.classList.remove('active');
    }
    doSearch($searchInput.value.trim());
    updatePill();
    applySubjectFilter();
    highlightAllSubjectDetails();
    navigateToSubjectRef(0);
    scheduleMinimap();
  }

  function closeSubjectPill() {
    activeSubject = null;
    $subjectPill.classList.remove('open');
    document.body.classList.remove('pill-open');
    $pillDropdown.classList.remove('open');
    clearDetailHighlight();
    preserveScroll(() => {
      getAllCards().forEach(c => c.classList.remove('filtered-out'));
      if (currentSearch) doSearch(currentSearch);
    });
    scheduleMinimap();
  }

  function updatePill() {
    if (!activeSubject) return;
    const ref = activeSubject.refs[subjectIdx];
    const prefix = ref.law_prefix ? ref.law_prefix + ':' : '';
    $pillCurrent.textContent = prefix + 'Art. ' + ref.art + (ref.detail ? ', ' + ref.detail : '');
  }

  function findRefTarget(ref) {
    // Returns the most specific DOM element for a ref (card, caput <p>, or detail <p>)
    let card;
    if (ref.law_prefix) {
      card = $cards.querySelector(`.card-artigo[data-art="${ref.art}"][data-law="${ref.law_prefix}"]`);
    } else {
      card = $cards.querySelector(`.card-artigo[data-art="${ref.art}"]:not([data-law])`)
          || $cards.querySelector(`.card-artigo[data-art="${ref.art}"]`);
    }
    if (!card) return null;
    if (!ref.detail) return card;
    const dt = ref.detail.trim();
    if (dt.toLowerCase() === 'caput') {
      return card.querySelector('p:not(.art-para):not(.old-version)') || card;
    }
    for (const uid of card.querySelectorAll('.unit-id')) {
      const path = uid.dataset.path || '';
      const ut = uid.textContent.trim();
      if (path === dt || ut === dt || (dt === '§ú' && ut === 'Parágrafo único')) {
        return uid.closest('p') || card;
      }
    }
    return card;
  }

  function navigateToSubjectRef(idx) {
    if (!activeSubject) return;
    subjectIdx = idx;
    updatePill();
    const ref = activeSubject.refs[idx];
    const target = findRefTarget(ref);
    if (!target) return;
    const card = target.closest('.card') || target;
    scrollToReadingLine(target);
    selectCard(card, true);
  }

  function applySubjectFilter() {
    if (!activeSubject) return;
    const cards = getAllCards();
    if (subjectFilter) {
      // Build set of "lawPrefix:art" keys for precise matching
      const refKeys = new Set(activeSubject.refs.map(r => (r.law_prefix || '') + ':' + r.art));
      for (const card of cards) {
        if (card.classList.contains('card-titulo')) {
          card.classList.add('filtered-out');
        } else if (card.dataset.art) {
          const cardKey = (card.dataset.law || '') + ':' + card.dataset.art;
          if (!refKeys.has(cardKey)) {
            card.classList.add('filtered-out');
          } else {
            card.classList.remove('filtered-out');
          }
        } else {
          card.classList.remove('filtered-out');
        }
      }
      showContextHeadings();
    } else {
      cards.forEach(c => c.classList.remove('filtered-out'));
    }
  }

  document.getElementById('pill-prev').addEventListener('click', () => {
    if (!activeSubject) return;
    subjectIdx = (subjectIdx - 1 + activeSubject.refs.length) % activeSubject.refs.length;
    navigateToSubjectRef(subjectIdx);
  });

  document.getElementById('pill-next').addEventListener('click', () => {
    if (!activeSubject) return;
    subjectIdx = (subjectIdx + 1) % activeSubject.refs.length;
    navigateToSubjectRef(subjectIdx);
  });

  $pillCurrent.addEventListener('click', (e) => {
    e.stopPropagation();
    $pillDropdown.classList.toggle('open');
    renderPillDropdown();
  });

  function renderPillDropdown() {
    if (!activeSubject) return;
    $pillDropdown.innerHTML = '';
    activeSubject.refs.forEach((ref, idx) => {
      const btn = document.createElement('button');
      btn.className = 'pill-dd-item' + (idx === subjectIdx ? ' current' : '');
      const prefix = ref.law_prefix ? ref.law_prefix + ':' : '';
      btn.textContent = prefix + 'Art. ' + ref.art + (ref.detail ? ', ' + ref.detail : '');
      btn.addEventListener('click', () => {
        $pillDropdown.classList.remove('open');
        navigateToSubjectRef(idx);
      });
      $pillDropdown.appendChild(btn);
    });
  }

  $pillFilter.addEventListener('click', () => {
    subjectFilter = !subjectFilter;
    $pillFilter.classList.toggle('active', subjectFilter);
    preserveScroll(() => {
      applySubjectFilter();
      highlightAllSubjectDetails();
      if (currentSearch) doSearch(currentSearch);
    });
    scheduleMinimap();
  });

  document.getElementById('pill-close').addEventListener('click', closeSubjectPill);

  document.addEventListener('click', (e) => {
    if (!$pillDropdown.contains(e.target) && e.target !== $pillCurrent) {
      $pillDropdown.classList.remove('open');
    }
  });

  // ===== PINCH-TO-ZOOM =====
  let initialPinchDist = null;
  let initialZoom = 1;

  function setZoom(scale) {
    preserveScroll(() => {
      zoomScale = Math.max(0.4, Math.min(2.5, scale));
      document.documentElement.style.setProperty('--zoom-scale', zoomScale);
    });

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
    $cards.classList.toggle('compact', compactMode);
    $btnCompact.classList.toggle('active', compactMode);
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
      window.scrollTo({ top: Math.max(0, target), behavior: 'instant' });
    }
    updateBreadcrumb();
    if (searchMatches.length) updateSearchTicks();
    scheduleMinimap();
    try { localStorage.setItem('regimento-compact', compactMode ? '1' : '0'); } catch (e) {}
  }

  $btnCompact.addEventListener('click', () => setCompactMode(!compactMode));

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
      if (card.classList.contains('nivel-norma'))    return '#222';
      if (card.classList.contains('nivel-titulo'))   return '#b71c1c';
      if (card.classList.contains('nivel-capitulo')) return '#f57c00';
      if (card.classList.contains('nivel-secao'))    return '#fdd835';
      if (card.classList.contains('nivel-subsecao')) return '#2e7d32';
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

    for (const card of cards) {
      if (card.classList.contains('filtered-out')) continue;
      const y = card.offsetTop * scale;
      const ch = Math.max(1, card.offsetHeight * scale);
      const color = getMinimapColor(card);
      ctx.fillStyle = color;
      ctx.fillRect(pad, y, barW, ch);

      headings.push({ y, h: ch, card });
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
        const prefix = (lawPrefix ? lawPrefix + ' ' : '') + 'Art. ' + artNum;
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

  // Resize → rebuild minimap
  window.addEventListener('resize', () => {
    scheduleMinimap();
  });

  // ===== INIT =====
  try {
    const savedZoom = localStorage.getItem('regimento-zoom');
    if (savedZoom) setZoom(parseFloat(savedZoom));
  } catch (e) {}
  try {
    if (localStorage.getItem('regimento-compact') === '1') setCompactMode(true);
  } catch (e) {}
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
