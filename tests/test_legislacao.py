"""Testes unitários da legislação correlata (notas de rodapé "L" no DOCX)."""

from __future__ import annotations

import pytest

from src.build_index import legislacao_index
from src.models import ArticleBlock, DocumentUnit, FootnotePara, ParsedDocument, TextRun, UnitType
from src.render_html import HTMLRenderer
from src.render_markdown import MarkdownRenderer
from src.resolve_amendments import structure_warnings

pytestmark = pytest.mark.unit

URL = "https://app-plpconsulta-prd.azurewebsites.net/Forms/MostrarArquivo?TIPO=LEI&NUMERO=14454&ANO=2007&DOCUMENTO=Atualizado"


def _norma(nome, ementa, url=URL):
    return FootnotePara(runs=[TextRun(nome, hyperlink_url=url), TextRun(f" — {ementa}")])


def _doc():
    xxx = DocumentUnit(UnitType.INCISO, "XXX", "art105XXX",
                       [TextRun("XXX - autorizar a alteração de denominação de próprios, vias e logradouros públicos;")],
                       legislacao=[_norma("Lei nº 14.454, de 27 de junho de 2007",
                                          "Consolida a legislação municipal sobre a denominação de vias.")])
    caput = DocumentUnit(UnitType.ARTIGO, "Art. 105", "art105", [TextRun("Art. 105 - São atribuições do Plenário:")])
    a105 = ArticleBlock(art_number="105", caput=caput, children=[xxx], law_name="Regimento Interno")
    p2 = DocumentUnit(UnitType.PARAGRAFO_NUM, "§ 2º", "art5p2", [TextRun("§ 2º - Texto.")], legislacao=[
        _norma("Resolução nº 3, de 2010", "Outra."), _norma("Lei nº 14.454, de 27 de junho de 2007", "Consolida.")])
    a5 = ArticleBlock(art_number="5", caput=DocumentUnit(UnitType.ARTIGO, "Art. 5º", "art5", [TextRun("Art. 5º - X.")]),
                      children=[p2], law_name="Regimento Interno")
    return ParsedDocument(elements=[a5, a105])


class TestLegislacaoCorrelata:
    def test_selo_e_caixa_no_dispositivo(self):
        html = HTMLRenderer().render(_doc())
        assert ('<sup class="footnote-ref leg-ref" data-note="L2" data-label="Legislação correlata"></sup></p>'
                in html)
        assert 'data-note="L1" data-label="Legislação correlata (2)"' in html
        assert (f'<div class="footnote-box leg-box" data-note="L2">' in html
                and f'<li><a href="{URL.replace("&", "&amp;")}" target="_blank" rel="noopener">'
                    'Lei nº 14.454, de 27 de junho de 2007</a> — Consolida a legislação municipal sobre a '
                    'denominação de vias.</li>' in html)

    def test_markdown(self):
        md = MarkdownRenderer().render_document(_doc())
        assert (f"*(legislação correlata: [Lei nº 14.454, de 27 de junho de 2007]({URL}) — Consolida a legislação "
                "municipal sobre a denominação de vias.)*") in md

    def test_aba_referencias_agrupa_por_norma(self):
        cat = legislacao_index(_doc())
        assert cat["category"] == "Legislação correlata"
        assert [g["title"] for g in cat["groups"]] == ["Lei nº 14.454, de 27 de junho de 2007", "Resolução nº 3, de 2010"]
        # a ementa primeiro (sem link), depois os dispositivos
        assert cat["groups"][0]["entries"][0] == {"html": "<i>Consolida.</i>"}
        assert [e["art_ref"] for e in cat["groups"][0]["entries"][1:]] == ["5, § 2º", "105, XXX"]

    def test_sem_notas_nao_cria_categoria(self):
        doc = _doc()
        for a in doc.elements:
            for c in a.children:
                c.legislacao = []
        assert legislacao_index(doc) is None

    def test_aviso_sem_link(self):
        doc = _doc()
        doc.elements[1].children[0].legislacao.append(FootnotePara(runs=[TextRun("Decreto nº 1, de 2020 — X.")]))
        avisos = [m for m, _ in structure_warnings(doc)]
        assert any("Legislação correlata sem link" in m and "Decreto nº 1" in m for m in avisos)


class TestPrefixoL:
    """O Word pode gravar "L", o espaço e o nome da norma em runs diferentes (até dentro do link)."""

    @pytest.mark.parametrize("runs", [
        [" L Lei nº 1"],
        ["L", " ", "Lei nº 1"],
        [" L", " Lei nº 1"],
        [" ", "L", " ", "Lei nº 1"],
        [" L", ("link", " Lei nº 1")],
        [" ", "L ", "Lei nº 1"],
    ])
    def test_tira_so_o_prefixo(self, runs):
        from src.parse_docx import _strip_prefix
        p = FootnotePara(runs=[TextRun(r[1], hyperlink_url=URL) if isinstance(r, tuple) else TextRun(r) for r in runs])
        _strip_prefix([p])
        assert "".join(r.text for r in p.runs) == "Lei nº 1"
