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

