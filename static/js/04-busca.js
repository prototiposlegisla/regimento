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
    // A search still waiting for its delay only runs: it already goes to the
    // first result, and Enter would go past it
    const pending = searchTimer !== null;
    flushPendingSearch();
    if (searchMatches.length) {
      e.preventDefault();
      if (!pending) navigateSearch(e.shiftKey ? -1 : 1);
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

