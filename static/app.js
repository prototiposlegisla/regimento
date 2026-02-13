(function() {
  'use strict';

  // ===== DATA (injected by build.py) =====
  const SYSTEMATIC_INDEX = /*__SYSTEMATIC_INDEX__*/[];

  const SUBJECT_INDEX = /*__SUBJECT_INDEX__*/[];

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

  let scrollTick = false;
  window.addEventListener('scroll', () => {
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => {
      manualSelect = false;
      updateSelection();
      scrollTick = false;
    });
  });

  $cards.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    if (e.target.closest('.footnote-ref') || e.target.closest('.footnote-box') || e.target.closest('.unit-id') || e.target.closest('.btn-toggle-versions')) return;
    selectCard(card, true);
  });

  // ===== SEARCH =====
  function clearHighlights() {
    $cards.querySelectorAll('mark').forEach(m => {
      const parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
  }

  function highlightText(node, term) {
    if (!term) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    while (walker.nextNode()) {
      if (walker.currentNode.parentElement.closest('.footnote-box, .art-head')) continue;
      textNodes.push(walker.currentNode);
    }
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    for (const tn of textNodes) {
      if (!regex.test(tn.textContent)) continue;
      const span = document.createElement('span');
      span.innerHTML = tn.textContent.replace(regex, '<mark>$1</mark>');
      tn.parentNode.replaceChild(span, tn);
    }
  }

  function doSearch(term) {
    currentSearch = term;
    clearHighlights();
    const cards = getAllCards();

    cards.forEach(c => c.classList.remove('filtered-out'));

    if (!term) {
      $btnClearSearch.style.display = 'none';
      return;
    }

    $btnClearSearch.style.display = 'flex';

    // Article navigation: a43, a44, aADT1, etc
    const artMatch = term.match(/^a(\d+[-A-Za-z]*)$/i);
    if (artMatch) {
      const artNum = artMatch[1];
      const target = $cards.querySelector(`.card-artigo[data-art="${artNum}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        selectCard(target, true);
      }
      return;
    }

    const articleCards = getArticleCards();
    const matchedCards = new Set();

    for (const card of articleCards) {
      const text = card.textContent.toLowerCase();
      if (text.includes(term.toLowerCase())) {
        matchedCards.add(card);
        highlightText(card, term);
      }
    }

    if (searchFilter) {
      for (const card of cards) {
        if (card.classList.contains('card-titulo')) {
          card.classList.add('filtered-out');
          continue;
        }
        if (!matchedCards.has(card)) {
          card.classList.add('filtered-out');
        }
      }
    }

    const firstMatch = articleCards.find(c => matchedCards.has(c));
    if (firstMatch) {
      firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
      selectCard(firstMatch, true);
    }
  }

  $searchInput.addEventListener('input', (e) => {
    doSearch(e.target.value.trim());
  });

  $btnClearSearch.addEventListener('click', () => {
    $searchInput.value = '';
    doSearch('');
  });

  $btnFilter.addEventListener('click', () => {
    searchFilter = !searchFilter;
    $btnFilter.classList.toggle('active', searchFilter);
    doSearch($searchInput.value.trim());
  });

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
      const label = el ? el.textContent : marker.uid;

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

  // ===== VERSION TOGGLE =====
  $cards.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-toggle-versions');
    if (btn) {
      e.stopPropagation();
      const card = btn.closest('.card');
      const box = card.querySelector('.old-versions');
      if (box) {
        box.classList.toggle('open');
        btn.textContent = box.classList.contains('open')
          ? 'Ocultar redações anteriores'
          : 'Ver redações anteriores';
      }
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

  $indexSearch.addEventListener('input', () => renderIndex());

  function renderIndex() {
    const filter = $indexSearch.value.trim().toLowerCase();
    $indexContent.innerHTML = '';

    if (currentIndexTab === 'systematic') {
      renderSystematicIndex(filter);
    } else {
      renderSubjectIndex(filter);
    }
  }

  function renderSystematicIndex(filter) {
    for (const group of SYSTEMATIC_INDEX) {
      if (filter && !group.title.toLowerCase().includes(filter)) {
        const hasChild = group.children && group.children.some(ch =>
          ch.title && ch.title.toLowerCase().includes(filter) ||
          (ch.children && ch.children.some(it =>
            (it.label && it.label.toLowerCase().includes(filter)) ||
            (it.title && it.title.toLowerCase().includes(filter)) ||
            (it.children && it.children.some(sub => sub.label && sub.label.toLowerCase().includes(filter)))
          ))
        );
        if (!hasChild) continue;
      }

      const div = document.createElement('div');
      div.className = 'sys-group';
      const title = document.createElement('div');
      title.className = 'sys-title';
      title.textContent = group.title;
      div.appendChild(title);

      if (group.children) {
        for (const ch of group.children) {
          renderSysNode(ch, div, 12, filter);
        }
      }

      $indexContent.appendChild(div);
    }
  }

  function renderSysNode(node, parent, indent, filter) {
    if (node.label) {
      // Leaf node (article)
      if (filter && !node.label.toLowerCase().includes(filter)) return;
      const el = document.createElement('div');
      el.className = 'sys-item';
      el.style.paddingLeft = indent + 'px';
      el.textContent = node.label;
      el.addEventListener('click', () => {
        closeIndex();
        navigateToArt(node.art);
      });
      parent.appendChild(el);
    } else if (node.title) {
      // Branch node (chapter/section)
      if (filter && !node.title.toLowerCase().includes(filter) &&
          !(node.children && node.children.some(it =>
            (it.label && it.label.toLowerCase().includes(filter)) ||
            (it.title && it.title.toLowerCase().includes(filter)) ||
            (it.children && it.children.some(sub => sub.label && sub.label.toLowerCase().includes(filter)))
          ))) return;

      const subTitle = document.createElement('div');
      subTitle.className = 'sys-title';
      subTitle.style.paddingLeft = indent + 'px';
      subTitle.style.fontSize = '12px';
      subTitle.textContent = node.title;
      parent.appendChild(subTitle);

      if (node.children) {
        for (const child of node.children) {
          renderSysNode(child, parent, indent + 12, filter);
        }
      }
    }
  }

  function renderSubjectIndex(filter) {
    const sorted = SUBJECT_INDEX.slice().sort((a, b) => a.subject.localeCompare(b.subject, 'pt-BR'));
    for (const entry of sorted) {
      if (filter && !entry.subject.toLowerCase().includes(filter)) continue;

      const div = document.createElement('div');
      div.className = 'subj-entry';
      const title = document.createElement('div');
      title.className = 'subj-title';
      title.textContent = entry.subject;
      title.addEventListener('click', () => {
        closeIndex();
        openSubjectPill(entry);
      });
      div.appendChild(title);

      const refs = document.createElement('div');
      refs.className = 'subj-refs';
      refs.textContent = entry.refs.map(r => 'Art. ' + r.art + (r.detail ? ', ' + r.detail : '')).join('; ');
      div.appendChild(refs);

      $indexContent.appendChild(div);
    }
  }

  function navigateToArt(artNum) {
    const card = $cards.querySelector(`.card-artigo[data-art="${artNum}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      selectCard(card, true);
    }
  }

  // ===== SUBJECT PILL =====
  function openSubjectPill(entry) {
    activeSubject = entry;
    subjectIdx = 0;
    subjectFilter = true;
    $pillFilter.classList.add('active');
    $subjectPill.classList.add('open');
    $pillLabel.textContent = entry.subject;
    updatePill();
    applySubjectFilter();
    navigateToSubjectRef(0);
  }

  function closeSubjectPill() {
    activeSubject = null;
    $subjectPill.classList.remove('open');
    $pillDropdown.classList.remove('open');
    getAllCards().forEach(c => c.classList.remove('filtered-out'));
  }

  function updatePill() {
    if (!activeSubject) return;
    const ref = activeSubject.refs[subjectIdx];
    $pillCurrent.textContent = 'Art. ' + ref.art + (ref.detail ? ', ' + ref.detail : '');
  }

  function navigateToSubjectRef(idx) {
    if (!activeSubject) return;
    subjectIdx = idx;
    updatePill();
    const ref = activeSubject.refs[idx];
    navigateToArt(ref.art);
  }

  function applySubjectFilter() {
    if (!activeSubject) return;
    const cards = getAllCards();
    if (subjectFilter) {
      const artNums = new Set(activeSubject.refs.map(r => r.art));
      for (const card of cards) {
        if (card.classList.contains('card-titulo')) {
          card.classList.add('filtered-out');
        } else if (card.dataset.art && !artNums.has(card.dataset.art)) {
          card.classList.add('filtered-out');
        } else {
          card.classList.remove('filtered-out');
        }
      }
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
      btn.textContent = 'Art. ' + ref.art + (ref.detail ? ', ' + ref.detail : '');
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
    applySubjectFilter();
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
    zoomScale = Math.max(0.4, Math.min(2.5, scale));
    document.documentElement.style.setProperty('--zoom-scale', zoomScale);

    $zoomIndicator.textContent = Math.round(zoomScale * 100) + '%';
    $zoomIndicator.classList.add('show');
    clearTimeout(zoomTimeout);
    zoomTimeout = setTimeout(() => $zoomIndicator.classList.remove('show'), 800);

    if (selectedCard) {
      selectedCard.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
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

  // ===== INIT =====
  loadMarkers();
  applyMarkers();
  renderMarkerNav();
  updateSelection();

})();
