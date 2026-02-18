(function() {
  'use strict';

  // ===== DATA (injected by build.py) =====
  const SYSTEMATIC_INDEX = /*__SYSTEMATIC_INDEX__*/[];

  const SUBJECT_INDEX = /*__SUBJECT_INDEX__*/[];

  const REFERENCIAS_INDEX = /*__REFERENCIAS_INDEX__*/[];

  const SUMMARIES_MAP = /*__SUMMARIES_MAP__*/{};

  // ===== MARKER COLOR PALETTE (fixed order for auto-assignment) =====
  const MARKER_PALETTE = [
    { name: 'coral',    bg: '#ff6b6b', bgLight: '#ffe0e0', text: '#fff' },
    { name: 'sky',      bg: '#4dabf7', bgLight: '#d0ebff', text: '#fff' },
    { name: 'lime',     bg: '#51cf66', bgLight: '#d3f9d8', text: '#fff' },
    { name: 'amber',    bg: '#fcc419', bgLight: '#fff3bf', text: '#333' },
    { name: 'violet',   bg: '#9775fa', bgLight: '#e5dbff', text: '#fff' },
    { name: 'pink',     bg: '#f06595', bgLight: '#ffdeeb', text: '#fff' },
    { name: 'teal',     bg: '#20c997', bgLight: '#c3fae8', text: '#fff' },
    { name: 'orange',   bg: '#ff922b', bgLight: '#ffe8cc', text: '#fff' },
  ];

  // ===== STATE =====
  let selectedCard = null;
  let manualSelect = false;
  let markersList = [];
  let searchFilter = true;
  let currentSearch = '';
  let activeSubject = null;
  let subjectIdx = 0;
  let subjectFilter = true;
  let zoomScale = 1;
  let zoomTimeout = null;
  let searchMatches = [];
  let searchIdx = 0;
  let currentRefCategory = 0;

  // ===== DOM REFS =====
  const $cards = document.getElementById('cards-container');
  const $searchInput = document.getElementById('search-input');
  const $btnFilter = document.getElementById('btn-filter');
  const $btnClearSearch = document.getElementById('btn-clear-search');
  const $btnIndex = document.getElementById('btn-index');
  const $markerNav = document.getElementById('marker-nav');
  const $indexOverlay = document.getElementById('index-overlay');
  const $indexPanel = document.getElementById('index-panel');
  const $indexContent = document.getElementById('index-content');
  const $indexSearch = document.getElementById('index-search');
  const $subjectPill = document.getElementById('subject-pill');
  const $pillLabel = document.getElementById('pill-label');
  const $pillCurrent = document.getElementById('pill-current');
  const $pillDropdown = document.getElementById('pill-dropdown');
  const $pillFilter = document.getElementById('pill-filter');
  const $zoomIndicator = document.getElementById('zoom-indicator');
  const $searchNav = document.getElementById('search-nav');
  const $searchCounter = document.getElementById('search-counter');
  const $breadcrumb = document.getElementById('breadcrumb');

  function getAllCards() {
    return Array.from($cards.querySelectorAll('.card'));
  }
  function getArticleCards() {
    return Array.from($cards.querySelectorAll('.card-artigo'));
  }

  // ===== SCROLL SELECTION =====
  function getReadingLineY() {
    return window.innerHeight * 0.25;
  }

  function scrollToReadingLine(card, behavior = 'smooth') {
    requestAnimationFrame(() => {
      const rect = card.getBoundingClientRect();
      const target = window.scrollY + rect.top - getReadingLineY();
      window.scrollTo({ top: Math.max(0, target), behavior });
    });
  }

  function updateSelection() {
    if (manualSelect) return;
    const lineY = getReadingLineY();
    const cards = getAllCards().filter(c => !c.classList.contains('filtered-out'));
    let best = null;
    let bestDist = Infinity;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (rect.top <= lineY && rect.bottom >= lineY) {
        best = card;
        break;
      }
      const dist = Math.min(Math.abs(rect.top - lineY), Math.abs(rect.bottom - lineY));
      if (dist < bestDist) {
        bestDist = dist;
        best = card;
      }
    }
    if (best && best !== selectedCard) {
      selectCard(best, false);
    }
  }

  function selectCard(card, manual) {
    if (selectedCard) selectedCard.classList.remove('selected');
    selectedCard = card;
    if (card) card.classList.add('selected');
    if (manual) {
      manualSelect = true;
      setTimeout(() => { manualSelect = false; }, 50);
    }
  }

  function preserveScroll(fn) {
    const card = selectedCard;
    const topBefore = card ? card.getBoundingClientRect().top : null;
    fn();
    if (card && topBefore !== null && !card.classList.contains('filtered-out')) {
      const topAfter = card.getBoundingClientRect().top;
      window.scrollBy(0, topAfter - topBefore);
    }
  }

  // ===== BREADCRUMB (scroll context) =====
  const headerEl = document.getElementById('header');

  function getHeadingShortTitle(el) {
    // Collect main text (before <br>) and subtitle (after <br>)
    let mainText = '', subtitle = '', pastBr = false;
    for (const node of el.childNodes) {
      if (node.nodeName === 'BR') { pastBr = true; continue; }
      if (node.nodeType === Node.TEXT_NODE) {
        if (!pastBr) mainText += node.textContent;
        else subtitle += node.textContent;
      }
    }
    mainText = mainText.trim();
    subtitle = subtitle.trim();
    // Strip type-word prefix (TÍTULO, CAPÍTULO, SEÇÃO, SUBSEÇÃO) — user deduces from color
    const num = mainText.replace(/^(T[IÍ]TULO|CAP[IÍ]TULO|SE[CÇ][AÃ]O|SUBSE[CÇ][AÃ]O)\s*/i, '').trim();
    if (subtitle) return (num ? num + '-' : '') + subtitle;
    return num || mainText;
  }

  function updateBreadcrumb() {
    if (compactMode) {
      $breadcrumb.classList.remove('visible');
      return;
    }

    // Find the last article card whose top is at or above the header bottom.
    // Using "last above" (instead of "straddles") ensures the breadcrumb stays
    // visible even when a gap or a title card sits exactly at the header line.
    const headerBottom = headerEl.getBoundingClientRect().bottom;
    const articles = getArticleCards().filter(c => !c.classList.contains('filtered-out'));
    let card = null;

    for (const a of articles) {
      const rect = a.getBoundingClientRect();
      if (rect.top > headerBottom) break;
      card = a;
    }

    if (!card) {
      $breadcrumb.classList.remove('visible');
      return;
    }

    // Find the last unit-id hidden behind the header
    const unitIds = card.querySelectorAll('.unit-id[data-path]');
    let currentUnit = null;
    for (const uid of unitIds) {
      if (uid.closest('.old-version')) continue;
      if (uid.getBoundingClientRect().bottom <= headerBottom) {
        currentUnit = uid;
      }
    }

    // Collect ancestor heading cards in reverse DOM order (most recent first)
    const levelOrder = ['norma', 'tit', 'cap', 'sec', 'subsec'];
    const foundLevels = new Set();
    const headings = [];
    let prev = card.previousElementSibling;
    while (prev && foundLevels.size < levelOrder.length) {
      if (prev.classList.contains('card-titulo')) {
        const sec = prev.dataset.section || '';
        let level = '';
        if (sec.startsWith('norma')) level = 'norma';
        else if (sec.startsWith('tit') || sec === 'adt') level = 'tit';
        else if (sec.startsWith('cap')) level = 'cap';
        else if (sec.startsWith('subsec')) level = 'subsec';
        else if (sec.startsWith('sec')) level = 'sec';
        if (level && !foundLevels.has(level)) {
          foundLevels.add(level);
          // Include if filtered-out (display:none, definitely above) or scrolled above header
          const isHidden = prev.classList.contains('filtered-out');
          const rect = prev.getBoundingClientRect();
          if (isHidden || rect.bottom <= headerBottom) {
            headings.push({ el: prev, level });
          }
        }
      }
      prev = prev.previousElementSibling;
    }
    headings.reverse(); // restore DOM order: título → capítulo → seção → …

    // Only show breadcrumb when at least one ancestor title is out of view
    if (headings.length === 0) {
      $breadcrumb.classList.remove('visible');
      return;
    }

    // Build breadcrumb DOM
    $breadcrumb.innerHTML = '';

    function addSep() {
      const sep = document.createElement('span');
      sep.className = 'bc-sep';
      sep.textContent = '\u203A';
      $breadcrumb.appendChild(sep);
    }

    headings.forEach((h, i) => {
      if (i > 0) addSep();
      const span = document.createElement('span');
      span.className = 'bc-item bc-' + h.level;
      span.textContent = getHeadingShortTitle(h.el);
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        const top = h.el.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: top - headerEl.offsetHeight - 8, behavior: 'smooth' });
      });
      $breadcrumb.appendChild(span);
    });

    if (headings.length > 0) addSep();
    const artSpan = document.createElement('span');
    artSpan.className = 'bc-item bc-article';
    const lawPrefix = card.dataset.law;
    artSpan.textContent = (lawPrefix ? lawPrefix + '\u00a0' : '') + card.dataset.art;
    artSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      const top = card.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top - headerEl.offsetHeight - 8, behavior: 'smooth' });
    });
    $breadcrumb.appendChild(artSpan);

    if (currentUnit && currentUnit.dataset.path) {
      const parts = currentUnit.dataset.path.split(',');
      addSep();
      const pathSpan = document.createElement('span');
      pathSpan.className = 'bc-path';
      pathSpan.textContent = parts.join(' \u203A ');
      $breadcrumb.appendChild(pathSpan);
    }

    $breadcrumb.classList.add('visible');
    breadcrumbCard = card;
  }

  let breadcrumbCard = null;

  $breadcrumb.addEventListener('click', (e) => {
    if (e.target.closest('.bc-item')) return;
    if (breadcrumbCard) {
      const top = breadcrumbCard.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top - headerEl.offsetHeight - 8, behavior: 'smooth' });
    }
  });

  let scrollTick = false;
  window.addEventListener('scroll', () => {
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => {
      manualSelect = false;
      updateSelection();
      updateBreadcrumb();
      scrollTick = false;
    });
  });

  $cards.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    if (e.target.closest('.footnote-ref') || e.target.closest('.footnote-box') || e.target.closest('.unit-id')) return;
    selectCard(card, true);
  });

  // ===== SEARCH =====
  function stripAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function accentInsensitivePattern(str) {
    const map = {
      'a': '[aáàâãä]', 'e': '[eéèêë]', 'i': '[iíìîï]',
      'o': '[oóòôõö]', 'u': '[uúùûü]', 'c': '[cç]', 'n': '[nñ]',
    };
    return str.replace(/[a-z]/gi, ch => map[ch.toLowerCase()] || ch);
  }

  function clearHighlights() {
    $cards.querySelectorAll('mark').forEach(m => {
      const parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
  }

  function getCardText(card, includeFootnotes) {
    const clone = card.cloneNode(true);
    if (!includeFootnotes) {
      clone.querySelectorAll('.footnote-box').forEach(el => el.remove());
    }
    return stripAccents(clone.textContent.toLowerCase());
  }

  function highlightText(node, terms, includeFootnotes) {
    if (!terms.length) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    while (walker.nextNode()) {
      const skip = includeFootnotes ? '.art-head' : '.footnote-box, .art-head';
      if (walker.currentNode.parentElement.closest(skip)) continue;
      textNodes.push(walker.currentNode);
    }
    const regex = new RegExp('(' + terms.map(t => accentInsensitivePattern(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('|') + ')', 'gi');
    for (const tn of textNodes) {
      if (!regex.test(tn.textContent)) continue;
      regex.lastIndex = 0;
      const span = document.createElement('span');
      span.innerHTML = tn.textContent.replace(regex, '<mark>$1</mark>');
      tn.parentNode.replaceChild(span, tn);
    }
  }

  function doSearch(term) {
    currentSearch = term;
    clearHighlights();
    const cards = getAllCards();

    if (activeSubject && subjectFilter) {
      applySubjectFilter();
    } else {
      cards.forEach(c => c.classList.remove('filtered-out'));
    }

    if (!term) {
      $btnClearSearch.style.display = 'none';
      searchMatches = [];
      searchIdx = 0;
      $searchNav.classList.remove('open');
      $searchInput.classList.remove('has-nav');
      return;
    }

    $btnClearSearch.style.display = 'flex';

    // Prefix "r " → include footnotes in search
    let includeFootnotes = false;
    const footnoteMatch = term.match(/^r\s+(.+)$/i);
    if (footnoteMatch) {
      includeFootnotes = true;
      term = footnoteMatch[1];
    }

    // Article navigation: a43, a44, aADT1, aLO23, etc
    const artMatch = term.match(/^a([A-Z]{2,})?(\d+[-A-Za-z]*)$/i);
    if (artMatch) {
      const lawPrefix = artMatch[1] ? artMatch[1].toUpperCase() : '';
      const artNum = artMatch[2];
      let target;
      if (lawPrefix) {
        target = $cards.querySelector(`.card-artigo[data-art="${artNum}"][data-law="${lawPrefix}"]`);
      } else {
        // Search default (no data-law) first, then any
        target = $cards.querySelector(`.card-artigo[data-art="${artNum}"]:not([data-law])`)
              || $cards.querySelector(`.card-artigo[data-art="${artNum}"]`);
      }
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        selectCard(target, true);
      }
      return;
    }

    const terms = stripAccents(term.toLowerCase()).split(/\s+/).filter(Boolean);
    const articleCards = getArticleCards().filter(c => !c.classList.contains('filtered-out'));
    const matchedCards = new Set();

    for (const card of articleCards) {
      const text = getCardText(card, includeFootnotes);
      if (terms.every(t => text.includes(t))) {
        matchedCards.add(card);
        highlightText(card, terms, includeFootnotes);
        // Open footnote boxes that contain highlights
        if (includeFootnotes) {
          card.querySelectorAll('.footnote-box').forEach(box => {
            if (box.querySelector('mark')) box.classList.add('open');
          });
        }
      }
    }

    if (searchFilter) {
      for (const card of cards) {
        if (card.classList.contains('filtered-out')) continue;
        if (card.classList.contains('card-titulo')) {
          card.classList.add('filtered-out');
          continue;
        }
        if (!matchedCards.has(card)) {
          card.classList.add('filtered-out');
        }
      }
      showContextHeadings();
    }

    searchMatches = articleCards.filter(c => matchedCards.has(c));
    searchIdx = 0;

    if (searchMatches.length > 0) {
      $searchNav.classList.add('open');
      $searchInput.classList.add('has-nav');
      updateSearchCounter();
      searchMatches[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      selectCard(searchMatches[0], true);
    } else {
      $searchNav.classList.remove('open');
      $searchInput.classList.remove('has-nav');
    }
  }

  $searchInput.addEventListener('input', (e) => {
    doSearch(e.target.value.trim());
  });

  $btnClearSearch.addEventListener('click', () => {
    $searchInput.value = '';
    preserveScroll(() => doSearch(''));
  });

  $btnFilter.addEventListener('click', () => {
    searchFilter = !searchFilter;
    $btnFilter.classList.toggle('active', searchFilter);
    preserveScroll(() => doSearch($searchInput.value.trim()));
  });

  function updateSearchCounter() {
    $searchCounter.textContent = (searchIdx + 1) + ' / ' + searchMatches.length;
  }

  function navigateSearch(delta) {
    if (!searchMatches.length) return;
    searchIdx = (searchIdx + delta + searchMatches.length) % searchMatches.length;
    updateSearchCounter();
    searchMatches[searchIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    selectCard(searchMatches[searchIdx], true);
  }

  document.getElementById('search-prev').addEventListener('click', () => navigateSearch(-1));
  document.getElementById('search-next').addEventListener('click', () => navigateSearch(1));

  // ===== MARKERS (click-on-identifier system) =====
  function loadMarkers() {
    try {
      const saved = localStorage.getItem('regimento-markers-v2');
      if (saved) markersList = JSON.parse(saved);
    } catch (e) {}
  }

  function saveMarkers() {
    localStorage.setItem('regimento-markers-v2', JSON.stringify(markersList));
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
    renderMarkerNav();
  }

  function clearAllMarkers() {
    markersList = [];
    saveMarkers();
    applyMarkers();
    renderMarkerNav();
  }

  function applyMarkers() {
    $cards.querySelectorAll('.unit-id').forEach(el => {
      el.style.backgroundColor = '';
      el.style.color = '';
    });

    for (const marker of markersList) {
      const el = $cards.querySelector(`.unit-id[data-uid="${marker.uid}"]`);
      if (!el) continue;
      const palette = MARKER_PALETTE[marker.colorIdx];
      el.style.backgroundColor = palette.bg;
      el.style.color = palette.text;
    }
  }

  function renderMarkerNav() {
    $markerNav.innerHTML = '';

    for (const marker of markersList) {
      const palette = MARKER_PALETTE[marker.colorIdx];
      const el = $cards.querySelector(`.unit-id[data-uid="${marker.uid}"]`);
      let label = el ? el.textContent.trim() : marker.uid;
      if (el) {
        const card = el.closest('.card-artigo');
        if (card) {
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
        const target = $cards.querySelector(`.unit-id[data-uid="${marker.uid}"]`);
        if (target) {
          const card = target.closest('.card');
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            selectCard(card, true);
          }
        }
      });
      $markerNav.appendChild(btn);
    }

    if (markersList.length > 0) {
      const clearBtn = document.createElement('button');
      clearBtn.id = 'marker-clear-all';
      clearBtn.className = 'visible';
      clearBtn.innerHTML = '&times;';
      clearBtn.title = 'Remover todos os marcadores';
      clearBtn.addEventListener('click', clearAllMarkers);
      $markerNav.appendChild(clearBtn);
    }
  }

  $cards.addEventListener('click', (e) => {
    const unitId = e.target.closest('.unit-id');
    if (unitId) {
      e.stopPropagation();
      toggleMarker(unitId.dataset.uid);
      return;
    }
  });

  // ===== FOOTNOTES =====
  $cards.addEventListener('click', (e) => {
    const ref = e.target.closest('.footnote-ref');
    if (ref) {
      e.stopPropagation();
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

  // ===== INDEX PANEL =====
  let currentIndexTab = 'systematic';

  function openIndex() {
    $indexOverlay.classList.add('open');
    $indexPanel.classList.add('open');
    renderIndex();
  }

  function closeIndex() {
    $indexOverlay.classList.remove('open');
    $indexPanel.classList.remove('open');
  }

  $btnIndex.addEventListener('click', openIndex);
  $indexOverlay.addEventListener('click', closeIndex);

  document.querySelectorAll('.index-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.index-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentIndexTab = tab.dataset.tab;
      renderIndex();
    });
  });

  const $btnClearIndexSearch = document.getElementById('btn-clear-index-search');

  $indexSearch.addEventListener('input', () => {
    $btnClearIndexSearch.style.display = $indexSearch.value.trim() ? 'flex' : 'none';
    renderIndex();
  });

  $btnClearIndexSearch.addEventListener('click', () => {
    $indexSearch.value = '';
    $btnClearIndexSearch.style.display = 'none';
    renderIndex();
    $indexSearch.focus();
  });

  function textMatchesFilter(text, filter) {
    const lower = stripAccents(text.toLowerCase());
    return stripAccents(filter).split(/\s+/).every(term => lower.includes(term));
  }

  function renderIndex() {
    const filter = $indexSearch.value.trim().toLowerCase();
    $indexContent.innerHTML = '';

    if (currentIndexTab === 'systematic') {
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
  }

  function highlightIndexContent(filter) {
    const terms = filter.split(/\s+/).filter(Boolean);
    const regex = new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    const walker = document.createTreeWalker($indexContent, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const tn of textNodes) {
      if (!regex.test(tn.textContent)) continue;
      regex.lastIndex = 0;
      const span = document.createElement('span');
      span.innerHTML = tn.textContent.replace(regex, '<mark>$1</mark>');
      tn.parentNode.replaceChild(span, tn);
    }
  }

  function sysLevelClass(sectionId) {
    if (!sectionId) return '';
    if (sectionId.startsWith('norma')) return 'sys-nivel-norma';
    if (sectionId.startsWith('tit'))   return 'sys-nivel-titulo';
    if (sectionId.startsWith('cap'))   return 'sys-nivel-capitulo';
    if (sectionId.startsWith('subsec')) return 'sys-nivel-subsecao';
    if (sectionId.startsWith('sec'))   return 'sys-nivel-secao';
    return '';
  }

  function renderSystematicIndex(filter) {
    for (const group of SYSTEMATIC_INDEX) {
      const isLaw = group.section_id && group.section_id.startsWith('norma');

      if (filter && !textMatchesFilter(group.title, filter)) {
        const hasChild = group.children && group.children.some(ch => sysNodeMatches(ch, filter));
        if (!hasChild) continue;
      }

      const div = document.createElement('div');
      div.className = 'sys-group';
      const title = document.createElement('div');
      const lvl = sysLevelClass(group.section_id);
      title.className = (isLaw ? 'sys-title sys-law' : 'sys-title') + (lvl ? ' ' + lvl : '');
      title.textContent = isLaw ? '— ' + group.title : group.title;
      if (group.art_range && (!group.children || !group.children.length)) {
        const rangeSpan = document.createElement('span');
        rangeSpan.className = 'sys-art-range';
        rangeSpan.textContent = ' ' + group.art_range;
        title.appendChild(rangeSpan);
      }
      if (group.section_id) {
        title.dataset.section = group.section_id;
        title.style.cursor = 'pointer';
        title.addEventListener('click', () => {
          closeIndex();
          navigateToSection(group.section_id);
        });
      }
      div.appendChild(title);

      if (group.children) {
        for (const ch of group.children) {
          renderSysNode(ch, div, 12, filter);
        }
      }

      $indexContent.appendChild(div);
    }
  }

  function sysNodeMatches(node, filter) {
    if (!node.title) return false;
    if (textMatchesFilter(node.title, filter)) return true;
    if (node.children) {
      for (const ch of node.children) {
        if (sysNodeMatches(ch, filter)) return true;
      }
    }
    return false;
  }

  function renderSysNode(node, parent, indent, filter) {
    if (!node.title) return;
    if (filter && !sysNodeMatches(node, filter)) return;

    const el = document.createElement('div');
    const lvl = sysLevelClass(node.section_id);
    el.className = 'sys-item' + (lvl ? ' ' + lvl : '');
    el.style.marginLeft = indent + 'px';
    el.textContent = node.title;
    if (node.art_range && (!node.children || !node.children.length)) {
      const rangeSpan = document.createElement('span');
      rangeSpan.className = 'sys-art-range';
      rangeSpan.textContent = ' ' + node.art_range;
      el.appendChild(rangeSpan);
    }

    if (node.section_id) {
      el.dataset.section = node.section_id;
      el.addEventListener('click', () => {
        closeIndex();
        navigateToSection(node.section_id);
      });
    }
    parent.appendChild(el);

    if (node.children) {
      for (const child of node.children) {
        renderSysNode(child, parent, indent + 12, filter);
      }
    }
  }

  function getCurrentSectionId() {
    const headerBottom = headerEl.getBoundingClientRect().bottom;
    const articles = getArticleCards().filter(c => !c.classList.contains('filtered-out'));
    let card = null;
    for (const a of articles) {
      const rect = a.getBoundingClientRect();
      if (rect.top > headerBottom) break;
      card = a;
    }
    if (!card) card = articles[0];
    if (!card) return '';
    // Walk backwards — first heading found is the most specific (deepest)
    let prev = card.previousElementSibling;
    while (prev) {
      if (prev.classList.contains('card-titulo') && prev.dataset.section) {
        return prev.dataset.section;
      }
      prev = prev.previousElementSibling;
    }
    return '';
  }

  function syncSystematicToScroll() {
    const sectionId = getCurrentSectionId();
    if (!sectionId) return;
    // Remove previous highlight
    $indexContent.querySelectorAll('.sys-active').forEach(el => el.classList.remove('sys-active'));
    // Find matching element in the index panel
    const target = $indexContent.querySelector('[data-section="' + sectionId + '"]');
    if (!target) return;
    target.classList.add('sys-active');
    target.scrollIntoView({ behavior: 'instant', block: 'center' });
  }

  function navigateToSection(sectionId) {
    const card = $cards.querySelector(`.card-titulo[data-section="${sectionId}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      selectCard(card, true);
    }
  }

  function formatRefsList(refs) {
    // Returns array of {label, hint, art, lawPrefix} — one per ref, no range compaction
    const result = [];
    for (const r of refs) {
      const prefix = r.law_prefix ? r.law_prefix + ' ' : '';
      const label = prefix + 'art. ' + r.art + (r.detail ? ', ' + r.detail : '');
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
    // Collect all refs from entry (direct + children) for the pill
    const all = [];
    if (entry.refs) all.push(...entry.refs);
    if (entry.children) {
      for (const ch of entry.children) {
        all.push(...ch.refs);
      }
    }
    return all;
  }

  function renderVides(vides) {
    const container = document.createElement('div');
    container.className = 'subj-vides';
    const label = document.createElement('span');
    label.className = 'vide-label';
    label.textContent = 'Vide: ';
    container.appendChild(label);
    vides.forEach((v, i) => {
      const link = document.createElement('a');
      link.className = 'vide-link';
      // Support "ASSUNTO|SUBASSUNTO" format
      const pipeIdx = v.indexOf('|');
      const subjectPart = pipeIdx !== -1 ? v.slice(0, pipeIdx).trim() : v;
      const subSubjectPart = pipeIdx !== -1 ? v.slice(pipeIdx + 1).trim() : '';
      link.textContent = subSubjectPart ? subjectPart + ' — ' + subSubjectPart : v;
      link.href = '#';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        // Find the referenced subject in the index and open it
        const target = SUBJECT_INDEX.find(
          s => stripAccents(s.subject.toLowerCase()) === stripAccents(subjectPart.toLowerCase())
        );
        if (target) {
          closeIndex();
          let refs = collectAllRefs(target);
          let pillLabel = target.subject;
          if (subSubjectPart && target.children) {
            const child = target.children.find(
              ch => stripAccents(ch.sub_subject.toLowerCase()) === stripAccents(subSubjectPart.toLowerCase())
            );
            if (child) {
              refs = child.refs;
              pillLabel = target.subject + ' — ' + child.sub_subject;
            }
          }
          openSubjectPill({ subject: pillLabel, refs });
        } else {
          // Try to filter the index to show the term
          const $indexSearch = document.getElementById('index-search');
          if ($indexSearch) {
            $indexSearch.value = subjectPart;
            $indexSearch.dispatchEvent(new Event('input'));
          }
        }
      });
      container.appendChild(link);
      if (i < vides.length - 1) {
        container.appendChild(document.createTextNode(', '));
      }
    });
    return container;
  }

  function renderSubjectIndex(filter) {
    const sorted = SUBJECT_INDEX.slice().sort((a, b) => a.subject.localeCompare(b.subject, 'pt-BR'));
    for (const entry of sorted) {
      const matchSelf = !filter || textMatchesFilter(entry.subject, filter);
      const matchChild = !matchSelf && entry.children && entry.children.some(
        ch => textMatchesFilter(ch.sub_subject, filter)
      );
      if (!matchSelf && !matchChild) continue;

      const div = document.createElement('div');
      div.className = 'subj-entry';
      const title = document.createElement('div');
      title.className = 'subj-title';
      title.textContent = entry.subject;
      const allRefs = collectAllRefs(entry);
      if (allRefs.length > 0) {
        title.addEventListener('click', () => {
          closeIndex();
          const pillEntry = { subject: entry.subject, refs: allRefs };
          openSubjectPill(pillEntry);
        });
      } else {
        title.classList.add('no-refs');
      }
      div.appendChild(title);

      // Direct refs
      if (entry.refs && entry.refs.length > 0) {
        const refsContainer = document.createElement('div');
        refsContainer.className = 'subj-refs';
        for (const item of formatRefsList(entry.refs)) {
          const line = document.createElement('div');
          line.className = 'subj-ref-line';
          const labelSpan = document.createTextNode(item.label);
          line.appendChild(labelSpan);
          if (item.hint) {
            const hintSpan = document.createElement('span');
            hintSpan.className = 'ref-hint';
            hintSpan.textContent = ' — ' + item.hint;
            line.appendChild(hintSpan);
          }
          refsContainer.appendChild(line);
        }
        div.appendChild(refsContainer);
      }

      // Vides (cross-references)
      if (entry.vides && entry.vides.length > 0) {
        div.appendChild(renderVides(entry.vides));
      }

      // Sub-subjects
      if (entry.children) {
        for (const ch of entry.children) {
          if (filter && !matchSelf && !textMatchesFilter(ch.sub_subject, filter)) continue;
          const subDiv = document.createElement('div');
          subDiv.className = 'subj-entry';
          subDiv.style.paddingLeft = '16px';
          const subTitle = document.createElement('div');
          subTitle.className = 'subj-title';
          subTitle.style.fontSize = '13px';
          subTitle.textContent = '— ' + ch.sub_subject;
          if (ch.refs && ch.refs.length > 0) {
            subTitle.addEventListener('click', ((child) => () => {
              closeIndex();
              const pillEntry = { subject: entry.subject + ' — ' + child.sub_subject, refs: child.refs };
              openSubjectPill(pillEntry);
            })(ch));
          } else {
            subTitle.classList.add('no-refs');
          }
          subDiv.appendChild(subTitle);

          const subRefs = document.createElement('div');
          subRefs.className = 'subj-refs';
          for (const item of formatRefsList(ch.refs)) {
            const line = document.createElement('div');
            line.className = 'subj-ref-line';
            const labelSpan = document.createTextNode(item.label);
            line.appendChild(labelSpan);
            if (item.hint) {
              const hintSpan = document.createElement('span');
              hintSpan.className = 'ref-hint';
              hintSpan.textContent = ' — ' + item.hint;
              line.appendChild(hintSpan);
            }
            subRefs.appendChild(line);
          }
          subDiv.appendChild(subRefs);

          // Vides on sub-subject
          if (ch.vides && ch.vides.length > 0) {
            subDiv.appendChild(renderVides(ch.vides));
          }

          div.appendChild(subDiv);
        }
      }

      $indexContent.appendChild(div);
    }
  }

  function renderReferencesIndex(filter) {
    if (!REFERENCIAS_INDEX.length) {
      $indexContent.textContent = 'Nenhuma referência disponível.';
      return;
    }

    // Category buttons
    const catBar = document.createElement('div');
    catBar.className = 'ref-categories';
    REFERENCIAS_INDEX.forEach((cat, idx) => {
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
    const cat = REFERENCIAS_INDEX[currentRefCategory];
    if (!cat) return;

    for (const group of cat.groups) {
      const hasMatch = !filter || group.entries.some(e => {
        const text = e.html.replace(/<[^>]*>/g, '');
        return textMatchesFilter(text, filter);
      });
      if (!hasMatch && !textMatchesFilter(group.title, filter)) continue;

      if (group.title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'ref-group-title';
        titleEl.textContent = group.title;
        $indexContent.appendChild(titleEl);
      }

      for (const entry of group.entries) {
        const entryText = entry.html.replace(/<[^>]*>/g, '');
        if (filter && !textMatchesFilter(entryText, filter) && !textMatchesFilter(group.title, filter)) continue;

        const entryEl = document.createElement('div');
        entryEl.className = 'ref-entry';

        const textSpan = document.createElement('span');
        textSpan.innerHTML = entry.html;
        entryEl.appendChild(textSpan);

        if (entry.art_ref) {
          const linkEl = document.createElement('a');
          linkEl.className = 'ref-art-link';
          linkEl.href = '#';
          linkEl.textContent = ' — Art. ' + entry.art_ref;
          linkEl.addEventListener('click', (e) => {
            e.preventDefault();
            closeIndex();
            // Extract base article number for navigation
            const artNum = entry.art_ref.replace(/[º°ª]/g, '').split(/[,\s]/)[0].trim();
            navigateToArt(artNum, '');
          });
          entryEl.appendChild(linkEl);
        }

        $indexContent.appendChild(entryEl);
      }
    }
  }

  function showContextHeadings() {
    // For each visible article, show its ancestor heading cards for context
    const cards = getAllCards();
    const visibleArts = cards.filter(c =>
      c.classList.contains('card-artigo') && !c.classList.contains('filtered-out')
    );
    for (const art of visibleArts) {
      const found = {}; // level → true
      let prev = art.previousElementSibling;
      while (prev) {
        if (prev.classList.contains('card-titulo')) {
          const sec = prev.dataset.section || '';
          let level = '';
          if (sec.startsWith('norma')) level = 'norma';
          else if (sec.startsWith('tit') || sec === 'adt') level = 'tit';
          else if (sec.startsWith('cap')) level = 'cap';
          else if (sec.startsWith('subsec')) level = 'subsec';
          else if (sec.startsWith('sec')) level = 'sec';
          if (level && !found[level]) {
            found[level] = true;
            prev.classList.remove('filtered-out');
            // Mark all lower levels as found so we don't pick up
            // headings from other branches (e.g. a capítulo from
            // a previous título that isn't an ancestor of this article)
            const hierarchy = ['norma', 'tit', 'cap', 'sec', 'subsec'];
            const idx = hierarchy.indexOf(level);
            for (let i = idx + 1; i < hierarchy.length; i++) found[hierarchy[i]] = true;
          }
          if (level === 'norma') break;
        }
        prev = prev.previousElementSibling;
      }
    }
  }

  function navigateToArt(artNum, lawPrefix) {
    let card;
    if (lawPrefix) {
      card = $cards.querySelector(`.card-artigo[data-art="${artNum}"][data-law="${lawPrefix}"]`);
    } else {
      card = $cards.querySelector(`.card-artigo[data-art="${artNum}"]:not([data-law])`)
          || $cards.querySelector(`.card-artigo[data-art="${artNum}"]`);
    }
    if (card) {
      scrollToReadingLine(card);
      selectCard(card, true);
    }
    return card;
  }

  // ===== DETAIL HIGHLIGHT =====
  function clearDetailHighlight() {
    $cards.querySelectorAll('.detail-highlight').forEach(el => {
      el.classList.remove('detail-highlight');
    });
  }

  function highlightAllSubjectDetails() {
    clearDetailHighlight();
    if (!activeSubject) return;
    for (const ref of activeSubject.refs) {
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
        card.classList.add('detail-highlight');
      } else if (ref.detail.trim().toLowerCase() === 'caput') {
        // Caput: first <p> that isn't .art-para
        const caput = card.querySelector('p:not(.art-para):not(.old-version)');
        if (caput) caput.classList.add('detail-highlight');
      } else {
        const dt = ref.detail.trim();
        let found = false;
        for (const uid of card.querySelectorAll('.unit-id')) {
          const path = uid.dataset.path || '';
          const ut = uid.textContent.trim();
          if (path === dt || ut === dt || (dt === '§ú' && ut === 'Parágrafo único')) {
            const p = uid.closest('p');
            if (p) p.classList.add('detail-highlight');
            found = true;
            break;
          }
        }
      }
    }
  }

  // ===== SUBJECT PILL =====
  function openSubjectPill(entry) {
    activeSubject = entry;
    subjectIdx = 0;
    subjectFilter = true;
    $pillFilter.classList.add('active');
    $subjectPill.classList.add('open');
    document.body.classList.add('pill-open');
    $pillLabel.textContent = entry.subject;
    updatePill();
    applySubjectFilter();
    highlightAllSubjectDetails();
    navigateToSubjectRef(0);
  }

  function closeSubjectPill() {
    activeSubject = null;
    $subjectPill.classList.remove('open');
    document.body.classList.remove('pill-open');
    $pillDropdown.classList.remove('open');
    clearDetailHighlight();
    preserveScroll(() => {
      getAllCards().forEach(c => c.classList.remove('filtered-out'));
      if (currentSearch) doSearch(currentSearch);
    });
  }

  function updatePill() {
    if (!activeSubject) return;
    const ref = activeSubject.refs[subjectIdx];
    const prefix = ref.law_prefix ? ref.law_prefix + ':' : '';
    $pillCurrent.textContent = prefix + 'Art. ' + ref.art + (ref.detail ? ', ' + ref.detail : '');
  }

  function findRefTarget(ref) {
    // Returns the most specific DOM element for a ref (card, caput <p>, or detail <p>)
    let card;
    if (ref.law_prefix) {
      card = $cards.querySelector(`.card-artigo[data-art="${ref.art}"][data-law="${ref.law_prefix}"]`);
    } else {
      card = $cards.querySelector(`.card-artigo[data-art="${ref.art}"]:not([data-law])`)
          || $cards.querySelector(`.card-artigo[data-art="${ref.art}"]`);
    }
    if (!card) return null;
    if (!ref.detail) return card;
    const dt = ref.detail.trim();
    if (dt.toLowerCase() === 'caput') {
      return card.querySelector('p:not(.art-para):not(.old-version)') || card;
    }
    for (const uid of card.querySelectorAll('.unit-id')) {
      const path = uid.dataset.path || '';
      const ut = uid.textContent.trim();
      if (path === dt || ut === dt || (dt === '§ú' && ut === 'Parágrafo único')) {
        return uid.closest('p') || card;
      }
    }
    return card;
  }

  function navigateToSubjectRef(idx) {
    if (!activeSubject) return;
    subjectIdx = idx;
    updatePill();
    const ref = activeSubject.refs[idx];
    const target = findRefTarget(ref);
    if (!target) return;
    const card = target.closest('.card') || target;
    scrollToReadingLine(target);
    selectCard(card, true);
  }

  function applySubjectFilter() {
    if (!activeSubject) return;
    const cards = getAllCards();
    if (subjectFilter) {
      // Build set of "lawPrefix:art" keys for precise matching
      const refKeys = new Set(activeSubject.refs.map(r => (r.law_prefix || '') + ':' + r.art));
      for (const card of cards) {
        if (card.classList.contains('card-titulo')) {
          card.classList.add('filtered-out');
        } else if (card.dataset.art) {
          const cardKey = (card.dataset.law || '') + ':' + card.dataset.art;
          if (!refKeys.has(cardKey)) {
            card.classList.add('filtered-out');
          } else {
            card.classList.remove('filtered-out');
          }
        } else {
          card.classList.remove('filtered-out');
        }
      }
      showContextHeadings();
    } else {
      cards.forEach(c => c.classList.remove('filtered-out'));
    }
  }

  document.getElementById('pill-prev').addEventListener('click', () => {
    if (!activeSubject) return;
    subjectIdx = (subjectIdx - 1 + activeSubject.refs.length) % activeSubject.refs.length;
    navigateToSubjectRef(subjectIdx);
  });

  document.getElementById('pill-next').addEventListener('click', () => {
    if (!activeSubject) return;
    subjectIdx = (subjectIdx + 1) % activeSubject.refs.length;
    navigateToSubjectRef(subjectIdx);
  });

  $pillCurrent.addEventListener('click', (e) => {
    e.stopPropagation();
    $pillDropdown.classList.toggle('open');
    renderPillDropdown();
  });

  function renderPillDropdown() {
    if (!activeSubject) return;
    $pillDropdown.innerHTML = '';
    activeSubject.refs.forEach((ref, idx) => {
      const btn = document.createElement('button');
      btn.className = 'pill-dd-item' + (idx === subjectIdx ? ' current' : '');
      const prefix = ref.law_prefix ? ref.law_prefix + ':' : '';
      btn.textContent = prefix + 'Art. ' + ref.art + (ref.detail ? ', ' + ref.detail : '');
      btn.addEventListener('click', () => {
        $pillDropdown.classList.remove('open');
        navigateToSubjectRef(idx);
      });
      $pillDropdown.appendChild(btn);
    });
  }

  $pillFilter.addEventListener('click', () => {
    subjectFilter = !subjectFilter;
    $pillFilter.classList.toggle('active', subjectFilter);
    preserveScroll(() => {
      applySubjectFilter();
      highlightAllSubjectDetails();
      if (currentSearch) doSearch(currentSearch);
    });
  });

  document.getElementById('pill-close').addEventListener('click', closeSubjectPill);

  document.addEventListener('click', (e) => {
    if (!$pillDropdown.contains(e.target) && e.target !== $pillCurrent) {
      $pillDropdown.classList.remove('open');
    }
  });

  // ===== PINCH-TO-ZOOM =====
  let initialPinchDist = null;
  let initialZoom = 1;

  function setZoom(scale) {
    preserveScroll(() => {
      zoomScale = Math.max(0.4, Math.min(2.5, scale));
      document.documentElement.style.setProperty('--zoom-scale', zoomScale);
    });

    $zoomIndicator.textContent = Math.round(zoomScale * 100) + '%';
    $zoomIndicator.classList.add('show');
    clearTimeout(zoomTimeout);
    zoomTimeout = setTimeout(() => $zoomIndicator.classList.remove('show'), 800);

    try { localStorage.setItem('regimento-zoom', zoomScale); } catch (e) {}
  }

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialPinchDist = Math.hypot(dx, dy);
      initialZoom = zoomScale;
    }
  }, { passive: false });

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
  });

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
    const card = selectedCard;
    compactMode = on;
    $cards.classList.toggle('compact', compactMode);
    $btnCompact.classList.toggle('active', compactMode);
    if (card && !card.classList.contains('filtered-out')) {
      const rect = card.getBoundingClientRect();
      const target = window.scrollY + rect.top - getReadingLineY();
      window.scrollTo({ top: Math.max(0, target), behavior: 'instant' });
    }
    updateBreadcrumb();
    try { localStorage.setItem('regimento-compact', compactMode ? '1' : '0'); } catch (e) {}
  }

  $btnCompact.addEventListener('click', () => setCompactMode(!compactMode));

  // ===== VERSION DIFF =====
  function wordDiff(oldText, newText) {
    const a = oldText.split(/\s+/).filter(Boolean);
    const b = newText.split(/\s+/).filter(Boolean);
    const m = a.length, n = b.length;
    // LCS table
    const dp = Array.from({length: m + 1}, () => new Uint16Array(n + 1));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
      }
    }
    // Backtrack
    const result = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
        result.push({type: 'eq', text: a[i-1]});
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
        result.push({type: 'ins', text: b[j-1]});
        j--;
      } else {
        result.push({type: 'del', text: a[i-1]});
        i--;
      }
    }
    return result.reverse();
  }

  function extractPlainText(el) {
    // Get text content excluding amendment-note spans
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.amendment-note, .diff-toggle').forEach(n => n.remove());
    return clone.textContent.trim();
  }

  function findCurrentVersion(oldEl) {
    const ident = oldEl.dataset.ident || '';
    // Walk forward through siblings to find matching current version
    let sib = oldEl.nextElementSibling;
    while (sib) {
      if (sib.classList.contains('old-version')) {
        // Another old version — skip
        sib = sib.nextElementSibling;
        continue;
      }
      // It's a current-version paragraph
      if (!ident) return sib;
      const uid = sib.querySelector('.unit-id');
      if (uid) {
        const uidText = uid.textContent.trim();
        // Match: "Art. 38" ↔ "Art. 38", "§ 1º" ↔ "§ 1º", etc.
        if (ident === uidText || ident.replace(/\s+/g, '') === uidText.replace(/\s+/g, '')) {
          return sib;
        }
      }
      // For caput without .art-para, the first non-old-version <p> is the match
      if (!sib.classList.contains('art-para') && sib.tagName === 'P') {
        return sib;
      }
      break;
    }
    return null;
  }

  function toggleDiff(oldEl) {
    // If already open, close
    if (oldEl.classList.contains('diff-open')) {
      oldEl.classList.remove('diff-open');
      const panel = oldEl.nextElementSibling;
      if (panel && panel.classList.contains('diff-panel')) {
        panel.remove();
      }
      return;
    }

    const currentEl = findCurrentVersion(oldEl);
    if (!currentEl) return;

    const oldText = extractPlainText(oldEl);
    const currentClone = currentEl.cloneNode(true);
    currentClone.querySelectorAll('.footnote-ref, .footnote-box').forEach(n => n.remove());
    const newText = currentClone.textContent.trim();

    const diff = wordDiff(oldText, newText);

    const panel = document.createElement('div');
    panel.className = 'diff-panel';
    for (const part of diff) {
      if (part.type === 'del') {
        const s = document.createElement('span');
        s.className = 'diff-del';
        s.textContent = part.text;
        panel.appendChild(s);
        panel.appendChild(document.createTextNode(' '));
      } else if (part.type === 'ins') {
        const s = document.createElement('span');
        s.className = 'diff-ins';
        s.textContent = part.text;
        panel.appendChild(s);
        panel.appendChild(document.createTextNode(' '));
      } else {
        panel.appendChild(document.createTextNode(part.text + ' '));
      }
    }

    oldEl.classList.add('diff-open');
    oldEl.after(panel);
  }

  // Inject diff-toggle icons into all old-version paragraphs
  function initDiffToggles() {
    $cards.querySelectorAll('.old-version').forEach(el => {
      if (el.querySelector('.diff-toggle')) return;
      if (!findCurrentVersion(el)) return;
      const btn = document.createElement('span');
      btn.className = 'diff-toggle';
      btn.textContent = '\u21C4';
      btn.title = 'Comparar com versão atual';
      el.appendChild(btn);
    });
  }

  // Delegated click handler for diff
  $cards.addEventListener('click', (e) => {
    const toggle = e.target.closest('.diff-toggle');
    if (toggle) {
      e.stopPropagation();
      const oldEl = toggle.closest('.old-version');
      if (oldEl) toggleDiff(oldEl);
      return;
    }
  });

  // ===== INIT =====
  try {
    const savedZoom = localStorage.getItem('regimento-zoom');
    if (savedZoom) setZoom(parseFloat(savedZoom));
  } catch (e) {}
  try {
    if (localStorage.getItem('regimento-compact') === '1') setCompactMode(true);
  } catch (e) {}
  loadMarkers();
  applyMarkers();
  renderMarkerNav();
  updateSelection();
  updateBreadcrumb();
  initDiffToggles();

})();
