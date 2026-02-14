"""Gerador do índice sistemático a partir da estrutura do documento."""

from __future__ import annotations

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
