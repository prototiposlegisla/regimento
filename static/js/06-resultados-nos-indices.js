  // ===== INDEX RESULTS =====
  // The entries of the consulta rápida and of the three indexes (sistemático,
  // remissivo, referências) with every term of the search, at the top of the
  // results list. Matched by their own text: a prazo or quórum by its value,
  // label and note, plus its section's words ("prazo vista"); a section by its
  // title, a subject by its name (a sub-subject together with its subject's),
  // a norm of the legislação correlata by its name and ementa.
  // Precedents (leaves of the sistemático) and the provisions' texts are in
  // the cards, which the search already lists.
  const INDEX_GROUPS_SHOWN = 3;   // per index; the rest behind "+ N"
  const QUICK_SHOWN = 4;          // entries of the consulta rápida
  const QUICK_LIST_SHOWN = 3;     // lines of a ficha (cabe aparte, a rito's steps)
  const QUICK_TEMA_SHOWN = 8;     // lines of a tema (Grande Expediente: duration, time, apartes...)
  const INDEX_ENTRIES_SHOWN = 2;  // per group (sub-subjects, prazos)
  const ART_LINKS_SHOWN = 6;      // a norm's provisions (legislação correlata)
  const LEGISLACAO = 'Legislação correlata';
  let indexItems = null;          // the indexes' entries and their normalized text

  function normIndexText(s) {
    return stripAccents(s.toLowerCase()).replace(/\s+/g, ' ');
  }

  function htmlToText(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    return t.content.textContent.replace(/\s+/g, ' ').trim();
  }

  // Fields matched together are joined by a character no term has: words
  // may be in different fields, a phrase must be in one
  const FIELD_SEP = '\u0000';

  function getIndexItems() {
    if (indexItems) return indexItems;
    const sys = [];
    (function walk(nodes, ctx) {
      for (const node of nodes) {
        if (node.art || !node.title) continue;
        sys.push({ node, ctx, text: normIndexText(node.title) });
        // "TÍTULO I — DA CÂMARA MUNICIPAL" → "TÍTULO I" in its children's context
        if (node.children) walk(node.children, ctx.concat(node.title.split(' — ')[0]));
      }
    })(SYSTEMATIC_INDEX, []);

    const subj = sortedSubjects()
      .map(entry => {
        const text = normIndexText(entry.subject);
        return {
          entry,
          text,
          children: (entry.children || []).map(ch => {
            const own = normIndexText(ch.sub_subject);
            return { ch, text: own, withSubject: text + FIELD_SEP + own };
          }),
        };
      });

    const refs = [];
    for (const cat of referenciasIndex()) {
      const leg = cat.category === LEGISLACAO;
      for (const group of cat.groups) {
        const title = normIndexText(group.title);
        const entries = group.entries.map(e => ({ e, text: htmlToText(e.html) }));
        if (leg) {
          // the ementa (the entry without an article), then the provisions
          const ementa = entries.filter(x => !x.e.art_ref).map(x => x.text);
          refs.push({ cat, leg, group, ementa: ementa.join(' '), entries: entries.filter(x => x.e.art_ref),
                      text: [title].concat(ementa.map(normIndexText)).join(FIELD_SEP) });
        } else {
          for (const x of entries) x.withTitle = title + FIELD_SEP + normIndexText(x.text);
          refs.push({ cat, leg, group, entries });
        }
      }
    }
    // The consulta rápida: each entry by its visible text (own) and with its
    // section's words, which aren't written ("prazo", "quórum")
    const quick = [];
    for (const sec of consultaIndex()) {
      for (const item of sec.items) {
        const own = normIndexText(quickTexts(item).join(FIELD_SEP));
        const terms = normIndexText(item.terms || '');
        quick.push({ sec, item, own, label: normIndexText(item.label), terms,
                     text: own + FIELD_SEP + normIndexText(sec.terms) + FIELD_SEP + terms });
      }
    }
    return indexItems = { sys, subj, refs, quick };
  }

  // The indexes' entries with every phrase and word (as parseSearchTerms
  // returns them): {sections: [{title, hits, build}], count, regex, key}
  function searchIndexes(phrases, words, regex, key, typed) {
    const has = text => phrases.every(p => text.includes(p)) && words.every(w => text.includes(w));
    const { sys, subj, refs, quick } = getIndexItems();

    // Those with more of the terms in their own text (or in their search terms,
    // the synonyms: "derrubada" for the veto) first, more yet in the label
    // ("prazo vista": the pedido de vista before every other prazo;
    // "aparte": the shorter label, cabe aparte, before the tempos that mention it;
    // a tema with every term in its name before all: "posse", the ficha of the posse)
    const terms = phrases.concat(words);
    // a ficha is found also by the word's stem, in another number or gender
    // ("prejudicado": the ficha "Proposição prejudicada"; "apartes": the ficha "Aparte")
    // (the stem starts a word and ends it within 3 letters: "comissão" finds
    // "Comissões", not "Subcomissões"; "público" finds "pública", not "publicação")
    // (only words of letters: "1/5" and "§" are matched as typed; -ão/-ões and -al/-ais leave a stem of 3 letters
    // or more, "moções" finds "Moção"; the plural -s and the last vowel, 4 or more: "meses" doesn't find "mesa")
    const stem = w => {
      if (w.length < 5) return w;
      const m = w.replace(/(oes|aos|aes|ao|ais|eis|al|el)$/, '');
      if (m !== w) return m.length >= 3 ? m : w;
      const s = w.replace(/(es|s)$/, '').replace(/[aoe]$/, '');
      return s.length >= 4 ? s : w;
    };
    // (a word of up to 3 letters, often a sigla, is the whole word or its plural: "PL" doesn't find "Plano")
    const stemRes = words.map(w => !/^[a-z]+$/.test(w) ? null
      : w.length <= 3 ? new RegExp('(^|[^a-z0-9])' + w + 's?($|[^a-z0-9])')
      : new RegExp('(^|[^a-z0-9])(' + stem(w) + '[a-z]{0,3}|' + w + ')($|[^a-z0-9])'));
    const wordIn = (k, text) => stemRes[k] ? stemRes[k].test(text) : text.includes(words[k]);
    const isTema = it => it.sec.key === 'temas';
    const byStem = text => phrases.every(p => text.includes(p)) && words.every((w, k) => wordIn(k, text));
    // in a ficha's name a word counts only from a word's start ("lei" is not in "Eleição")
    // (and so does a word of up to 3 letters in any name: "PL" is not in "Plano Diretor")
    const inLabel = (it, k) => k >= phrases.length && (isTema(it) || words[k - phrases.length].length <= 3)
      ? wordIn(k - phrases.length, it.label) : it.label.includes(terms[k]);
    // a connective of the query needs not be in the name: "prazo do parecer" names "Prazos de parecer das Comissões"
    const CONNECTIVES = new Set(['a', 'o', 'e', 'as', 'os', 'ao', 'aos', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
      'para', 'por', 'pelo', 'pela', 'com', 'um', 'uma']);
    const loose = k => k >= phrases.length && CONNECTIVES.has(terms[k]) && terms.some(t => !CONNECTIVES.has(t));
    const temaNamed = it => isTema(it) && terms.every((t, k) => loose(k) || inLabel(it, k)) ? 1 : 0;
    // a ficha whose search terms have the whole query, as typed ("caso omisso", "sorteado"), from a word's start,
    // before those that only mention it, unless the query is a single word many fichas list ("sessão", "prazo"):
    // there the name decides
    const query = (typed || terms.join(' ')).trim();
    const queryRe = query ? new RegExp('(^|[^a-z0-9])' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      + (query.length <= 3 ? '($|[^a-z0-9])' : '')) : null;
    const termedBy = queryRe ? quick.filter(it => isTema(it) && queryRe.test(it.terms)).length : 0;
    const temaTermed = it => isTema(it) && queryRe && (terms.length > 1 || termedBy <= 2) && queryRe.test(it.terms) ? 1 : 0;
    const quickHits = quick.filter(it => has(it.text) || (isTema(it) && byStem(it.text)))
      .map((it, i) => ({ it, i, score: terms.reduce((n, t, k) => n + (inLabel(it, k) ? 2 : it.own.includes(t) || it.terms.includes(t) ? 1 : 0), 0) + temaNamed(it) + temaTermed(it) }))
      .sort((a, b) => b.score - a.score || (b.score > terms.length ? a.it.label.length - b.it.label.length : 0) || a.i - b.i);

    const sysHits = sys.filter(it => has(it.text));

    // Subjects found by their name first, then those found by a sub-subject
    // (names also by the stem, as the fichas: "apartes" finds APARTE; those
    // with the very word first: "comissões", COMISSÕES before COMISSÃO DE...).
    // Found by its name, a subject brings all its sub-subjects, those with
    // the terms first, so it doesn't look smaller than it is ("veto": none of
    // VETO's sub-subjects says veto). The subject named just the query, in any
    // number, before all ("prefeito": PREFEITO before CASSAÇÃO DE MANDATO DE
    // PREFEITO, which it would follow in alphabetical order)
    const nameIsQuery = [], byName = [], byStemName = [], bySub = [];
    const hasName = text => has(text) || byStem(text);
    const stems = text => text.split(' ').map(stem).join(' ');
    const queryStems = stems(query);
    for (const it of subj) {
      const exact = has(it.text);
      const self = exact || byStem(it.text);
      const subs = it.children.filter(c => hasName(self ? c.text : c.withSubject));
      const hit = { it, subs: subs.concat(it.children.filter(c => !subs.includes(c))), byName: true };
      if (self && stems(it.text) === queryStems) nameIsQuery.push(hit);
      else if (self) (exact ? byName : byStemName).push(hit);
      else if (subs.length) bySub.push({ it, subs, byName: false });
    }
    // the very word before another number ("comissão": COMISSÃO, then COMISSÕES)
    nameIsQuery.sort((a, b) => (b.it.text === query) - (a.it.text === query));
    byName.unshift(...nameIsQuery);
    byName.push(...byStemName);

    const refHits = [];
    for (const it of refs) {
      if (it.leg) {
        if (has(it.text)) refHits.push({ it, entries: it.entries });
      } else {
        const entries = it.entries.filter(x => has(x.withTitle));
        if (entries.length) refHits.push({ it, entries });
      }
    }

    const sections = [
      { title: 'Consulta rápida', where: 'na consulta rápida', hits: quickHits, build: buildQuickResult, shown: QUICK_SHOWN },
      { title: 'Índice sistemático',where: 'no índice sistemático', hits: sysHits, build: buildSysResult },
      { title: 'Índice remissivo', where: 'no índice remissivo', hits: byName.concat(bySub), build: buildSubjectResult },
      { title: 'Referências', where: 'nas referências', hits: refHits, build: buildRefResult },
    ].filter(s => s.hits.length);
    const named = new Set(quickHits.filter(h => temaNamed(h.it)).map(h => h.it.item));
    return { sections, count: sections.reduce((n, s) => n + s.hits.length, 0), regex, key, named };
  }

  // The indexes' part of the list, in one element at its top (kept when the
  // list is rebuilt for the same indexMatches: see buildResultsList)
  function appendIndexResults() {
    indexPart = document.createElement('div');
    indexPart.className = 'res-idx-part';
    indexPartFor = indexMatches;
    for (const sec of indexMatches.sections) {
      const head = document.createElement('div');
      head.className = 'res-idx';
      head.setAttribute('role', 'heading');
      head.setAttribute('aria-level', '3');
      head.textContent = sec.title + ' · ' + sec.hits.length;
      indexPart.appendChild(head);
      const more = appendWithMore(indexPart, sec.hits, sec.shown || INDEX_GROUPS_SHOWN, sec.build, ['resultado', 'resultados'], 'res-idx-more');
      if (more) more.setAttribute('aria-label', more.textContent + ' ' + sec.where);
    }
    $resultsList.appendChild(indexPart);
  }

  // Appends build(item) of the first `shown` items to parent, the rest behind
  // a "+ N" button (returned). noun: [singular, plural], or the button's text
  // from the hidden items.
  function appendWithMore(parent, items, shown, build, noun, cls) {
    for (const item of items.slice(0, shown)) parent.appendChild(build(item));
    const rest = items.length - shown;
    if (rest <= 0) return null;
    const more = document.createElement('button');
    more.className = 'res-expand' + (cls ? ' ' + cls : '');
    more.textContent = typeof noun === 'function' ? noun(items.slice(shown)) : '+ ' + rest + ' ' + noun[rest === 1 ? 0 : 1];
    more.addEventListener('click', () => {
      const hadFocus = document.activeElement === more;
      const added = items.slice(shown).map(build);
      more.before(...added);
      // the keyboard goes on from the first entry shown now (or, if none of
      // them does anything, from the next one in the list)
      let next = null;
      if (hadFocus) {
        for (const el of added) {
          next = el.matches('button') ? el : el.querySelector('button');
          if (next) break;
        }
        if (!next) {
          const last = added[added.length - 1];
          next = Array.from($resultsList.querySelectorAll('button')).find(b =>
            b !== more && last.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        }
      }
      more.remove();
      if (next) next.focus();
    });
    parent.appendChild(more);
    return more;
  }

  // text as HTML with the search's matches marked; whole, or (long texts)
  // just around the matches
  function indexMarkHtml(text, snippet) {
    const re = indexMatches.regex;
    const spans = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      if (!m[0].length) { re.lastIndex++; continue; }
      if (!isWeakMatch(re, m[0])) spans.push([m.index, m.index + m[0].length]);
    }
    return snippet ? snippetHtml(text, spans) : markSpans(text, 0, text.length, spans);
  }

  // label: what the group is (a subject, a norm), for screen readers
  // entering one of its entries
  function indexGroup(label) {
    const group = document.createElement('div');
    group.className = 'res-group res-idx-group';
    if (label) {
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', label);
    }
    return group;
  }

  // A button of the list: go() moves the page (and returns the element to
  // focus, if not the selected card). Without go (nothing to open), plain text.
  function indexButton(cls, html, go) {
    const el = document.createElement(go ? 'button' : 'div');
    el.className = cls + (go ? '' : ' res-inert');
    el.innerHTML = html;
    if (go) el.addEventListener('click', e => goToIndexResult(e, go));
    return el;
  }

  function goToIndexResult(event, go) {
    takeStep();
    const fromDrawer = resultsDrawerOpen;
    if (resultsDrawerOpen) {
      resultsDrawerOpen = false;
      updateResultsVisibility();
    }
    const target = go() || selectedCard;
    // As in goToResult: after a click or tap, the keys scroll the page
    // (keyboard activation keeps the focus on the sidebar list, which keeps
    // its indexes' part when the search runs again)
    if (target && (fromDrawer || (event && event.detail > 0))) {
      if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  }

  // A section of the sistemático: "TÍTULO III › CAPÍTULO II — DAS COMISSÕES PERMANENTES (art. 46–79)"
  function buildSysResult(hit) {
    const { node, ctx } = hit;
    let html = ctx.length ? '<span class="res-ctx">' + escapeHtml(ctx.join(' › ')) + ' › </span>' : '';
    html += indexMarkHtml(node.title);
    if (node.art_range && !(node.children && node.children.length)) {
      html += ' <span class="res-sum">' + escapeHtml(node.art_range) + '</span>';
    }
    const group = indexGroup();
    group.appendChild(indexButton('res-head', html, () => navigateToSection(node.section_id)));
    return group;
  }

  // A subject of the remissivo: its sub-subjects with the terms (and their
  // "vide") and, found by its name, its articles, all its sub-subjects and
  // its "vide"; each puts the subject in the search bar
  function buildSubjectResult(hit) {
    const { entry } = hit.it;
    const group = indexGroup(entry.subject);
    const allRefs = collectAllRefs(entry);
    group.appendChild(indexButton('res-head', indexMarkHtml(entry.subject) + (hit.byName ? refsHtml(entry.refs) : ''),
      allRefs.length ? () => { openSubject({ subject: entry.subject, refs: allRefs }); } : null));
    const items = [];
    for (const sub of hit.subs) {
      items.push({ sub });
      for (const vide of sub.ch.vides || []) items.push({ vide });
    }
    if (hit.byName) for (const vide of entry.vides || []) items.push({ vide });
    // "+ 5 subassuntos", "+ 12 subassuntos, 3 vide", "+ 2 outros"
    const more = hidden => {
      const subs = hidden.filter(item => item.sub).length, vides = hidden.length - subs;
      if (!subs) return '+ ' + vides + (vides > 1 ? ' outros' : ' outro');
      return '+ ' + subs + ' subassunto' + (subs > 1 ? 's' : '') + (vides ? ', ' + vides + ' vide' : '');
    };
    appendWithMore(group, items, INDEX_ENTRIES_SHOWN, ({ sub, vide }) => {
      if (vide) {
        const target = findVide(vide);
        return indexButton('res-entry res-vide', 'vide ' + escapeHtml(target.label),
          target.refs.length ? () => { openSubject({ subject: target.label, refs: target.refs }); } : null);
      }
      const ch = sub.ch;
      const refs = subjectRefs(entry, ch.sub_subject);
      return indexButton('res-entry', '— ' + indexMarkHtml(ch.sub_subject) + refsHtml(ch.refs),
        refs.length ? () => { openSubject({ subject: entry.subject + ' — ' + ch.sub_subject, refs }); } : null);
    }, more);
    return group;
  }

  // The articles, one per line in two columns, as the index's tab shows
  // them: the dispositivo with its norma's badge ("RI art. 46"), its dica
  function refsHtml(refs) {
    if (!refs || !refs.length) return '';
    let html = '';
    for (const r of formatRefsList(refs)) {
      html += '<span class="res-ref">' + refCellHtml(r)[0]
        + '<span class="res-ref-hint">' + (r.hint ? indexMarkHtml(r.hint) : '') + '</span></span>';
    }
    return '<span class="res-refs">' + html + '</span>';
  }

  // The subject (or sub-subject) a "vide" points to ("ASSUNTO" or
  // "ASSUNTO|subassunto"), and its articles
  let subjectsByKey = null;
  function findVide(vide, seen = new Set([vide])) {
    if (!subjectsByKey) subjectsByKey = new Map(SUBJECT_INDEX.map(e => [normIndexText(e.subject), e]));
    const [subject, sub] = vide.split('|').map(s => s.trim());
    const entry = subjectsByKey.get(normIndexText(subject));
    if (!entry) return { label: sub ? subject + ' — ' + sub : subject, refs: [] };
    if (!sub) return { label: entry.subject, refs: collectAllRefs(entry) };
    return { label: entry.subject + ' — ' + sub, refs: subjectRefs(entry, sub, seen) };
  }

  // The articles of a sub-subject. One without its own (a heading, as
  // "vantagens" or "cargo"): those of the sub-subjects under it ("vantagens:
  // adicional", "cargo em comissão") and of its "vide", as the index shows
  // around it.
  function subjectRefs(entry, sub, seen = new Set()) {
    const key = normIndexText(sub);
    const children = entry.children || [];
    const ch = children.find(c => normIndexText(c.sub_subject) === key);
    if (ch && ch.refs.length) return ch.refs;
    const refs = [];
    for (const c of children) {
      const k = normIndexText(c.sub_subject);
      if (k !== key && (k.startsWith(key + ':') || k.startsWith(key + ' '))) refs.push(...c.refs);
    }
    for (const vide of (ch && ch.vides) || []) {
      if (seen.has(vide)) continue;   // "cargo" and "função" point to each other
      seen.add(vide);
      refs.push(...findVide(vide, seen).refs);
    }
    // once each, in order
    const keys = new Set();
    return refs.filter(r => {
      const k = (r.law_prefix || '') + ':' + r.art + ':' + (r.detail || '');
      return !keys.has(k) && keys.add(k);
    });
  }

  // A group of the referências: a prazo or quórum (its entries with the
  // terms), or a norm of the legislação correlata (its ementa and the
  // provisions it's linked to)
  function buildRefResult(hit) {
    const { it, entries } = hit;
    const group = indexGroup(it.group.title);
    const head = document.createElement('div');
    head.className = 'res-head res-idx-title';
    head.innerHTML = '<span class="res-law-tag">' + escapeHtml(it.cat.category) + '</span>' + indexMarkHtml(it.group.title);
    group.appendChild(head);
    if (!it.leg) {
      appendWithMore(group, entries, INDEX_ENTRIES_SHOWN, x => indexButton('res-entry',
        (x.e.art_ref ? '<span class="res-label">' + escapeHtml(refEntryLabel(x.e)) + '</span> ' : '')
          + '<span class="res-text">' + indexMarkHtml(x.text, true) + '</span>',
        x.e.art_ref ? () => goToRefEntry(x.e, false) : null,
      ), ['trecho', 'trechos']);
      return group;
    }
    if (it.ementa) {
      const ementa = document.createElement('div');
      ementa.className = 'res-ementa';
      ementa.innerHTML = indexMarkHtml(it.ementa, true);
      ementa.title = it.ementa;
      group.appendChild(ementa);
    }
    // The provisions as links in a line, their text on hover
    const links = document.createElement('div');
    links.className = 'res-artlinks';
    appendWithMore(links, entries, ART_LINKS_SHOWN, x => {
      const btn = indexButton('res-artlink', escapeHtml(refEntryLabel(x.e)), () => goToRefEntry(x.e, true));
      btn.title = x.text;
      return btn;
    }, ['dispositivo', 'dispositivos']);
    group.appendChild(links);
    return group;
  }

