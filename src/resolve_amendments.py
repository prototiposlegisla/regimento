"""Resolução de emendas (múltiplas redações de um mesmo dispositivo).

Regra: quando há dispositivos consecutivos com mesmo identificador,
o último na sequência (sem strikethrough) é a versão vigente.
Os anteriores (com strikethrough) vão para all_versions.
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

    Estratégia:
    1. Agrupa children consecutivos com mesmo identifier
    2. Último não-strike do grupo = versão vigente (fica em children)
    3. Os demais vão para all_versions
    4. Se o caput tem all_versions (múltiplas versões já detectadas pelo parser),
       o caput atual (sem strike) é mantido
    """
    if not art.children:
        return

    # Separate old (struck-through) versions already in all_versions
    # and process children for duplicates
    new_children: list[DocumentUnit] = []
    versions: list[DocumentUnit] = list(art.all_versions)

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

    for group in groups:
        if len(group) == 1:
            new_children.append(group[0])
        else:
            # Multiple versions with same identifier
            # Last one = vigente, others → all_versions
            vigente = group[-1]
            for old in group[:-1]:
                old.is_old_version = True
                versions.append(old)
            new_children.append(vigente)

    art.children = new_children
    art.all_versions = versions

    # Handle caput versions: if caput is struck through and there's
    # a non-struck version in all_versions, swap
    if art.caput and art.caput.is_old_version:
        # Look for a non-struck caput in versions
        for i, v in enumerate(art.all_versions):
            if (
                v.identifier == art.caput.identifier
                and not v.is_old_version
            ):
                # Swap
                art.all_versions[i] = art.caput
                art.caput = v
                break

    # Detect if entire article is revoked
    if art.caput and art.caput.is_revoked and not any(
        not c.is_revoked for c in art.children
    ):
        art.is_revoked = True
