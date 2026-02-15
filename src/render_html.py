"""Renderização dos cards HTML a partir do ParsedDocument."""

from __future__ import annotations

import html
import re
from typing import Optional

from .models import (
    ArticleBlock, DocumentUnit, ParsedDocument, SectionHeading,
    TextRun, UnitType,
)


class HTMLRenderer:
    """Gera HTML dos cards com a mesma estrutura do index.html original."""

    def __init__(self):
        self.footnote_counter = 0

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
        art_num = html.escape(art.art_number)
        revoked_cls = " revoked" if art.is_revoked else ""
        law_attr = ""
        if art.law_prefix:
            law_attr = f' data-law="{html.escape(art.law_prefix)}"'
        parts: list[str] = []
        parts.append(
            f'  <div class="card card-artigo{revoked_cls}" data-art="{art_num}"{law_attr}>'
        )

        # Law badge (for non-default laws)
        if art.law_prefix:
            badge = html.escape(art.law_prefix)
            parts.append(f'    <span class="law-badge">{badge}</span>')

        # Old caputs from full-article rewrites (in DOCX order)
        for v in art.all_versions:
            parts.append(self._render_old_version(v))

        # Current caput
        if art.caput:
            parts.append(self._render_unit_as_p(art.caput, is_caput=True))

        # Children in document order (old versions interleaved)
        path_ctx = ["", "", "", ""]  # [para, inciso, alinea, sub]
        for child in art.children:
            if child.is_old_version:
                parts.append(self._render_old_version(child))
            else:
                path = self._update_path_ctx(child, path_ctx)
                parts.append(self._render_unit_as_p(
                    child, is_caput=False, path=path,
                ))

        parts.append("  </div>")
        return "\n".join(parts)

    def _update_path_ctx(
        self, unit: DocumentUnit, ctx: list[str],
    ) -> str:
        """Atualiza contexto hierárquico e retorna path comma-separated.

        ctx = [para, inciso, alinea, sub]
        Formato do path: "I,b,2", "§ 1º,I", "§ú", etc.
        """
        if unit.unit_type in (UnitType.PARAGRAFO_UNICO, UnitType.PARAGRAFO_NUM):
            ctx[0] = "§ú" if unit.unit_type == UnitType.PARAGRAFO_UNICO else unit.identifier
            ctx[1] = ctx[2] = ctx[3] = ""
        elif unit.unit_type == UnitType.INCISO:
            ctx[1] = unit.identifier  # "I", "II", etc.
            ctx[2] = ctx[3] = ""
        elif unit.unit_type == UnitType.ALINEA:
            ctx[2] = re.sub(r"\)$", "", unit.identifier)  # "a)" → "a"
            ctx[3] = ""
        elif unit.unit_type in (UnitType.SUB_ALINEA, UnitType.ITEM_NUM):
            m = re.match(r"(\d+)", unit.identifier)
            ctx[3] = m.group(1) if m else unit.identifier
        else:
            return ""

        return ",".join(part for part in ctx if part)

    def _render_unit_as_p(
        self, unit: DocumentUnit, is_caput: bool, path: str = "",
    ) -> str:
        cls = "" if is_caput else ' class="art-para"'
        uid = html.escape(unit.uid)

        # Build inline content
        inner = self._render_unit_id(unit, path=path)
        inner += " — "
        inner += self._render_runs_after_identifier(unit)

        # Insert footnote superscript references inline
        for fn in unit.footnotes:
            inner += (
                f'<sup class="footnote-ref" data-note="{fn.number}">'
                f"[{fn.number}]</sup>"
            )

        # Footnote content boxes (hidden by default, toggled by click)
        footnote_html = ""
        for fn in unit.footnotes:
            footnote_html += "\n" + self._render_footnote(fn)

        return f"    <p{cls}>{inner}</p>{footnote_html}"

    def _render_unit_id(self, unit: DocumentUnit, path: str = "") -> str:
        uid = html.escape(unit.uid)
        label = html.escape(unit.identifier)
        path_attr = f' data-path="{html.escape(path)}"' if path else ""
        return f'<span class="unit-id" data-uid="{uid}"{path_attr}>{label}</span>'

    def _render_runs_after_identifier(self, unit: DocumentUnit) -> str:
        """Renderiza os runs removendo o identificador do início."""
        full_text = unit.full_text
        ident = unit.identifier

        # Find where the identifier ends in the text
        # Pattern: "Art. 43  - text" or "§ 1º - text" or "I - text"
        # Remove identifier + separator from start
        patterns = [
            re.escape(ident) + r"\s*[-–—.]\s*",
            re.escape(ident) + r"\s+",
        ]
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
        return self._render_runs_from(unit.runs, skip_chars)

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

            escaped = html.escape(text)

            if run.hyperlink_url:
                url = html.escape(run.hyperlink_url)
                escaped = f'<a href="{url}" target="_blank" rel="noopener">{escaped}</a>'
            elif run.hyperlink_anchor:
                # Internal link — generate navigation
                anchor = html.escape(run.hyperlink_anchor)
                escaped = f'<a href="#{anchor}" class="internal-ref">{escaped}</a>'

            if run.strike:
                escaped = f"<s>{escaped}</s>"
            if run.bold:
                escaped = f"<strong>{escaped}</strong>"
            if run.italic:
                escaped = f"<em>{escaped}</em>"

            parts.append(escaped)

        return "".join(parts)

    def _render_footnote(self, fn: Footnote) -> str:
        note_num = fn.number
        content = self._render_runs(fn.content)
        return (
            f'    <div class="footnote-box" data-note="{note_num}">\n'
            f'      <button class="footnote-close">&times;</button>\n'
            f"      <strong>Nota {note_num}:</strong> {content}\n"
            f"    </div>"
        )

    def _render_runs(self, runs: list[TextRun]) -> str:
        parts: list[str] = []
        for run in runs:
            text = html.escape(run.text)
            if run.hyperlink_url:
                url = html.escape(run.hyperlink_url)
                text = f'<a href="{url}" target="_blank" rel="noopener">{text}</a>'
            if run.strike:
                text = f"<s>{text}</s>"
            if run.bold:
                text = f"<strong>{text}</strong>"
            if run.italic:
                text = f"<em>{text}</em>"
            parts.append(text)
        return "".join(parts)

    def _render_old_version(self, unit: DocumentUnit) -> str:
        """Renderiza uma versão antiga (strikethrough + amendment note)."""
        text = html.escape(unit.full_text)
        note = ""
        if unit.amendment_note:
            note = f' <span class="amendment-note">{html.escape(unit.amendment_note)}</span>'
        return f'    <p class="old-version">{text}{note}</p>'


def render_cards(doc: ParsedDocument) -> str:
    renderer = HTMLRenderer()
    return renderer.render(doc)
