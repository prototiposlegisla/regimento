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

  // Amendment notes ("(Redação dada…)", "(Revogado…)", "(Vide…)"), left out of the
  // comparison on both sides (the old version has them in .amendment-note spans)
  const AMENDMENT_NOTE_RE = /\s*\((?:Reda[çc][ãa]o|Inclu[ií]d|Inserid|Acrescentad|Revogad|Renumerad|Alterad|Vide\b|Suprimid|Declarad|Adin\b|ADI\b|Precedente|NR(?=\))|Vig[êe]ncia|Produ[çc][ãa]o|Novamente|Designad|Restabelecid|Reestabelecid)[^()]*(?:\([^()]*\)[^()]*)*\)/gi;
  // The provision's identifier and separator at the start ("§ 1º -", "IV —", "b)"):
  // the current version shows it in .unit-id, the old one in the text
  const LEADING_IDENT_RE = /^\s*(?:Art\.?\s*\d+\s*[ºª°]?(?:-?[A-H](?=[.\s\-–—]))?|§\s*\d+\s*\.?\s*[ºª°]?(?:-[A-H])?|Par[aá]grafo\s+[uú]nico|[IVXLC]+(?=\s*[-–—])|[a-z]\s?\)|\d+\s*\)|\d+(?=\s*[-–—]))\s*[-–—.:]?\s*/i;

  function extractPlainText(el) {
    // Only the provision's text: no identifier, amendment notes or UI bits
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.amendment-note, .diff-toggle, .footnote-ref, .footnote-box, .unit-id, .indent-path')
      .forEach(n => n.remove());
    return clone.textContent
      .replace(AMENDMENT_NOTE_RE, '')
      .replace(/([.;:,])\s*[.;,]+/g, '$1')      // punctuation left around a removed note
      .replace(LEADING_IDENT_RE, '')
      .replace(/^[\s\-–—]+/, '')
      .trim();
  }

  function findNextVersion(oldEl) {
    const ident = oldEl.dataset.ident || '';
    const path = oldEl.dataset.path || '';
    // A provision in the article (it has a path): the next old version of the same
    // path, or the current version of the same path, wherever it is in the card
    if (path) {
      for (let sib = oldEl.nextElementSibling; sib; sib = sib.nextElementSibling) {
        if (sib.classList.contains('old-version')) {
          if (sib.dataset.path === path) return sib;
          continue;
        }
        const uid = sib.querySelector && sib.querySelector('.unit-id');
        if (uid && uid.dataset.path === path) return sib;
      }
      return null;
    }
    // A precedent's item ("6)", "6 -"): the next wording with the same number
    const item = oldEl.dataset.item || '';
    if (item) {
      for (let sib = oldEl.nextElementSibling; sib; sib = sib.nextElementSibling) {
        if (sib.dataset && sib.dataset.item === item) return sib;
      }
      return null;
    }
    // Old caput versions: the next old caput or the current caput
    if (!/^Art/i.test(ident)) return null;
    // Walk forward through siblings to find the next version (old or current)
    let sib = oldEl.nextElementSibling;
    while (sib) {
      // Skip diff panels
      if (sib.classList.contains('diff-panel')) {
        sib = sib.nextElementSibling;
        continue;
      }
      if (sib.classList.contains('old-version')) {
        // Another old version — return it if same ident (sequential diff)
        const sibIdent = sib.dataset.ident || '';
        if (ident && ident === sibIdent) return sib;
        // Different ident — skip
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
    // The diff panel's text is part of the card's searchable text
    invalidateCardText(oldEl.closest('.card'));
    // If already open, close
    if (oldEl.classList.contains('diff-open')) {
      oldEl.classList.remove('diff-open');
      const panel = oldEl.nextElementSibling;
      if (panel && panel.classList.contains('diff-panel')) {
        panel.remove();
      }
      return;
    }

    const nextEl = findNextVersion(oldEl);
    if (!nextEl) return;

    const oldText = extractPlainText(oldEl);
    const newText = extractPlainText(nextEl);

    const diff = wordDiff(oldText, newText);

    const panel = document.createElement('div');
    panel.className = 'diff-panel';
    if (!diff.some(part => part.type !== 'eq')) {
      panel.textContent = 'Sem alteração no texto (só nas notas).';
      oldEl.classList.add('diff-open');
      oldEl.after(panel);
      return;
    }
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
      if (!findNextVersion(el)) return;
      const btn = document.createElement('span');
      btn.className = 'diff-toggle';
      btn.textContent = '\u21C4';
      btn.title = 'Comparar com versão seguinte';
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

