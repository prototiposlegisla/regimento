  // ===== INDEX PANEL =====
  let currentIndexTab = 'systematic';

  function openIndex() {
    takeStep('panel');
    // The results drawer (opened by a search, below the header) gives way;
    // the panel links back to it
    if (resultsDrawerOpen) {
      resultsDrawerOpen = false;
      updateResultsVisibility();
    }
    $indexOverlay.classList.add('open');
    setPanelOpen(true);
    sysNorm = -1;
    sysTitle = null;
    renderIndex();
    if (window.innerWidth > 768) $indexSearch.focus();
  }

  // The closed panel stays in the page, off to the side: shut once out of
  // sight (style.css), so Tab and a screen reader don't walk through its
  // thousands of lines. Not inert: turned on and off, it would have them all
  // styled again on each opening, a long pause on a phone; shut, they keep
  // their layout and come back at once
  const PANEL_SLIDE_MS = 450;   // its slide out (style.css: .42s at most)
  let panelShutTimer = null;
  function setPanelOpen(open, now) {
    $indexPanel.classList.toggle('open', open);
    clearTimeout(panelShutTimer);
    if (open || now) $indexPanel.classList.toggle('shut', !open);
    else panelShutTimer = setTimeout(() => $indexPanel.classList.add('shut'), PANEL_SLIDE_MS);
    $btnIndex.setAttribute('aria-expanded', open);
  }

  // Returns whether the focus was in the panel: it goes back to the ☰ that
  // opened it (the caller may then put it on the article it goes to)
  function closeIndex() {
    dropStep('panel');
    const hadFocus = $indexPanel.contains(document.activeElement);
    $indexOverlay.classList.remove('open');
    setPanelOpen(false);
    $sysTip.classList.remove('visible');
    $indexContent.querySelectorAll('.vide-highlight').forEach(el => el.classList.remove('vide-highlight'));
    if (hadFocus) $btnIndex.focus({ preventScroll: true });
    return hadFocus;
  }

  setPanelOpen(false, true);
  $btnIndex.addEventListener('click', () => {
    if ($indexPanel.classList.contains('open')) closeIndex();
    else openIndex();
  });
  $indexOverlay.addEventListener('click', () => {
    closeIndex();
    if (resultsDrawerOpen) closeResults();
  });
  document.getElementById('index-close').addEventListener('click', closeIndex);
  // A finger: a swipe to the left closes it, as a drawer (not one along a
  // strip that scrolls sideways, as the consulta rápida's)
  let swipe = null;
  $indexPanel.addEventListener('touchstart', e => {
    const t = e.touches[0];
    swipe = e.touches.length === 1 && !e.target.closest('.q-toc') ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  $indexPanel.addEventListener('touchend', e => {
    if (!swipe) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
    swipe = null;
    if (dx < -70 && Math.abs(dy) < -dx / 2 && !String(getSelection())) closeIndex();
  }, { passive: true });
  // Esc closes the open layer first, the panel or the results drawer, before
  // clearing the search (as the remissões' previews and boxes do, above)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if ($indexPanel.classList.contains('open')) closeIndex();
    else if (resultsDrawerOpen) closeResults(true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  const $btnInfoTab = document.getElementById('btn-info-tab');
  const $indexSearchWrapper = document.getElementById('index-search-wrapper');

  function setIndexTab(name) {
    document.querySelectorAll('.index-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $btnInfoTab.classList.toggle('active', name === 'info');
    currentIndexTab = name;
    $indexSearchWrapper.style.display = name === 'info' ? 'none' : '';
  }

  // The tab marked and the list it leaves dimmed at once; its own list drawn
  // once that is on the screen: a long one (the first time, on a phone) does
  // not leave the tap unanswered. Another rendering meanwhile cancels it.
  let tabRender = 0;
  function indexTabClick(name) {
    setIndexTab(name);
    $indexPanel.classList.add('loading');
    const mine = ++tabRender;
    requestAnimationFrame(() => setTimeout(() => {
      if (mine !== tabRender) return;
      renderIndex();
      $indexContent.scrollTop = 0;   // (not where the last tab was)
      if (currentIndexTab === 'systematic') syncSystematicToScroll();
    }, 0));
  }
  document.querySelectorAll('.index-tab').forEach(tab => {
    tab.addEventListener('click', () => indexTabClick(tab.dataset.tab));
  });

  $btnInfoTab.addEventListener('click', () => {
    setIndexTab('info');
    renderIndex();
  });

  const $btnClearIndexSearch = document.getElementById('btn-clear-index-search');

  // Filtering the remissivo redoes thousands of entries: wait for a pause in
  // the typing, as the search bar does (a short filter matches almost all)
  let indexFilterTimer = null;
  $indexSearch.addEventListener('input', () => {
    $btnClearIndexSearch.style.display = $indexSearch.value.trim() ? 'flex' : 'none';
    clearTimeout(indexFilterTimer);
    const delay = $indexSearch.value.trim().length <= 3 ? SHORT_TERM_SEARCH_DELAY_MS : SEARCH_DELAY_MS;
    indexFilterTimer = setTimeout(renderIndex, delay);
  });

  // Right away (a vide needs its target in the list)
  function setIndexFilter(value) {
    $indexSearch.value = value;
    $btnClearIndexSearch.style.display = value.trim() ? 'flex' : 'none';
    renderIndex();
  }

  $btnClearIndexSearch.addEventListener('click', () => {
    setIndexFilter('');
    $indexSearch.focus();
  });

  // The entries' text lowercased and without accents, once per text
  const filterTextCache = new Map();
  let filterTermsOf = null, filterTerms = [];
  function textMatchesFilter(text, filter) {
    let lower = filterTextCache.get(text);
    if (lower === undefined) filterTextCache.set(text, lower = stripAccents(text.toLowerCase()));
    if (filter !== filterTermsOf) {
      filterTermsOf = filter;
      filterTerms = stripAccents(filter).split(/\s+/);
    }
    return filterTerms.every(term => lower.includes(term));
  }

  // The remissivo and the referências unfiltered are thousands of entries:
  // built once (per category) and put back on each opening, not rebuilt
  const indexDomCache = new Map();

  // In idle time after the load (19-inicio-da-pagina.js): a tab's list built
  // in the closed panel and kept, so its first opening only lays it out. Not
  // with the panel open or a filter in it, nor once kept
  function warmIndexTab(name) {
    const key = name === 'subject' ? 'subject' : 'references:' + currentRefCategory;
    if ($indexPanel.classList.contains('open') || $indexSearch.value.trim() || indexDomCache.has(key)) return;
    const was = currentIndexTab, wasWidth = $indexPanel.dataset.tab;
    currentIndexTab = name;
    renderIndex();
    currentIndexTab = was;
    if (wasWidth === undefined) delete $indexPanel.dataset.tab;
    else $indexPanel.dataset.tab = wasWidth;
  }

  function renderIndex() {
    indexRenders++;
    tabRender++;
    $indexPanel.classList.remove('loading');
    clearTimeout(indexFilterTimer);
    indexFill = null;
    // one letter would match nearly every entry: not a filter (as in the search bar)
    let filter = $indexSearch.value.trim().toLowerCase();
    if (filter.length < MIN_TERM_LENGTH) filter = '';
    const cacheKey = filter ? null
      : currentIndexTab === 'subject' ? 'subject'
      : currentIndexTab === 'references' ? 'references:' + currentRefCategory : null;
    if ($indexPanel.dataset.tab !== currentIndexTab) $indexPanel.dataset.tab = currentIndexTab;
    $indexContent.classList.remove('sys-two');
    const cached = cacheKey && indexDomCache.get(cacheKey);
    if (cached) {
      // still in the panel (closed and reopened): left as they are; put back,
      // thousands of entries would be styled and laid out again as it opens
      const kept = $indexContent.firstChild === cached[0] && $indexContent.childNodes.length === cached.length;
      if (!kept) $indexContent.replaceChildren(...cached);
      if (cacheKey === 'subject') buildSubjectRail(subjAllLetters);
      $indexContent.querySelectorAll('.vide-highlight').forEach(el => el.classList.remove('vide-highlight'));
      return;
    }
    $indexContent.innerHTML = '';

    if (currentIndexTab === 'info') {
      $indexContent.innerHTML = '<div class="info-content">' + INFO_HTML + '</div>';
      return;
    } else if (currentIndexTab === 'systematic') {
      renderSystematicIndex(filter);
      if (!filter) syncSystematicToScroll();
    } else if (currentIndexTab === 'references') {
      renderReferencesIndex(filter);
    } else {
      renderSubjectIndex(filter);
    }

    if (filter) {
      highlightIndexContent(filter);
    }
    // (the whole remissivo is kept once its last slice is in)
    if (cacheKey && cacheKey !== 'subject') indexDomCache.set(cacheKey, [...$indexContent.childNodes]);
  }

  function highlightIndexContent(filter) {
    const terms = filter.split(/\s+/).filter(Boolean);
    const regex = new RegExp(terms.map(t => accentInsensitivePattern(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('|'), 'gi');
    const walker = document.createTreeWalker($indexContent, NodeFilter.SHOW_TEXT, null);
    const hits = [];
    while (walker.nextNode()) {
      regex.lastIndex = 0;
      if (regex.test(walker.currentNode.data)) hits.push(walker.currentNode);
    }
    // Each match split off its text node into a <mark> (no HTML to parse)
    for (let tn of hits) {
      const spans = [];
      regex.lastIndex = 0;
      for (let m; (m = regex.exec(tn.data)); ) spans.push([m.index, m[0].length]);
      let offset = 0;
      for (const [at, len] of spans) {
        const hit = tn.splitText(at - offset);
        tn = hit.splitText(len);
        offset = at + len;
        const mark = document.createElement('mark');
        hit.replaceWith(mark);
        mark.appendChild(hit);
      }
    }
  }

  // The systematic index: one norma at a time (its tabs at the top). Each
  // título is a bar as long as its number of articles, split in its
  // capítulos: where the bulk of the norma is, and where the reader is. On a
  // wide panel, two columns: the títulos on the left, the hovered (or
  // clicked) one's capítulos and seções on the right; narrow, a título opens
  // them under it. Names in capitals are shown in sentence case.
  const SYS_LEVELS = ['norma', 'tit', 'cap', 'sec', 'subsec'];
  const SYS_LEVEL_NAME = { norma: 'norma', tit: 'titulo', cap: 'capitulo', sec: 'secao', subsec: 'subsecao' };
  const SYS_ABBR = { 'TÍTULO': 'Tít.', 'CAPÍTULO': 'Cap.', 'SEÇÃO': 'Seç.', 'SUBSEÇÃO': 'Subs.' };
  const SYS_NORM_SHORT = { 'Regimento Interno': 'RI', 'Lei Orgânica': 'LOM', 'Constituição Estadual': 'CE',
    'Constituição Federal': 'CF', 'Precedentes Regimentais': 'Precedentes' };
  // ...and its prefix, for its color (CSS: [data-nrm])
  const SYS_NORM_PREFIX = { 'Regimento Interno': 'RI', 'Lei Orgânica': 'LOM', 'Constituição Estadual': 'CE',
    'Constituição Federal': 'CF', 'Precedentes Regimentais': 'PREC' };
  // kept capitalized when a name in capitals is lowercased (the longer first)
  const SYS_PROPER = ['Câmara Municipal', 'Câmara dos Deputados', 'Câmara', 'Mesa', 'Plenário', 'Vereadores', 'Vereador',
    'Vice-Presidentes', 'Presidentes', 'Presidente', 'Secretários Municipais', 'Secretários', 'Comissões Permanentes',
    'Comissões Temporárias', 'Comissões', 'Comissão', 'Município', 'Prefeito', 'Lei Orgânica', 'Regimento Interno',
    'Estado', 'União', 'Distrito Federal', 'República', 'Tribunal de Contas', 'Poder Legislativo', 'Poder Executivo',
    'Poder Judiciário', 'Ministério Público', 'Defensoria Pública', 'Congresso Nacional', 'Senado Federal',
    'Constituição', 'Ordem do Dia', 'Expediente', 'Subprefeituras', 'Orçamento', 'Líderes', 'Vice-Líderes'];
  const SYS_PROPER_RE = SYS_PROPER.map(p => [new RegExp('(^|[^\\p{L}])' + p.toLowerCase() + '(?![\\p{L}])', 'gu'), p]);
  const sysWide = window.matchMedia('(min-width: 720px)');
  let sysTree = null;    // [norma node]; node: {title, id, level, tag, name, kids, parent, arts, first, last, art?, law?}
  let sysNorm = -1;      // the norma shown (-1: the reader's)
  let sysTitle = null;   // the título shown on the right (wide panel)

  function sysCase(name) {
    const letters = name.replace(/[^\p{L}]/gu, '');
    if (!letters || letters !== letters.toUpperCase()) return name;
    let s = name.toLowerCase();
    for (const [re, p] of SYS_PROPER_RE) s = s.replace(re, (m, a) => a + p);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function sysLevelOf(id) {
    if (!id) return '';
    if (id.startsWith('norma')) return 'norma';
    if (id === 'adt' || id === 'dgt' || id.startsWith('tit')) return 'tit';
    if (id.startsWith('cap')) return 'cap';
    if (id.startsWith('subsec')) return 'subsec';
    if (id.startsWith('sec')) return 'sec';
    return '';
  }

  // The tree, with each section's number of articles and first and last
  // article, counted on the cards (once)
  function sysTreeBuild() {
    if (sysTree) return sysTree;
    const byId = new Map();
    const node = (src, parent) => {
      const title = (src.title || src.label || '').replace(/\xa0/g, ' ');
      const n = { title, id: src.section_id || '', kids: [], parent, arts: 0, first: '', last: '' };
      n.level = sysLevelOf(n.id);
      if (src.art) { n.art = src.art; n.law = src.law || ''; }
      const m = title.match(/^(TÍTULO|CAPÍTULO|SEÇÃO|SUBSEÇÃO)\s+([IVXLC]+[-A-Z]*|ÚNIC[OA])\s*[—–-]\s*(.*)$/i);
      n.tag = m ? (SYS_ABBR[m[1].toUpperCase()] || m[1]) + ' ' + (/^ÚNIC/i.test(m[2]) ? 'Único' : m[2]) : '';
      n.name = sysCase(m ? m[3] : title);
      if (n.id) byId.set(n.id, n);
      for (const ch of src.children || []) if (ch.title || ch.art) n.kids.push(node(ch, n));
      return n;
    };
    sysTree = [];
    for (const g of SYSTEMATIC_INDEX) {
      if (sysLevelOf(g.section_id) === 'norma') { sysTree.push(node(g, null)); continue; }
      // the Regimento's títulos come first, without a norma of their own
      if (!sysTree.length) sysTree.push({ title: 'Regimento Interno', name: 'Regimento Interno', id: 'norma1',
        level: 'norma', tag: '', kids: [], parent: null, arts: 0, first: '', last: '' });
      sysTree[sysTree.length - 1].kids.push(node(g, sysTree[sysTree.length - 1]));
    }
    if (sysTree.length && !byId.has('norma1')) byId.set('norma1', sysTree[0]);
    const current = SYS_LEVELS.map(() => null);
    for (const card of ALL_CARDS) {
      if (card.classList.contains('card-titulo')) {
        const i = SYS_LEVELS.indexOf(headingLevel(card));
        if (i < 0) continue;
        current[i] = byId.get(card.dataset.section) || null;
        current.fill(null, i + 1);
      } else if (card.classList.contains('card-artigo')) {
        const art = card.dataset.art.replace(/^ADT/, '');
        for (const n of current) {
          if (!n) continue;
          n.arts++;
          if (!n.first) n.first = art;
          n.last = art;
        }
      }
    }
    return sysTree;
  }

  function sysRange(n) {
    if (!n.first || n.art) return '';
    return 'art. ' + (n.first === n.last ? n.first : n.first + '–' + n.last);
  }

  // The nodes that contain the reader's position (a precedent: its leaf)
  function sysHerePath() {
    const here = new Set();
    const card = selectedCard;
    if (!card) return here;
    let n = null;
    if (isPrecCard(card)) {
      const norm = sysTree.find(x => x.kids.some(k => k.art));
      n = norm && norm.kids.find(k => k.art === card.dataset.art) || null;
    } else {
      const id = getCurrentSectionId();
      const find = list => {
        for (const x of list) {
          if (x.id === id) return x;
          const y = find(x.kids);
          if (y) return y;
        }
        return null;
      };
      n = id ? find(sysTree) : null;
    }
    for (; n; n = n.parent) here.add(n);
    return here;
  }

  function sysFlat(n, out = [], depth = 0) {
    for (const k of n.kids) {
      out.push([k, depth]);
      sysFlat(k, out, depth + 1);
    }
    return out;
  }

  function sysGo(n) {
    takeStep();
    const byKeyboard = closeIndex();
    let card;
    if (!n.art) card = navigateToSection(n.id);
    else {
      card = $cards.querySelector(`.card-artigo[data-art="${CSS.escape(n.art)}"][data-law="${n.law}"]`);
      if (!card) return;
      revealCard(card);   // hidden by a filter: shown (and its norma), as a remissão does
      scrollToReadingLine(card);
      selectCard(card, true);
    }
    // chosen from the keyboard: Tab goes on from the card gone to, not from the header
    if (byKeyboard && card) {
      card.tabIndex = -1;
      card.focus({ preventScroll: true });
    }
  }

  function sysTagHtml(n) {
    return n.tag ? '<span class="sys-tag">' + escapeHtml(n.tag) + '</span>' : '';
  }

  // A row: a capítulo, seção... or a precedent; goes to it
  function sysRowEl(n, depth, here) {
    const el = document.createElement('div');
    el.className = 'sys-row lv-' + (SYS_LEVEL_NAME[n.level] || 'leaf') + (here.has(n) ? ' sys-here' : '');
    el.style.setProperty('--d', depth);
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.innerHTML = sysTagHtml(n) + '<span class="sys-nm">' + escapeHtml(n.art ? n.title : n.name) + '</span>'
      + '<span class="sys-rg">' + escapeHtml(sysRange(n).replace(/^art\. /, '')) + '</span>';
    el.sysNode = n;
    return el;
  }

  // A título: its name and range, and the bar of its capítulos
  function sysTitleEl(t, max, here) {
    const el = document.createElement('div');
    el.className = 'sys-tit lv-titulo' + (here.has(t) ? ' sys-here' : '');
    const top = document.createElement('div');
    top.className = 'sys-top';
    top.tabIndex = 0;
    top.setAttribute('role', 'button');
    top.innerHTML = sysTagHtml(t) + '<span class="sys-nm">' + escapeHtml(t.name) + '</span>'
      + '<span class="sys-rg">' + escapeHtml(sysRange(t)) + '</span>';
    const bar = document.createElement('div');
    bar.className = 'sys-bar' + (t.kids.length ? '' : ' solo');
    bar.style.width = Math.max(t.arts / max * 100, 3) + '%';
    for (const s of t.kids.length ? t.kids : [t]) {
      const seg = document.createElement('i');
      seg.style.flex = Math.max(s.arts, 1);
      if (here.has(s)) seg.className = 'sys-here';
      seg.sysNode = s;
      bar.appendChild(seg);
    }
    el.append(top, bar);
    el.sysNode = t;
    return el;
  }

  function sysNormTabs(here) {
    const tabs = document.createElement('div');
    tabs.className = 'sys-norms';
    sysTree.forEach((n, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = i === sysNorm ? 'on' : '';
      b.dataset.nrm = SYS_NORM_PREFIX[n.title] || 'RI';
      b.title = n.title + ': ' + n.arts + (n.arts === 1 ? ' artigo' : ' artigos');
      b.innerHTML = escapeHtml(SYS_NORM_SHORT[n.title] || n.title) + (here.has(n) ? ' <span class="sys-dot" aria-label="você está aqui">●</span>' : '');
      b.addEventListener('click', () => {
        sysNorm = i;
        sysTitle = null;
        renderIndex();
      });
      tabs.appendChild(b);
    });
    return tabs;
  }

  function renderSystematicIndex(filter) {
    sysTreeBuild();
    const here = sysHerePath();
    if (filter) { renderSysFiltered(filter, here); return; }
    if (sysNorm < 0) sysNorm = Math.max(0, sysTree.findIndex(n => here.has(n)));
    const norm = sysTree[sysNorm];
    $indexContent.appendChild(sysNormTabs(here));
    // the precedents: just their list
    if (!norm.kids.some(k => k.kids.length || k.id)) {
      const list = document.createElement('div');
      list.className = 'sys-list';
      for (const k of norm.kids) list.appendChild(sysRowEl(k, 0, here));
      $indexContent.appendChild(list);
      return;
    }
    const max = Math.max(1, ...norm.kids.map(t => t.arts));
    const intro = document.createElement('div');
    intro.className = 'sys-intro';
    intro.textContent = 'Cada barra mede o título em artigos; cada pedaço é um capítulo.';
    $indexContent.appendChild(intro);
    if (sysWide.matches) {
      $indexContent.classList.add('sys-two');
      if (!sysTitle || !norm.kids.includes(sysTitle)) sysTitle = norm.kids.find(t => here.has(t)) || norm.kids[0];
      const cols = document.createElement('div');
      cols.className = 'sys-cols';
      const left = document.createElement('div');
      left.className = 'sys-left';
      const right = document.createElement('div');
      right.className = 'sys-right';
      for (const t of norm.kids) {
        const el = sysTitleEl(t, max, here);
        if (t === sysTitle) el.classList.add('on');
        left.appendChild(el);
      }
      cols.append(left, right);
      $indexContent.appendChild(cols);
      sysFillRight(right, sysTitle, here);
      return;
    }
    for (const t of norm.kids) {
      const el = sysTitleEl(t, max, here);
      if (t.kids.length) {
        const kids = document.createElement('div');
        kids.className = 'sys-kids';
        kids.hidden = !here.has(t);
        const start = sysRowEl(t, 0, new Set());
        start.classList.add('sys-start');
        start.querySelector('.sys-nm').textContent = 'Início do título';
        kids.appendChild(start);
        for (const [n, d] of sysFlat(t)) kids.appendChild(sysRowEl(n, d, here));
        el.appendChild(kids);
        el.setAttribute('aria-expanded', String(!kids.hidden));
      }
      $indexContent.appendChild(el);
    }
  }

  // The right column: the título, a way to its start, its capítulos and seções
  function sysFillRight(right, t, here) {
    right.replaceChildren();
    right.sysNode = t;
    const head = document.createElement('div');
    head.className = 'sys-head';
    head.tabIndex = 0;
    head.setAttribute('role', 'button');
    head.title = 'Ir ao início do título';
    head.innerHTML = '<div class="sys-k">' + escapeHtml(t.tag || 'Título') + '</div>'
      + '<div class="sys-h">' + escapeHtml(t.name) + '</div>'
      + '<div class="sys-rg">' + escapeHtml(sysRange(t)) + ' · ' + t.arts + (t.arts === 1 ? ' artigo' : ' artigos')
      + '<span class="sys-go">ir ao início ›</span></div>';
    head.sysNode = t;
    right.appendChild(head);
    if (!t.kids.length) {
      const empty = document.createElement('div');
      empty.className = 'sys-empty';
      empty.textContent = 'Sem capítulos: o título vai direto aos artigos.';
      right.appendChild(empty);
    }
    for (const [n, d] of sysFlat(t)) right.appendChild(sysRowEl(n, d, here));
    right.scrollTop = 0;
  }

  // With a filter: the sections that match, under the títulos (and normas) they belong to
  function renderSysFiltered(filter, here) {
    const shown = new Set();
    const visit = n => {
      for (const k of n.kids) {
        if (textMatchesFilter(k.title, filter) || textMatchesFilter(k.name, filter)) {
          for (let x = k; x; x = x.parent) shown.add(x);
        }
        visit(k);
      }
    };
    sysTree.forEach(visit);
    if (!shown.size) {
      $indexContent.innerHTML = '<div class="sys-empty">Nada no índice sistemático com esses termos.</div>';
      return;
    }
    for (const norm of sysTree) {
      if (!shown.has(norm)) continue;
      const h = document.createElement('div');
      h.className = 'sys-norm-h';
      h.dataset.nrm = SYS_NORM_PREFIX[norm.title] || 'RI';
      h.textContent = norm.title;
      $indexContent.appendChild(h);
      for (const [n, d] of sysFlat(norm)) if (shown.has(n)) $indexContent.appendChild(sysRowEl(n, d, here));
    }
  }

  // Wide: the título on the right (and marked on the left)
  function sysShowTitle(tit) {
    const right = $indexContent.querySelector('.sys-right');
    if (!right) return false;
    sysTitle = tit.sysNode;
    $indexContent.querySelectorAll('.sys-tit.on').forEach(x => x.classList.remove('on'));
    tit.classList.add('on');
    if (right.sysNode !== tit.sysNode) sysFillRight(right, tit.sysNode, sysHerePath());
    return true;
  }

  // Clicks and keys in the systematic index
  function sysActivate(e) {
    const seg = e.target.closest('.sys-bar > i');
    if (seg) { e.stopPropagation(); sysGo(seg.sysNode); return true; }
    const row = e.target.closest('.sys-row, .sys-head');
    if (row) { sysGo(row.sysNode); return true; }
    const top = e.target.closest('.sys-top');
    if (!top) return false;
    const tit = top.parentNode;
    const t = tit.sysNode;
    if (sysShowTitle(tit)) return true;
    const kids = tit.querySelector(':scope > .sys-kids');
    if (!kids) { sysGo(t); return true; }
    kids.hidden = !kids.hidden;
    tit.setAttribute('aria-expanded', String(!kids.hidden));
    return true;
  }
  $indexContent.addEventListener('click', e => {
    if (currentIndexTab === 'systematic') sysActivate(e);
  });
  $indexContent.addEventListener('keydown', e => {
    if (currentIndexTab !== 'systematic' || (e.key !== 'Enter' && e.key !== ' ')) return;
    if (!e.target.matches('.sys-row, .sys-head, .sys-top')) return;
    e.preventDefault();
    sysActivate(e);
  });
  // Wide: hovering a título shows it on the right, and it stays there for the
  // mouse to go to it (after a pause on it: crossing other títulos on the way
  // doesn't change it); a piece of a bar names its capítulo
  let sysHoverTimer = 0;
  const $sysTip = document.createElement('div');
  $sysTip.id = 'sys-tip';
  document.body.appendChild($sysTip);
  $indexContent.addEventListener('mouseover', e => {
    if (currentIndexTab !== 'systematic') return;
    const seg = e.target.closest('.sys-bar > i');
    if (seg) {
      const s = seg.sysNode;
      $sysTip.innerHTML = (s.tag ? '<b>' + escapeHtml(s.tag) + '</b> ' : '') + escapeHtml(s.name)
        + '<br><span>' + escapeHtml(sysRange(s)) + ' · ' + s.arts + (s.arts === 1 ? ' artigo' : ' artigos') + '</span>';
      $sysTip.classList.add('visible');
    }
    if (!HOVER) return;
    clearTimeout(sysHoverTimer);
    const tit = e.target.closest('.sys-left .sys-tit');
    if (tit && !tit.classList.contains('on')) sysHoverTimer = setTimeout(() => sysShowTitle(tit), 120);
  });
  $indexContent.addEventListener('mousemove', e => {
    if (!$sysTip.classList.contains('visible')) return;
    const w = $sysTip.offsetWidth;
    $sysTip.style.left = Math.min(e.clientX + 12, window.innerWidth - w - 8) + 'px';
    $sysTip.style.top = (e.clientY + 16) + 'px';
  });
  $indexContent.addEventListener('mouseout', e => {
    if (e.target.closest('.sys-bar > i')) $sysTip.classList.remove('visible');
    if (!e.relatedTarget || !$indexContent.contains(e.relatedTarget)) clearTimeout(sysHoverTimer);
  });
  sysWide.addEventListener('change', () => {
    if ($indexPanel.classList.contains('open') && currentIndexTab === 'systematic') renderIndex();
  });

  function getCurrentSectionId() {
    const card = selectedCard;
    if (!card) return '';
    // Walk backwards — first heading found is the most specific (deepest)
    let prev = card.classList.contains('card-titulo') ? card : card.previousElementSibling;
    while (prev) {
      if (prev.classList.contains('card-titulo') && prev.dataset.section) {
        return prev.dataset.section;
      }
      prev = prev.previousElementSibling;
    }
    return '';
  }

  // The reader's place, in view: the título on the left (wide) and the
  // deepest section or precedent
  function syncSystematicToScroll() {
    const tit = $indexContent.querySelector('.sys-left .sys-tit.sys-here');
    if (tit) tit.scrollIntoView({ behavior: 'instant', block: 'nearest' });
    const rows = $indexContent.querySelectorAll('.sys-row.sys-here');
    const target = rows[rows.length - 1] || $indexContent.querySelector('.sys-tit.sys-here');
    if (target) target.scrollIntoView({ behavior: 'instant', block: 'center' });
  }

  function navigateToSection(sectionId) {
    const card = $cards.querySelector(`.card-titulo[data-section="${sectionId}"]`);
    if (!card) return null;
    // Hidden by the search filter alone: the section is read whole, without it
    if (card.classList.contains('filtered-out') && searchFilter) {
      searchFilter = false;
      $btnFilter.classList.remove('active');
      doSearch($searchInput.value.trim());
    }
    revealCard(card);   // still hidden by another filter: shown anyway
    scrollToReadingLine(card);
    selectCard(card, true);
    return card;
  }

  function formatRefsList(refs) {
    // Returns array of {label, hint, art, lawPrefix} — one per ref, no range compaction
    const result = [];
    for (const r of refs) {
      const label = r.law_prefix === 'PREC' ? 'Precedente ' + precLabel(r.art)
        : (r.law_prefix ? r.law_prefix + ' ' : '') + 'art. ' + r.art + (r.detail ? ', ' + r.detail : '');
      // Hint: from XLSX parentheses → fallback to SUMMARIES_MAP
      let hint = r.hint || '';
      if (!hint) {
        const key = r.law_prefix ? r.law_prefix + ':' + r.art : r.art;
        hint = SUMMARIES_MAP[key] || '';
      }
      result.push({ label, hint, art: r.art, lawPrefix: r.law_prefix || '' });
    }
    return result;
  }

  function collectAllRefs(entry) {
    // Collect all refs from entry (direct + children) for the search bar
    const all = [];
    if (entry.refs) all.push(...entry.refs);
    if (entry.children) {
      for (const ch of entry.children) {
        all.push(...ch.refs);
      }
    }
    return all;
  }

  // "Vide:" of an entry: each link carries its target ("ASSUNTO" or
  // "ASSUNTO|SUBASSUNTO"); the clicks are handled on the panel
  function videsHtml(vides) {
    const links = vides.map(v => {
      // Support "ASSUNTO|SUBASSUNTO" format
      const pipeIdx = v.indexOf('|');
      const subjectPart = pipeIdx !== -1 ? v.slice(0, pipeIdx).trim() : v;
      const subSubjectPart = pipeIdx !== -1 ? v.slice(pipeIdx + 1).trim() : '';
      const text = subSubjectPart ? subjectPart + ' — ' + subSubjectPart : v;
      return '<a class="vide-link" href="#" data-vide="' + escapeAttr(v) + '">' + escapeHtml(text) + '</a>';
    });
    return '<div class="subj-vides"><span class="vide-label">Vide: </span>' + links.join(', ') + '</div>';
  }

  function goToVide(v) {
    const pipeIdx = v.indexOf('|');
    const subjectPart = pipeIdx !== -1 ? v.slice(0, pipeIdx).trim() : v;
    const subSubjectPart = pipeIdx !== -1 ? v.slice(pipeIdx + 1).trim() : '';
    // Build the key to find the target element in the DOM
    const targetKey = subSubjectPart
      ? stripAccents(subjectPart.toLowerCase()) + '|' + stripAccents(subSubjectPart.toLowerCase())
      : stripAccents(subjectPart.toLowerCase());
    // Clear search filter so the target is visible
    if ($indexSearch.value.trim()) setIndexFilter('');
    flushIndexFill();
    // Find the DOM element with matching data-subject-key
    const targetEl = $indexContent.querySelector('[data-subject-key="' + CSS.escape(targetKey) + '"]');
    if (targetEl) {
      // Remove any previous highlights
      $indexContent.querySelectorAll('.vide-highlight').forEach(el => el.classList.remove('vide-highlight'));
      // Highlight and scroll to the target
      targetEl.classList.add('vide-highlight');
      // Entries not yet drawn have an estimated height (style.css): far away,
      // jump; near, glide and then settle on it (those drawn on the way change)
      const far = Math.abs(targetEl.getBoundingClientRect().top - $indexContent.getBoundingClientRect().top)
        > FAR_SCROLL_SCREENS * $indexContent.clientHeight;
      targetEl.scrollIntoView({ behavior: far ? 'instant' : 'smooth', block: 'center' });
      if (!far && 'onscrollend' in window) {
        $indexContent.addEventListener('scrollend',
          () => targetEl.scrollIntoView({ behavior: 'instant', block: 'center' }), { once: true });
      }
    } else {
      // Target not found — put in search bar
      setIndexFilter(subjectPart);
    }
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  // An entry's lines of references, in two columns: the dispositivo (with
  // its norma's badge, as the remissões') and its dica. A line goes to its
  // dispositivo (data-r: its position in refs). And the height they add (px,
  // fitted against the panel's layout: per line of the longer column)
  const SUBJ_HINT_CHARS = 50, SUBJ_REF_CHARS = 20;
  function subjRefsHtml(refs) {
    let html = '<div class="subj-refs">', h = 0;
    formatRefsList(refs).forEach((item, i) => {
      const [cell, n] = refCellHtml(item);
      html += '<div class="subj-ref-line" data-r="' + i + '" role="button" tabindex="0" title="Ir para o dispositivo">'
        + cell + '<span class="ref-hint">' + escapeHtml(item.hint) + '</span></div>';
      h += 21 + 15.5 * (Math.max(1, Math.ceil(item.hint.length / SUBJ_HINT_CHARS), Math.ceil(n / SUBJ_REF_CHARS)) - 1);
    });
    return [html + '</div>', h];
  }
  // The dispositivo's column: its norma's badge and the rest ("art. 46, I"),
  // and how many characters it takes
  function refCellHtml(item) {
    const law = item.lawPrefix || 'RI';
    const ref = law === 'PREC' ? item.label.replace(/^Precedente /, '')
      : item.label.replace(/^[A-Z]+ (?=art\.)/, '').replace(/,(?=\S)/g, ', ');   // "§1,I" → "§1, I"
    return ['<span class="rf"><i class="' + law + '">' + law + '</i>' + escapeHtml(ref) + '</span>', law.length + ref.length + 1];
  }

  // The remissivo is ~700 subjects and 2,000 sub-subjects: written as one
  // HTML string (much faster than node by node), the clicks handled on the
  // panel by the entry's position (data-i, and data-c for a sub-subject)
  let subjectsSorted = null;
  function sortedSubjects() {
    if (!subjectsSorted) {
      const collator = new Intl.Collator('pt-BR');
      subjectsSorted = SUBJECT_INDEX.slice().sort((a, b) => collator.compare(a.subject, b.subject));
    }
    return subjectsSorted;
  }
  // The subjects' initial ("Á" under A; a digit under #)
  function subjLetter(entry) {
    const c = stripAccents(entry.subject.charAt(0)).toUpperCase();
    return /[A-Z]/.test(c) ? c : '#';
  }

  function renderSubjectIndex(filter) {
    sortedSubjects();
    const parts = [];
    // the subjects shown, by letter (each letter's band says how many)
    const shown = subjectsSorted.map(entry => !filter || textMatchesFilter(entry.subject, filter)
      || !!(entry.children && entry.children.some(ch => textMatchesFilter(ch.sub_subject, filter))));
    const perLetter = new Map();
    subjectsSorted.forEach((entry, i) => {
      if (shown[i]) perLetter.set(subjLetter(entry), (perLetter.get(subjLetter(entry)) || 0) + 1);
    });
    let letter = null;
    subjectsSorted.forEach((entry, i) => {
      if (!shown[i]) return;
      const matchSelf = !filter || textMatchesFilter(entry.subject, filter);
      if (subjLetter(entry) !== letter) {
        letter = subjLetter(entry);
        const n = perLetter.get(letter);
        parts.push('<div class="subj-letter" data-letter="' + letter + '">' + letter
          + '<small>' + n + (n === 1 ? ' assunto' : ' assuntos') + '</small></div>');
      }

      const key = stripAccents(entry.subject.toLowerCase());
      // Off-screen entries are not laid out (style.css): their estimated height
      let est = 26 + 18 * (Math.ceil(entry.subject.length / 54) - 1);
      let html = '<div class="subj-title' + (collectAllRefs(entry).length ? '' : ' no-refs') + '">'
        + escapeHtml(entry.subject) + '</div>';

      // Direct refs
      if (entry.refs && entry.refs.length > 0) {
        const [refs, h] = subjRefsHtml(entry.refs);
        html += refs;
        est += h;
      }

      // Vides (cross-references)
      if (entry.vides && entry.vides.length > 0) {
        html += videsHtml(entry.vides);
        est += 17 * Math.ceil((6 + entry.vides.join(', ').length) / 52);
      }

      // Sub-subjects
      if (entry.children) {
        entry.children.forEach((ch, c) => {
          if (filter && !matchSelf && !textMatchesFilter(ch.sub_subject, filter)) return;
          const subKey = key + '|' + stripAccents(ch.sub_subject.toLowerCase());
          html += '<div class="subj-entry subj-sub" data-subject-key="' + escapeAttr(subKey)
            + '" data-c="' + c + '"><div class="subj-title' + (ch.refs && ch.refs.length ? '' : ' no-refs')
            + '">— ' + escapeHtml(ch.sub_subject) + '</div>';
          const [refs, h] = subjRefsHtml(ch.refs);
          html += refs;
          est += 27 + 16 * (Math.ceil((2 + ch.sub_subject.length) / 60) - 1) + h;

          // Vides on sub-subject
          if (ch.vides && ch.vides.length > 0) {
            html += videsHtml(ch.vides);
            est += 17 * Math.ceil((6 + ch.vides.join(', ').length) / 52);
          }
          html += '</div>';
        });
      }

      parts.push('<div class="subj-entry" data-subject-key="' + escapeAttr(key) + '" data-i="' + i
        + '" style="contain-intrinsic-size:auto ' + Math.round(est) + 'px">' + html + '</div>');
    });
    if (!filter) subjAllLetters = perLetter;
    buildSubjectRail(perLetter);
    if (filter) {
      $indexContent.insertAdjacentHTML('beforeend', parts.join(''));
      return;
    }
    // Whole: the first screen right away, the rest in slices after it is
    // painted (and kept for the next openings once complete)
    let next = SUBJECTS_FIRST;
    $indexContent.insertAdjacentHTML('beforeend', parts.slice(0, next).join(''));
    const fill = indexFill = () => {
      if (indexFill !== fill) return;
      const end = flushingIndexFill ? parts.length : next + SUBJECTS_SLICE;
      $indexContent.insertAdjacentHTML('beforeend', parts.slice(next, end).join(''));
      next = end;
      if (next < parts.length) setTimeout(fill, 0);
      else {
        indexFill = null;
        indexDomCache.set('subject', [...$indexContent.childNodes]);
      }
    };
    requestAnimationFrame(() => setTimeout(fill, 0));
  }
  // The letters A–Z beside the remissivo: a click goes to the letter (those
  // without subjects, greyed); the letter being read is marked
  const $subjRail = document.createElement('nav');
  $subjRail.id = 'subj-rail';
  $subjRail.setAttribute('aria-label', 'Letras do índice remissivo');
  $indexPanel.appendChild($subjRail);
  let subjAllLetters = new Map();   // of the whole remissivo (its DOM is kept: see renderIndex)
  function buildSubjectRail(perLetter) {
    $subjRail.replaceChildren();
    for (const l of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = l;
      b.dataset.letter = l;
      b.disabled = !perLetter.has(l);
      $subjRail.appendChild(b);
    }
    $subjRail.style.top = ($indexContent.offsetTop + 6) + 'px';
    syncSubjectRail();
  }
  $subjRail.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    flushIndexFill();
    const band = $indexContent.querySelector('.subj-letter[data-letter="' + b.dataset.letter + '"]');
    if (!band) return;
    // its first subject right under the band (a band may be stuck to the top:
    // not where it is). Entries drawn on the way change from their estimated
    // height, some frames later: held there for a few frames
    const first = band.nextElementSibling || band;
    const jump = () => {
      $indexContent.scrollTop += first.getBoundingClientRect().top - $indexContent.getBoundingClientRect().top
        - band.offsetHeight - 2;
    };
    let frames = 0;
    (function hold() {
      jump();
      if (++frames < 12) requestAnimationFrame(hold);
    })();
  });
  function syncSubjectRail() {
    if (currentIndexTab !== 'subject') return;
    const top = $indexContent.scrollTop + $indexContent.offsetTop + 8;
    let cur = null;
    for (const band of $indexContent.querySelectorAll('.subj-letter')) {
      if (band.offsetTop <= top) cur = band.dataset.letter;
      else break;
    }
    for (const b of $subjRail.children) b.classList.toggle('on', b.dataset.letter === (cur || 'A'));
  }
  $indexContent.addEventListener('scroll', syncSubjectRail, { passive: true });
  $indexContent.addEventListener('keydown', e => {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.matches('.subj-ref-line')) return;
    e.preventDefault();
    e.target.click();
  });

  const SUBJECTS_FIRST = 40;    // entries
  const SUBJECTS_SLICE = 120;
  let indexFill = null;         // the slices still to append (a new rendering cancels them)
  let flushingIndexFill = false;
  function flushIndexFill() {
    if (!indexFill) return;
    flushingIndexFill = true;
    indexFill();
    flushingIndexFill = false;
  }

  $indexContent.addEventListener('click', e => {
    const vide = e.target.closest('.vide-link[data-vide]');
    if (vide) {
      e.preventDefault();
      goToVide(vide.dataset.vide);
      return;
    }
    const line = e.target.closest('.subj-ref-line[data-r]');
    if (line) {
      const at = line.closest('.subj-entry[data-i]');
      const entry = subjectsSorted[+at.dataset.i];
      const sub = line.closest('.subj-entry[data-c]');
      const refs = sub ? entry.children[+sub.dataset.c].refs : entry.refs;
      takeStep();
      closeIndex();
      goToQuickRef(idxRemRef(refs[+line.dataset.r]));
      return;
    }
    const title = e.target.closest('.subj-title:not(.no-refs)');
    const top = title && title.closest('.subj-entry[data-i]');
    if (!top) return;
    const entry = subjectsSorted[+top.dataset.i];
    const sub = title.parentElement.dataset.c;
    takeStep();
    closeIndex();
    if (sub === undefined) {
      openSubject({ subject: entry.subject, refs: collectAllRefs(entry) });
    } else {
      const child = entry.children[+sub];
      openSubject({ subject: entry.subject + ' — ' + child.sub_subject, refs: child.refs });
    }
  });

  function renderReferencesIndex(filter) {
    // The consulta rápida first, then the categories of the referências
    const cats = (consultaIndex().length ? [{ category: 'Consulta rápida', consulta: true }] : []).concat(referenciasIndex());
    if (!cats.length) {
      $indexContent.textContent = 'Nenhuma referência disponível.';
      return;
    }

    // Category buttons
    const catBar = document.createElement('div');
    catBar.className = 'ref-categories';
    cats.forEach((cat, idx) => {
      const btn = document.createElement('button');
      btn.className = 'ref-cat-btn' + (idx === currentRefCategory ? ' active' : '');
      btn.textContent = cat.category;
      btn.addEventListener('click', () => {
        currentRefCategory = idx;
        renderIndex();
      });
      catBar.appendChild(btn);
    });
    $indexContent.appendChild(catBar);

    // Render groups/entries for active category
    const cat = cats[currentRefCategory];
    if (!cat) return;
    if (cat.consulta) {
      renderConsulta(filter);
      return;
    }

    for (const group of cat.groups) {
      const hasMatch = !filter || group.entries.some(e => {
        const text = e.html.replace(/<[^>]*>/g, '');
        return textMatchesFilter(text, filter);
      });
      if (!hasMatch && !textMatchesFilter(group.title, filter)) continue;

      if (group.title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'ref-group-title' + (cat.category === LEGISLACAO ? ' ref-law-title' : '');
        titleEl.textContent = group.title;
        $indexContent.appendChild(titleEl);
      }

      for (const entry of group.entries) {
        const entryText = entry.html.replace(/<[^>]*>/g, '');
        if (filter && !textMatchesFilter(entryText, filter) && !textMatchesFilter(group.title, filter)) continue;

        const entryEl = document.createElement('div');
        // In the legislação, the entry without an article is the norm's ementa
        entryEl.className = 'ref-entry' + (cat.category === LEGISLACAO && !entry.art_ref ? ' ref-law-ementa' : '');

        const textSpan = document.createElement('span');
        textSpan.innerHTML = entry.html;
        entryEl.appendChild(textSpan);

        if (entry.art_ref) {
          const linkEl = document.createElement('a');
          linkEl.className = 'ref-art-link';
          linkEl.href = '#';
          linkEl.textContent = ' — ' + refEntryLabel(entry);
          linkEl.addEventListener('click', (e) => {
            e.preventDefault();
            takeStep();
            closeIndex();
            goToRefEntry(entry, cat.category === LEGISLACAO);
          });
          entryEl.appendChild(linkEl);
        }

        $indexContent.appendChild(entryEl);
      }
    }
  }

  function showContextHeadings() {
    // For each visible article, show its ancestor heading cards for context.
    // Single pass in document order keeping the current heading of each level;
    // a heading resets the levels below it, so headings from other branches
    // (e.g. a capítulo from a previous título) are never picked up.
    const hierarchy = ['norma', 'tit', 'cap', 'sec', 'subsec'];
    const current = [null, null, null, null, null];
    for (const card of getAllCards()) {
      if (card.classList.contains('card-titulo')) {
        const idx = hierarchy.indexOf(headingLevel(card));
        if (idx < 0) continue;
        current[idx] = card;
        for (let i = idx + 1; i < hierarchy.length; i++) current[i] = null;
      } else if (card.classList.contains('card-artigo') && !card.classList.contains('filtered-out')) {
        for (const heading of current) {
          if (heading) heading.classList.remove('filtered-out');
        }
      }
    }
  }

