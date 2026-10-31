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
  // On a slow network the bar shows seconds before the script runs: what
  // was typed meanwhile is searched now
  if ($searchInput.value.trim()) $searchInput.dispatchEvent(new Event('input'));

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

  // The systematic index's tree too, so the panel's first opening doesn't pay
  // for it; and the lists of the other two tabs, so their first one doesn't
  whenIdle(() => sysTreeBuild());
  whenIdle(() => warmIndexTab('references'));
  whenIdle(() => warmIndexTab('subject'));

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
