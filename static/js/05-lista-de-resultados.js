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

