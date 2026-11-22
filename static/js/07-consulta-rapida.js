  // ===== CONSULTA RÁPIDA =====
  // Prazos, quóruns, tempos, datas (kind "valor": the number large, its unit
  // under it) and hipóteses, ritos (kind "ficha": text, list or steps), from
  // consulta-rapida.yaml (see src/consulta.py). The same element in the
  // Referências tab and at the top of the search results.

  // The texts of an entry the search matches (and marks)
  function quickTexts(item) {
    return [item.v, item.u, item.label, item.text, item.obs].filter(Boolean)
      .concat((item.list || []).map(x => x.text), item.steps || []);
  }

  function buildQuickResult(hit) {
    const { sec, item } = hit.it;
    return quickItemEl(sec, item, text => indexMarkHtml(text), true);
  }

  // The provision of a reference ({law, art, path}), shown even if a filter
  // hides it, highlighted if it's a part of the article. Returns the element to focus.
  function goToQuickRef(ref) {
    const card = remCard(ref);
    if (!card) return null;
    revealCard(card);
    const p = ref.path ? remUnitP(card, ref.path) : null;
    revealOld(p);
    scrollToReadingLine(p || card);
    selectCard(card, true);
    if (p) remFlash(p);
    return p || card;
  }

  // From the search list (its drawer closes) or from the tab (the index closes)
  function quickGo(go, inSearch) {
    return e => {
      if (inSearch) { goToIndexResult(e, go); return; }
      takeStep();
      closeIndex();
      go();
    };
  }

  // The references of an entry, as links: "art. 63, § 4º", "LOM art. 138, § 6º"
  function quickRefsEl(refs, inSearch) {
    const el = document.createElement('div');
    el.className = 'q-refs';
    for (const ref of refs) {
      const btn = document.createElement('button');
      btn.className = 'q-ref';
      btn.textContent = ref.label;
      btn.addEventListener('click', quickGo(() => goToQuickRef(ref), inSearch));
      el.appendChild(btn);
    }
    return el;
  }

  // A text with its grifos (hl: [start, end, start, end…], the yaml's ==…==)
  // in <b class="q-g">; mark() on each piece, so a search match stays marked
  // inside or outside a grifo (one that crosses the edge of a grifo isn't)
  function quickHl(text, hl, mark) {
    if (!hl || !hl.length) return mark(text);
    let out = '';
    let at = 0;
    // hl = [start, end, level…]: 0 bold (the answer), 1 pink marker (the key: the subject one looks for), 2 lilac (the trap)
    for (let i = 0; i < hl.length; i += 3) {
      if (hl[i] > at) out += mark(text.slice(at, hl[i]));
      out += '<b class="q-g' + (hl[i + 2] ? ' q-g' + hl[i + 2] : '') + '">' + mark(text.slice(hl[i], hl[i + 1])) + '</b>';
      at = hl[i + 1];
    }
    return at < text.length ? out + mark(text.slice(at)) : out;
  }

  // mark(text) → HTML: the search's matches marked, or just escaped
  function quickItemEl(sec, item, mark, inSearch) {
    const el = document.createElement('div');
    el.className = 'q-item q-' + sec.kind + (inSearch ? ' res-group res-idx-group' : '');
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', sec.title + ': ' + (item.v ? (item.v + ' ' + item.u).trim() + ', ' : '') + item.label);

    if (sec.kind === 'valor') {
      const val = document.createElement('div');
      val.className = 'q-val' + (item.v.length > 12 ? ' q-xlong' : item.v.length > 6 ? ' q-long' : '');
      // "1º fev–30 jun · 1º ago–15 dez": a line each
      val.innerHTML = '<span class="q-n">' + item.v.split(' · ').map(x => mark(x)).join('<br>') + '</span>'
        + (item.u ? '<span class="q-u">' + mark(item.u) + '</span>' : '');
      el.appendChild(val);
    }
    const body = document.createElement('div');
    body.className = 'q-body';
    if (inSearch) {
      const tag = document.createElement('div');
      tag.className = 'q-sec';
      tag.textContent = sec.title;
      body.appendChild(tag);
    }
    // the label opens the first article cited
    const first = item.refs[0];
    const label = document.createElement(first ? 'button' : 'div');
    label.className = 'q-label';
    const hl = item.hl || {};
    label.innerHTML = quickHl(item.label, hl.label, mark)
      + (item.cf ? ' <span class="q-cf" title="artigo ainda não confirmado">†</span>' : '');
    if (first) label.addEventListener('click', quickGo(() => goToQuickRef(first), inSearch));
    body.appendChild(label);
    for (const [cls, text, grifos] of [['q-text', item.text, hl.text], ['q-obs', item.obs, hl.obs]]) {
      if (!text) continue;
      const div = document.createElement('div');
      div.className = cls;
      div.innerHTML = quickHl(text, grifos, mark);
      body.appendChild(div);
    }
    // a rito's steps (numbered by the CSS); a ficha's lines (in the search,
    // those with the terms first). Divs, not li: the "+ N" button goes among them.
    const lists = [];
    if (item.steps) lists.push(['q-steps', item.steps, step => {
      const line = document.createElement('div');
      line.className = 'q-line';
      line.innerHTML = quickHl(step, item.hlSteps && item.hlSteps[item.steps.indexOf(step)], mark);
      return line;
    }, ['passo', 'passos']]);
    if (item.list) {
      let lines = item.list;
      if (inSearch) {
        const re = indexMatches.regex;
        const found = x => { re.lastIndex = 0; return re.test(x.text); };
        // a tema searched by its name keeps the ficha's order (general to particular)
        if (!(sec.key === 'temas' && indexMatches.named && indexMatches.named.has(item)))
          lines = lines.filter(found).concat(lines.filter(x => !found(x)));
      }
      lists.push(['q-list', lines, x => {
        const line = document.createElement('div');
        line.className = 'q-line';
        line.innerHTML = quickHl(x.text, x.hl, mark) + (x.tag ? ' <span class="q-tag">' + escapeHtml(x.tag) + '</span>' : '');
        if (x.refs.length) line.appendChild(quickRefsEl(x.refs, inSearch));
        return line;
      }, ['linha', 'linhas']]);
    }
    for (const [cls, items, build, noun] of lists) {
      const list = document.createElement('div');
      list.className = cls;
      // a tema's ficha shows more lines in the search, where it sums up the
      // subject; in the Referências tab, the first ones, so the fichas don't fill the tab
      if (inSearch) appendWithMore(list, items, sec.key === 'temas' ? QUICK_TEMA_SHOWN : QUICK_LIST_SHOWN, build, noun);
      else if (sec.key === 'temas') appendWithMore(list, items, QUICK_LIST_SHOWN, build, noun);
      else items.forEach(x => list.appendChild(build(x)));
      body.appendChild(list);
    }
    if (item.refs.length) body.appendChild(quickRefsEl(item.refs, inSearch));
    el.appendChild(body);
    return el;
  }

  // The consulta rápida in the Referências tab: its sections, with links to
  // each one at the top (fixed, the section being read marked), the entries
  // as cards in a grid; with a filter, the entries with its terms
  function renderConsulta(filter) {
    const toc = document.createElement('div');
    toc.className = 'q-toc';
    $indexContent.appendChild(toc);
    const heads = [];
    // the lists of quorums and signatures first, as in the printed sheet, then the fichas by area
    // (the order of the index itself, which the search's ties follow, stays)
    const isList = sec => sec.key === 'quoruns' || sec.key === 'quorum_materia' || sec.key === 'subscricao';
    const all = consultaIndex();
    for (const sec of all.filter(isList).concat(all.filter(sec => !isList(sec)))) {
      const items = sec.items.filter(item => !filter
        || textMatchesFilter(quickTexts(item).join(' ') + ' ' + sec.terms + ' ' + (item.terms || ''), filter));
      if (!items.length) continue;
      const noun = items.length === 1 ? ' item' : ' itens';
      const head = document.createElement('div');
      head.className = 'ref-group-title q-head';
      head.innerHTML = escapeHtml(sec.title) + '<small>' + items.length + noun + '</small>';
      $indexContent.appendChild(head);
      // a link at the top to each section; the fichas, which are almost all of the consulta since the
      // reorganization of 22/11/2026 (area → ficha → lines), get one link for each area instead
      const tocLink = (title, count, target) => {
        const link = document.createElement('button');
        link.className = 'q-toc-link';
        link.innerHTML = escapeHtml(title) + '<small>' + count + '</small>';
        link.addEventListener('click', () => goToQuickHead(target));
        toc.appendChild(link);
        heads.push([target, link]);
      };
      const byArea = sec.key === 'temas' && items.some(item => item.group);
      if (!byArea) tocLink(sec.title, items.length, head);
      // the fichas by group ("Sessões", "Comissões"), each with its subtitle
      let group = null;
      let grid = null;
      for (const item of items) {
        // a ficha without group after grouped ones goes under "Outros", not under the group above
        const g = item.group || (group ? 'Outros' : null);
        if (g && g !== group) {
          group = g;
          grid = null;
          const sub = document.createElement('div');
          sub.className = 'q-subhead';
          sub.textContent = group;
          $indexContent.appendChild(sub);
          if (byArea) tocLink(group, items.filter(x => (x.group || 'Outros') === group).length, sub);
        }
        if (!grid) {
          grid = document.createElement('div');
          grid.className = 'q-grid';
          $indexContent.appendChild(grid);
        }
        grid.appendChild(quickItemEl(sec, item, escapeHtml, false));
      }
    }
    if (!toc.childNodes.length) {
      toc.className = 'q-empty';
      toc.textContent = 'Nada na consulta rápida com esses termos.';
      return;
    }
    // the section being read, marked in the links
    const mark = () => {
      if (!toc.isConnected) { $indexContent.removeEventListener('scroll', mark); return; }
      // (the room for a head brought by its link: it stops at its scroll-margin, 52px, and the bar is 42 to 44px tall)
      const top = toc.getBoundingClientRect().bottom + 14;
      let cur = heads[0];
      for (const h of heads) if (h[0].getBoundingClientRect().top <= top) cur = h;
      for (const [, link] of heads) link.classList.toggle('on', link === cur[1]);
      // the links are more than fit in the bar (one for each area): the marked one is kept in sight
      const on = cur[1];
      if (on !== shown) {
        shown = on;
        if (on.offsetLeft < toc.scrollLeft) toc.scrollLeft = on.offsetLeft - 12;
        else if (on.offsetLeft + on.offsetWidth > toc.scrollLeft + toc.clientWidth)
          toc.scrollLeft = on.offsetLeft + on.offsetWidth - toc.clientWidth + 12;
      }
    };
    let shown = null;
    $indexContent.addEventListener('scroll', mark, { passive: true });
    requestAnimationFrame(mark);
  }

  // A section of the consulta rápida, from its link. The cards not yet drawn
  // have an estimated height (style.css), and those drawn on the way change
  // it: far, a jump; near, a glide; then held on the section for a few frames
  function goToQuickHead(head) {
    const hold = () => {
      let frames = 0;
      (function again() {
        if (!head.isConnected) return;
        head.scrollIntoView({ block: 'start', behavior: 'instant' });
        if (++frames < 12) requestAnimationFrame(again);
      })();
    };
    const dist = Math.abs(head.getBoundingClientRect().top - $indexContent.getBoundingClientRect().top);
    // (no glide, no scrollend: the hold right away)
    if (dist > FAR_SCROLL_SCREENS * $indexContent.clientHeight || dist < 80 || !('onscrollend' in window)) {
      hold();
      return;
    }
    $indexContent.addEventListener('scrollend', hold, { once: true });
    head.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // "Art. 105, XII", "Art. 4-C ADT, I"
  function refEntryLabel(entry) {
    const ref = entry.art_ref || '';
    return (entry.law ? entry.law + ' art. ' : 'Art. ') +
      (ref.startsWith('ADT') ? ref.slice(3).replace(/^([^,\s]+)/, '$1 ADT') : ref);
  }

  // The article of an entry of the referências (of the Regimento), shown
  // even if a filter hides it; for the legislação correlata, its provision,
  // with the norms' box open. Returns the element to focus.
  function goToRefEntry(entry, leg) {
    if (!entry.art_ref) return null;
    const art = entry.art_ref.replace(/[º°ª]/g, '').split(/[,\s]/)[0].trim();
    const card = remCard({ law: entry.law || 'RI', art });
    if (!card) return null;
    revealCard(card);
    let target = card;
    if (leg) {
      const p = entry.path ? remUnitP(card, entry.path) : remCaputP(card);
      revealOld(p);
      const ref = p && p.querySelector('.leg-ref');
      const box = ref && card.querySelector(`.leg-box[data-note="${ref.dataset.note}"]`);
      if (box) box.classList.add('open');
      if (p) target = p;
    }
    scrollToReadingLine(target);
    selectCard(card, true);
    return target;
  }

  // A card hidden by a filter (search, subject, markers) shown again, with its headings
  function revealCard(card) {
    if (!card.classList.contains('filtered-out')) return;
    card.classList.remove('filtered-out');
    showContextHeadings();
    scheduleMinimap();
  }

