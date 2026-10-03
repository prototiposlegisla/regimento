"""Gerador do índice sistemático a partir da estrutura do documento."""

from __future__ import annotations

import re
from collections import defaultdict

from .models import (
    PREC, ArticleBlock, ParsedDocument, SectionHeading, UnitType,
    SysIndexLeaf, SysIndexNode, prec_label, sys_index_to_list, unit_path,
)


def build_systematic_index(doc: ParsedDocument) -> list[dict]:
    """Gera o índice sistemático como lista JSON-friendly.

    Estrutura: TÍTULO > CAPÍTULO > SEÇÃO/SUBSEÇÃO (sem artigos).
    Normas não-Regimento aparecem só pelo nome, ao final. Os precedentes
    regimentais, que não têm títulos, aparecem um a um na norma deles.
    """
    nodes = _build_tree(doc)
    direct_articles = _collect_direct_articles(doc)
    _annotate_ranges(nodes, direct_articles)
    _add_precedents(nodes, doc)
    return sys_index_to_list(nodes)


def _add_precedents(nodes: list[SysIndexNode], doc: ParsedDocument) -> None:
    """Uma folha por precedente ("nº 2/2004 — síntese"), em ordem, no nó da norma."""
    by_norma: dict[str, list[ArticleBlock]] = defaultdict(list)
    norma = ""
    for el in doc.elements:
        if isinstance(el, SectionHeading) and el.data_section.startswith("norma"):
            norma = el.data_section
        elif isinstance(el, ArticleBlock) and el.law_prefix == PREC and norma:
            by_norma[norma].append(el)
    for node in nodes:
        precs = by_norma.get(node.section_id)
        if precs:
            node.art_range = ""
            node.children = [
                SysIndexLeaf(label=prec_label(a.art_number) + (f" — {a.summary}" if a.summary else ""),
                             art=a.art_number, law=PREC)
                for a in precs
            ]


def _build_tree(doc: ParsedDocument) -> list[SysIndexNode]:
    root: list[SysIndexNode] = []

    current_titulo: SysIndexNode | None = None
    current_capitulo: SysIndexNode | None = None
    current_secao: SysIndexNode | None = None
    current_law_node: SysIndexNode | None = None  # container for non-default laws

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
                # Non-default law — add as top-level node with children
                in_default_law = False
                current_law_node = SysIndexNode(
                    title=el.text, section_id=el.data_section,
                )
                root.append(current_law_node)
                current_titulo = None
                current_capitulo = None
                current_secao = None
            continue

        heading_text = el.text
        if el.subtitle:
            heading_text += " — " + el.subtitle

        node = SysIndexNode(
            title=heading_text, section_id=el.data_section,
        )

        # Determine the parent container (root list vs law node)
        container = current_law_node.children if not in_default_law and current_law_node else root

        if el.level == UnitType.TITULO:
            current_titulo = node
            current_capitulo = None
            current_secao = None
            container.append(current_titulo)

        elif el.level == UnitType.CAPITULO:
            current_capitulo = node
            current_secao = None
            if current_titulo:
                current_titulo.children.append(current_capitulo)
            else:
                container.append(current_capitulo)

        elif el.level in (UnitType.SECAO, UnitType.SUBSECAO):
            current_secao = node
            if current_capitulo:
                current_capitulo.children.append(current_secao)
            elif current_titulo:
                current_titulo.children.append(current_secao)
            else:
                container.append(current_secao)

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
            section_id = (
                current_secao_id or current_capitulo_id
                or current_titulo_id or current_norma_id
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


# ---- Legislação correlata (aba Referências) ----

_TIPO_ORDEM = ("constituição", "lei complementar", "lei", "decreto-lei", "decreto legislativo", "decreto",
               "resolução", "ato")


def _norma_key(label: str) -> tuple:
    """Ordem: esfera (federal, estadual, municipal), tipo (constituição, lei complementar, lei,
    decreto-lei, decreto legislativo, decreto, resolução, ato), ano, número; os artigos de uma
    Constituição em ordem."""
    low = label.lower()
    esfera = 0 if re.search(r"\bfederal\b", low) else 1 if re.search(r"\bestadual\b", low) else 2
    tipo = next((i for i, t in enumerate(_TIPO_ORDEM) if low.startswith(t)), len(_TIPO_ORDEM))
    num = re.search(r"(?:\bn\.?\s?[º°o]\.?|\bn\.|\bart\.)\s*(\d[\d.]*)", low)   # "nº", "nº.", "n.º", "art."
    ano = re.search(r"(\d{4})", low[num.end():] if num else low)
    return (esfera, tipo, int(ano.group(1)) if ano else 0,
            int(re.sub(r"\D", "", num.group(1)) or 0) if num else 0, low)


def legislacao_index(doc: ParsedDocument) -> dict | None:
    """Categoria "Legislação correlata" da aba Referências: cada norma (nota "L") e os
    dispositivos do Regimento a que ela se liga, com link para o artigo."""
    import html as _html
    groups: dict[str, dict] = {}
    for art in doc.elements:
        if not isinstance(art, ArticleBlock) or art.law_prefix or not art.caput:
            continue
        ctx = ["", "", "", ""]
        for u in [art.caput, *art.children]:
            if u.is_old_version:
                continue
            path = unit_path(u, ctx) if u is not art.caput else ""
            if not u.legislacao:
                continue
            ref = art.art_number + (", " + path.replace("§ú", "parágrafo único").replace(",", ", ") if path else "")
            texto = re.sub(r"\s+", " ", u.full_text).strip()
            for p in u.legislacao:
                full = re.sub(r"\s+", " ", "".join(r.text for r in p.runs)).strip()
                nome = full.split(" — ")[0].strip()
                # the norm's name as the title; its ementa first, then the provisions
                ementa = full[len(nome):].lstrip(" —").strip()
                g = groups.setdefault(nome, {"title": nome, "entries": [
                    {"html": f"<i>{_html.escape(ementa)}</i>"}] if ementa else []})
                g["entries"].append({"html": _html.escape(texto[:180] + ("…" if len(texto) > 180 else "")),
                                     "art_ref": ref})
    if not groups:
        return None
    return {"category": "Legislação correlata",
            "groups": [groups[k] for k in sorted(groups, key=_norma_key)]}
