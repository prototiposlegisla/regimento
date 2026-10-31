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

  // Reads only (no DOM writes): what the breadcrumb should show, or null
  function computeBreadcrumb() {
    if (compactMode) return null;

    // Find the last article card whose top is at or above the header bottom.
    // Using "last above" (instead of "straddles") ensures the breadcrumb stays
    // visible even when a gap or a title card sits exactly at the header line.
    const headerBottom = headerEl.getBoundingClientRect().bottom;
    const articles = visibleOnly(ARTICLE_CARDS);
    const card = articles[firstCardWhere(articles, r => r.top > headerBottom) - 1];
    if (!card) return null;

    // Find the last unit-id hidden behind the header
    const unitIds = card.querySelectorAll('.unit-id[data-path]');
    let currentUnit = null;
    for (const uid of unitIds) {
      if (uid.closest('.old-version')) continue;
      if (uid.getBoundingClientRect().bottom <= headerBottom) {
        currentUnit = uid;
      }
    }

    // Ancestor headings out of view: filtered-out (display:none, definitely
    // above) or scrolled above header
    const headings = collectAncestorHeadings(card).filter(h =>
      h.el.classList.contains('filtered-out') || h.el.getBoundingClientRect().bottom <= headerBottom);

    // Only show breadcrumb when at least one ancestor title is out of view
    if (headings.length === 0) return null;

    return { card, headings, path: currentUnit ? currentUnit.dataset.path : '' };
  }

  let breadcrumbShown = null; // content currently built in $breadcrumb

  function sameBreadcrumb(a, b) {
    return !!(a && b && a.card === b.card && a.path === b.path &&
      a.headings.length === b.headings.length &&
      a.headings.every((h, i) => h.el === b.headings[i].el));
  }

  function updateBreadcrumb() {
    applyBreadcrumb(computeBreadcrumb());
  }

  function applyBreadcrumb(bc) {
    if (!bc) {
      $breadcrumb.classList.remove('visible', 'open');
      return;
    }
    const { card, headings } = bc;
    // Rebuild only when the content changes (scroll fires every frame)
    if (sameBreadcrumb(bc, breadcrumbShown)) {
      $breadcrumb.classList.add('visible');
      breadcrumbCard = card;
      return;
    }
    breadcrumbShown = bc;

    // Build breadcrumb DOM
    $breadcrumb.innerHTML = '';
    $breadcrumb.classList.toggle('bc-phone', PHONE.matches);
    if (PHONE.matches) {
      buildPhoneBreadcrumb(bc);
      $breadcrumb.classList.add('visible');
      breadcrumbCard = card;
      return;
    }

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
      if (h.level === 'norma') span.dataset.nrm = h.el.dataset.nrm || 'RI';   // its color (CSS)
      span.textContent = getHeadingShortTitle(h.el);
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        const top = h.el.getBoundingClientRect().top + window.scrollY;
        scrollToY(top - getReadingLineY(), 'smooth');
      });
      $breadcrumb.appendChild(span);
    });

    if (headings.length > 0) addSep();
    const artSpan = document.createElement('span');
    artSpan.className = 'bc-item bc-article';
    const lawPrefix = card.dataset.law;
    artSpan.textContent = isPrecCard(card) ? precLabel(card.dataset.art)
      : (lawPrefix ? lawPrefix + '\u00a0' : '') + card.dataset.art;
    artSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      const top = card.getBoundingClientRect().top + window.scrollY;
      scrollToY(top - getReadingLineY(), 'smooth');
    });
    $breadcrumb.appendChild(artSpan);

    if (bc.path) {
      const parts = bc.path.split(',');
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

  // On a phone, one line: the levels by their numbers ("RI", "II", "IV"),
  // the deepest with its name, each on its level's color, and the article;
  // a tap opens the whole path under it, each heading on its color, and a
  // heading there goes to it. The line never wraps over the text.
  const PHONE = window.matchMedia('(max-width: 600px)');
  function bcHeadingParts(h) {
    const name = getHeadingShortTitle(h.el);
    if (h.level === 'norma') return [SYS_NORM_SHORT[name] || name, name];
    const m = name.match(/^([IVXLC]+[-A-Z]*|ÚNIC[OA])(?:-(.*))?$/i);
    if (!m) return ['', sysCase(name)];
    const num = /^ÚNIC/i.test(m[1]) ? 'Único' : m[1];
    return [num, m[2] ? sysCase(m[2]) : ''];
  }
  const BC_LEVEL_WORD = { tit: 'Título', cap: 'Capítulo', sec: 'Seção', subsec: 'Subseção' };
  function buildPhoneBreadcrumb(bc) {
    const { card, headings } = bc;
    const line = document.createElement('div');
    line.className = 'bc-line';
    line.setAttribute('role', 'button');
    line.setAttribute('aria-expanded', 'false');
    line.title = 'Ver onde você está';
    headings.forEach((h, i) => {
      const [num, name] = bcHeadingParts(h);
      const span = document.createElement('span');
      span.className = 'bc-item bc-' + h.level + (i === headings.length - 1 ? ' bc-last' : '');
      if (h.level === 'norma') span.dataset.nrm = h.el.dataset.nrm || 'RI';
      span.textContent = i === headings.length - 1 && h.level !== 'norma' && name
        ? (num ? num + ' · ' : '') + name : num || name;
      line.appendChild(span);
    });
    const art = document.createElement('span');
    art.className = 'bc-item bc-article';
    art.textContent = isPrecCard(card) ? precLabel(card.dataset.art)
      : (card.dataset.law ? card.dataset.law + '\u00a0' : '') + 'Art.\u00a0' + card.dataset.art;
    const more = document.createElement('span');
    more.className = 'bc-more';
    more.setAttribute('aria-hidden', 'true');
    line.append(art, more);

    const list = document.createElement('div');
    list.className = 'bc-list';
    const go = el => {
      $breadcrumb.classList.remove('open');
      const top = el.getBoundingClientRect().top + window.scrollY;
      scrollToY(top - getReadingLineY(), 'smooth');
    };
    headings.forEach((h, i) => {
      const [num, name] = bcHeadingParts(h);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bc-row bc-' + h.level;
      row.style.setProperty('--d', i);
      row.textContent = h.level === 'norma' ? name
        : [BC_LEVEL_WORD[h.level] && num ? BC_LEVEL_WORD[h.level] + ' ' + num : num, name].filter(Boolean).join(' — ');
      row.addEventListener('click', e => { e.stopPropagation(); go(h.el); });
      list.appendChild(row);
    });
    const artRow = document.createElement('button');
    artRow.type = 'button';
    artRow.className = 'bc-row bc-article';
    artRow.style.setProperty('--d', headings.length);
    const summary = card.querySelector(':scope > .art-summary');
    artRow.textContent = art.textContent.replace(/\u00a0/g, ' ')
      + (bc.path ? ', ' + bc.path.split(',').join(', ') : '')
      + (summary ? ' — ' + summary.textContent.trim() : '');
    artRow.addEventListener('click', e => { e.stopPropagation(); go(card); });
    list.appendChild(artRow);
    $breadcrumb.append(line, list);
  }
  PHONE.addEventListener('change', () => {
    breadcrumbShown = null;
    $breadcrumb.classList.remove('open');
    document.body.classList.remove('hide-top');
    updateBreadcrumb();
  });

  $breadcrumb.addEventListener('click', (e) => {
    if ($breadcrumb.classList.contains('bc-phone')) {
      if (!e.target.closest('.bc-line')) return;
      const open = $breadcrumb.classList.toggle('open');
      e.target.closest('.bc-line').setAttribute('aria-expanded', String(open));
      return;
    }
    if (e.target.closest('.bc-item')) return;
    if (breadcrumbCard) {
      const top = breadcrumbCard.getBoundingClientRect().top + window.scrollY;
      scrollToY(top - getReadingLineY(), 'smooth');
    }
  });

  // Selection, breadcrumb, minimap viewport and nearby search highlights for
  // the current scroll position. Reads all geometry before writing anything,
  // so the frame lays out once.
  function syncToScroll() {
    manualSelect = false;
    const viewport = readMinimapViewport();
    const best = findSelectionCard();
    const bc = computeBreadcrumb();
    registerNearbyHits();
    if (best && best !== selectedCard) selectCard(best, false);
    applyBreadcrumb(bc);
    applyMinimapViewport(viewport);
    if (best) showNorma(best);
  }

  // The norma being read gives its color to the window (style.css, --bg)
  function showNorma(card) {
    const law = card.dataset.law || card.dataset.nrm;
    const root = document.documentElement;
    if (law) { if (root.dataset.nrm !== law) root.dataset.nrm = law; }
    else if (root.dataset.nrm) delete root.dataset.nrm;
  }

  // A card drawn for the first time above the screen changes height
  // (estimate → real). Chrome's scroll anchoring keeps the text being read
  // still; WebKit (so every iOS browser) lets it jump. There, compensate by
  // hand right after layout and before paint (ResizeObserver), and only when
  // first draws are all that changed: zoom, filters and the compact mode
  // move the cards themselves.
  const UA = navigator.userAgent;
  if (/AppleWebKit\//.test(UA) && !/Chrome\/|Edg\//.test(UA) && window.ResizeObserver) {
    const lastHeight = new Map();
    const firstDraws = new ResizeObserver(entries => {
      let shift = 0, onlyFirstDraws = true;
      for (const e of entries) {
        const card = e.target;
        const h = e.borderBoxSize[0].blockSize;
        const before = lastHeight.get(card);
        lastHeight.set(card, h);
        if (before === undefined) continue;
        const compactArt = compactMode && card.classList.contains('card-artigo');
        const estimate = parseFloat(card.style.getPropertyValue(compactArt ? '--card-hc' : '--card-h'))
          + (compactArt ? 16 : 32) * zoomScale;
        if (Math.abs(before - estimate) > 1) { onlyFirstDraws = false; continue; }
        if (card.getBoundingClientRect().top < 0) shift += h - before;
      }
      if (onlyFirstDraws && shift && Math.abs(shift) < window.innerHeight / 2) {
        window.scrollBy({ top: shift, behavior: 'instant' });
      }
    });
    ALL_CARDS.forEach(card => firstDraws.observe(card));
  }

  // On a phone, the header goes away while reading down and comes back on
  // the way up (or at the top); it stays while the search, its results or
  // the index are in use, and through jumps (a search, a remissão). A thin
  // bar at the top shows how far into the document the reading is.
  const $readProgress = document.createElement('div');
  $readProgress.id = 'read-progress';
  document.body.appendChild($readProgress);
  let lastScrollY = window.scrollY;
  window.addEventListener('scroll', () => {
    if (!PHONE.matches) return;
    const y = window.scrollY;
    const dy = y - lastScrollY;
    lastScrollY = y;
    const root = document.documentElement;
    $readProgress.style.transform = 'scaleX(' + Math.min(1, y / Math.max(1, root.scrollHeight - root.clientHeight)) + ')';
    const busy = resultsDrawerOpen || document.activeElement === $searchInput
      || $indexPanel.classList.contains('open') || $breadcrumb.classList.contains('open') || smoothScrolling;
    if (y <= 80 || busy || dy < -6) document.body.classList.remove('hide-top');
    else if (dy > 6 && dy < window.innerHeight) document.body.classList.add('hide-top');
  }, { passive: true });
  $searchInput.addEventListener('focus', () => document.body.classList.remove('hide-top'));
  // the long hint doesn't fit a phone's search field
  const SEARCH_HINT = $searchInput.placeholder;
  const setSearchHint = () => { $searchInput.placeholder = PHONE.matches ? 'Buscar ou r43…' : SEARCH_HINT; };
  setSearchHint();
  PHONE.addEventListener('change', setSearchHint);

  let scrollTick = false;
  window.addEventListener('scroll', () => {
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => {
      syncToScroll();
      scrollTick = false;
    });
  });

  $cards.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    if (e.target.closest('.footnote-ref') || e.target.closest('.footnote-box') || e.target.closest('.unit-id')) return;
    selectCard(card, true);
  });

