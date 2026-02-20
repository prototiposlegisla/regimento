"""Testes unitários para _build_document."""

from __future__ import annotations

import pytest

from src.models import UnitType, TextRun, ArticleBlock, SectionHeading
from src.parse_docx import _build_document, _ClassifiedParagraph

pytestmark = pytest.mark.unit


def _cp(
    unit_type: UnitType,
    text: str,
    *,
    identifier: str = "",
    art_number: str = "",
    is_centered: bool = False,
    has_strike: bool = False,
    indent_left: int = 0,
    footnote_ids: list[int] | None = None,
) -> _ClassifiedParagraph:
    return _ClassifiedParagraph(
        unit_type=unit_type,
        identifier=identifier,
        text=text,
        runs=[TextRun(text=text)],
        is_centered=is_centered,
        has_strike=has_strike,
        indent_left=indent_left,
        bookmark_name="",
        art_number=art_number,
        footnote_ids=footnote_ids or [],
    )


class TestBuildDocumentArticles:
    def test_artigo_simples(self):
        classified = [
            _cp(UnitType.ARTIGO, "Art. 1º - Texto", identifier="Art. 1º", art_number="1"),
        ]
        doc = _build_document(classified)
        assert len(doc.elements) == 1
        art = doc.elements[0]
        assert isinstance(art, ArticleBlock)
        assert art.art_number == "1"
        assert art.caput is not None
        assert art.caput.uid == "art1"

    def test_artigo_com_filhos(self):
        classified = [
            _cp(UnitType.ARTIGO, "Art. 10º - Texto", identifier="Art. 10º", art_number="10"),
            _cp(UnitType.PARAGRAFO_NUM, "§ 1º - Sub", identifier="§ 1º"),
            _cp(UnitType.INCISO, "I - Inciso", identifier="I"),
            _cp(UnitType.ALINEA, "a) Alínea", identifier="a)"),
        ]
        doc = _build_document(classified)
        assert len(doc.elements) == 1
        art = doc.elements[0]
        assert isinstance(art, ArticleBlock)
        assert len(art.children) == 3
        assert art.children[0].uid == "art10p1"
        assert art.children[1].uid == "art10p1I"
        assert art.children[2].uid == "art10p1Ia"

    def test_artigo_duplicado_merge(self):
        """Dois artigos com mesmo número → merge (versão)."""
        classified = [
            _cp(UnitType.ARTIGO, "Art. 5º - V1", identifier="Art. 5º", art_number="5", has_strike=True),
            _cp(UnitType.ARTIGO, "Art. 5º - V2", identifier="Art. 5º", art_number="5"),
        ]
        doc = _build_document(classified)
        assert len(doc.elements) == 1
        art = doc.elements[0]
        assert isinstance(art, ArticleBlock)
        # V1 foi para all_versions, V2 é o caput atual
        assert len(art.all_versions) == 1
        assert art.all_versions[0].is_old_version is True
        assert "V2" in art.caput.full_text


class TestBuildDocumentHeadings:
    def test_heading_com_subtitle(self):
        classified = [
            _cp(UnitType.TITULO, "TÍTULO I", identifier="TÍTULO I", is_centered=True),
            _cp(UnitType.SUBTITLE, "DA CÂMARA MUNICIPAL", identifier="DA CÂMARA MUNICIPAL", is_centered=True),
        ]
        doc = _build_document(classified)
        assert len(doc.elements) == 1
        h = doc.elements[0]
        assert isinstance(h, SectionHeading)
        assert h.level == UnitType.TITULO
        assert h.text == "TÍTULO I"
        assert h.subtitle == "DA CÂMARA MUNICIPAL"
        assert h.data_section == "tit1"

    def test_capitulo_heading(self):
        classified = [
            _cp(UnitType.CAPITULO, "CAPÍTULO II", identifier="CAPÍTULO II", is_centered=True),
            _cp(UnitType.SUBTITLE, "DAS COMISSÕES", identifier="DAS COMISSÕES", is_centered=True),
        ]
        doc = _build_document(classified)
        h = doc.elements[0]
        assert isinstance(h, SectionHeading)
        assert h.data_section == "cap1"
        assert h.subtitle == "DAS COMISSÕES"

    def test_secao_heading(self):
        classified = [
            _cp(UnitType.SECAO, "SEÇÃO I", identifier="SEÇÃO I", is_centered=True),
        ]
        doc = _build_document(classified)
        h = doc.elements[0]
        assert isinstance(h, SectionHeading)
        assert h.data_section == "sec1"

    def test_subsecao_heading(self):
        classified = [
            _cp(UnitType.SUBSECAO, "SUBSEÇÃO I", identifier="SUBSEÇÃO I", is_centered=True),
        ]
        doc = _build_document(classified)
        h = doc.elements[0]
        assert isinstance(h, SectionHeading)
        assert h.data_section == "subsec1"

    def test_subtitle_standalone_vira_secao(self):
        """Subtitle sem heading precedente → tratado como SEÇÃO."""
        classified = [
            _cp(UnitType.SUBTITLE, "DAS DISPOSIÇÕES GERAIS", identifier="DAS DISPOSIÇÕES GERAIS", is_centered=True),
        ]
        doc = _build_document(classified)
        h = doc.elements[0]
        assert isinstance(h, SectionHeading)
        assert h.level == UnitType.SECAO


class TestBuildDocumentSpecial:
    def test_empty_ignorado(self):
        classified = [
            _cp(UnitType.EMPTY, ""),
            _cp(UnitType.ARTIGO, "Art. 1º - Texto", identifier="Art. 1º", art_number="1"),
            _cp(UnitType.EMPTY, "\xa0"),
        ]
        doc = _build_document(classified)
        assert len(doc.elements) == 1
        assert isinstance(doc.elements[0], ArticleBlock)

    def test_adt_marker(self):
        classified = [
            _cp(UnitType.SUBTITLE, "ATO DAS DISPOSIÇÕES TRANSITÓRIAS",
                 identifier="ATO DAS DISPOSIÇÕES TRANSITÓRIAS", is_centered=True),
            _cp(UnitType.ARTIGO, "Art. 1º - Texto ADT", identifier="Art. 1º", art_number="1"),
        ]
        doc = _build_document(classified)
        # First: ADT heading
        assert isinstance(doc.elements[0], SectionHeading)
        assert doc.elements[0].data_section == "adt"
        # Second: Article with ADT prefix
        art = doc.elements[1]
        assert isinstance(art, ArticleBlock)
        assert art.art_number == "ADT1"
        assert art.is_adt is True

    def test_norma_marker(self):
        classified = [
            _cp(UnitType.OTHER, "NORMA: Lei Orgânica do Município",
                 is_centered=True),
            _cp(UnitType.ARTIGO, "Art. 1º - Texto", identifier="Art. 1º", art_number="1"),
        ]
        doc = _build_document(classified)
        # NORMA → heading
        h = doc.elements[0]
        assert isinstance(h, SectionHeading)
        assert h.text == "Lei Orgânica do Município"
        assert h.data_section == "norma1"
        # Article after NORMA
        art = doc.elements[1]
        assert isinstance(art, ArticleBlock)
        assert art.law_name == "Lei Orgânica do Município"

    def test_sub_dispositivo_orfao_ignorado(self):
        """Sub-dispositivo sem artigo precedente → ignorado."""
        classified = [
            _cp(UnitType.INCISO, "I - Texto órfão", identifier="I"),
        ]
        doc = _build_document(classified)
        assert len(doc.elements) == 0

    def test_dedup_uid_colisao(self):
        """UIDs duplicados recebem sufixo _2, _3..."""
        classified = [
            _cp(UnitType.ARTIGO, "Art. 1º - Texto", identifier="Art. 1º", art_number="1"),
            _cp(UnitType.OTHER, "Texto solto 1", identifier=""),
            _cp(UnitType.OTHER, "Texto solto 2", identifier=""),
        ]
        doc = _build_document(classified)
        art = doc.elements[0]
        assert isinstance(art, ArticleBlock)
        uids = [c.uid for c in art.children]
        assert len(uids) == len(set(uids)), f"UIDs duplicados: {uids}"

    def test_heading_flush_artigo_anterior(self):
        """Heading aparecendo após artigo → flush do artigo."""
        classified = [
            _cp(UnitType.ARTIGO, "Art. 1º - Texto", identifier="Art. 1º", art_number="1"),
            _cp(UnitType.TITULO, "TÍTULO II", identifier="TÍTULO II", is_centered=True),
            _cp(UnitType.ARTIGO, "Art. 2º - Texto", identifier="Art. 2º", art_number="2"),
        ]
        doc = _build_document(classified)
        assert len(doc.elements) == 3
        assert isinstance(doc.elements[0], ArticleBlock)
        assert isinstance(doc.elements[1], SectionHeading)
        assert isinstance(doc.elements[2], ArticleBlock)
