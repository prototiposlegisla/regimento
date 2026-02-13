"""Gerador do índice sistemático a partir da estrutura do documento."""

from __future__ import annotations

from .models import (
    ArticleBlock, ParsedDocument, SectionHeading, UnitType,
    SysIndexNode, SysIndexLeaf, sys_index_to_list,
)


def build_systematic_index(doc: ParsedDocument) -> list[dict]:
    """Gera o índice sistemático como lista JSON-friendly.

    Estrutura: TÍTULO > CAPÍTULO > SEÇÃO > Arts
    """
    nodes = _build_tree(doc)
    return sys_index_to_list(nodes)


def _build_tree(doc: ParsedDocument) -> list[SysIndexNode | SysIndexLeaf]:
    root: list[SysIndexNode | SysIndexLeaf] = []

    current_titulo: SysIndexNode | None = None
    current_capitulo: SysIndexNode | None = None
    current_secao: SysIndexNode | None = None

    for el in doc.elements:
        if isinstance(el, SectionHeading):
            heading_text = el.text
            if el.subtitle:
                heading_text += " — " + el.subtitle

            if el.level == UnitType.TITULO:
                current_titulo = SysIndexNode(title=heading_text)
                current_capitulo = None
                current_secao = None
                root.append(current_titulo)

            elif el.level == UnitType.CAPITULO:
                current_capitulo = SysIndexNode(title=heading_text)
                current_secao = None
                if current_titulo:
                    current_titulo.children.append(current_capitulo)
                else:
                    root.append(current_capitulo)

            elif el.level in (UnitType.SECAO, UnitType.SUBSECAO):
                current_secao = SysIndexNode(title=heading_text)
                if current_capitulo:
                    current_capitulo.children.append(current_secao)
                elif current_titulo:
                    current_titulo.children.append(current_secao)
                else:
                    root.append(current_secao)

        elif isinstance(el, ArticleBlock):
            label = _make_article_label(el)
            leaf = SysIndexLeaf(label=label, art=el.art_number)

            # Attach to deepest current section
            target = current_secao or current_capitulo or current_titulo
            if target:
                target.children.append(leaf)
            else:
                root.append(leaf)

    return root


def _make_article_label(art: ArticleBlock) -> str:
    """Gera label do artigo: 'Art. 43 — Eleição das Presidências'."""
    prefix = f"Art. {art.art_number}"

    if not art.caput:
        return prefix

    # Get caput text, removing the "Art. N -" prefix
    text = art.caput.full_text
    # Remove "Art. Nº - " or "Art. N-A - " variations
    import re
    text = re.sub(
        r"^Art\.\s*\d+[ºª°]?\s*[-–—]?\s*[A-H]?[ºª°.]?\s*[-–—.]\s*", "", text
    )

    # Truncate to ~60 chars at word boundary
    if len(text) > 60:
        truncated = text[:57]
        # Cut at last space
        last_space = truncated.rfind(" ")
        if last_space > 30:
            truncated = truncated[:last_space]
        text = truncated + "..."

    return f"{prefix} — {text}"
