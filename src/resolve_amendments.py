"""Resolução de emendas (múltiplas redações de um mesmo dispositivo).

Regra: quando há dispositivos consecutivos com mesmo identificador,
o último na sequência é a versão vigente. Os anteriores são marcados
como is_old_version e permanecem in-place em children (interleaved).
"""

from __future__ import annotations

from .models import ArticleBlock, DocumentUnit, ParsedDocument, SectionHeading


def resolve_amendments(doc: ParsedDocument) -> ParsedDocument:
    """Processa emendas em todos os artigos do documento."""
    for el in doc.elements:
        if isinstance(el, ArticleBlock):
            _resolve_article(el)
    return doc


def _resolve_article(art: ArticleBlock) -> None:
    """Resolve versões múltiplas dentro de um ArticleBlock.

    Mantém todas as versões em children na ordem do documento.
    Grupos consecutivos com mesmo identifier: o último é vigente,
    os anteriores recebem is_old_version = True.
    """
    if not art.children:
        # Detect if entire article is revoked (caput-only)
        if art.caput and art.caput.is_revoked:
            art.is_revoked = True
        return

    # Group consecutive children with same identifier,
    # mark old versions, keep all in-place
    groups: list[list[DocumentUnit]] = []
    current_group: list[DocumentUnit] = []

    for child in art.children:
        if current_group and current_group[-1].identifier == child.identifier:
            current_group.append(child)
        else:
            if current_group:
                groups.append(current_group)
            current_group = [child]
    if current_group:
        groups.append(current_group)

    new_children: list[DocumentUnit] = []
    version_count = 0
    for group in groups:
        if len(group) == 1:
            new_children.append(group[0])
        else:
            # Multiple versions with same identifier
            # Last one = vigente, others = old versions (kept in order)
            for old in group[:-1]:
                old.is_old_version = True
                version_count += 1
                new_children.append(old)
            new_children.append(group[-1])

    art.children = new_children

    # Count all old versions (children + all_versions from caput merge)
    for child in art.children:
        if child.is_old_version:
            pass  # already counted above or was already old

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

    # Detect if entire article is revoked
    current_children = [c for c in art.children if not c.is_old_version]
    if art.caput and art.caput.is_revoked and not any(
        not c.is_revoked for c in current_children
    ):
        art.is_revoked = True
