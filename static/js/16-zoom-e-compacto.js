  // ===== PINCH-TO-ZOOM =====
  let initialPinchDist = null;
  let initialZoom = 1;

  function setZoom(scale, now) {
    // a saved value gone bad, or a pinch with both fingers on one point,
    // would make every size NaN (the text 0 px, until the site's data is cleared)
    if (!Number.isFinite(scale) || scale <= 0) return;
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

  // Only the pinch's touchmove blocks (it keeps the browser from zooming
  // the page itself); its start does not need to
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialPinchDist = Math.hypot(dx, dy) || null;
      initialZoom = zoomScale;
    }
  }, { passive: true });

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
  }, { passive: true });

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
    if (on) fillIndexBands();
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

