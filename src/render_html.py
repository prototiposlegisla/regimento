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


class HTMLRenderer:
    """Gera HTML dos cards com a mesma estrutura do index.html original."""

    def __init__(self, remissoes: Optional["Resultado"] = None):
        self.footnote_counter = 0
        # Remissões explícitas: os trechos citados viram gatilho de uma prévia
        self._rem_by_unit = remissoes.por_unidade() if remissoes else {}
        self._cited_by = remissoes.citado_em() if remissoes else {}
        # Remissões implícitas: um selo no fim do dispositivo, nos dois lados
        self._imp_by_unit = remissoes.implicitas_por_unidade() if remissoes else {}

    def render(self, doc: ParsedDocument) -> str:
        """Renderiza todos os elementos do documento."""
        parts: list[str] = []
        for el in doc.elements:
            if isinstance(el, SectionHeading):
                parts.append(self._render_heading(el))
            elif isinstance(el, ArticleBlock):
                parts.append(self._render_article(el))
        return "\n\n".join(parts)

    def _render_heading(self, h: SectionHeading) -> str:
        text = html.escape(h.text)
        if h.subtitle:
            text += "<br>" + html.escape(h.subtitle)
        section = html.escape(h.data_section)
        nivel = self._heading_nivel(h)
        return (
            f'  <div class="card card-titulo {nivel}" data-section="{section}">'
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

    @staticmethod
    def _footnote_refs(unit: DocumentUnit) -> str:
        """Superscript references to the unit's footnotes, inline."""
        out = ""
        for fn in unit.footnotes:
            note_id = f"b{fn.number}" if fn.is_private else str(fn.number)
            out += f'<sup class="footnote-ref" data-note="{note_id}">[{note_id}]</sup>'
        return out

    def _footnote_boxes(self, unit: DocumentUnit) -> str:
        """Footnote content boxes (hidden by default, toggled by click)."""
        return "".join("\n" + self._render_footnote(fn) for fn in unit.footnotes)

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
        return f'<span class="unit-id" data-uid="{uid}"{path_attr}>{label}</span>'

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

        # Now render runs, skipping the first skip_chars characters
        if marks:
            return self._render_runs_with_marks(unit.runs, skip_chars, marks)
        return self._render_runs_from(unit.runs, skip_chars)

    def _render_runs_with_marks(
        self, runs: list[TextRun], skip_chars: int, marks: "list[Remissao]",
    ) -> str:
        """Como _render_runs_from, envolvendo cada trecho citado num gatilho de remissão.

        O link oficial que já estava no trecho fica no href do gatilho (sem link
        dentro de link); o JS mostra a prévia e o oferece como "fonte oficial".
        """
        spans = []
        last_end = skip_chars
        for m in sorted(marks, key=lambda r: r.start):
            if m.start >= last_end and m.end > m.start:
                spans.append(m)
                last_end = m.end
        if not spans:
            return self._render_runs_from(runs, skip_chars)

        cuts = sorted({skip_chars, *(m.start for m in spans), *(m.end for m in spans)})
        parts: list[str] = []
        pos = 0
        mi = 0
        open_mark = None
        for run in runs:
            r_start, r_end = pos, pos + len(run.text)
            pos = r_end
            if r_end <= skip_chars:
                continue
            bounds = [max(r_start, skip_chars)] + [c for c in cuts if max(r_start, skip_chars) < c < r_end] + [r_end]
            for a, b in zip(bounds, bounds[1:]):
                if open_mark is None and mi < len(spans) and spans[mi].start == a:
                    open_mark = spans[mi]
                    parts.append(self._open_mark(open_mark))
                text = run.text[a - r_start:b - r_start]
                # a link cut by a citation: its leftover " ", ";", "(Vide " or "(Redação dada pelo "
                # outside stays plain text
                split = (a > r_start or b < r_end) and open_mark is None
                parts.append(self._wrap_run(html.escape(text), run,
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
        return "".join(parts)

    # Label of the implicit remissão's badge, seen from each side: (origin, target)
    CHIP_PREFIX = {"eq": ("≈", "≈"), "det": ("detalha", "detalhado em"), "fund": ("↑", "↓"), "div": ("≠", "≠")}

    def _render_correlatos(self, unit: DocumentUnit) -> str:
        """Selos das remissões implícitas do dispositivo (rótulo e nota em atributos: fora da busca)."""
        out = []
        for im, side in self._imp_by_unit.get(id(unit), ()):
            other = im.destino if side == "src" else im.origem
            prefix = self.CHIP_PREFIX[im.tipo][0 if side == "src" else 1]
            art = f"DGT {other.art[3:]}" if other.art.startswith("ADT") and other.law == "LOM" else \
                (f"ADT {other.art[3:]}" if other.art.startswith("ADT") else other.art)
            path = other.path.replace("§ú", "p.ú.").replace(",", ", ")
            label = f"{prefix} {other.law} {art}" + (f", {path}" if path else "")
            attrs = (f' data-ref="{html.escape(other.ref)}" data-tipo="{im.tipo}" data-side="{side}"'
                     f' data-nota="{html.escape(im.nota)}" data-label="{html.escape(label)}"')
            if im.proposta:
                attrs += ' data-status="proposta"'
            out.append(f'<span class="rem rem-imp t-{im.tipo}" tabindex="0" role="button"{attrs}></span>')
        return "".join(out)

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

    @staticmethod
    def _wrap_run(escaped: str, run: TextRun, link: bool = True, in_mark: bool = False) -> str:
        """Link, tachado, negrito e itálico de um trecho de run (já escapado).

        in_mark: dentro de um gatilho de remissão; o link sai da ordem do Tab (o
        gatilho é a parada) e continua abrindo com Ctrl/Cmd+clique.
        """
        if link and run.hyperlink_url:
            tab = ' tabindex="-1"' if in_mark else ""
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
        self, runs: list[TextRun], skip_chars: int
    ) -> str:
        """Renderiza runs pulando os primeiros skip_chars caracteres."""
        parts: list[str] = []
        remaining_skip = skip_chars

        for run in runs:
            if remaining_skip >= len(run.text):
                remaining_skip -= len(run.text)
                continue

            text = run.text[remaining_skip:]
            remaining_skip = 0
            parts.append(self._wrap_run(html.escape(text), run))

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


def render_cards(doc: ParsedDocument, remissoes: Optional["Resultado"] = None) -> str:
    renderer = HTMLRenderer(remissoes)
    return renderer.render(doc)
