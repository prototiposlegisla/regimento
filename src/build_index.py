"""Gerador do índice sistemático a partir da estrutura do documento."""

from __future__ import annotations

import re
from collections import defaultdict

from .models import (
    ArticleBlock, ParsedDocument, SectionHeading, UnitType,
    SysIndexNode, sys_index_to_list,
)


def build_systematic_index(doc: ParsedDocument) -> list[dict]:
    """Gera o índice sistemático como lista JSON-friendly.

    Estrutura: TÍTULO > CAPÍTULO > SEÇÃO/SUBSEÇÃO (sem artigos).
    Normas não-Regimento aparecem só pelo nome, ao final.
    """
    nodes = _build_tree(doc)
    direct_articles = _collect_direct_articles(doc)
    _annotate_ranges(nodes, direct_articles)
    return sys_index_to_list(nodes)


def _build_tree(doc: ParsedDocument) -> list[SysIndexNode]:
    root: list[SysIndexNode] = []
    non_default_laws: list[SysIndexNode] = []

    current_titulo: SysIndexNode | None = None
    current_capitulo: SysIndexNode | None = None
    current_secao: SysIndexNode | None = None

    first_norma_seen = False
    in_default_law = True  # Start in default law mode

    for el in doc.elements:
        if isinstance(el, ArticleBlock):
            continue

        if not isinstance(el, SectionHeading):
            continue

        # Handle NORMA: headings (data_section starts with "norma")
        if el.data_section.startswith("norma"):
            if not first_norma_seen:
                # First NORMA (default law, e.g. "Regimento Interno") — skip
                first_norma_seen = True
                in_default_law = True
            else:
                # Non-default law — record it, stop adding structure
                in_default_law = False
                non_default_laws.append(SysIndexNode(
                    title=el.text, section_id=el.data_section,
                ))
            continue

        # Skip headings belonging to non-default laws
        if not in_default_law:
            continue

        heading_text = el.text
        if el.subtitle:
            heading_text += " — " + el.subtitle

        if el.level == UnitType.TITULO:
            current_titulo = SysIndexNode(
                title=heading_text, section_id=el.data_section,
            )
            current_capitulo = None
            current_secao = None
            root.append(current_titulo)

        elif el.level == UnitType.CAPITULO:
            current_capitulo = SysIndexNode(
                title=heading_text, section_id=el.data_section,
            )
            current_secao = None
            if current_titulo:
                current_titulo.children.append(current_capitulo)
            else:
                root.append(current_capitulo)

        elif el.level in (UnitType.SECAO, UnitType.SUBSECAO):
            current_secao = SysIndexNode(
                title=heading_text, section_id=el.data_section,
            )
            if current_capitulo:
                current_capitulo.children.append(current_secao)
            elif current_titulo:
                current_titulo.children.append(current_secao)
            else:
                root.append(current_secao)

    # Append non-default laws at the end
    root.extend(non_default_laws)

    return root


# ---- Article range annotation ----

def _collect_direct_articles(doc: ParsedDocument) -> dict[str, list[str]]:
    """Map each section_id to its direct article numbers."""
    result: dict[str, list[str]] = defaultdict(list)

    first_norma_seen = False
    in_default_law = True
    current_norma_id: str | None = None

    current_titulo_id: str | None = None
    current_capitulo_id: str | None = None
    current_secao_id: str | None = None

    for el in doc.elements:
        if isinstance(el, SectionHeading):
            if el.data_section.startswith("norma"):
                if not first_norma_seen:
                    first_norma_seen = True
                    in_default_law = True
                else:
                    in_default_law = False
                    current_norma_id = el.data_section
                    current_titulo_id = None
                    current_capitulo_id = None
                    current_secao_id = None
                continue

            if not in_default_law:
                continue

            if el.level == UnitType.TITULO:
                current_titulo_id = el.data_section
                current_capitulo_id = None
                current_secao_id = None
            elif el.level == UnitType.CAPITULO:
                current_capitulo_id = el.data_section
                current_secao_id = None
            elif el.level in (UnitType.SECAO, UnitType.SUBSECAO):
                current_secao_id = el.data_section

        elif isinstance(el, ArticleBlock):
            if not in_default_law:
                if current_norma_id:
                    result[current_norma_id].append(el.art_number)
            else:
                section_id = (
                    current_secao_id or current_capitulo_id or current_titulo_id
                )
                if section_id:
                    result[section_id].append(el.art_number)

    return dict(result)


def _annotate_ranges(
    nodes: list[SysIndexNode], direct_articles: dict[str, list[str]],
) -> None:
    """Annotate leaf nodes with their article range."""
    for node in nodes:
        child_nodes = [c for c in node.children if isinstance(c, SysIndexNode)]
        if child_nodes:
            _annotate_ranges(child_nodes, direct_articles)
        else:
            arts = direct_articles.get(node.section_id, [])
            if arts:
                node.art_range = _format_art_range(arts)


def _art_sort_key(art_num: str) -> tuple:
    """Sort key: '1' < '4-A' < '183' < '183-A' < 'ADT1' < 'ADT4-A'."""
    is_adt = art_num.startswith("ADT")
    num_str = art_num[3:] if is_adt else art_num
    m = re.match(r"(\d+)(?:-([A-Z]))?$", num_str)
    if m:
        return (1 if is_adt else 0, int(m.group(1)), m.group(2) or "")
    return (1 if is_adt else 0, 0, num_str)


def _format_art_num(art_num: str) -> str:
    """Format: '1' → '1º', '10' → '10', '4-A' → '4º-A', '183-A' → '183-A'."""
    is_adt = art_num.startswith("ADT")
    num_str = art_num[3:] if is_adt else art_num
    m = re.match(r"(\d+)(-[A-Z])?$", num_str)
    if not m:
        return num_str
    num = int(m.group(1))
    suffix = m.group(2) or ""
    if num <= 9:
        return f"{num}\u00ba{suffix}"
    return f"{num}{suffix}"


def _format_art_range(articles: list[str]) -> str:
    """Format: '(art. 1º-2º)' or '(art. 38)' for a single article."""
    if not articles:
        return ""
    sorted_arts = sorted(articles, key=_art_sort_key)
    first = _format_art_num(sorted_arts[0])
    last = _format_art_num(sorted_arts[-1])
    if first == last:
        return f"(art. {first})"
    return f"(art. {first}\u2013{last})"
