  // ===== MARKERS (click-on-identifier system) =====
  // Read back as saved, keeping only well-formed markers (a list edited or
  // left broken would stop the load, or put a quote into a selector)
  function loadMarkers() {
    try {
      const saved = JSON.parse(localStorage.getItem('regimento-markers-v2') || '[]');
      if (!Array.isArray(saved)) return;
      const seen = new Set();
      markersList = saved.filter(m => m && typeof m.uid === 'string' && /^[\w.-]+$/.test(m.uid)
        && Number.isInteger(m.colorIdx) && m.colorIdx >= 0 && m.colorIdx < MARKER_PALETTE.length
        && !seen.has(m.uid) && seen.add(m.uid)).map(m => ({ uid: m.uid, colorIdx: m.colorIdx }));
    } catch (e) {}
  }

  // A browser that refuses to store (full, private mode, a policy) still
  // marks: only for this visit
  function saveMarkers() {
    try { localStorage.setItem('regimento-markers-v2', JSON.stringify(markersList)); } catch (e) {}
  }

  function getNextColorIdx() {
    const used = new Set(markersList.map(m => m.colorIdx));
    for (let i = 0; i < MARKER_PALETTE.length; i++) {
      if (!used.has(i)) return i;
    }
    return markersList.length % MARKER_PALETTE.length;
  }

  function findMarker(uid) {
    return markersList.find(m => m.uid === uid);
  }

  function toggleMarker(uid) {
    const existing = findMarker(uid);
    if (existing) {
      markersList = markersList.filter(m => m.uid !== uid);
    } else {
      markersList.push({ uid, colorIdx: getNextColorIdx() });
    }
    saveMarkers();
    applyMarkers();
    // In the bar, the marked articles follow (the last one unmarked, it goes)
    if (scope && scope.kind === 'markers') {
      if (markersList.length === 0) closeScope();
      else markScopeUnits();
      preserveScroll(() => doSearch(currentSearch));
    }
    renderMarkerNav();
  }

  function clearAllMarkers() {
    markersList = [];
    saveMarkers();
    applyMarkers();
    if (scope && scope.kind === 'markers') {
      closeScope();
      preserveScroll(() => doSearch(currentSearch));
    }
    renderMarkerNav();
  }

  // The funnel of the markers: the marked articles in the search bar, or out of it
  function toggleMarkersScope() {
    if (scope && scope.kind === 'markers') removeScope();
    else openScope({ kind: 'markers', label: 'Marcados' });
  }

  function applyMarkers() {
    $cards.querySelectorAll('.unit-id').forEach(el => {
      el.style.backgroundColor = '';
      el.style.color = '';
    });
    $cards.querySelectorAll('.art-compact-label').forEach(el => {
      el.style.backgroundColor = '';
      el.style.color = '';
    });

    for (const marker of markersList) {
      const el = $cards.querySelector(`.unit-id[data-uid="${marker.uid}"]`);
      if (!el) continue;
      const palette = MARKER_PALETTE[marker.colorIdx];
      el.style.backgroundColor = palette.bg;
      el.style.color = palette.text;
      // Also color the compact label if this is the caput (first unit-id in the card)
      const card = el.closest('.card-artigo');
      if (card && card.querySelector('.unit-id') === el) {
        const compactLabel = card.querySelector('.art-compact-label');
        if (compactLabel) {
          compactLabel.style.backgroundColor = palette.bg;
          compactLabel.style.color = palette.text;
        }
      }
    }
  }

  function renderMarkerNav() {
    hideMarkerTooltip();
    $markerNav.innerHTML = '';

    for (const marker of markersList) {
      const palette = MARKER_PALETTE[marker.colorIdx];
      const el = $cards.querySelector(`.unit-id[data-uid="${marker.uid}"]`);
      let label = el ? el.textContent.trim() : marker.uid;
      if (el) {
        const card = el.closest('.card-artigo');
        if (card && isPrecCard(card)) {
          label = 'Prec.' + card.dataset.art;
        } else if (card) {
          const lawPrefix = card.dataset.law;
          const pre = lawPrefix ? lawPrefix + ':' : '';
          if (el.dataset.path) {
            // Use hierarchical path: "I,b,2" → "13,I,b,2"
            label = pre + 'Art.' + card.dataset.art + ',' + el.dataset.path;
          } else if (!label.startsWith('Art.')) {
            // Sub-units without path: prepend article number
            label = pre + 'Art.' + card.dataset.art + ',' + label;
          } else if (lawPrefix) {
            // Caput of other laws: prepend law prefix
            label = lawPrefix + ':' + label;
          }
        }
      }
      // Compact label: remove Art., º, spaces, abbreviate Parágrafo único → §ú
      label = label.replace(/Parágrafo único/gi, '§ú');
      label = label.replace(/Art\.\s*/g, '');
      label = label.replace(/\u00ba/g, '').replace(/\s+/g, '');

      const btn = document.createElement('button');
      btn.className = 'marker-btn';
      btn.style.background = palette.bg;
      btn.style.color = palette.text;
      btn.textContent = label;
      btn.title = 'Ir para ' + label;
      btn.addEventListener('click', () => {
        hideMarkerTooltip();
        const target = $cards.querySelector(`.unit-id[data-uid="${marker.uid}"]`);
        if (target) {
          const card = target.closest('.card');
          if (card) {
            scrollToReadingLine(target);
            selectCard(card, true);
          }
        }
      });
      // Tooltip listeners
      ((uid, pal) => {
        btn.addEventListener('mouseenter', () => showMarkerTooltip(btn, uid, pal));
        btn.addEventListener('mouseleave', () => hideMarkerTooltip());
        // passive: a touch never waits for the script to start scrolling
        btn.addEventListener('touchstart', () => {
          markerTooltipTimer = setTimeout(() => showMarkerTooltip(btn, uid, pal), 500);
        }, { passive: true });
        btn.addEventListener('touchend', () => hideMarkerTooltip(), { passive: true });
        btn.addEventListener('touchmove', () => hideMarkerTooltip(), { passive: true });
      })(marker.uid, palette);
      $markerNav.appendChild(btn);
    }

    if (markersList.length > 0) {
      const filterBtn = document.createElement('button');
      filterBtn.id = 'marker-filter-btn';
      const inBar = scope !== null && scope.kind === 'markers';
      filterBtn.className = inBar ? 'visible active' : 'visible';
      filterBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 1h14L10 7v5l-4 2V7z"/></svg>';
      filterBtn.title = inBar ? 'Tirar os marcados da busca' : 'Buscar nos artigos marcados';
      filterBtn.addEventListener('click', toggleMarkersScope);
      $markerNav.appendChild(filterBtn);

      const copyBtn = document.createElement('button');
      copyBtn.id = 'marker-copy-btn';
      copyBtn.className = 'visible';
      copyBtn.innerHTML = COPY_ICON;
      copyBtn.title = 'Copiar o texto dos dispositivos marcados';
      copyBtn.addEventListener('click', () => copyMarkedText(copyBtn));
      $markerNav.appendChild(copyBtn);

      const clearBtn = document.createElement('button');
      clearBtn.id = 'marker-clear-all';
      clearBtn.className = 'visible';
      clearBtn.innerHTML = '&times;';
      clearBtn.title = 'Remover todos os marcadores';
      clearBtn.addEventListener('click', clearAllMarkers);
      $markerNav.appendChild(clearBtn);
    }
  }

  // ===== COPY THE MARKED PROVISIONS =====
  // The text of the marked provisions, ready to paste in a working text: first the
  // citation ("conforme disposto nos arts. 6º, II e 13, II, c, do Regimento Interno:"), then,
  // per article, in the page's order: the marked provisions whole; the ones above
  // them (the article, the inciso of an alínea) by their identifier alone; "[...]"
  // on a line of its own where provisions are left out. A marked provision with
  // nothing marked under it comes with all of its own (the caput alone: the whole
  // article), as when it's cited.
  const COPY_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">'
    + '<rect x="5.5" y="5.5" width="8.5" height="9" rx="1.5"/><path d="M10.5 3.5V3a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3v6.5A1.5 1.5 0 0 0 3.5 11H4"/></svg>';
  const COPIED_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.5 8.5l3.5 3.5 7.5-8"/></svg>';
  // each norm's name, and its "of" ("do Regimento Interno")
  const COPY_LAWS = {
    RI: ['Regimento Interno', 'do'], ADT: ['Ato das Disposições Transitórias do Regimento Interno', 'do'],
    LOM: ['Lei Orgânica do Município', 'da'], CE: ['Constituição do Estado de São Paulo', 'da'],
    CF: ['Constituição Federal', 'da'],
  };
  // "a", "a e b", "a, b e c"; "a e b, e c" when an item before the last has its own "e"
  const joinE = items => items.length < 2 ? items.join('')
    : items.slice(0, -1).join(', ') + (items.slice(0, -1).some(x => x.includes(' e ')) ? ', e ' : ' e ')
      + items[items.length - 1];

  function copyMarkedText(btn) {
    const uids = new Set(markersList.map(m => m.uid));
    const cards = [];
    for (const uid of uids) {
      const el = $cards.querySelector(`.unit-id[data-uid="${uid}"]`);
      const card = el && el.closest('.card-artigo');
      if (card && !cards.includes(card)) cards.push(card);
    }
    cards.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const lawOf = card => card.dataset.law || (card.dataset.art.startsWith('ADT') ? 'ADT' : 'RI');
    // more than one norm: each one's name before its articles
    const named = new Set(cards.map(lawOf).filter(l => COPY_LAWS[l])).size > 1;
    const lines = [];
    const groups = [];   // the citation's: { law, cites }, a norm at a time
    let law = null;
    for (const card of cards) {
      const l = lawOf(card);
      // a blank line between the norms, and around each precedent
      if (lines.length && ((l !== law && named) || isPrecCard(card) || law === 'PREC')) lines.push('');
      if (l !== law && named && COPY_LAWS[l]) lines.push(COPY_LAWS[l][0]);
      if (l !== law) groups.push({ law: l, cites: [] });
      law = l;
      lines.push(...copyCardLines(card, uids));
      groups[groups.length - 1].cites.push(isPrecCard(card) ? precLabel(card.dataset.art) : copyCitation(card, uids));
    }
    if (lines.length) lines.unshift('conforme disposto ' + joinE(groups.map(g => {
      const many = g.cites.length > 1;
      if (g.law === 'PREC') return (many ? 'nos Precedentes Regimentais ' : 'no Precedente Regimental ') + joinE(g.cites);
      const [name, of] = COPY_LAWS[g.law];
      // "art. 6º do", "art. 6º, II, do"
      const comma = g.cites[g.cites.length - 1].includes(',') ? ', ' : ' ';
      return (many ? 'nos arts. ' : 'no art. ') + joinE(g.cites) + comma + of + ' ' + name;
    })) + ':');
    if (!lines.length) return;
    copyToClipboard(lines.join('\n')).then(ok => {
      btn.innerHTML = ok ? COPIED_ICON : COPY_ICON;
      btn.title = ok ? 'Copiado' : 'Não foi possível copiar';
      btn.classList.toggle('copied', ok);
      setTimeout(() => {
        btn.innerHTML = COPY_ICON;
        btn.title = 'Copiar o texto dos dispositivos marcados';
        btn.classList.remove('copied');
      }, 1600);
    });
  }

  // An article as cited: "6º" (the whole), "13, II, c", "13, I, a e b, e II, c",
  // "25, caput e parágrafo único": the provisions grouped by what's above them
  function copyCitation(card, uids) {
    const ids = [...card.querySelectorAll(':scope > p:not(.old-version) .unit-id')];
    const num = ids[0].textContent.replace(/\s+/g, ' ').trim().replace(/^Art(igo)?\.?\s*/, '');
    const paths = ids.filter(id => uids.has(id.dataset.uid)).map(id => id.dataset.path || '');
    if (paths.length === 1 && paths[0] === '') return num;
    const root = [];
    for (const path of paths) {
      let level = root;
      for (const seg of path ? path.split(',') : ['caput']) {
        let node = level.find(n => n.seg === seg);
        if (!node) level.push(node = { seg, kids: [] });
        level = node.kids;
      }
    }
    const cite = nodes => joinE(nodes.map(n => (n.seg === '§ú' ? 'parágrafo único' : n.seg)
      + (n.kids.length ? ', ' + cite(n.kids) : '')));
    return num + ', ' + cite(root);
  }

  function copyCardLines(card, uids) {
    const ownText = p => p.querySelector('.unit-id').textContent.replace(/\s+/g, ' ').trim();
    if (isPrecCard(card)) {
      // a precedent comes whole: its title, then its text
      return [...card.querySelectorAll(':scope > p:not(.old-version)')]
        .map(p => p.querySelector('.unit-id') ? ownText(p) : copyUnitText(p));
    }
    const units = [];
    for (const p of card.querySelectorAll(':scope > p:not(.old-version)')) {
      const id = p.querySelector('.unit-id');
      if (id) units.push({ p, path: id.dataset.path || '', marked: uids.has(id.dataset.uid) });
    }
    // b under a: a's path is a prefix of b's ("" = the caput, above all)
    const under = (b, a) => a === '' ? b !== '' : b.startsWith(a + ',');
    const marked = units.filter(u => u.marked);
    const whole = new Set();
    for (const m of marked) {
      const inner = marked.some(o => under(o.path, m.path));
      for (const u of units) if (u === m || (!inner && under(u.path, m.path))) whole.add(u);
    }
    const lines = [];
    let gap = false;
    for (const u of units) {
      const above = !whole.has(u) && [...whole].some(w => under(w.path, u.path));
      if (!whole.has(u) && !above) { gap = true; continue; }
      if (gap && lines.length) lines.push('[...]');
      gap = false;
      const ident = ownText(u.p);
      const text = whole.has(u) ? copyUnitText(u.p) : '';
      lines.push(text ? ident + ' — ' + text : u.path ? ident + ' —' : ident);
    }
    return lines;
  }

  // A provision's text without its identifier, gutter, badges and notes (but a
  // revoked one keeps the note that revoked it)
  function copyUnitText(p) {
    const clone = p.cloneNode(true);
    const revoked = p.querySelector('s') || p.closest('.card').classList.contains('revoked');
    clone.querySelectorAll('.unit-id, .indent-path, .rem-imp, .rem-back, sup.footnote-ref'
      + (revoked ? '' : ', .amendment-note')).forEach(el => el.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim()
      .replace(/^[—–-]\s*/, '').replace(/\s+([.;:,])/g, '$1');
  }

  function copyToClipboard(text) {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      return ok;
    };
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true, fallback);
    }
    return Promise.resolve(fallback());
  }

  // ===== MARKER TOOLTIP =====
  function buildMarkerTooltip(uid, palette) {
    $markerTooltip.innerHTML = '';
    const span = $cards.querySelector(`.unit-id[data-uid="${uid}"]`);
    if (!span) return false;
    const card = span.closest('.card-artigo');
    if (!card) return false;

    // Heading ancestor chips (título, capítulo, seção…)
    const ancestors = collectAncestorHeadings(card);
    for (const a of ancestors) {
      const chip = document.createElement('div');
      chip.className = 'mtt-chip';
      const c = MINIMAP_COLORS[a.level];
      chip.style.background = c.bg;
      chip.style.color = c.text;
      chip.style.borderLeftColor = c.bg;
      chip.textContent = getHeadingShortTitle(a.el);
      $markerTooltip.appendChild(chip);
    }

    const path = span.dataset.path || '';
    // Build ancestor chain: e.g. path "I,a" → ['', 'I', 'I,a']
    const parts = path ? path.split(',') : [];
    const chain = [''];
    for (let i = 0; i < parts.length; i++) {
      chain.push(parts.slice(0, i + 1).join(','));
    }

    for (let i = 0; i < chain.length; i++) {
      const segPath = chain[i];
      let p;
      if (segPath === '') {
        // Caput: first <p> child of card (skip old versions)
        p = card.querySelector(':scope > p:not(.old-version)');
      } else {
        // Find the unit-id with this path, then its parent <p>/<div>
        const seg = card.querySelector(`.unit-id[data-path="${segPath}"]`);
        if (seg) p = seg.closest('.art-para') || seg.parentElement;
      }
      if (!p) continue;

      // Extract clean text: clone, remove .indent-path elements, get textContent
      const clone = p.cloneNode(true);
      clone.querySelectorAll('.indent-path').forEach(el => el.remove());
      let text = clone.textContent.trim();

      // Split label from rest: e.g. "Art. 13 —" or "I —" or "a)"
      let label = '';
      let rest = text;
      const dashIdx = text.indexOf('\u00a0\u2014');
      const dashIdx2 = text.indexOf(' \u2014');
      const splitIdx = dashIdx >= 0 ? dashIdx : dashIdx2;
      if (splitIdx >= 0 && splitIdx < 40) {
        label = text.slice(0, splitIdx);
        rest = text.slice(splitIdx);
      }

      const chip = document.createElement('div');
      chip.className = 'mtt-chip' + (i === chain.length - 1 ? ' mtt-target' : '');
      if (i === chain.length - 1) {
        chip.style.borderLeftColor = palette.bg;
      }
      if (label) {
        chip.innerHTML = '<b>' + escapeHtml(label) + '</b>' + escapeHtml(rest);
      } else {
        chip.textContent = rest;
      }
      $markerTooltip.appendChild(chip);
    }
    return $markerTooltip.children.length > 0;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

