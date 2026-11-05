  // ===== SCROLL GUIDE (phones) =====
  // A phone's own scrollbar can't be dragged, and over a document of more than
  // a thousand screens it is under a pixel tall. So a fast scroll with the
  // finger brings a paper tab out of the right edge, with the norma and the
  // article; dragging it runs through the whole document, the page following
  // live and the path to the article beside the finger. Proportional, without
  // help: a pixel of drag is some two screens (chosen in the fitting room of
  // the scrolling, 05/11/2026). Back undoes the trip (14-voltar-e-avancar.js).
  const $guide = document.getElementById('scroll-guide');
  const $guideGrip = document.getElementById('sg-grip');
  const $guideNorma = document.getElementById('sg-norma');
  const $guideNum = document.getElementById('sg-num');
  const $guideOrigin = document.getElementById('sg-origin');
  const $guideBubble = document.getElementById('sg-bubble');
  const GUIDE_FAST = 2.5;      // screens per second that call it
  const GUIDE_LINGER = 1500;
  const GUIDE_TOP = 96, GUIDE_BOTTOM = 18;   // the tab's way: below the bars, above the screen's foot
  const GRIP_H = 76;           // the place to touch, bigger than the tab
  let guideShown = false;
  let guideHeld = null;        // the drag going on
  let guideTimer = 0;
  let guideCard = null;        // the article the tab shows
  let guideBubbleH = 0;
  let fingerScrolling = false;
  const scrollSamples = [];    // [time, scrollY] of the last moments

  function guideMayShow() {
    return PHONE.matches && !resultsDrawerOpen && !$indexPanel.classList.contains('open');
  }

  function showGuide() {
    if (!guideMayShow()) return;
    if (!guideShown) {
      guideShown = true;
      $guide.classList.add('visible');
      applyScrollGuide(readScrollGuide(), findSelectionCard());
    }
    clearTimeout(guideTimer);
    if (!guideHeld) guideTimer = setTimeout(hideGuide, GUIDE_LINGER);
  }

  function hideGuide() {
    guideShown = false;
    $guide.classList.remove('visible');
  }

  function guideTop() {
    return GUIDE_TOP;
  }
  function guideBottom() {
    return window.innerHeight - GUIDE_BOTTOM;
  }

  // Where the scroll puts the tab; null when it isn't the scroll that places
  // it. Reads only, for syncToScroll
  function readScrollGuide() {
    if (!guideShown || guideHeld) return null;
    const root = document.documentElement;
    const top = guideTop();
    return top + window.scrollY / Math.max(1, root.scrollHeight - root.clientHeight) * (guideBottom() - top);
  }

  function placeGuideGrip(y) {
    $guideGrip.style.transform = `translate3d(0, ${Math.round(y - GRIP_H / 2)}px, 0)`;
  }

  function placeGuideBubble(y) {
    const top = Math.max(8, Math.min(guideBottom() + 12 - guideBubbleH, y - guideBubbleH / 2 - 20));
    $guideBubble.style.transform = `translate3d(0, ${Math.round(top)}px, 0)`;
  }

  // The card on the reading line may be a heading: the article that opens it
  function guideArticle(card) {
    for (let c = card, i = 0; c && i < 8; c = c.nextElementSibling, i++) {
      if (c.classList.contains('card-artigo') && !c.classList.contains('filtered-out')) return c;
    }
    return null;
  }

  function applyScrollGuide(y, card) {
    if (!guideShown) return;
    if (y !== null) placeGuideGrip(y);
    const article = card && guideArticle(card);
    if (article && article !== guideCard) {
      guideCard = article;
      const norma = article.dataset.law || 'RI';
      $guide.style.setProperty('--sg-c', 'var(--n-' + norma.toLowerCase() + ')');
      $guideNorma.textContent = norma === 'PREC' ? 'Prec.' : norma;
      $guideNum.textContent = isPrecCard(article) ? precLabel(article.dataset.art) : article.dataset.art;
      if (guideHeld) {
        buildGuideBubble(article);
        placeGuideBubble(guideHeld.y);
      }
    }
  }

  // The path to the article, and its summary
  function buildGuideBubble(article) {
    const line = (tag, cls, text) => {
      const el = document.createElement(tag);
      el.className = cls;
      el.textContent = text;
      return el;
    };
    $guideBubble.textContent = '';
    for (const h of collectAncestorHeadings(article)) {
      $guideBubble.appendChild(line('span', 'sg-path' + (h.level === 'norma' ? ' sg-path-norma' : ''), bcHeadingRowText(h)));
    }
    const label = line('span', 'sg-article', '');
    label.append(line('span', 'sg-article-norma', $guideNorma.textContent),
      line('b', '', isPrecCard(article) ? $guideNum.textContent : 'Art. ' + $guideNum.textContent));
    $guideBubble.appendChild(label);
    const summary = article.querySelector(':scope > .art-summary');
    if (summary) $guideBubble.appendChild(line('span', 'sg-summary', summary.textContent.trim()));
    guideBubbleH = $guideBubble.offsetHeight;
  }

  // ----- what calls it: a fast scroll by a finger, not a jump, not a pinch -----
  window.addEventListener('touchstart', () => { fingerScrolling = false; }, { passive: true, capture: true });
  window.addEventListener('touchmove', e => {
    fingerScrolling = !guideHeld && e.touches.length === 1;
  }, { passive: true, capture: true });
  // (a fling goes on after the finger leaves; this is when it ends)
  window.addEventListener('scrollend', () => { fingerScrolling = false; });
  window.addEventListener('scroll', () => {
    if (!fingerScrolling || !PHONE.matches) return;
    const now = performance.now(), y = window.scrollY;
    // a new movement doesn't inherit the speed of the last one
    if (scrollSamples.length && now - scrollSamples[scrollSamples.length - 1][0] > 250) scrollSamples.length = 0;
    scrollSamples.push([now, y]);
    while (now - scrollSamples[0][0] > 200) scrollSamples.shift();
    const span = now - scrollSamples[0][0];
    const speed = span < 30 ? 0 : Math.abs(y - scrollSamples[0][1]) / window.innerHeight / (span / 1000);
    if (guideShown || speed >= GUIDE_FAST) showGuide();
  }, { passive: true });

  // ----- the drag (touch-action: none: the browser never starts to scroll
  // from the tab, so it doesn't cancel the pointer) -----
  let guideFrame = 0;
  function guideDragFrame() {
    guideFrame = 0;
    const held = guideHeld;
    if (!held) return;
    const root = document.documentElement;
    const top = guideTop();
    window.scrollTo({ top: (held.y - top) / (guideBottom() - top) * (root.scrollHeight - root.clientHeight), behavior: 'instant' });
    placeGuideGrip(held.y);
    placeGuideBubble(held.y);
    $guide.classList.toggle('away', Math.abs(held.y - held.from) > 24);
  }

  $guideGrip.addEventListener('pointerdown', e => {
    if (e.button || !guideShown) return;
    e.preventDefault();
    $guideGrip.setPointerCapture(e.pointerId);
    cancelScrollCorrection();
    const y = readScrollGuide();
    guideHeld = { pointer: e.pointerId, offset: e.clientY - y, from: y, y, moved: false };
    clearTimeout(guideTimer);
    $breadcrumb.classList.remove('open');
    document.body.classList.add('hide-top');
    $markerNav.classList.add('under-guide');
    $guide.classList.add('held');
    $guideOrigin.style.top = y + 'px';
    guideCard = null;
    applyScrollGuide(null, findSelectionCard());
    placeGuideBubble(y);
  });

  $guideGrip.addEventListener('pointermove', e => {
    const held = guideHeld;
    if (!held || e.pointerId !== held.pointer) return;
    if (!held.moved) {
      if (Math.abs(e.clientY - held.offset - held.from) < 3) return;
      held.moved = true;
      takeStep();
    }
    held.y = Math.max(guideTop(), Math.min(guideBottom(), e.clientY - held.offset));
    if (!guideFrame) guideFrame = requestAnimationFrame(guideDragFrame);
  });

  function releaseGuide(e) {
    if (!guideHeld || e.pointerId !== guideHeld.pointer) return;
    guideHeld = null;
    fingerScrolling = false;
    $markerNav.classList.remove('under-guide');
    $guide.classList.remove('held', 'away');
    if (window.scrollY <= 80) document.body.classList.remove('hide-top');
    guideTimer = setTimeout(hideGuide, GUIDE_LINGER);
    // the tab goes back to the scroll's say
    applyScrollGuide(readScrollGuide(), null);
  }
  $guideGrip.addEventListener('pointerup', releaseGuide);
  $guideGrip.addEventListener('pointercancel', releaseGuide);
  $guide.addEventListener('contextmenu', e => e.preventDefault());
  PHONE.addEventListener('change', hideGuide);

