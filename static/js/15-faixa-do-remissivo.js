  // ===== NO ÍNDICE REMISSIVO =====
  // At the end of each article, the subjects of the remissivo that cite it (or
  // one of its provisions), grouped: each subject (bold) with its sub-subjects
  // beside it, the groups running one after the other (38% of the entries
  // repeated the subject of another in the same card). Labels via CSS, out of
  // the searchable text. All in alphabetical order. Each entry is
  // a trigger as the correlates' (.rem): hover previews the entry's
  // dispositivos, click opens them in a box in the band, and the box's foot
  // puts the subject in the search bar, starting at this article.
  // Folded (the usual), a band is only its line: its table is built when the
  // bands open (fillIndexBands), a quarter of the page's elements spared.

  function renderIndexBacklinks() {
    const byArt = new Map();   // "LOM:42" → [{label, refs, entry, child}]
    const add = (label, own, refs, entry, child = null) => {
      const items = new Map();
      for (const r of own) {
        const key = (r.law_prefix || '') + ':' + r.art;
        if (!items.has(key)) items.set(key, { label, refs, entry, child });
      }
      for (const [key, it] of items) {
        if (!byArt.has(key)) byArt.set(key, []);
        byArt.get(key).push(it);
      }
    };
    for (const entry of SUBJECT_INDEX) {
      if (entry.refs) add(entry.subject, entry.refs, collectAllRefs(entry), entry);
      for (const ch of entry.children || []) {
        add(entry.subject + ' — ' + ch.sub_subject, ch.refs, subjectRefs(entry, ch.sub_subject), entry, ch);
      }
    }
    const collator = new Intl.Collator('pt-BR');   // (localeCompare builds one per call)
    for (const card of ARTICLE_CARDS) {
      const items = byArt.get((card.dataset.law || '') + ':' + card.dataset.art);
      if (!items) continue;
      items.sort((a, b) => collator.compare(a.label, b.label));
      // by subject, in alphabetical order (easier to find one)
      const groups = new Map();
      for (const it of items) {
        const head = it.child ? it.entry.subject : it.label;
        if (!groups.has(head)) groups.set(head, { self: null, subs: [] });
        if (it.child) groups.get(head).subs.push(it);
        else groups.get(head).self = it;
      }
      const band = document.createElement('div');
      band.className = 'rem-backlinks idx-backlinks';
      band.setAttribute('aria-label', 'No índice remissivo');
      const nEntries = items.length;
      const sum = document.createElement('button');
      sum.type = 'button';
      sum.className = 'idx-sum';
      sum.setAttribute('aria-expanded', String(idxOpen));
      sum.dataset.label = 'Índice remissivo · ' + groups.size + (groups.size === 1 ? ' assunto · ' : ' assuntos · ')
        + nEntries + (nEntries === 1 ? ' entrada' : ' entradas');
      sum.setAttribute('aria-label', sum.dataset.label);
      band.appendChild(sum);
      band.idxGroups = [...groups].sort((a, b) => collator.compare(a[0], b[0]));
      indexBands.push(band);
      card.appendChild(band);
    }
    if (idxOpen) fillIndexBands();
  }
  const indexBands = [];

  // Each band's table, once: a row per subject, its sub-subjects beside it
  function fillIndexBands() {
    const chip = (it, cls, show) => {
      const c = document.createElement('span');
      c.className = 'rem idx-back ' + cls;
      c.tabIndex = 0;
      c.setAttribute('role', 'button');
      c.setAttribute('aria-expanded', 'false');
      c.dataset.label = it.label;
      if (show) c.dataset.show = show;
      c.idxEntry = it;
      return c;
    };
    for (const band of indexBands) {
      if (!band.idxGroups) continue;
      for (const [head, g] of band.idxGroups) {
        const row = document.createElement('div');
        row.className = 'idx-row';
        if (g.self) row.appendChild(chip(g.self, 'idx-head'));
        else {
          const h = document.createElement('span');
          h.className = 'idx-head';
          h.dataset.label = head;
          row.appendChild(h);
        }
        for (const it of g.subs) row.appendChild(chip(it, 'idx-sub', it.child.sub_subject));
        band.appendChild(row);
      }
      band.idxGroups = null;
    }
  }

  // The entry's box: its dispositivos with their dicas, as the index lists
  // them (a subject with its sub-subjects under it), the ones of this article
  // marked. Hover previews one (desktop), a click goes to it (and "voltar"
  // comes back); the foot
  // puts the entry in the search bar.
  function idxRemRef(r) {
    return { law: r.law_prefix || 'RI', art: r.art, path: r.detail && r.detail !== 'caput' ? r.detail : '' };
  }

  function buildIdxPanel(trigger) {
    const it = trigger.idxEntry;
    const card = trigger.closest('.card');
    const group = document.createElement('section');
    group.className = 'rem-group';
    const head = document.createElement('div');
    head.className = 'rem-head';
    const tag = document.createElement('span');
    tag.className = 'rem-law IDX';
    tag.textContent = 'ÍNDICE';
    const label = document.createElement('span');
    label.textContent = it.label;
    head.append(tag, label);
    group.appendChild(head);

    const body = document.createElement('div');
    body.className = 'rem-body idx-list';
    const addRefs = refs => {
      formatRefsList(refs).forEach((item, i) => {
        const r = refs[i];
        const line = document.createElement('div');
        const here = card && r.art === card.dataset.art && (r.law_prefix || '') === (card.dataset.law || '');
        line.className = 'idx-line' + (here ? ' idx-here' : '');
        line.tabIndex = 0;
        line.setAttribute('role', 'button');
        // in the box, hover previews it (as a citation: data-ref); a click goes to it
        line.dataset.ref = (r.law_prefix ? r.law_prefix + ':' : '') + r.art + (r.detail ? ',' + r.detail : '');
        if (!HOVER) line.title = 'Ir para o dispositivo';
        line.appendChild(document.createTextNode(item.label));
        if (item.hint) {
          const h = document.createElement('span');
          h.className = 'ref-hint';
          h.textContent = ' — ' + item.hint;
          line.appendChild(h);
        }
        const go = ev => { ev.stopPropagation(); remGoTo(idxRemRef(r), trigger); };
        line.addEventListener('click', go);
        line.addEventListener('keydown', ev => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          ev.preventDefault();
          go(ev);
        });
        body.appendChild(line);
      });
    };
    const addVides = vides => {
      if (!vides || !vides.length) return;
      const v = document.createElement('div');
      v.className = 'idx-vides';
      v.textContent = 'Vide: ' + vides.map(x => x.split('|').map(s => s.trim()).join(' — ')).join('; ');
      body.appendChild(v);
    };
    if (it.child) {
      addRefs(it.child.refs);
      addVides(it.child.vides);
    } else {
      addRefs(it.entry.refs || []);
      addVides(it.entry.vides);
      for (const ch of it.entry.children || []) {
        const sub = document.createElement('div');
        sub.className = 'idx-sub';
        sub.textContent = '— ' + ch.sub_subject;
        body.appendChild(sub);
        addRefs(ch.refs || []);
        addVides(ch.vides);
      }
    }
    group.appendChild(body);

    const foot = document.createElement('div');
    foot.className = 'rem-foot';
    const filter = document.createElement('button');
    filter.type = 'button';
    filter.textContent = 'Filtrar por esta entrada do índice';
    filter.addEventListener('click', ev => {
      ev.stopPropagation();
      hideRemPop();
      const box = remBoxOpen(trigger);
      if (box) closeRemBox(box);
      openSubject({ subject: it.label, refs: it.refs }, card);
    });
    const n = document.createElement('span');
    n.className = 'idx-count';
    n.textContent = it.refs.length + (it.refs.length === 1 ? ' dispositivo' : ' dispositivos');
    foot.append(filter, n);
    group.appendChild(foot);
    return group;
  }

