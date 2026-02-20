"""Testes unitários para _classify_one()."""

from __future__ import annotations

import pytest

from src.models import UnitType
from src.parse_docx import _classify_one

pytestmark = pytest.mark.unit


# ── Artigos ─────────────────────────────────────────────────────────────

class TestClassifyArtigo:
    def test_artigo_simples(self, make_raw):
        cp = _classify_one(make_raw("Art. 43º - O Presidente..."))
        assert cp.unit_type == UnitType.ARTIGO
        assert cp.art_number == "43"
        assert cp.identifier == "Art. 43º"

    def test_artigo_sem_ordinal(self, make_raw):
        cp = _classify_one(make_raw("Art. 1 - Texto do artigo"))
        assert cp.unit_type == UnitType.ARTIGO
        assert cp.art_number == "1"

    def test_artigo_ordinal_feminino(self, make_raw):
        cp = _classify_one(make_raw("Art. 2ª - Texto"))
        assert cp.unit_type == UnitType.ARTIGO
        assert cp.art_number == "2"
        assert cp.identifier == "Art. 2ª"

    def test_artigo_ordinal_grau(self, make_raw):
        cp = _classify_one(make_raw("Art. 5° - Texto"))
        assert cp.unit_type == UnitType.ARTIGO
        assert cp.art_number == "5"
        assert cp.identifier == "Art. 5°"

    def test_artigo_com_letra_dash(self, make_raw):
        """Art. 183-A → art_number='183-A'."""
        cp = _classify_one(make_raw("Art. 183º-A - Texto do artigo"))
        assert cp.unit_type == UnitType.ARTIGO
        assert cp.art_number == "183-A"
        assert cp.identifier == "Art. 183º-A"

    def test_artigo_com_letra_colada(self, make_raw):
        """Art. 4ºA → art_number='4-A'."""
        cp = _classify_one(make_raw("Art. 4ºA - Texto do artigo"))
        assert cp.unit_type == UnitType.ARTIGO
        assert cp.art_number == "4-A"
        assert cp.identifier == "Art. 4ºA"

    def test_artigo_4_c_com_ponto(self, make_raw):
        """Art. 4º-C. → art_number='4-C'."""
        cp = _classify_one(make_raw("Art. 4º-C. Texto"))
        assert cp.unit_type == UnitType.ARTIGO
        assert cp.art_number == "4-C"
        assert cp.identifier == "Art. 4º-C"

    def test_artigo_4_h(self, make_raw):
        cp = _classify_one(make_raw("Art. 4º-H - Texto"))
        assert cp.unit_type == UnitType.ARTIGO
        assert cp.art_number == "4-H"

    def test_artigo_numero_grande(self, make_raw):
        cp = _classify_one(make_raw("Art. 395º - Último artigo"))
        assert cp.unit_type == UnitType.ARTIGO
        assert cp.art_number == "395"

    def test_artigo_centrado_nao_eh_heading(self, make_raw):
        """Artigo centrado: regex de artigo NÃO casa em centered (is_centered entra no bloco de headings)."""
        cp = _classify_one(make_raw("Art. 10º - Texto", is_centered=True))
        # Centered text sem match de heading → SUBTITLE
        assert cp.unit_type == UnitType.SUBTITLE


# ── Headings (centered) ────────────────────────────────────────────────

class TestClassifyHeadings:
    def test_titulo(self, make_raw):
        cp = _classify_one(make_raw("TÍTULO I", is_centered=True))
        assert cp.unit_type == UnitType.TITULO
        assert cp.identifier == "TÍTULO I"

    def test_titulo_sem_acento(self, make_raw):
        cp = _classify_one(make_raw("TITULO II", is_centered=True))
        assert cp.unit_type == UnitType.TITULO

    def test_capitulo(self, make_raw):
        cp = _classify_one(make_raw("CAPÍTULO III", is_centered=True))
        assert cp.unit_type == UnitType.CAPITULO

    def test_capitulo_sem_acento(self, make_raw):
        cp = _classify_one(make_raw("CAPITULO IV", is_centered=True))
        assert cp.unit_type == UnitType.CAPITULO

    def test_secao(self, make_raw):
        cp = _classify_one(make_raw("SEÇÃO I", is_centered=True))
        assert cp.unit_type == UnitType.SECAO

    def test_secao_sem_cedilha(self, make_raw):
        cp = _classify_one(make_raw("SECAO II", is_centered=True))
        assert cp.unit_type == UnitType.SECAO

    def test_subsecao(self, make_raw):
        cp = _classify_one(make_raw("SUBSEÇÃO I", is_centered=True))
        assert cp.unit_type == UnitType.SUBSECAO

    def test_subtitle_centered_generico(self, make_raw):
        cp = _classify_one(make_raw("DA MESA DIRETORA", is_centered=True))
        assert cp.unit_type == UnitType.SUBTITLE
        assert cp.identifier == "DA MESA DIRETORA"

    def test_heading_nao_centrado_nao_eh_heading(self, make_raw):
        """TÍTULO sem is_centered → OTHER (body text)."""
        cp = _classify_one(make_raw("TÍTULO I", is_centered=False))
        assert cp.unit_type == UnitType.OTHER


# ── Sub-dispositivos ────────────────────────────────────────────────────

class TestClassifySubDispositivos:
    def test_paragrafo_unico(self, make_raw):
        cp = _classify_one(make_raw("Parágrafo único - Texto"))
        assert cp.unit_type == UnitType.PARAGRAFO_UNICO
        assert cp.identifier == "Parágrafo único"

    def test_paragrafo_unico_sem_acento(self, make_raw):
        cp = _classify_one(make_raw("Paragrafo unico - Texto"))
        assert cp.unit_type == UnitType.PARAGRAFO_UNICO

    def test_paragrafo_numerado(self, make_raw):
        cp = _classify_one(make_raw("§ 1º - Texto do parágrafo"))
        assert cp.unit_type == UnitType.PARAGRAFO_NUM
        assert cp.identifier == "§ 1º"

    def test_paragrafo_normaliza_ponto(self, make_raw):
        """§ 10. → § 10º (normaliza ponto para ordinal)."""
        cp = _classify_one(make_raw("§ 10. - Texto"))
        assert cp.unit_type == UnitType.PARAGRAFO_NUM
        assert cp.identifier == "§ 10º"

    def test_paragrafo_com_ponto_ordinal(self, make_raw):
        """§ 1.º → § 1º."""
        cp = _classify_one(make_raw("§ 1.º - Texto"))
        assert cp.unit_type == UnitType.PARAGRAFO_NUM
        assert cp.identifier == "§ 1º"

    def test_inciso_romano(self, make_raw):
        cp = _classify_one(make_raw("III - Texto do inciso"))
        assert cp.unit_type == UnitType.INCISO
        assert cp.identifier == "III"

    def test_inciso_typo_l_minusculo(self, make_raw):
        """lV → IV (L minúsculo no início)."""
        cp = _classify_one(make_raw("lV - Texto"))
        assert cp.unit_type == UnitType.INCISO
        assert cp.identifier == "IV"

    def test_inciso_complexo(self, make_raw):
        cp = _classify_one(make_raw("XLII - Texto"))
        assert cp.unit_type == UnitType.INCISO
        assert cp.identifier == "XLII"

    def test_alinea(self, make_raw):
        cp = _classify_one(make_raw("a) texto da alínea"))
        assert cp.unit_type == UnitType.ALINEA
        assert cp.identifier == "a)"

    def test_alinea_z(self, make_raw):
        cp = _classify_one(make_raw("z) última alínea"))
        assert cp.unit_type == UnitType.ALINEA
        assert cp.identifier == "z)"

    def test_sub_alinea_com_indent(self, make_raw):
        """1) com indent >= 600 → SUB_ALINEA."""
        cp = _classify_one(make_raw("1) texto da sub-alínea", indent_left=700))
        assert cp.unit_type == UnitType.SUB_ALINEA
        assert cp.identifier == "1)"

    def test_sub_alinea_sem_indent_vira_item(self, make_raw):
        """1) sem indent (< 600) → ITEM_NUM."""
        cp = _classify_one(make_raw("1) texto sem indent", indent_left=0))
        assert cp.unit_type == UnitType.ITEM_NUM

    def test_item_num(self, make_raw):
        cp = _classify_one(make_raw("3 - Texto numerado"))
        assert cp.unit_type == UnitType.ITEM_NUM
        assert cp.identifier == "3"


# ── Edge cases ──────────────────────────────────────────────────────────

class TestClassifyEdgeCases:
    def test_empty_string(self, make_raw):
        cp = _classify_one(make_raw(""))
        assert cp.unit_type == UnitType.EMPTY

    def test_nbsp_only(self, make_raw):
        cp = _classify_one(make_raw("\xa0"))
        assert cp.unit_type == UnitType.EMPTY

    def test_whitespace_only(self, make_raw):
        cp = _classify_one(make_raw("   "))
        assert cp.unit_type == UnitType.EMPTY

    def test_other_body_text(self, make_raw):
        cp = _classify_one(make_raw("Texto qualquer no corpo do documento."))
        assert cp.unit_type == UnitType.OTHER
        assert cp.identifier == ""
