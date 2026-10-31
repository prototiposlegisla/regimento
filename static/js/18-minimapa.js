  // ===== MINIMAP =====
  let minimapRafId = null;
  let minimapHeadings = []; // { y, h, color, textColor, label } for tooltip on hover

  function getMinimapColor(card) {
    if (card.classList.contains('card-titulo')) {
      if (card.classList.contains('nivel-norma'))    return MINIMAP_COLORS.norma.bg;
      if (card.classList.contains('nivel-titulo'))   return MINIMAP_COLORS.tit.bg;
      if (card.classList.contains('nivel-capitulo')) return MINIMAP_COLORS.cap.bg;
      if (card.classList.contains('nivel-secao'))    return MINIMAP_COLORS.sec.bg;
      if (card.classList.contains('nivel-subsecao')) return MINIMAP_COLORS.subsec.bg;
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

    // Headings at least 2 px and drawn last: a heading is far shorter than a
    // pixel here, and the article right after it would paint over it
    const titles = [];
    for (const card of cards) {
      if (card.classList.contains('filtered-out')) continue;
      const y = card.offsetTop * scale;
      const isTitle = card.classList.contains('card-titulo');
      const ch = Math.max(isTitle ? 2 : 1, card.offsetHeight * scale);
      if (isTitle) titles.push([y, ch, card]);
      else {
        ctx.fillStyle = getMinimapColor(card);
        ctx.fillRect(pad, y, barW, ch);
      }
      headings.push({ y, h: ch, card });
    }
    for (const [y, ch, card] of titles) {
      ctx.fillStyle = getMinimapColor(card);
      ctx.fillRect(pad, y, barW, ch);
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
        const prefix = cardRefLabel(card);
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

  // Resize → rebuild minimap (and re-estimate card heights for the new width)
  let estimatedWidth = $cards.clientWidth;
  window.addEventListener('resize', () => {
    if ($cards.clientWidth !== estimatedWidth) {
      estimatedWidth = $cards.clientWidth;
      preserveScroll(estimateCardHeights);
      forgetCardHeights();
    }
    scheduleMinimap();
  });

  // Cards drawn for the first time replace their estimate with the real
  // height: redraw the minimap once they stop changing (not per scroll stop,
  // as programmatic scrolls end every frame)
  let minimapStaleTimer;
  $cards.addEventListener('contentvisibilityautostatechange', e => {
    if (e.target.classList.contains('card')) {
      if (e.skipped) cardsShown.delete(e.target);
      else cardsShown.add(e.target), cardsDrawn.add(e.target);
    }
    clearTimeout(minimapStaleTimer);
    minimapStaleTimer = setTimeout(scheduleMinimap, 500);
  }, true);

