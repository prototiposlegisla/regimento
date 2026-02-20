"""Renderização Markdown do documento para exportação LLM."""

from __future__ import annotations

import re

from .models import (
    ArticleBlock, DocumentUnit, Footnote, FootnotePara,
    ParsedDocument, SectionHeading, TextRun, UnitType,
)


class MarkdownRenderer:
    """Gera arquivos Markdown otimizados para consumo por LLMs."""

    # ── Documento principal ───────────────────────────────────────────

    def render_document(self, doc: ParsedDocument) -> str:
        """Renderiza o documento completo em Markdown."""
        parts: list[str] = []
        for el in doc.elements:
            if isinstance(el, SectionHeading):
                parts.append(self._render_heading(el))
            elif isinstance(el, ArticleBlock):
                parts.append(self._render_article(el))
        return "\n\n".join(parts) + "\n"

    def _render_heading(self, h: SectionHeading) -> str:
        level_map = {
            UnitType.TITULO: "#",
            UnitType.CAPITULO: "##",
            UnitType.SECAO: "###",
            UnitType.SUBSECAO: "###",
        }
        prefix = level_map.get(h.level, "###")
        text = h.text
        if h.subtitle:
            text += " — " + h.subtitle
        return f"{prefix} {text}"

    def _render_article(self, art: ArticleBlock) -> str:
        parts: list[str] = []

        # H4 heading with article number and optional summary
        art_label = art.art_number
        if art.law_prefix:
            art_label = f"{art.law_prefix}:{art_label}"
        heading = f"#### Art. {art_label}"
        if art.summary:
            heading += f" — {art.summary}"
        parts.append(heading)

        # Current caput
        if art.caput:
            caput_text = self._render_runs_after_identifier(art.caput)
            if caput_text.strip():
                parts.append(caput_text)
            for fn in art.caput.footnotes:
                parts.append(self._render_footnote(fn))

        # Children (current versions only)
        for child in art.children:
            if child.is_old_version:
                continue
            child_text = self._render_child(child)
            parts.append(child_text)
            for fn in child.footnotes:
                parts.append(self._render_footnote(fn))

        # Old versions section
        old_versions = list(art.all_versions)
        old_children = [c for c in art.children if c.is_old_version]
        if old_versions or old_children:
            parts.append("---")
            parts.append("*Versões anteriores deste artigo:*")
            for v in old_versions:
                parts.append(self._render_old_version(v))
            for v in old_children:
                parts.append(self._render_old_version(v))

        return "\n\n".join(parts)

    def _render_child(self, child: DocumentUnit) -> str:
        indent = self._get_indent(child)
        identifier = child.identifier
        body = self._render_runs_after_identifier(child)
        return f"{indent}**{identifier}** — {body}"

    @staticmethod
    def _get_indent(unit: DocumentUnit) -> str:
        if unit.unit_type == UnitType.ALINEA:
            return "  "
        if unit.unit_type in (UnitType.SUB_ALINEA, UnitType.ITEM_NUM):
            return "    "
        return ""

    def _render_old_version(self, unit: DocumentUnit) -> str:
        text = unit.full_text.replace("\xa0", " ")
        line = f"*[Versão supersedida]* {text}"
        if unit.amendment_note:
            line += f" *{unit.amendment_note}*"
        return line

    def _render_runs_after_identifier(self, unit: DocumentUnit) -> str:
        """Renderiza runs removendo o identificador do início."""
        full_text = unit.full_text
        ident = unit.identifier

        escaped = re.escape(ident)
        patterns = [
            escaped + r"\s*[-–—.]\s*",
            escaped + r"\s+",
        ]
        if any(c in ident for c in "ºª°"):
            flex = escaped
            for c in "ºª°":
                flex = flex.replace(c, r"\.?" + c)
            patterns += [flex + r"\s*[-–—.]\s*", flex + r"\s+"]

        skip_chars = 0
        for pat in patterns:
            m = re.match(pat, full_text, re.IGNORECASE)
            if m:
                skip_chars = m.end()
                break
        if skip_chars == 0:
            skip_chars = len(ident)

        return self._render_runs_from(unit.runs, skip_chars)

    def _render_runs_from(self, runs: list[TextRun], skip_chars: int) -> str:
        parts: list[str] = []
        remaining_skip = skip_chars

        for run in runs:
            if remaining_skip >= len(run.text):
                remaining_skip -= len(run.text)
                continue

            text = run.text[remaining_skip:]
            remaining_skip = 0

            # Replace non-breaking space
            text = text.replace("\xa0", " ")

            if run.hyperlink_url:
                text = f"[{text}]({run.hyperlink_url})"
            # hyperlink_anchor → plain text (no link target in markdown)

            if run.strike:
                text = f"~~{text}~~"
            if run.italic:
                text = f"*{text}*"
            if run.bold:
                text = f"**{text}**"

            parts.append(text)

        return "".join(parts)

    def _render_runs(self, runs: list[TextRun]) -> str:
        return self._render_runs_from(runs, 0)

    def _render_footnote(self, fn: Footnote) -> str:
        note_id = f"b{fn.number}" if fn.is_private else str(fn.number)
        parts: list[str] = []
        for para in fn.paragraphs:
            text = self._render_runs(para.runs).strip()
            if text:
                parts.append(text)
        content = " ".join(parts)
        suffix = " *(nota privada)*" if fn.is_private else ""
        return f"> **Nota {note_id}:** {content}{suffix}"

    # ── Índice remissivo ──────────────────────────────────────────────

    def render_subject_index(self, subject_list: list[dict]) -> str:
        """Renderiza o índice remissivo em Markdown."""
        lines: list[str] = ["# Índice Remissivo"]

        for item in subject_list:
            subject = item["subject"]
            lines.append(f"\n## {subject}")

            if "refs" in item:
                for ref in item["refs"]:
                    lines.append(self._format_ref(ref))

            if "vides" in item:
                for v in item["vides"]:
                    vide_display = v.replace("|", " — ")
                    lines.append(f"\n*Vide: {vide_display}*")

            if "children" in item:
                for child in item["children"]:
                    lines.append(f"\n### {child['sub_subject']}")
                    for ref in child.get("refs", []):
                        lines.append(self._format_ref(ref))
                    for v in child.get("vides", []):
                        vide_display = v.replace("|", " — ")
                        lines.append(f"\n*Vide: {vide_display}*")

        return "\n".join(lines) + "\n"

    @staticmethod
    def _format_ref(ref: dict) -> str:
        art = ref["art"]
        detail = ref.get("detail", "")
        law_prefix = ref.get("law_prefix", "")
        hint = ref.get("hint", "")

        label = f"Art. {art}"
        if law_prefix:
            label = f"Art. {law_prefix}:{art}"
        if detail:
            label += f", {detail}"

        line = f"- {label}"
        if hint:
            line += f" *({hint})*"
        return line

    # ── Referências ───────────────────────────────────────────────────

    def render_referencias(self, referencias_data: list[dict]) -> str:
        """Renderiza as referências em Markdown."""
        lines: list[str] = ["# Referências"]

        for cat in referencias_data:
            category = cat["category"]
            lines.append(f"\n## {category}")

            for group in cat["groups"]:
                if group["title"]:
                    lines.append(f"\n### {group['title']}")

                for entry in group["entries"]:
                    html_text = entry["html"]
                    md_text = self._html_to_markdown(html_text)
                    art_ref = entry.get("art_ref")

                    line = f"- {md_text}"
                    if art_ref:
                        line += f" — Art. {art_ref}"
                    lines.append(line)

        return "\n".join(lines) + "\n"

    @staticmethod
    def _html_to_markdown(html_text: str) -> str:
        """Converte HTML simples (de referências) para Markdown."""
        text = re.sub(r"<b>(.*?)</b>", r"**\1**", html_text)
        text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        return text
