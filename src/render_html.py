"""Renderização dos cards HTML a partir do ParsedDocument."""

from __future__ import annotations

import html
import re
from typing import TYPE_CHECKING, Optional

from .parse_docx import note_tail_spans
from .remissoes import EXIBIVEIS, law_of

if TYPE_CHECKING:
    from .remissoes import Remissao, Resultado
from .models import (
    PREC, ArticleBlock, DocumentUnit, Footnote, FootnotePara,
    ParsedDocument, SectionHeading, TextRun, UnitType, prec_label, unit_path,
)


# Capa de cada norma (pelo prefixo dos seus artigos): o monograma ao fundo e
# a linha de identificação sob o nome
CAPA_NORMA = {
    "": ("RI", "Câmara Municipal de São Paulo · Resolução nº 2, de 26 de abril de 1991"),
    "LOM": ("LOM", "Município de São Paulo · promulgada em 4 de abril de 1990"),
    "CE": ("CE", "Estado de São Paulo · promulgada em 5 de outubro de 1989 · dispositivos selecionados"),
    "CF": ("CF", "República Federativa do Brasil · promulgada em 5 de outubro de 1988 · dispositivos selecionados"),
    PREC: ("PR", "Câmara Municipal de São Paulo · decisões e interpretações da Presidência (RI, art. 313)"),
}

# O tipo de cada dispositivo, que dá a cor do seu número (o artigo sem classe)
UNIT_ID_KIND = {
    UnitType.PARAGRAFO_UNICO: "u-par", UnitType.PARAGRAFO_NUM: "u-par",
    UnitType.INCISO: "u-inc", UnitType.ALINEA: "u-ali",
    UnitType.SUB_ALINEA: "u-item", UnitType.ITEM_NUM: "u-item",
}


class HTMLRenderer:
    """Gera HTML dos cards com a mesma estrutura do index.html original."""

    def __init__(self, remissoes: Optional["Resultado"] = None, busca: Optional[dict[tuple[str, str], str]] = None,
                 cf_ce: Optional[set[tuple[str, str]]] = None):
        self.footnote_counter = 0
        # Pares CF × CE de texto igual (remissoes_cf_ce.toml): os dois correlatos do mesmo dispositivo viram um selo
        self._cf_ce = cf_ce or set()
        # Forma certa dos erros do texto oficial, que a busca lê junto com o texto do card (data-busca)
        self._busca = busca or {}
        self._leg_ids: dict[int, str] = {}   # legislação correlata: id(unit) -> "L1", "L2"...
        # Remissões explícitas: os trechos citados viram gatilho de uma prévia
        self._rem_by_unit = remissoes.por_unidade() if remissoes else {}
        self._cited_by = remissoes.citado_em() if remissoes else {}
        # Remissões implícitas: um selo no fim do dispositivo, nos dois lados
        self._imp_by_unit = remissoes.implicitas_por_unidade() if remissoes else {}
        # Notas dos correlatos, cada uma uma vez: o selo está nos dois lados e leva só o número
        self.notas: list[str] = []
        self._nota_n: dict[str, int] = {}

    def render(self, doc: ParsedDocument) -> str:
        """Renderiza todos os elementos do documento."""
        # A norma de cada título: a dos artigos que vêm depois dele
        norma_de: dict[int, str] = {}
        norma = ""
        for el in reversed(doc.elements):
            if isinstance(el, ArticleBlock):
                norma = el.law_prefix
            elif isinstance(el, SectionHeading):
                norma_de[id(el)] = norma
        parts: list[str] = []
        for el in doc.elements:
            if isinstance(el, SectionHeading):
                parts.append(self._render_heading(el, norma_de.get(id(el), "")))
            elif isinstance(el, ArticleBlock):
                parts.append(self._render_article(el))
        return "\n\n".join(parts)

    def _render_heading(self, h: SectionHeading, norma: str = "") -> str:
        text = html.escape(h.text)
        if h.subtitle:
            text += "<br>" + html.escape(h.subtitle)
        section = html.escape(h.data_section)
        nivel = self._heading_nivel(h)
        # a norma (como o data-law dos artigos; o Regimento sem) e, na capa,
        # o monograma e a linha de identificação
        attrs = f' data-nrm="{html.escape(norma)}"' if norma else ""
        if nivel == "nivel-norma" and norma in CAPA_NORMA:
            mono, sub = CAPA_NORMA[norma]
            attrs += f' data-mono="{html.escape(mono)}" data-sub="{html.escape(sub)}"'
        return (
            f'  <div class="card card-titulo {nivel}" data-section="{section}"{attrs}>'
            f"{text}</div>"
        )

    @staticmethod
    def _heading_nivel(h: SectionHeading) -> str:
        if h.data_section.startswith("norma"):
            return "nivel-norma"
        if h.level == UnitType.TITULO:
            return "nivel-titulo"
        if h.level == UnitType.CAPITULO:
            return "nivel-capitulo"
        if h.level == UnitType.SECAO:
            return "nivel-secao"
        return "nivel-subsecao"

    def _render_article(self, art: ArticleBlock) -> str:
        if art.law_prefix == PREC:
            return self._render_precedent(art)
        art_num = html.escape(art.art_number)
        revoked_cls = " revoked" if art.is_revoked else ""
        law_attr = ""
        if art.law_prefix:
            law_attr = f' data-law="{html.escape(art.law_prefix)}"'
        busca = self._busca.get((art.law_prefix or "RI", art.art_number))
        if busca:
            law_attr += f' data-busca="{html.escape(busca)}"'
        parts: list[str] = []
        parts.append(
            f'  <div class="card card-artigo{revoked_cls}" data-art="{art_num}"{law_attr}>'
        )

        # Compact-mode label (hidden by default, shown via CSS)
        compact_suffix = " ADT" if art.law_prefix == "ADT" else ""
        parts.append(
            f'    <span class="art-compact-label">Art. {art_num}{compact_suffix}</span>'
        )

        # Article summary
        if art.summary:
            summary = html.escape(art.summary)
            parts.append(f'    <span class="art-summary">{summary}</span>')

        # Law badge (for non-default laws)
        if art.law_prefix:
            badge = html.escape(art.law_prefix)
            parts.append(f'    <span class="law-badge">{badge}</span>')

        # Old caputs from full-article rewrites (in DOCX order), with their children
        v_ctx = ["", "", "", ""]
        for v in art.all_versions:
            if v.unit_type == UnitType.ARTIGO:
                v_ctx = ["", "", "", ""]
                parts.append(self._render_old_version(v))
            else:
                parts.append(self._render_old_version(v, path=self._update_path_ctx(v, v_ctx)))

        # Current caput
        if art.caput:
            parts.append(self._render_unit_as_p(art.caput, is_caput=True))

        # Children in document order (old versions interleaved)
        path_ctx = ["", "", "", ""]  # [para, inciso, alinea, sub]
        all_ctx = ["", "", "", ""]   # same, also moved by old versions (their data-path)
        for child in art.children:
            all_path = self._update_path_ctx(child, all_ctx)
            if child.is_old_version:
                parts.append(self._render_old_version(child, is_child=True, path=all_path))
            else:
                path = self._update_path_ctx(child, path_ctx)
                parts.append(self._render_unit_as_p(
                    child, is_caput=False, path=path,
                    art_number=art.art_number,
                ))

        parts.extend(self._render_backlinks(art))

        parts.append("  </div>")
        return "\n".join(parts)

    def _render_backlinks(self, art: ArticleBlock) -> list[str]:
        """Where this article is cited (labels via CSS, out of the searchable text).

        The precedents that cite an article of the Regimento come in a line of their own.
        """
        cited = self._cited_by.get((law_of(art), art.art_number), [])
        precs = [o for o in cited if o.law == PREC] if art.law_prefix != PREC else []
        others = [o for o in cited if o not in precs]

        def items(origins, label):
            return "".join(
                f'<span class="rem rem-back" tabindex="0" role="button" data-ref="{html.escape(o.ref)}"'
                f' data-label="{html.escape(label(o))}"></span>'
                for o in origins
            )
        out = []
        if others:
            out.append(f'    <div class="rem-backlinks" data-label="Citado em:">{items(others, lambda o: o.rotulo)}</div>')
        if precs:
            out.append(f'    <div class="rem-backlinks rem-precs" data-label="Precedentes regimentais:">'
                       f'{items(precs, lambda o: prec_label(o.art))}</div>')
        return out

    def _render_precedent(self, art: ArticleBlock) -> str:
        """Card of a Precedente Regimental: its title, then its text as written, with the
        citations it makes (to the Regimento, by default) as remissão triggers."""
        art_num = html.escape(art.art_number)
        src = f' data-src="{html.escape(art.source_url)}"' if art.source_url else ""
        parts = [
            f'  <div class="card card-artigo card-prec" data-art="{art_num}" data-law="{PREC}"{src}>',
            f'    <span class="art-compact-label">Precedente {html.escape(prec_label(art.art_number))}</span>',
        ]
        if art.summary:
            parts.append(f'    <span class="art-summary">{html.escape(art.summary)}</span>')
        parts.append(f'    <span class="law-badge">{PREC}</span>')
        cap = art.caput
        parts.append(f"    <p>{self._render_unit_id(cap)}{self._footnote_refs(cap)}</p>{self._footnote_boxes(cap)}")
        for child in art.children:
            # the item number ("6)", "6 -", "6.") pairs a struck wording with the new one (diff)
            m = re.match(r"\s*(\d{1,3})\s*[).\-–—]", child.full_text)
            item = f' data-item="{m.group(1)}"' if m else ""
            if child.is_old_version:
                old = self._render_old_version(child)
                parts.append(old.replace('<p class="old-version"', f'<p class="old-version"{item}', 1))
                continue
            marks = self._rem_by_unit.get(id(child), ())
            body = (self._render_runs_with_marks(child.runs, 0, marks) if marks
                    else self._render_runs_from(child.runs, 0))
            parts.append(f'    <p class="prec-para"{item}>{body}{self._footnote_refs(child)}</p>'
                         f'{self._footnote_boxes(child)}')
        parts.extend(self._render_backlinks(art))
        parts.append("  </div>")
        return "\n".join(parts)

    def _footnote_refs(self, unit: DocumentUnit) -> str:
        """References to the unit's notes, inline: the legislação correlata badge, then the footnotes."""
        out = ""
        if unit.legislacao:
            n = len(unit.legislacao)
            label = "Legislação correlata" + (f" ({n})" if n > 1 else "")
            # a footnote reference (same box and tooltip), shown as a badge; label via CSS
            out += f'<sup class="footnote-ref leg-ref" data-note="{self._leg_id(unit)}" data-label="{label}"></sup>'
        for fn in unit.footnotes:
            note_id = f"b{fn.number}" if fn.is_private else str(fn.number)
            out += f'<sup class="footnote-ref" data-note="{note_id}">[{note_id}]</sup>'
        return out

    def _footnote_boxes(self, unit: DocumentUnit) -> str:
        """Note boxes (hidden by default, toggled by click)."""
        out = ""
        if unit.legislacao:
            # one per line: the search text and the results' snippets keep the norms apart
            items = "\n".join(f"<li>{self._render_runs(p.runs).strip()}</li>" for p in unit.legislacao)
            out += (f'\n    <div class="footnote-box leg-box" data-note="{self._leg_id(unit)}">\n'
                    f'      <button class="footnote-close">&times;</button>\n'
                    f'      <strong>Legislação correlata:</strong><ul class="leg-list">{items}</ul>\n'
                    f'    </div>')
        return out + "".join("\n" + self._render_footnote(fn) for fn in unit.footnotes)

    def _leg_id(self, unit: DocumentUnit) -> str:
        nid = self._leg_ids.get(id(unit))
        if nid is None:
            nid = self._leg_ids[id(unit)] = f"L{len(self._leg_ids) + 1}"
        return nid

    def _update_path_ctx(
        self, unit: DocumentUnit, ctx: list[str],
    ) -> str:
        """Atualiza contexto hierárquico e retorna path comma-separated.

        ctx = [para, inciso, alinea, sub]
        Formato do path: "I,b,2", "§ 1º,I", "§ú", etc.
        """
        return unit_path(unit, ctx)

    def _render_indent_path(self, art_number: str, path: str) -> str:
        """Generate per-column indent-path spans for gutter ancestry hints."""
        segments = path.split(",")
        parent_segments = segments[:-1]  # all but current unit

        # Column 0 = art number, columns 1+ = parent segments
        items: list[tuple[int, str]] = []
        if art_number:
            display_num = art_number.removeprefix("ADT")
            items.append((0, display_num))
        for i, seg in enumerate(parent_segments):
            # "§ 1º" → "§1", keep "§ú" as is
            compact = re.sub(r"§\s*(\d+)º", r"§\1", seg)
            items.append((i + 1, compact))

        parts: list[str] = []
        for col, label in items:
            escaped = html.escape(label)
            parts.append(
                f'<span class="indent-path" style="--col:{col}">'
                f'{escaped}</span>'
            )
        return "".join(parts)

    def _render_unit_as_p(
        self, unit: DocumentUnit, is_caput: bool, path: str = "",
        art_number: str = "",
    ) -> str:
        depth = 0
        if is_caput:
            cls_style = ""
        else:
            depth = len(path.split(",")) if path else 1
            depth_style = f' style="--depth:{depth}"' if depth > 1 else ""
            cls_style = f' class="art-para"{depth_style}'
        uid = html.escape(unit.uid)

        # Build indent-path gutter hint for deep units
        indent_html = ""
        if depth >= 2 and path:
            indent_html = self._render_indent_path(art_number, path)

        # Build inline content
        inner = indent_html + self._render_unit_id(unit, path=path)
        inner += " — "
        inner += self._render_runs_after_identifier(unit, self._rem_by_unit.get(id(unit), ()))
        inner += self._render_correlatos(unit)

        inner += self._footnote_refs(unit)
        return f"    <p{cls_style}>{inner}</p>{self._footnote_boxes(unit)}"

    def _render_unit_id(self, unit: DocumentUnit, path: str = "") -> str:
        uid = html.escape(unit.uid)
        label = html.escape(unit.identifier)
        path_attr = f' data-path="{html.escape(path)}"' if path else ""
        kind = UNIT_ID_KIND.get(unit.unit_type)
        cls = f"unit-id {kind}" if kind else "unit-id"
        return f'<span class="{cls}" data-uid="{uid}"{path_attr}>{label}</span>'

    def _render_runs_after_identifier(self, unit: DocumentUnit, marks: "tuple | list" = ()) -> str:
        """Renderiza os runs removendo o identificador do início.

        marks: remissões do dispositivo; o trecho citado vira o gatilho da prévia.
        """
        full_text = unit.full_text
        ident = unit.identifier

        # Find where the identifier ends in the text
        # Pattern: "Art. 43  - text" or "§ 1º - text" or "I - text"
        # Remove identifier + separator from start (tolerating leading spaces and
        # \xa0 inside the identifier: "  Art.\xa029. O Município...")
        escaped = r"\s*" + re.escape(ident).replace(r"\ ", r"\s*")
        # o identificador é "Art. 144"; no texto da Constituição Estadual (ALESP), "Artigo 144 -"
        escaped = escaped.replace(r"Art\.", r"Art(?:\.|igo)", 1)
        patterns = [
            escaped + r"\s*[-–—.]\s*",
            escaped + r"\s+",
        ]
        # Aceita variações da marca ordinal no texto do DOCX (identificador normalizado § 1º)
        if any(c in ident for c in "ºª°"):
            # Also "§ 1.º", "§ 1°" (degree sign), "§ 10" (no ordinal) and "§ 1 o A..." (CF)
            flex = re.sub("[ºª°]", lambda _: r"\s*\.?\s*(?:[ºª°]|(?-i:o)(?=\s))?", escaped)
            patterns += [flex + r"\s*[-–—.]\s*", flex + r"\s+"]
        skip_chars = 0
        for pat in patterns:
            m = re.match(pat, full_text, re.IGNORECASE)
            if m:
                skip_chars = m.end()
                break

        if skip_chars == 0:
            # Fallback: skip identifier length
            skip_chars = len(ident)

        # The wording notes at the end ("(Redação dada…) (Vide…)") in one span, as in
        # the old versions: the site shows them as a tag, out of the norma's text
        notes = note_tail_spans(full_text)
        nota = max(notes[0][0], skip_chars) if notes else None

        # Now render runs, skipping the first skip_chars characters
        if marks:
            return self._render_runs_with_marks(unit.runs, skip_chars, marks, nota)
        return self._render_runs_from(unit.runs, skip_chars, nota)

    def _render_runs_with_marks(
        self, runs: list[TextRun], skip_chars: int, marks: "list[Remissao]", nota: Optional[int] = None,
    ) -> str:
        """Como _render_runs_from, envolvendo cada trecho citado num gatilho de remissão.

        O link oficial que já estava no trecho fica no href do gatilho (sem link
        dentro de link); o JS mostra a prévia e o oferece como "fonte oficial".
        nota: onde começam as notas de redação do fim (ver _render_runs_from).
        """
        spans = []
        last_end = skip_chars
        for m in sorted(marks, key=lambda r: r.start):
            if m.start >= last_end and m.end > m.start:
                spans.append(m)
                last_end = m.end
        if not spans:
            return self._render_runs_from(runs, skip_chars, nota)

        cuts = sorted({skip_chars, *(m.start for m in spans), *(m.end for m in spans),
                       *((nota,) if nota is not None else ())})
        parts: list[str] = []
        pos = 0
        mi = 0
        open_mark = None
        in_nota = False
        longa = nota is not None and self._nota_longa("".join(r.text for r in runs)[nota:])
        for run in runs:
            r_start, r_end = pos, pos + len(run.text)
            pos = r_end
            if r_end <= skip_chars:
                continue
            bounds = [max(r_start, skip_chars)] + [c for c in cuts if max(r_start, skip_chars) < c < r_end] + [r_end]
            for a, b in zip(bounds, bounds[1:]):
                if a == nota and open_mark is None:
                    parts.append(self._nota_open(longa))
                    in_nota = True
                if open_mark is None and mi < len(spans) and spans[mi].start == a:
                    open_mark = spans[mi]
                    parts.append(self._open_mark(open_mark))
                text = run.text[a - r_start:b - r_start]
                # a link cut by a citation: its leftover " ", ";", "(Vide " or "(Redação dada pelo "
                # outside stays plain text
                split = (a > r_start or b < r_end) and open_mark is None
                esc = html.escape(text)
                if in_nota and longa:
                    esc = esc.replace(" ", self.ESPACO_NOTA).replace("\xa0", "\u202f")
                parts.append(self._wrap_run(esc, run,
                                            link=not (split and re.fullmatch(
                                                r"[\s\xa0.,;:()–—-]*(?:(?:no|na|nos|nas|do|da|dos|das|ao|aos|e|[Vv]ide"
                                                r"|Reda[çc][ãa]o\s+dada\s+pel[oa])"
                                                r"[\s\xa0]*)?", text)),
                                            in_mark=open_mark is not None))
                if open_mark is not None and open_mark.end == b:
                    parts.append("</span>")
                    open_mark = None
                    mi += 1
        if open_mark is not None:
            parts.append("</span>")
        if in_nota:
            parts.append("</span>")
        return "".join(parts)

    # Label of the implicit remissão's badge, seen from each side: (origin, target)
    CHIP_PREFIX = {"eq": ("≈", "≈"), "det": ("detalha", "detalhado em"), "fund": ("↑", "↓"), "div": ("≠", "≠"),
                   "sim": ("⇄", "⇄"), "exc": ("regra geral:", "exceção:")}

    def _render_correlatos(self, unit: DocumentUnit) -> str:
        """Selos das remissões implícitas do dispositivo (rótulo e nota em atributos: fora da busca). Correlatos do
        mesmo tipo com a CF e com a CE de um par de texto igual (remissoes_cf_ce.toml) saem num selo só (o49)."""
        itens = list(self._imp_by_unit.get(id(unit), ()))
        outro = lambda im, side: im.destino if side == "src" else im.origem
        juntos: dict[int, tuple] = {}     # índice do correlato com a CF -> (correlato com a CE, lado)
        usados: set[int] = set()
        if self._cf_ce:
            for i, (im, side) in enumerate(itens):
                if outro(im, side).law != "CF":
                    continue
                for j, (im2, side2) in enumerate(itens):
                    if j in usados or side2 != side or im2.tipo != im.tipo or outro(im2, side2).law != "CE":
                        continue
                    if (outro(im, side).ref, outro(im2, side2).ref) in self._cf_ce:
                        juntos[i] = (im2, side2)
                        usados.add(j)
                        break
        out = []
        for i, (im, side) in enumerate(itens):
            if i in usados:
                continue
            par = juntos.get(i)
            out.append(self._selo(im, side, par[0] if par else None))
        return "".join(out)

    def _rotulo_alvo(self, other) -> str:
        art = f"DGT {other.art[3:]}" if other.art.startswith("ADT") and other.law == "LOM" else             (f"ADT {other.art[3:]}" if other.art.startswith("ADT") else other.art)
        path = other.path.replace("§ú", "p.ú.").replace(",", ", ")
        return f"{other.law} {art}" + (f", {path}" if path else "")

    def _selo(self, im, side: str, ce=None) -> str:
        """Um selo de correlato; com ce, o correlato com a CE de texto igual ao da CF vai junto (dois links, uma nota)."""
        other = im.destino if side == "src" else im.origem
        prefix = self.CHIP_PREFIX[im.tipo][0 if side == "src" else 1]
        label = f"{prefix} {self._rotulo_alvo(other)}"
        ref = other.ref
        nota = im.nota
        if ce is not None:
            other_ce = ce.destino if side == "src" else ce.origem
            label += f" · {self._rotulo_alvo(other_ce)}"
            ref += ";" + other_ce.ref
            nota = (nota.rstrip() + " " if nota else "") + "A CE repete a regra, para o Estado."
        attrs = f' data-ref="{html.escape(ref)}" data-tipo="{im.tipo}" data-side="{side}"'
        if nota:
            # a nota vai uma vez só para a página (CORRELATO_NOTAS); o selo leva o número dela
            n = self._nota_n.setdefault(nota, len(self.notas))
            if n == len(self.notas):
                self.notas.append(nota)
            attrs += f' data-n="{n}"'
        attrs += f' data-label="{html.escape(label)}"'
        if im.tipo == "sim" and im.origem.law == im.destino.law:
            attrs += ' data-mesma="1"'   # "correspondente" na mesma norma: não é regra federal
        elif im.tipo == "sim" and ce is not None:
            attrs += ' data-esfera="ambas"'   # as regras federal e estadual correspondentes, juntas
        elif im.tipo == "sim" and im.destino.law == "CE":
            attrs += ' data-esfera="estadual"'   # a regra correspondente é a do Estado
        if im.proposta or (ce is not None and ce.proposta):
            attrs += ' data-status="proposta"'
        return f'<span class="rem rem-imp t-{im.tipo}" tabindex="0" role="button"{attrs}></span>'

    @staticmethod
    def _open_mark(rem: "Remissao") -> str:
        alvos = [a for a in rem.alvos if a.status in EXIBIVEIS]
        attrs = f' data-ref="{html.escape(";".join(a.ref for a in alvos))}"'
        revogados = [a.ref for a in alvos if a.status == "revogado"]
        if revogados:
            attrs += f' data-rev="{html.escape(";".join(revogados))}"'
        tachados = [a.ref for a in alvos if a.status == "tachado"]
        if tachados:
            attrs += f' data-tach="{html.escape(";".join(tachados))}"'
        return f'<span class="rem rem-exp" tabindex="0" role="button"{attrs}>'

    # A long note flows with the text (a tag that doesn't fit would leave the
    # justified line before it spread over the whole width), its words apart
    # by four-per-em spaces (and the no-break ones narrow), which justification
    # doesn't stretch (and a search takes as spaces, \s); a short one is a
    # block in the line
    NOTA_LONGA = 45
    ESPACO_NOTA = "\u2005"

    @classmethod
    def _nota_longa(cls, text: str) -> bool:
        return len(text.strip()) > cls.NOTA_LONGA

    @classmethod
    def _nota_open(cls, longa: bool) -> str:
        return f'<span class="amendment-note{" longa" if longa else ""}">'

    @classmethod
    def _wrap_run(cls, escaped: str, run: TextRun, link: bool = True, in_mark: bool = False) -> str:
        """Link, tachado, negrito e itálico de um trecho de run (já escapado).

        in_mark: dentro de um gatilho de remissão; o link sai da ordem do Tab (o
        gatilho é a parada) e continua abrindo com Ctrl/Cmd+clique.
        """
        # a piece without a letter or digit is not a link: the link of a note often starts at the
        # space before it (" (Redação dada…)"), and the PLP links a lone ";" (LOM 32) — each would
        # be a stray "↗" and an empty Tab stop
        link = link and re.search(r"\w", html.unescape(escaped)) is not None
        if link and run.hyperlink_url:
            tab = ' tabindex="-1"' if in_mark else ""
            # a link that is a note by itself, "(Dispositivos renumerados…)", even where
            # the note isn't one of the known kinds (note_tail_spans): shown as one
            if not in_mark and escaped.lstrip().startswith("("):
                longa = cls._nota_longa(html.unescape(escaped))
                if longa:
                    escaped = escaped.replace(" ", cls.ESPACO_NOTA).replace("\xa0", "\u202f")
                tab += f' class="amendment-note{" longa" if longa else ""}"'
            escaped = f'<a href="{html.escape(run.link_url)}" target="_blank" rel="noopener"{tab}>{escaped}</a>'
        elif link and run.hyperlink_anchor:
            # Internal link — generate navigation
            tab = ' tabindex="-1"' if in_mark else ""
            escaped = f'<a href="#{html.escape(run.hyperlink_anchor)}" class="internal-ref"{tab}>{escaped}</a>'
        if run.strike:
            escaped = f"<s>{escaped}</s>"
        if run.bold:
            escaped = f"<strong>{escaped}</strong>"
        if run.italic:
            escaped = f"<em>{escaped}</em>"
        return escaped

    def _render_runs_from(
        self, runs: list[TextRun], skip_chars: int, nota: Optional[int] = None
    ) -> str:
        """Renderiza runs pulando os primeiros skip_chars caracteres.

        nota: a posição (no texto inteiro) onde começam as notas de redação do
        fim; dali ao fim, num <span class="amendment-note">.
        """
        parts: list[str] = []
        pos = 0
        longa = nota is not None and self._nota_longa("".join(r.text for r in runs)[nota:])
        for run in runs:
            r_start, r_end = pos, pos + len(run.text)
            pos = r_end
            if r_end <= skip_chars:
                continue
            a = max(r_start, skip_chars)
            if nota is not None and a < nota < r_end:
                parts.append(self._wrap_run(html.escape(run.text[a - r_start:nota - r_start]), run))
                a = nota
            if a == nota:
                parts.append(self._nota_open(longa))
            text = html.escape(run.text[a - r_start:])
            if longa and nota <= a:
                text = text.replace(" ", self.ESPACO_NOTA).replace("\xa0", "\u202f")
            parts.append(self._wrap_run(text, run))
        if nota is not None and nota < pos:
            parts.append("</span>")
        return "".join(parts)

    def _render_footnote(self, fn: Footnote) -> str:
        note_id = f"b{fn.number}" if fn.is_private else str(fn.number)
        parts: list[str] = []
        in_indent = False
        has_content = False  # whether previous iteration added visible content
        for para in fn.paragraphs:
            rendered = self._render_runs(para.runs).replace("\n", "<br>")
            # Handle indent transitions before anything else
            if not para.indent and in_indent:
                parts.append("</div>")
                in_indent = False
                has_content = False
            if para.indent and not in_indent:
                parts.append('<div class="fn-indent">')
                in_indent = True
                has_content = False
            # Empty paragraph → preserve as line break (not before any content)
            if not rendered.strip():
                if parts:
                    parts.append("<br>")
                continue
            # <br> between consecutive same-level paragraphs
            if has_content:
                parts.append("<br>")
            parts.append(rendered)
            has_content = True
        if in_indent:
            parts.append("</div>")
        content = "".join(parts)
        return (
            f'    <div class="footnote-box" data-note="{note_id}">\n'
            f'      <button class="footnote-close">&times;</button>\n'
            f"      <strong>Nota {note_id}:</strong> {content}\n"
            f"    </div>"
        )

    def _render_runs(self, runs: list[TextRun]) -> str:
        parts: list[str] = []
        for run in runs:
            text = html.escape(run.text)
            if run.hyperlink_url:
                url = html.escape(run.link_url)
                text = f'<a href="{url}" target="_blank" rel="noopener">{text}</a>'
            if run.strike:
                text = f"<s>{text}</s>"
            if run.bold:
                text = f"<strong>{text}</strong>"
            if run.italic:
                text = f"<em>{text}</em>"
            parts.append(text)
        return "".join(parts)

    def _render_old_version(self, unit: DocumentUnit, is_child: bool = False, path: str = "") -> str:
        """Renderiza uma versão antiga (strikethrough + amendment note)."""
        # The final notes ("(Redação dada...) (Revogado...).") are part of the text:
        # mark them there, as one span without the strikethrough
        full = unit.full_text
        spans = note_tail_spans(full)
        if spans:
            s = spans[0][0]
            body = full[:s].rstrip(" \xa0")
            tail = re.sub(r"[\s\xa0]+", " ", full[s:]).strip()
            text = f'{html.escape(body)} <span class="amendment-note">{html.escape(tail)}</span>'
        else:
            text = html.escape(full)
        note = ""
        if unit.amendment_note and unit.amendment_note not in full:
            note = f' <span class="amendment-note">{html.escape(unit.amendment_note)}</span>'
        # For JS diff pairing: the parser's identifier (as in the current version's
        # unit-id) and the provision's path in the article (as in its data-path)
        ident = html.escape(unit.identifier)
        ident_attr = f' data-ident="{ident}"' if ident else ""
        if path:
            ident_attr += f' data-path="{html.escape(path)}"'
        cls = "old-version art-para" if is_child else "old-version"
        return f'    <p class="{cls}"{ident_attr}>{text}{note}</p>'


def render_cards(doc: ParsedDocument, remissoes: Optional["Resultado"] = None,
                 busca: Optional[dict[tuple[str, str], str]] = None,
                 cf_ce: Optional[set[tuple[str, str]]] = None) -> tuple[str, list[str]]:
    """(HTML dos cards, notas dos correlatos que os selos citam por número); busca: as formas certas dos erros do
    texto oficial por (norma, artigo), para o atributo data-busca do card; cf_ce: os pares CF × CE de texto igual,
    cujos correlatos saem num selo só."""
    renderer = HTMLRenderer(remissoes, busca, cf_ce)
    return renderer.render(doc), renderer.notas
