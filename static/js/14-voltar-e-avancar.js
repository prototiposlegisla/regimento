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
    setPanelOpen(true);
    $indexContent.scrollTop = p.top;
  }

