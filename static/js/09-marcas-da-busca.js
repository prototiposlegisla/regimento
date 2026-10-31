  // ===== SEARCH TICK TOOLTIP HELPERS =====
  // Text node as HTML, with search highlights (highlight API) as <mark>
  function textWithMarks(textNode) {
    const text = textNode.textContent;
    const spans = textNodeHits.get(textNode);
    if (!spans) return escapeHtml(text);
    let html = '';
    let last = 0;
    for (const [start, end] of spans) {
      html += escapeHtml(text.slice(last, start)) + '<mark>' + escapeHtml(text.slice(start, end)) + '</mark>';
      last = end;
    }
    return html + escapeHtml(text.slice(last));
  }

  // A clone doesn't carry the StaticRange highlights of the original: turn
  // them into <mark>s (same structure, so the text nodes pair up)
  function markHighlightsInClone(original, clone) {
    if (!textNodeHits.size) return;
    const originals = document.createTreeWalker(original, NodeFilter.SHOW_TEXT);
    const copies = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    const pairs = [];
    while (originals.nextNode() && copies.nextNode()) {
      if (textNodeHits.has(originals.currentNode)) pairs.push([originals.currentNode, copies.currentNode]);
    }
    for (const [textNode, copy] of pairs) {
      const tpl = document.createElement('template');
      tpl.innerHTML = textWithMarks(textNode);
      copy.parentNode.replaceChild(tpl.content, copy);
    }
  }

  function extractTextWithMarks(node) {
    let html = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        html += textWithMarks(child);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.tagName === 'MARK' && !child.classList.contains('weak')) {
          html += '<mark>' + escapeHtml(child.textContent) + '</mark>';
        } else if (child.classList.contains('indent-path') || child.classList.contains('unit-id')) {
          continue;
        } else {
          html += extractTextWithMarks(child);
        }
      }
    }
    return html;
  }

  // Nearest preceding heading card of each level, in DOM order. Depends only
  // on the (static) card order, so it's computed once per card. Callers must
  // not mutate the returned array.
  const ancestorHeadingsCache = new Map();

  function collectAncestorHeadings(card) {
    const cached = ancestorHeadingsCache.get(card);
    if (cached) return cached;
    const levelOrder = ['norma', 'tit', 'cap', 'sec', 'subsec'];
    // Only headings above the ones already found: once a title is found, the
    // chapters and sections before it belong to the previous title
    let minIdx = levelOrder.length;
    const ancestors = [];
    let prev = card.previousElementSibling;
    while (prev && minIdx > 0) {
      if (prev.classList.contains('card-titulo')) {
        const level = headingLevel(prev);
        const idx = levelOrder.indexOf(level);
        if (idx >= 0 && idx < minIdx) {
          minIdx = idx;
          ancestors.push({ el: prev, level });
        }
      }
      prev = prev.previousElementSibling;
    }
    ancestors.reverse();
    ancestorHeadingsCache.set(card, ancestors);
    return ancestors;
  }

  function buildSearchTickTooltip(card) {
    $searchTickTooltip.innerHTML = '';
    if (!card) return;

    // --- Part 1: Breadcrumb chips (heading ancestors + article) ---
    const ancestors = collectAncestorHeadings(card);
    for (const a of ancestors) {
      const chip = document.createElement('div');
      chip.className = 'mm-chip';
      const c = MINIMAP_COLORS[a.level];
      chip.style.background = c.bg;
      chip.style.color = c.text;
      chip.textContent = getHeadingShortTitle(a.el);
      $searchTickTooltip.appendChild(chip);
    }

    // Article chip
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
      chip.textContent = summary ? prefix + ' \u2014 ' + summary : prefix;
      $searchTickTooltip.appendChild(chip);
    }

    // --- Part 2: Match unit chips ---
    const hits = getCardHits(card);
    if (!hits.length) return;

    // Collect unique matched paragraphs
    const matchedPaths = [];
    const seenPaths = new Set();
    for (const hit of hits) {
      const m = hitElement(hit);
      // Skip marks inside footnotes
      if (m.closest('.footnote-box')) continue;
      const oldVer = m.closest('.old-version');
      const p = m.closest('.art-para') || m.closest('p');
      if (!p) continue;
      // Use element identity for old-version (no data-path), path string otherwise
      const uid = p.querySelector('.unit-id');
      const key = oldVer ? 'old:' + (p.dataset.ident || '') + ':' + p.textContent.slice(0, 40) : (uid ? (uid.dataset.path || '') : '');
      if (p.classList.contains('prec-para')) {
        // a precedent's running text: each paragraph is its own target
        if (!seenPaths.has(p)) { seenPaths.add(p); matchedPaths.push({ path: '', p, isOld: false, prec: true }); }
        continue;
      }
      if (!seenPaths.has(key)) {
        seenPaths.add(key);
        matchedPaths.push({ path: uid ? (uid.dataset.path || '') : '', p, isOld: !!oldVer });
      }
    }

    if (!matchedPaths.length) return;

    // Sort by depth (caput first)
    matchedPaths.sort((a, b) => {
      const da = a.path ? a.path.split(',').length : 0;
      const db = b.path ? b.path.split(',').length : 0;
      return da - db;
    });

    // Divider between breadcrumb and match chips
    const divider = document.createElement('div');
    divider.className = 'stt-divider';
    $searchTickTooltip.appendChild(divider);

    // Build chain of ancestor + target chips, deduplicating
    const renderedPaths = new Set();

    for (const { path, p, isOld, prec } of matchedPaths) {
      if (prec) {
        const chip = document.createElement('div');
        chip.className = 'mtt-chip mtt-target';
        chip.innerHTML = extractTextWithMarks(p);
        $searchTickTooltip.appendChild(chip);
        continue;
      }
      // Old-version paragraphs: show caput ancestor, then strikethrough chip
      if (isOld) {
        // Render caput as ancestor if not already shown
        if (!renderedPaths.has('')) {
          renderedPaths.add('');
          const caputP = card.querySelector(':scope > p:not(.old-version)');
          if (caputP) {
            const caputChip = document.createElement('div');
            caputChip.className = 'mtt-chip';
            const uidSpan = caputP.querySelector('.unit-id');
            const clone = caputP.cloneNode(true);
            clone.querySelectorAll('.indent-path').forEach(el => el.remove());
            clone.querySelectorAll('.unit-id').forEach(el => el.remove());
            const caputLabel = uidSpan ? uidSpan.textContent : '';
            const caputRest = clone.textContent.trim();
            if (caputLabel) {
              caputChip.innerHTML = '<b>' + escapeHtml(caputLabel) + '</b> ' + escapeHtml(caputRest);
            } else {
              caputChip.textContent = caputRest;
            }
            $searchTickTooltip.appendChild(caputChip);
          }
        }
        const chip = document.createElement('div');
        chip.className = 'mtt-chip mtt-target mtt-old';
        const rawHtml = extractTextWithMarks(p);
        // Try to split label (e.g. "Art. 38 -") from rest
        const text = p.textContent.trim();
        const dashIdx = text.indexOf(' - ');
        if (dashIdx >= 0 && dashIdx < 40) {
          const label = text.slice(0, dashIdx);
          chip.innerHTML = '<b>' + escapeHtml(label) + '</b>' + rawHtml.slice(rawHtml.indexOf(escapeHtml(label)) + escapeHtml(label).length);
        } else {
          chip.innerHTML = rawHtml;
        }
        $searchTickTooltip.appendChild(chip);
        continue;
      }

      const parts = path ? path.split(',') : [];
      const chain = [''];
      for (let i = 0; i < parts.length; i++) {
        chain.push(parts.slice(0, i + 1).join(','));
      }

      for (let i = 0; i < chain.length; i++) {
        const segPath = chain[i];
        if (renderedPaths.has(segPath)) continue;
        renderedPaths.add(segPath);

        const isTarget = segPath === path;
        let segP;
        if (segPath === '') {
          segP = card.querySelector(':scope > p:not(.old-version)');
        } else {
          const seg = card.querySelector('.unit-id[data-path="' + segPath + '"]');
          if (seg) segP = seg.closest('.art-para') || seg.parentElement;
        }
        if (!segP) continue;

        const chip = document.createElement('div');
        chip.className = 'mtt-chip' + (isTarget ? ' mtt-target' : '');

        if (isTarget) {
          // Label comes from .unit-id; rest from extractTextWithMarks (which skips .unit-id)
          const uidSpan = segP.querySelector('.unit-id');
          const label = uidSpan ? uidSpan.textContent : '';
          const rawHtml = extractTextWithMarks(segP);
          if (label) {
            chip.innerHTML = '<b>' + escapeHtml(label) + '</b>' + rawHtml;
          } else {
            chip.innerHTML = rawHtml;
          }
        } else {
          // Plain text for ancestor segments
          const clone = segP.cloneNode(true);
          clone.querySelectorAll('.indent-path').forEach(el => el.remove());
          const text = clone.textContent.trim();
          let label = '', rest = text;
          const dashIdx = text.indexOf('\u00a0\u2014');
          const dashIdx2 = text.indexOf(' \u2014');
          const splitIdx = dashIdx >= 0 ? dashIdx : dashIdx2;
          if (splitIdx >= 0 && splitIdx < 40) {
            label = text.slice(0, splitIdx);
            rest = text.slice(splitIdx);
          }
          if (label) {
            chip.innerHTML = '<b>' + escapeHtml(label) + '</b>' + escapeHtml(rest);
          } else {
            chip.textContent = rest;
          }
        }

        $searchTickTooltip.appendChild(chip);
      }
    }
  }

  function showMarkerTooltip(btn, uid, palette) {
    if (!buildMarkerTooltip(uid, palette)) return;
    $markerTooltip.classList.add('visible');
    // Position to the left of the button, vertically centered
    const br = btn.getBoundingClientRect();
    const tr = $markerTooltip.getBoundingClientRect();
    let left = br.left - tr.width - 8;
    let top = br.top + br.height / 2 - tr.height / 2;
    // Clamp to viewport
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    if (top + tr.height > window.innerHeight - 4) {
      top = window.innerHeight - 4 - tr.height;
    }
    $markerTooltip.style.left = left + 'px';
    $markerTooltip.style.top = top + 'px';
  }

  function hideMarkerTooltip() {
    $markerTooltip.classList.remove('visible');
    $markerTooltip.innerHTML = '';
    if (markerTooltipTimer) {
      clearTimeout(markerTooltipTimer);
      markerTooltipTimer = null;
    }
  }

  $cards.addEventListener('click', (e) => {
    const unitId = e.target.closest('.unit-id');
    if (unitId) {
      e.stopPropagation();
      toggleMarker(unitId.dataset.uid);
      return;
    }
    // Compact mode: tap on article label to toggle marker on caput
    const compactLabel = e.target.closest('.art-compact-label');
    if (compactLabel && compactMode) {
      e.stopPropagation();
      const card = compactLabel.closest('.card-artigo');
      if (card) {
        const firstUid = card.querySelector('.unit-id');
        if (firstUid) toggleMarker(firstUid.dataset.uid);
      }
      return;
    }
  });

