"""Testes unitários para resolve_amendments."""

from __future__ import annotations

import pytest

from src.models import (
    ArticleBlock, DocumentUnit, ParsedDocument, SectionHeading, UnitType, TextRun,
)
from src.resolve_amendments import resolve_amendments, _resolve_article

pytestmark = pytest.mark.unit


def _make_unit(
    identifier: str,
    uid: str,
    *,
    unit_type: UnitType = UnitType.INCISO,
    is_old_version: bool = False,
    is_revoked: bool = False,
    has_strike: bool = False,
    text: str = "",
) -> DocumentUnit:
    return DocumentUnit(
        unit_type=unit_type,
        identifier=identifier,
        uid=uid,
        runs=[TextRun(text=text or f"{identifier} - Texto")],
        is_old_version=is_old_version,
        is_revoked=is_revoked,
    )


def _make_article(
    art_number: str,
    children: list[DocumentUnit] | None = None,
    *,
    caput_revoked: bool = False,
    caput_struck: bool = False,
) -> ArticleBlock:
    caput = DocumentUnit(
        unit_type=UnitType.ARTIGO,
        identifier=f"Art. {art_number}º",
        uid=f"art{art_number}",
        runs=[TextRun(text=f"Art. {art_number}º - Texto")],
        is_revoked=caput_revoked,
        is_old_version=caput_struck,
    )
    return ArticleBlock(
        art_number=art_number,
        caput=caput,
        children=children or [],
    )


class TestResolveArticle:
    def test_sem_filhos(self):
        art = _make_article("10")
        _resolve_article(art)
        assert len(art.children) == 0
        assert art.is_revoked is False

    def test_filhos_unicos(self):
        """Cada filho com identifier diferente → nenhum marcado como old."""
        art = _make_article("10", [
            _make_unit("I", "art10I"),
            _make_unit("II", "art10II"),
            _make_unit("III", "art10III"),
        ])
        _resolve_article(art)
        assert len(art.children) == 3
        assert all(not c.is_old_version for c in art.children)

    def test_duas_versoes_consecutivas(self):
        """Dois incisos com mesmo identifier: primeiro → old, segundo → vigente."""
        art = _make_article("10", [
            _make_unit("I", "art10I_v1"),
            _make_unit("I", "art10I_v2"),
        ])
        _resolve_article(art)
        assert len(art.children) == 2
        assert art.children[0].is_old_version is True
        assert art.children[1].is_old_version is False

    def test_tres_versoes_consecutivas(self):
        """Três versões: 2 primeiras → old, última → vigente."""
        art = _make_article("10", [
            _make_unit("I", "art10I_v1"),
            _make_unit("I", "art10I_v2"),
            _make_unit("I", "art10I_v3"),
        ])
        _resolve_article(art)
        assert art.children[0].is_old_version is True
        assert art.children[1].is_old_version is True
        assert art.children[2].is_old_version is False

    def test_versoes_nao_consecutivas_separadas(self):
        """Mesmos identifiers mas não consecutivos → grupos separados."""
        art = _make_article("10", [
            _make_unit("I", "art10I"),
            _make_unit("II", "art10II"),
            _make_unit("I", "art10I_dup"),
        ])
        _resolve_article(art)
        # I e II são grupos separados; o segundo I é grupo separado
        assert art.children[0].is_old_version is False  # I (sozinho no grupo)
        assert art.children[1].is_old_version is False  # II
        assert art.children[2].is_old_version is False  # I (sozinho no grupo)

    def test_artigo_caput_revogado_sem_filhos(self):
        art = _make_article("10", caput_revoked=True)
        _resolve_article(art)
        assert art.is_revoked is True

    def test_artigo_revogado_com_filhos_revogados(self):
        art = _make_article("10", [
            _make_unit("I", "art10I", is_revoked=True),
        ], caput_revoked=True)
        _resolve_article(art)
        assert art.is_revoked is True

    def test_artigo_revogado_caput_mas_filho_vigente(self):
        """Caput revogado mas filho não revogado → artigo NÃO é revogado."""
        art = _make_article("10", [
            _make_unit("I", "art10I", is_revoked=False),
        ], caput_revoked=True)
        _resolve_article(art)
        assert art.is_revoked is False

    def test_caput_struck_swap(self):
        """Caput is_old_version + versão em all_versions → swap."""
        # Precisa de children para não retornar early
        art = _make_article("10", [
            _make_unit("I", "art10I"),
        ], caput_struck=True)
        new_caput = _make_unit(
            "Art. 10º", "art10",
            unit_type=UnitType.ARTIGO,
            is_old_version=False,
        )
        art.all_versions = [new_caput]
        _resolve_article(art)
        # Agora o caput vigente é o new_caput
        assert art.caput is new_caput
        assert art.all_versions[0].is_old_version is True


class TestResolveAmendmentsDocument:
    def test_resolve_amendments_aplica_em_todos_artigos(self):
        art1 = _make_article("1", [
            _make_unit("I", "art1I_v1"),
            _make_unit("I", "art1I_v2"),
        ])
        art2 = _make_article("2")
        doc = ParsedDocument(elements=[
            SectionHeading(level=UnitType.TITULO, text="TÍTULO I"),
            art1,
            art2,
        ])
        result = resolve_amendments(doc)
        assert result is doc  # modifica in-place
        assert art1.children[0].is_old_version is True
        assert art1.children[1].is_old_version is False
