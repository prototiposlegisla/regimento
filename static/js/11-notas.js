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

  // Mobile: long-press. Passive: a touch on the text never waits for the
  // script to start scrolling
  $cards.addEventListener('touchstart', (e) => {
    const ref = e.target.closest('.footnote-ref');
    if (!ref) return;
    footnoteTooltipTimer = setTimeout(() => showFootnoteTooltip(ref), 500);
  }, { passive: true });
  $cards.addEventListener('touchend', (e) => {
    if (e.target.closest('.footnote-ref')) hideFootnoteTooltip();
  }, { passive: true });
  $cards.addEventListener('touchmove', (e) => {
    if (e.target.closest('.footnote-ref')) hideFootnoteTooltip();
  }, { passive: true });

