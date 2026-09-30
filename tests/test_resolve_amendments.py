"""Testes unitários para resolve_amendments."""

from __future__ import annotations

import pytest

from src.models import (
    ArticleBlock, DocumentUnit, ParsedDocument, SectionHeading, UnitType, TextRun,
)
from src.models import Footnote
from src.resolve_amendments import (
    resolve_amendments, _resolve_article, duplicate_identifiers, structure_warnings,
)

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
        """Redação antiga tachada (old) seguida da vigente: ficam como vieram do parse."""
        art = _make_article("10", [
            _make_unit("I", "art10I_v1", is_old_version=True),
            _make_unit("I", "art10I_v2"),
        ])
        _resolve_article(art)
        assert len(art.children) == 2
        assert art.children[0].is_old_version is True
        assert art.children[1].is_old_version is False

    def test_vigente_antes_da_tachada(self):
        """Redação restabelecida (ex.: LOM art. 88, após ADIN): a vigente vem antes da tachada."""
        art = _make_article("10", [
            _make_unit("I", "art10I"),
            _make_unit("I", "art10I_2", is_old_version=True),
        ])
        _resolve_article(art)
        assert art.children[0].is_old_version is False
        assert art.children[1].is_old_version is True

    def test_repetidos_sem_tachado_continuam_vigentes(self):
        """Mesmo número duas vezes, nenhum tachado (ex.: RI art. 283, dois IV): os dois vigentes."""
        art = _make_article("10", [
            _make_unit("IV", "art10IV"),
            _make_unit("IV", "art10IV_2"),
        ])
        _resolve_article(art)
        assert art.children[0].is_old_version is False
        assert art.children[1].is_old_version is False

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

    def test_caput_restabelecido_antes_do_tachado_vira_o_vigente(self):
        """Caput vigente (restabelecido) antes de um caput tachado: troca."""
        art = _make_article("88", caput_struck=True)
        restored = _make_unit("Art. 88º", "art88_v1", unit_type=UnitType.ARTIGO)
        art.all_versions = [restored]
        _resolve_article(art)
        assert art.caput is restored and art.is_revoked is False

    def test_artigo_tachado_com_filhos_todos_tachados_eh_revogado(self):
        art = _make_article("10", [_make_unit("I", "art10I", is_old_version=True)], caput_struck=True)
        _resolve_article(art)
        assert art.is_revoked is True

    def test_artigo_todo_tachado_sem_filhos_eh_revogado(self):
        """LOM art. 51: caput tachado (ADIN), sem outra redação vigente."""
        art = _make_article("51", caput_struck=True)
        _resolve_article(art)
        assert art.is_revoked is True

    def test_caput_tachado_com_outra_redacao_vigente_nao_eh_revogado(self):
        art = _make_article("51", caput_struck=True)
        art.all_versions = [_make_unit("Art. 51º", "art51_2", unit_type=UnitType.ARTIGO)]
        _resolve_article(art)
        assert art.is_revoked is False

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
            _make_unit("I", "art1I_v1", is_old_version=True),
            _make_unit("I", "art1I_v2"),
        ])
        art2 = _make_article("2", caput_revoked=True)
        doc = ParsedDocument(elements=[
            SectionHeading(level=UnitType.TITULO, text="TÍTULO I"),
            art1,
            art2,
        ])
        result = resolve_amendments(doc)
        assert result is doc  # modifica in-place
        assert art1.children[0].is_old_version is True
        assert art1.children[1].is_old_version is False
        assert art1.is_revoked is False
        assert art2.is_revoked is True


class TestDuplicateIdentifiers:
    def test_acusa_repetidos_sem_tachado(self):
        art = _make_article("10", [
            _make_unit("IV", "art10IV"),
            _make_unit("IV", "art10IV_2"),
        ])
        doc = ParsedDocument(elements=[art])
        assert [(a.art_number, ident) for a, ident in duplicate_identifiers(doc)] == [("10", "IV")]

    def test_ignora_versao_tachada(self):
        art = _make_article("10", [
            _make_unit("IV", "art10IV", is_old_version=True),
            _make_unit("IV", "art10IV_2"),
        ])
        assert duplicate_identifiers(ParsedDocument(elements=[art])) == []

    def test_acusa_repetido_nao_vizinho(self):
        """IV vigente, IV tachado, IV vigente: o 1º e o 3º são repetidos."""
        art = _make_article("10", [
            _make_unit("IV", "art10IV"),
            _make_unit("IV", "art10IV_2", is_old_version=True),
            _make_unit("IV", "art10IV_3"),
        ])
        assert [p for _, p in duplicate_identifiers(ParsedDocument(elements=[art]))] == ["IV"]

    def test_repetido_com_filhos_acusa_so_o_pai(self):
        """RI art. 47 sem o tachado: XI, a), XI, a) → só "XI"."""
        art = _make_article("47", [
            _make_unit("XI", "art47XI"),
            _make_unit("a)", "art47XIa", unit_type=UnitType.ALINEA),
            _make_unit("XI", "art47XI_2"),
            _make_unit("a)", "art47XIa_2", unit_type=UnitType.ALINEA),
        ])
        assert [p for _, p in duplicate_identifiers(ParsedDocument(elements=[art]))] == ["XI"]

    def test_mesmo_inciso_em_paragrafos_diferentes_nao_eh_repetido(self):
        art = _make_article("10", [
            _make_unit("§ 1º", "art10p1", unit_type=UnitType.PARAGRAFO_NUM),
            _make_unit("I", "art10p1I"),
            _make_unit("§ 2º", "art10p2", unit_type=UnitType.PARAGRAFO_NUM),
            _make_unit("I", "art10p2I"),
        ])
        assert duplicate_identifiers(ParsedDocument(elements=[art])) == []

    def test_incisos_antigos_em_outro_nivel_nao_contam(self):
        """RI 47, XIV: os incisos da redação de 2019 (tachados) viraram alíneas; "a)" continua sob o XIV."""
        art = _make_article("47", [
            _make_unit("I", "art47I"),
            _make_unit("a)", "art47Ia", unit_type=UnitType.ALINEA),
            _make_unit("XIV", "art47XIV"),
            _make_unit("I", "art47XIVI", is_old_version=True),
            _make_unit("a)", "art47XIVa", unit_type=UnitType.ALINEA),
        ])
        assert duplicate_identifiers(ParsedDocument(elements=[art])) == []

    def test_ignora_identificador_vazio(self):
        """Linhas sem identificador (texto solto) não são dispositivos repetidos."""
        art = _make_article("10", [
            _make_unit("", "art10", unit_type=UnitType.OTHER),
            _make_unit("", "art10_2", unit_type=UnitType.OTHER),
        ])
        assert duplicate_identifiers(ParsedDocument(elements=[art])) == []


class TestStructureWarnings:
    def test_repetido_avisa_e_lista_de_excecoes_silencia(self):
        art = _make_article("283", [_make_unit("IV", "art283IV"), _make_unit("IV", "art283IV_2")])
        art.law_name = "Regimento Interno"
        doc = ParsedDocument(elements=[art])
        (msg, ctx), = structure_warnings(doc)
        assert '"IV" repetido entre as redações vigentes' in msg and ctx == "Regimento Interno, Art. 283"
        assert structure_warnings(doc, {("Regimento Interno", "283", "IV")}) == []

    def test_nota_no_caput_tachado_vigente_nao_avisa(self):
        """O caput atual aparece com as notas, mesmo tachado (ex.: LOM 51)."""
        art = _make_article("51", caput_struck=True)
        art.caput.footnotes = [Footnote(number=1)]
        assert structure_warnings(ParsedDocument(elements=[art])) == []

    def test_duas_redacoes_do_caput_sem_tachado(self):
        art = _make_article("10")
        art.all_versions = [_make_unit("Art. 10º", "art10_v1", unit_type=UnitType.ARTIGO)]
        (msg, _), = structure_warnings(ParsedDocument(elements=[art]))
        assert "Duas redações do caput" in msg

    def test_nota_de_rodape_em_redacao_tachada(self):
        old = _make_unit("I", "art10I", is_old_version=True, text="I - redação antiga")
        old.footnotes = [Footnote(number=1)]
        doc = ParsedDocument(elements=[_make_article("10", [old, _make_unit("I", "art10I_2")])])
        (msg, _), = structure_warnings(doc)
        assert "Nota de rodapé em redação tachada" in msg

    def test_sem_avisos(self):
        doc = ParsedDocument(elements=[_make_article("10", [_make_unit("I", "art10I"), _make_unit("II", "art10II")])])
        assert structure_warnings(doc) == []
