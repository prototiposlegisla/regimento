"""Constituição Estadual (compilação da ALESP): formato do texto, remissões e rótulos."""

from __future__ import annotations

import pytest

from src.models import ArticleBlock, DocumentUnit, ParsedDocument, TextRun, UnitType
from src.parse_docx import _classify_one, _is_revoked_text, note_tail_spans
from src.remissoes import detectar
from src.render_html import HTMLRenderer
from src.render_markdown import MarkdownRenderer

pytestmark = pytest.mark.unit


# ── Formato da ALESP ────────────────────────────────────────────────────

class TestFormatoAlesp:
    @pytest.mark.parametrize("text,num,ident", [
        ("Artigo 144 - Os Municípios, com autonomia política", "144", "Art. 144"),
        ("Artigo 1° - O Estado de São Paulo", "1", "Art. 1°"),
        ("Artigo 145-A - A alteração da denominação de Municípios", "145-A", "Art. 145-A"),
    ])
    def test_artigo_por_extenso(self, make_raw, text, num, ident):
        cp = _classify_one(make_raw(text))
        assert cp.unit_type == UnitType.ARTIGO and cp.art_number == num and cp.identifier == ident

    def test_artigo_citado_sem_travessao_e_texto(self, make_raw):
        """Precedente nº 1/2007: "Artigo 307, inciso III e Artigo 120, inciso I." não abre artigo."""
        assert _classify_one(make_raw("Artigo 307, inciso III e Artigo 120, inciso I.")).unit_type != UnitType.ARTIGO

    def test_inciso_com_letra(self, make_raw):
        cp = _classify_one(make_raw("XX-A - a administração tributária, atividade essencial"))
        assert cp.unit_type == UnitType.INCISO and cp.identifier == "XX-A"

    @pytest.mark.parametrize("nota", [
        '(§ 2° com redação dada pela Emenda Constitucional n° 47, de 14/03/2019)',
        '("Caput" acrescentado pela Emenda Constitucional n° 27, de 15/06/2009)',
        '(Item 1 declarado inconstitucional, em controle concentrado, pelo Supremo Tribunal Federal nos autos da ADI n° 7436)',
        '(Expressão "Federal", anteriormente constante deste inciso, declarada inconstitucional)',
    ])
    def test_nota_da_alesp_no_fim(self, nota):
        text = "§2° - No primeiro ano da legislatura, a Assembleia reunir-se-á. " + nota
        assert [text[a:b] for a, b in note_tail_spans(text)] == [nota]

    def test_parenteses_do_texto_nao_sao_nota(self):
        assert note_tail_spans("I - os casos previstos (§ 1º do artigo 40)") == []

    def test_revogado_pela_nota_da_alesp(self):
        assert _is_revoked_text("VIII - Revogado. (Inciso VIII revogado pela Emenda Constitucional n° 21, de 14/02/2006)")
        assert not _is_revoked_text("§1° - texto (§1° com redação dada pela Emenda Constitucional n° 21, revogado o parágrafo único)")


# ── Remissões e correlatos ──────────────────────────────────────────────

def _u(ut, ident, uid, text):
    return DocumentUnit(ut, ident, uid, runs=[TextRun(text)])


def _doc():
    lom200 = ArticleBlock(art_number="200", law_name="Lei Orgânica", law_prefix="LOM",
                          caput=_u(UnitType.ARTIGO, "Art. 200", "art200", "Art. 200 - A educação."),
                          children=[_u(UnitType.PARAGRAFO_NUM, "§ 3º", "art200p3",
                                       "§ 3.º — O Plano Municipal de Educação previsto no art. 241 da "
                                       "Constituição Estadual será elaborado pelo Executivo.")])
    ce115 = ArticleBlock(art_number="115", law_name="Constituição Estadual", law_prefix="CE",
                         caput=_u(UnitType.ARTIGO, "Art. 115", "art115",
                                  "Artigo 115 - Para a organização da administração pública, observado o "
                                  "artigo 241 desta Constituição e o artigo 37 da Constituição Federal:"))
    ce241 = ArticleBlock(art_number="241", law_name="Constituição Estadual", law_prefix="CE",
                         caput=_u(UnitType.ARTIGO, "Art. 241", "art241", "Artigo 241 - O Plano Estadual de Educação."))
    cf37 = ArticleBlock(art_number="37", law_name="Constituição Federal", law_prefix="CF",
                        caput=_u(UnitType.ARTIGO, "Art. 37", "art37", "Art. 37. A administração pública."))
    return ParsedDocument(elements=[lom200, ce115, ce241, cf37])


def _alvos(res, origem):
    return [a.ref for r in res.remissoes if r.origem.ref == origem and r.exibivel for a in r.alvos]


class TestRemissoesCE:
    def test_lom_cita_a_constituicao_estadual(self):
        assert _alvos(detectar(_doc()), "LOM:200,§ 3º") == ["CE:241"]

    def test_desta_constituicao_no_texto_da_ce(self):
        assert _alvos(detectar(_doc()), "CE:115") == ["CE:241", "CF:37"]

    def test_artigo_da_ce_fora_da_pagina_e_externa(self):
        doc = _doc()
        doc.elements.remove(doc.elements[2])
        (r,) = [r for r in detectar(doc).remissoes if r.origem.ref == "LOM:200,§ 3º"]
        assert r.classe == "externa"

    def test_identificador_por_extenso_sai_do_texto(self):
        unit = _u(UnitType.ARTIGO, "Art. 144", "art144", "Artigo 144 - Os Municípios se auto-organizarão.")
        assert HTMLRenderer()._render_runs_after_identifier(unit).strip() == "Os Municípios se auto-organizarão."
        assert MarkdownRenderer()._render_runs_after_identifier(unit).strip() == "Os Municípios se auto-organizarão."

    def test_correspondente_com_a_ce_e_regra_estadual(self):
        doc = _doc()
        linha = {"ID": "R1", "Origem": "LOM:200", "Destino": "CE:241", "Tipo": "correspondente",
                 "Nota": "Na CE, o Plano Estadual; na LOM, o municipal.", "Status": "aprovado",
                 "Visibilidade": "público", "linha": 2}
        res = detectar(doc, implicitas=[linha])
        html = HTMLRenderer(res).render(doc)
        assert 'data-ref="CE:241" data-tipo="sim" data-side="src"' in html and 'data-esfera="estadual"' in html
        md = MarkdownRenderer(res).render_document(doc)
        assert "tem como regra estadual correspondente CE art. 241" in md
        assert "é a regra estadual correspondente a LOM art. 200" in md
