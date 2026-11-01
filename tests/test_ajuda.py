"""A parte da aba de informações escrita pelo build (src/ajuda.py)."""

import pytest

from src.ajuda import html_da_ajuda, ultimas_alteracoes
from src.models import ArticleBlock, DocumentUnit, ParsedDocument, TextRun, UnitType

pytestmark = pytest.mark.unit


def artigo(norma, numero, texto, prefixo=""):
    caput = DocumentUnit(UnitType.ARTIGO, f"Art. {numero}", f"art{numero}", runs=[TextRun(texto)])
    return ArticleBlock(art_number=numero, caput=caput, law_name=norma, law_prefix=prefixo)


def doc_exemplo():
    return ParsedDocument(elements=[
        artigo("Regimento Interno", "1", "Texto. (Redação dada pela Resolução nº 03, de 18 de junho de 2019)"),
        artigo("Regimento Interno", "2", "Texto. (Redação dada pela Resolução nº 8, de 2026)"),
        artigo("Regimento Interno", "3", "Texto. (Incluído pela Resolução nº 21/2025)"),
        artigo("Lei Orgânica", "14", "Texto. (Redação dada pela Emenda à Lei Orgânica nº 44, de 13 de março de 2025)",
               "LOM"),
        artigo("Lei Orgânica", "15", "Texto. (Redação dada pela Emenda a Lei Orgânica nº 43 de 2023)", "LOM"),
        artigo("Constituição Federal", "7", "Texto. (Redação dada pela Emenda Constitucional nº 141, de 2026)", "CF"),
        artigo("Constituição Federal", "8", "Texto. (Incluído pela Emenda Constitucional nº 99, de 2017)", "CF"),
        artigo("Precedentes Regimentais", "2/2021", "Texto.", "PREC"),
        artigo("Precedentes Regimentais", "1/2026", "Texto.", "PREC"),
    ])


def test_ultima_alteracao_de_cada_norma():
    assert ultimas_alteracoes(doc_exemplo()) == [
        ("Regimento Interno", "Resolução nº 8/2026"),
        ("Lei Orgânica", "Emenda à Lei Orgânica nº 44/2025"),
        ("Constituição Federal (artigos selecionados)", "Emenda Constitucional nº 141/2026"),
        ("Precedentes regimentais", "até o nº 1/2026"),
    ]


def test_norma_sem_alteracao_fica_de_fora():
    doc = ParsedDocument(elements=[artigo("Constituição Estadual", "1", "Texto sem nota.", "CE")])
    assert ultimas_alteracoes(doc) == []


def test_ajuda_e_uma_sanfona_com_a_ultima_alteracao():
    h = html_da_ajuda(doc_exemplo())
    assert h.startswith('<details class="info-sec"><summary>Texto atualizado até</summary>')
    assert "Resolução nº 8/2026" in h and h.endswith("</details>")


def test_ajuda_sem_alteracao_fica_vazia():
    doc = ParsedDocument(elements=[artigo("Constituição Estadual", "1", "Texto sem nota.", "CE")])
    assert html_da_ajuda(doc) == ""
