  // ===== INIT =====
  try {
    const savedZoom = localStorage.getItem('regimento-zoom');
    if (savedZoom) setZoom(parseFloat(savedZoom), 'load');
  } catch (e) {}
  try {
    if (localStorage.getItem('regimento-compact') === '1') setCompactMode(true, 'load');
  } catch (e) {}
  try {
    idxOpen = localStorage.getItem('regimento-indice-aberto') === '1';
    $cards.classList.toggle('idx-open', idxOpen);
  } catch (e) {}
  // The index bands kept open: their tables once the remissivo comes
  if (idxOpen) {
    for (const b of $cards.querySelectorAll('.idx-sum')) b.setAttribute('aria-expanded', 'true');
    if (!fillIndexBands()) whenIndexBandsFilled();
  }
  // Read before anything waits (below): a marker set meanwhile would save
  // the list without the ones kept
  loadMarkers();
  if (window.innerWidth > 768) $searchInput.focus();

  // The rest in turns, the browser free between them to draw and answer (a
  // slow phone: its longest task 1.5 → 0.8 s). A tap on ☰ meanwhile is
  // still the header's (base.html; the panel's own listener leaves it alone
  // while window.earlyIndex is there): handed over at the end
  const pause = () => window.scheduler && scheduler.yield ? scheduler.yield() : new Promise(r => setTimeout(r, 0));
  (async () => {
    // (the saved zoom and compact mode above leave it to here)
    estimateCardHeights();
    await pause();
    applyMarkers();
    renderMarkerNav();
    await pause();
    updateSelection();
    updateBreadcrumb();
    await pause();
    initDiffToggles();
    scheduleMinimap();
    // On a slow network the bar shows seconds before the script runs: what
    // was typed meanwhile is searched now
    if ($searchInput.value.trim()) $searchInput.dispatchEvent(new Event('input'));
    // ...and ☰ tapped meanwhile (base.html) opens the index now
    if (window.earlyIndex) {
      $btnIndex.removeEventListener('click', window.earlyIndex);
      $btnIndex.classList.remove('pending');
      if (window.earlyIndex.asked) {
        if (firstOpen) firstOpen.tap = window.earlyIndex.asked;
        openIndex();
      }
      delete window.earlyIndex;
    }
  })();

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
    $layers.appendChild(warm);
    void warm.offsetHeight;
    warm.remove();
  });

  // The systematic index's tree too, so the panel's first opening doesn't pay
  // for it. (Not the lists of the other two tabs: seconds of work on a phone,
  // just when a first tap on ☰ is likely, which would wait for it unanswered;
  // they are built once the panel has been opened and closed: setPanelOpen)
  whenIdle(() => sysTreeBuild());

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
