  // ===== REMISSÕES =====
  // A citation ("artigo 369") is a trigger (span.rem-exp, around the text and its
  // original links) with data-ref = the cited provisions ("369", "LOM:42,§ 7º",
  // "18,VI"; several separated by ";"), and data-rev / data-tach = the revoked or
  // struck ones. A correlate in another norm (implicit remissão) is a badge
  // (span.rem-imp) at the end of the provision, on both sides, with data-tipo
  // (eq / det / fund / div), data-side (src / tgt) and data-n (its note in
  // the page's correlatoNotas: the badge is on both sides, the note only once). The preview is
  // built from the target's card in this same page, so it always shows the
  // wording in force. Hover (desktop) shows a floating preview; click/tap or
  // Enter pins a box under the provision.
  const HOVER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  // Official texts, for "fonte oficial" (anchors artN exist on these pages)
  const REM_SOURCES = {
    RI: 'https://app-plpconsulta-prd.azurewebsites.net/Forms/MostrarArquivo?ID=168&TipArq=1',
    LOM: 'https://app-plpconsulta-prd.azurewebsites.net/Forms/MostrarArquivo?ID=68&TipArq=1',
    CE: 'https://www.al.sp.gov.br/repositorio/legislacao/constituicao/1989/compilacao-constituicao-0-05.10.1989.html',
    CF: 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm',
  };
  const $header = document.getElementById('header');
  const $remPop = document.createElement('div');
  $remPop.id = 'rem-pop';
  document.body.appendChild($remPop);
  const $remReturn = document.createElement('button');
  $remReturn.id = 'rem-return';
  $remReturn.type = 'button';
  document.body.appendChild($remReturn);
  let remHideTimer = null, remShowTimer = null, remReturnTo = null, remPopTrigger = null;
  // Kind of correlate, as read from the origin and from the target side
  const REM_TIPO = {
    eq: ['≈ Mesma regra', '≈ Mesma regra'],
    det: ['Detalha a norma correlata', 'Detalhado na norma correlata'],
    fund: ['↑ Fundamento na norma superior', '↓ Aplicado na norma correlata'],
    div: ['≠ Divergência', '≠ Divergência'],
    sim: ['⇄ Regra federal correspondente', '⇄ Regra municipal correspondente'],
    exc: ['Regra geral', 'Exceção à regra geral'],
  };
  // A box belongs to one trigger: a citation and a badge may point to the same place
  function remKey(trigger) {
    if (trigger.classList.contains('idx-back')) return 'idx:' + trigger.dataset.label;
    return (trigger.classList.contains('rem-imp') ? 'imp:' : '') + trigger.dataset.ref;
  }
  // The color of the preview and of the box: the norma it points to (its first
  // target's), or the index's
  function remKind(trigger) {
    return trigger.classList.contains('idx-back') ? 'idx' : '';
  }
  function remNorm(trigger) {
    return trigger.classList.contains('idx-back') ? '' : parseRemRef(trigger.dataset.ref.split(';')[0]).law;
  }
  function remPanel(trigger) {
    return trigger.classList.contains('idx-back') ? buildIdxPanel(trigger) : buildRemPanel(trigger);
  }

  function parseRemRef(s) {
    let law = 'RI';
    const m = s.match(/^([A-Z]{2,}):(.+)$/);
    if (m) { law = m[1]; s = m[2]; }
    const parts = s.split(',');
    return { law, art: parts.shift().trim(), path: parts.map(x => x.trim()).join(',') };
  }
  function remCard(r) {
    return r.law === 'RI'
      ? $cards.querySelector(`.card-artigo[data-art="${r.art}"]:not([data-law])`)
      : $cards.querySelector(`.card-artigo[data-art="${r.art}"][data-law="${r.law}"]`);
  }
  function remUnitP(card, path) {
    if (path === 'caput') return remCaputP(card);   // the index's
    for (const u of card.querySelectorAll(':scope > p .unit-id[data-path]')) {
      if (u.dataset.path === path) return u.closest('p');
    }
    // revoked or struck: the last old version at that path
    const olds = card.querySelectorAll(`:scope > .old-version[data-path="${CSS.escape(path)}"]`);
    return olds.length ? olds[olds.length - 1] : null;
  }
  function remCaputP(card) { return card.querySelector(':scope > p:not(.art-para):not(.old-version)'); }
  function remFmtPath(path) {
    return path.split(',').map(x => x === '§ú' ? 'parágrafo único' : x).join(', ');
  }
  function remArtLabel(art) { return art.startsWith('ADT') ? art.slice(3) + ' ADT' : art; }
  function remRefLabel(r) {
    if (r.law === 'PREC') return 'Precedente ' + precLabel(r.art);
    return (r.law !== 'RI' ? r.law + ' ' : '') + 'Art. ' + remArtLabel(r.art) + (r.path ? ', ' + remFmtPath(r.path) : '');
  }
  function remSourceUrl(g) {
    if (g.law === 'PREC') {
      // each precedent has its own page (the link of its title in the DOCX)
      const card = remCard(g);
      return (card && card.dataset.src) || null;
    }
    const base = REM_SOURCES[g.law];
    if (!base) return null;
    if (g.law === 'CE') return base;   // the ALESP page has no anchors
    if (!g.art.startsWith('ADT')) return base + '#art' + g.art.replace('-', '');
    const n = g.art.slice(3);
    if (g.law === 'LOM') return base + '#' + encodeURIComponent('DisposiçõesTransitóriasart' + n);
    if (g.law === 'RI') return base + '#art' + n.replace('-', '') + 'adt';
    return base;
  }
  // A copy of a paragraph for the preview, without the page's controls
  function remClone(p) {
    const c = p.cloneNode(true);
    c.querySelectorAll('.footnote-ref, .footnote-box, .indent-path, .diff-toggle, .rem-backlinks, .rem-imp')
      .forEach(n => n.remove());
    c.querySelectorAll('.unit-id').forEach(u => {
      u.classList.replace('unit-id', 'rem-uid');
      u.removeAttribute('data-uid');
      u.removeAttribute('data-path');
    });
    c.classList.remove('selected', 'diff-open', 'rem-flash');
    c.removeAttribute('data-path');
    c.removeAttribute('id');
    return c;
  }

  // What to show of the target: the whole article (caput + provisions in force),
  // or the provision(s) with their ancestors (caput → § → inciso), "[…]" for gaps.
  // Several targets in one article ("incisos III, IV e V do art. 18") become one block.
  function remExcerpt(g) {
    const card = remCard(g);
    if (!card) return null;
    // a precedent: its text, without the title (already in the group's head)
    const vig = [...card.querySelectorAll(isPrecCard(card) ? ':scope > p.prec-para' : ':scope > p:not(.old-version)')];
    const pick = new Set(), hits = new Set();
    if (g.paths.includes('')) vig.forEach(p => pick.add(p));
    for (const path of g.paths.filter(Boolean)) {
      const segs = path.split(',');
      const cap = remCaputP(card);
      if (cap) pick.add(cap);
      for (let i = 1; i < segs.length; i++) {
        const a = remUnitP(card, segs.slice(0, i).join(','));
        if (a && !a.classList.contains('old-version')) pick.add(a);
      }
      const t = remUnitP(card, path);
      if (!t) return null;
      pick.add(t); hits.add(t);
    }
    const order = [...card.querySelectorAll(':scope > p')];
    const frag = document.createDocumentFragment();
    let last = -1;
    for (const p of [...pick].sort((x, y) => order.indexOf(x) - order.indexOf(y))) {
      const i = vig.indexOf(p);
      if (last >= 0 && i > last + 1) {
        const gp = document.createElement('p');
        gp.className = 'rem-gap';
        gp.textContent = '[…]';
        frag.appendChild(gp);
      }
      const c = remClone(p);
      if (hits.has(p)) c.classList.add('rem-hit');
      frag.appendChild(c);
      if (i >= 0) last = i;
    }
    const sint = card.querySelector('.art-summary');
    return { card, frag, sint: sint ? sint.textContent : '' };
  }

  function remGroupLabel(g) {
    if (g.law === 'PREC') return 'Precedente ' + precLabel(g.art);
    const ps = g.paths.filter(Boolean).map(remFmtPath);
    const tail = ps.length > 1 ? ps.slice(0, -1).join(', ') + ' e ' + ps[ps.length - 1] : ps.join('');
    const sep = g.paths.includes('') ? ' e ' : ', ';
    return 'Art. ' + remArtLabel(g.art) + (tail ? sep + tail : '');
  }

  function buildRemPanel(trigger) {
    const revoked = new Set((trigger.dataset.rev || '').split(';').filter(Boolean));
    const struck = new Set((trigger.dataset.tach || '').split(';').filter(Boolean));
    const groups = [];
    for (const ref of trigger.dataset.ref.split(';')) {
      const r = parseRemRef(ref);
      let g = groups.find(x => x.law === r.law && x.art === r.art);
      if (!g) groups.push(g = { law: r.law, art: r.art, paths: [], revoked: false, struck: false });
      g.paths.push(r.path);
      if (revoked.has(ref)) g.revoked = true;
      if (struck.has(ref)) g.struck = true;
    }
    const wrap = document.createDocumentFragment();
    const tipo = trigger.dataset.tipo;
    if (tipo && REM_TIPO[tipo]) {
      // correlate: what links the two provisions comes first
      const n = document.createElement('div');
      n.className = 'rem-note t-' + tipo;
      const k = document.createElement('span');
      k.className = 'rem-kind';
      // "correspondente" inside one norm (data-mesma: RI–RI, LOM–LOM) is no federal
      // rule: parts of one procedure or parallel rules, linked both ways
      // and with the Constituição Estadual (data-esfera) it is the state rule; a CF and a
      // CE of the same wording in one badge (data-esfera="ambas") are the two rules
      k.textContent = tipo === 'sim' && trigger.dataset.mesma ? '⇄ Dispositivo correspondente'
        : tipo === 'sim' && trigger.dataset.esfera === 'ambas' && trigger.dataset.side !== 'tgt' ? '⇄ Regras federal e estadual correspondentes'
        : tipo === 'sim' && trigger.dataset.esfera && trigger.dataset.side !== 'tgt' ? '⇄ Regra estadual correspondente'
        : REM_TIPO[tipo][trigger.dataset.side === 'tgt' ? 1 : 0];
      n.appendChild(k);
      if (trigger.dataset.status === 'proposta') {
        const pr = document.createElement('span');
        pr.className = 'rem-proposta';
        pr.textContent = 'proposta, ainda não revisada';
        n.appendChild(pr);
      }
      if (trigger.dataset.n) n.appendChild(document.createTextNode(correlatoNotas()[+trigger.dataset.n]));
      wrap.appendChild(n);
    }
    for (const g of groups) {
      const ex = remExcerpt(g);
      const group = document.createElement('section');
      group.className = 'rem-group';
      const head = document.createElement('div');
      head.className = 'rem-head';
      const law = document.createElement('span');
      law.className = 'rem-law ' + g.law;
      law.textContent = g.law;
      const label = document.createElement('span');
      label.textContent = remGroupLabel(g);
      head.append(law, label);
      const status = g.revoked || (ex && ex.card.classList.contains('revoked')) ? 'revogado'
        : g.struck ? 'sem efeito' : '';
      if (status) {
        const rv = document.createElement('span');
        rv.className = 'rem-revoked';
        rv.textContent = status;
        head.appendChild(rv);
      }
      if (ex && ex.sint) {
        const s = document.createElement('span');
        s.className = 'rem-sint';
        s.textContent = '— ' + ex.sint;
        head.appendChild(s);
      }
      group.appendChild(head);
      const body = document.createElement('div');
      body.className = 'rem-body';
      if (ex) body.appendChild(ex.frag);
      else body.textContent = 'Dispositivo não encontrado nesta página.';
      group.appendChild(body);
      const foot = document.createElement('div');
      foot.className = 'rem-foot';
      const first = { law: g.law, art: g.art, path: g.paths[0] };
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = 'Ir para ' + remRefLabel(first) + ' ›';
      go.addEventListener('click', ev => { ev.stopPropagation(); remGoTo(first, trigger); });
      foot.appendChild(go);
      const src = remSourceUrl(g);
      if (src) {
        const a = document.createElement('a');
        a.href = src; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = 'fonte oficial ↗';
        foot.appendChild(a);
      }
      group.appendChild(foot);
      wrap.appendChild(group);
    }
    return wrap;
  }

  function showRemPop(trigger) {
    remPopTrigger = trigger;
    $remPop.replaceChildren(remPanel(trigger));
    // its color (style.css), as in the pinned box
    for (const c of [...$remPop.classList]) if (c.startsWith('t-')) $remPop.classList.remove(c);
    if (remKind(trigger)) $remPop.classList.add('t-' + remKind(trigger));
    if (remNorm(trigger)) $remPop.dataset.nrm = remNorm(trigger);
    else delete $remPop.dataset.nrm;
    $remPop.style.maxHeight = 'none';
    $remPop.classList.add('visible');
    // The side with more room, never over the trigger, the header or the breadcrumb
    const rr = trigger.getBoundingClientRect();
    let topLimit = $header ? $header.getBoundingClientRect().bottom : 0;
    if ($breadcrumb && $breadcrumb.classList.contains('visible')) {
      topLimit = Math.max(topLimit, $breadcrumb.getBoundingClientRect().bottom);
    }
    topLimit += 6;
    if (trigger.classList.contains('idx-line') && placeRemPopBeside(trigger, topLimit)) return;
    const below = window.innerHeight - rr.bottom - 14;
    const above = rr.top - topLimit - 8;
    const natural = $remPop.getBoundingClientRect().height;
    const cap = window.innerHeight * 0.6;
    const useBelow = Math.min(natural, cap) <= below || below >= above;
    const h = Math.max(80, Math.min(natural, cap, useBelow ? below : above));
    $remPop.style.maxHeight = h + 'px';
    const viewW = document.documentElement.clientWidth;
    const left = Math.min(Math.max(8, rr.left), viewW - $remPop.offsetWidth - 8);
    $remPop.style.left = left + 'px';
    $remPop.style.top = (useBelow ? rr.bottom + 6 : rr.top - 6 - h) + 'px';
  }
  // A line of an index box: beside its text, if there is room, so that the
  // lines under it stay free to hover
  function placeRemPopBeside(line, topLimit) {
    const range = document.createRange();
    range.selectNodeContents(line);
    const tr = range.getBoundingClientRect();
    const left = tr.right + 14;
    if (left + $remPop.offsetWidth > document.documentElement.clientWidth - 8) return false;
    const natural = $remPop.getBoundingClientRect().height;
    const h = Math.max(80, Math.min(natural, window.innerHeight * 0.6, window.innerHeight - 8 - topLimit));
    $remPop.style.maxHeight = h + 'px';
    $remPop.style.left = left + 'px';
    $remPop.style.top = Math.max(topLimit, Math.min(tr.top - 8, window.innerHeight - 8 - h)) + 'px';
    return true;
  }
  // An entry of the index opens its box inside the band at the card's foot;
  // anything else, right under its provision
  function remBoxOpen(trigger) {
    const key = remKey(trigger);
    const band = trigger.closest('.idx-backlinks');
    if (band) return [...band.querySelectorAll(':scope > .rem-box')].find(b => b.dataset.for === key) || null;
    const p = trigger.closest('p');
    for (let box = p && p.nextElementSibling; box && box.classList.contains('rem-box'); box = box.nextElementSibling) {
      if (box.dataset.for === key) return box;
    }
    return null;
  }
  function hideRemPop() {
    clearTimeout(remShowTimer);
    $remPop.classList.remove('visible');
  }

  // The chip (or citation) whose box is open stays marked until the box closes
  const remBoxTrigger = new WeakMap();
  function closeRemBox(box) {
    const t = remBoxTrigger.get(box);
    if (t) { t.classList.remove('rem-open'); t.setAttribute('aria-expanded', 'false'); }
    box.remove();
  }

  // Click/tap: pins the preview in a box under the provision (the only mode on touch)
  function toggleRemBox(trigger) {
    const open = remBoxOpen(trigger);
    if (open) { closeRemBox(open); return; }
    const b = document.createElement('div');
    b.className = 'rem-box' + (remKind(trigger) ? ' t-' + remKind(trigger) : '');
    if (remNorm(trigger)) b.dataset.nrm = remNorm(trigger);
    b.dataset.for = remKey(trigger);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'rem-close';
    close.setAttribute('aria-label', 'Fechar');
    close.textContent = '×';
    b.append(close, remPanel(trigger));
    const band = trigger.closest('.idx-backlinks');
    if (band) band.appendChild(b);
    else {
      // after the boxes already open there, in reading order
      let after = trigger.closest('p') || trigger.closest('.rem-backlinks');
      while (after.nextElementSibling && after.nextElementSibling.classList.contains('rem-box')) {
        after = after.nextElementSibling;
      }
      after.after(b);
    }
    remBoxTrigger.set(b, trigger);
    trigger.classList.add('rem-open');
    trigger.setAttribute('aria-expanded', 'true');
  }

  // Highlight the target once the smooth scroll gets there
  function remFlash(el, scrolls = true) {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      el.classList.remove('rem-flash'); void el.offsetWidth; el.classList.add('rem-flash');
    };
    if (!scrolls) { go(); return; }
    if ('onscrollend' in window) window.addEventListener('scrollend', go, { once: true });
    setTimeout(go, 1500);
  }
  // Scroll el to the middle of the screen (a jump, not an animation, when far:
  // see scrollToY); returns whether the page moves
  function remScrollTo(el) {
    const r = el.getBoundingClientRect();
    const y = window.scrollY + r.top - (window.innerHeight - Math.min(r.height, window.innerHeight)) / 2;
    const moves = Math.abs(y - window.scrollY) >= 2;
    if (moves) scrollToY(y, 'smooth');
    return moves && Math.abs(y - window.scrollY) <= FAR_SCROLL_SCREENS * window.innerHeight;
  }

  function remGoTo(r, trigger) {
    const card = remCard(r);
    if (!card) return;
    const target = (r.path && remUnitP(card, r.path)) || card;
    takeStep('rem');
    card.classList.remove('filtered-out');   // the target may be hidden by a filter
    remReturnTo = trigger;
    const src = trigger.closest('.card-artigo');
    const up = trigger.closest('p') && trigger.closest('p').querySelector('.unit-id');
    if (src) {
      const from = { law: src.dataset.law || 'RI', art: src.dataset.art, path: (up && up.dataset.path) || '' };
      $remReturn.textContent = '← voltar ao ' + remRefLabel(from);
      $remReturn.classList.add('visible');
    }
    hideRemPop();
    const smooth = remScrollTo(target);
    // the keyboard goes on from the target, not from the citation
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    remFlash(target, smooth);
  }
  $remReturn.addEventListener('click', () => {
    // as back: the jump's step out of the history (forward goes to it again)
    if (stepKinds.get(stepId) === 'rem') {
      steps.set(stepId, stepState());
      dropStep('rem');
    }
    if (remReturnTo && remReturnTo.isConnected) {
      const smooth = remScrollTo(remReturnTo);
      if (remReturnTo.tabIndex >= 0) remReturnTo.focus({ preventScroll: true });
      remFlash(remReturnTo.closest('p') || remReturnTo, smooth);
    }
    $remReturn.classList.remove('visible');
  });

  $cards.addEventListener('click', e => {
    const close = e.target.closest('.rem-close');
    if (close) {
      e.stopPropagation();
      closeRemBox(close.closest('.rem-box'));
      return;
    }
    const t = e.target.closest('.rem');
    if (!t) return;
    // Ctrl/Cmd/Shift-click or middle click on the citation's own link: open it, as before
    if (e.target.closest('a[href]') && (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0)) return;
    e.preventDefault(); e.stopPropagation();
    hideRemPop();
    if (t.classList.contains('rem-back')) { remGoTo(parseRemRef(t.dataset.ref), t); return; }
    toggleRemBox(t);
  }, true);
  $cards.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target.classList && e.target.classList.contains('rem') ? e.target : null;
    if (!t) return;
    e.preventDefault();
    hideRemPop();
    if (t.classList.contains('rem-back')) remGoTo(parseRemRef(t.dataset.ref), t);
    else toggleRemBox(t);
  });
  // Esc closes the preview, or the box the focus is in, before clearing the search
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const active = document.activeElement;
    let box = null;
    if (active && active.classList && (active.classList.contains('rem-exp') || active.classList.contains('rem-imp')
        || active.classList.contains('idx-back'))) {
      box = remBoxOpen(active);
    }
    if (!box && active && active.closest) box = active.closest('.rem-box');
    if ($remPop.classList.contains('visible')) hideRemPop();
    else if (box) {
      const t = remBoxTrigger.get(box);
      closeRemBox(box);
      if (t && t.isConnected) t.focus({ preventScroll: true });
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  if (HOVER) {
    $cards.addEventListener('mouseover', e => {
      // (in a box, only the lines of an index entry's: they preview their dispositivo)
      const t = e.target.closest('.rem-exp, .rem-imp, .rem-back, .idx-back, .rem-box .idx-line');
      if (!t || (t.closest('.rem-box') && !t.classList.contains('idx-line'))) return;
      if (e.relatedTarget && t.contains(e.relatedTarget)) return;   // moving inside the trigger
      clearTimeout(remHideTimer); clearTimeout(remShowTimer);
      if (!t.classList.contains('rem-back') && remBoxOpen(t)) return;  // its box is already open
      remShowTimer = setTimeout(() => showRemPop(t), 250);
    });
    $cards.addEventListener('mouseout', e => {
      const t = e.target.closest('.rem, .idx-line');
      if (!t || (e.relatedTarget && t.contains(e.relatedTarget))) return;
      clearTimeout(remShowTimer);
      remHideTimer = setTimeout(hideRemPop, 250);
    });
    $remPop.addEventListener('mouseenter', () => clearTimeout(remHideTimer));
    // A citation inside the preview: go to it (back returns to the original one)
    $remPop.addEventListener('click', e => {
      const t = e.target.closest('.rem-exp');
      if (!t) return;
      if (e.target.closest('a[href]') && (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0)) return;
      e.preventDefault();
      if (remPopTrigger) remGoTo(parseRemRef(t.dataset.ref.split(';')[0]), remPopTrigger);
    });
    $remPop.addEventListener('mouseleave', () => { remHideTimer = setTimeout(hideRemPop, 250); });
  }
  window.addEventListener('scroll', () => { if ($remPop.classList.contains('visible')) hideRemPop(); },
    { passive: true });

