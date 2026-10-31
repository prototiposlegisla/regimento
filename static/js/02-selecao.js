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

