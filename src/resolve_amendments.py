"""Resolução de emendas (múltiplas redações de um mesmo dispositivo).

Regra: a redação antiga é a tachada no DOCX (is_old_version, marcado no
parse) e permanece in-place em children (interleaved). Dispositivos
consecutivos com o mesmo identificador e sem tachado continuam vigentes:
ou o texto tem de fato dois dispositivos iguais (ex.: RI art. 283, dois
incisos IV em vigor), ou falta tachar a redação antiga no DOCX — o build
avisa (duplicate_identifiers).
"""

from __future__ import annotations

import re

from .models import PREC, ArticleBlock, DocumentUnit, ParsedDocument, SectionHeading, UnitType, prec_label, unit_path


def resolve_amendments(doc: ParsedDocument) -> ParsedDocument:
    """Processa emendas em todos os artigos do documento."""
    for el in doc.elements:
        if isinstance(el, ArticleBlock):
            _resolve_article(el)
    return doc


def _resolve_article(art: ArticleBlock) -> None:
    """Resolve versões múltiplas dentro de um ArticleBlock.

    Mantém todas as versões em children na ordem do documento; as antigas
    já vêm marcadas (is_old_version) pelo tachado.
    """
    # Handle caput versions: if caput is struck through and there's
    # a non-struck version in all_versions, swap
    if art.caput and art.caput.is_old_version:
        for i, v in enumerate(art.all_versions):
            if (
                v.identifier == art.caput.identifier
                and not v.is_old_version
            ):
                art.all_versions[i] = art.caput
                art.caput = v
                break

    # Detect if entire article is revoked: caput "(Revogado...)" or struck with
    # no other version in force (e.g. declared unconstitutional), and no
    # provision in force below it
    current_children = [c for c in art.children if not c.is_old_version]
    if art.caput and (art.caput.is_revoked or art.caput.is_old_version) and not any(
        not c.is_revoked for c in current_children
    ):
        art.is_revoked = True


def duplicate_identifiers(doc: ParsedDocument) -> list[tuple[ArticleBlock, str]]:
    """Dispositivos vigentes com o mesmo caminho no artigo (ex.: dois "IV", dois "§ 1º,II").

    Em geral é redação antiga que ficou sem tachado no DOCX; às vezes é o
    próprio texto normativo que repete o número. Devolve (artigo, caminho);
    os filhos de um caminho repetido não são repetidos na lista.
    """
    found: list[tuple[ArticleBlock, str]] = []
    for el in doc.elements:
        if not isinstance(el, ArticleBlock):
            continue
        ctx = ["", "", "", ""]  # parágrafo, inciso, alínea, item
        seen: set[str] = set()
        reported: list[str] = []
        for child in el.children:
            # only the units in force set the context (old versions may use other
            # levels, e.g. RI 47, XIV: incisos in 2019, alíneas today)
            if child.is_old_version:
                continue
            path = unit_path(child, ctx)
            if not path:
                continue
            if path in seen and not any(path.startswith(r + ",") for r in reported):
                found.append((el, path))
                reported.append(path)
            seen.add(path)
    return found


def structure_warnings(
    doc: ParsedDocument,
    known_duplicates: set[tuple[str, str, str]] | frozenset = frozenset(),
) -> list[tuple[str, str]]:
    """Avisos sobre a estrutura do DOCX, como (mensagem, contexto).

    - dispositivo vigente repetido (falta tachar a redação antiga?), exceto os
      de known_duplicates = {(norma, artigo, caminho)};
    - nota de rodapé presa a uma redação tachada (não aparece no site);
    - precedente regimental com título não reconhecido (vira texto do anterior)
      ou com número repetido.
    """
    warnings: list[tuple[str, str]] = []
    from .parse_docx import RE_TITULO_PREC
    seen_prec: set[str] = set()
    for el in doc.elements:
        if not isinstance(el, ArticleBlock) or el.law_prefix != PREC:
            continue
        ctx = f"Precedente Regimental {prec_label(el.art_number)}"
        if el.art_number in seen_prec:
            warnings.append(("Precedente com número repetido (dois títulos iguais?)", ctx))
        seen_prec.add(el.art_number)
        for c in el.children:
            if RE_TITULO_PREC.match(c.full_text):
                warnings.append((f"Título de precedente não reconhecido, lido como texto do anterior: "
                                 f"\"{c.full_text[:60]}\" (use \"PRECEDENTE REGIMENTAL Nº 2/2026\")", ctx))
    for art, path in duplicate_identifiers(doc):
        if (art.law_name, art.art_number, path) in known_duplicates:
            continue
        warnings.append((
            f"Dispositivo \"{path}\" repetido entre as redações vigentes (falta tachar a antiga?)",
            f"{art.law_name or 'Regimento Interno'}, Art. {art.art_number}",
        ))
    for el in doc.elements:
        if not isinstance(el, ArticleBlock):
            continue
        ctx = f"{el.law_name or 'Regimento Interno'}, Art. {el.art_number}"
        # rendered as old versions, without their footnotes (the current caput shows
        # them even when struck)
        for u in [*el.all_versions, *(c for c in el.children if c.is_old_version)]:
            if u.footnotes:
                warnings.append((
                    f"Nota de rodapé em redação tachada (não aparece no site): \"{u.full_text[:60]}\"", ctx))
        if el.caput and not el.caput.is_old_version and any(
            v.unit_type == UnitType.ARTIGO and not v.is_old_version for v in el.all_versions
        ):
            warnings.append(("Duas redações do caput sem tachado (falta tachar a antiga?)", ctx))
    return warnings
