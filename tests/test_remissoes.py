"""Testes unitários das remissões explícitas (src/remissoes.py) e da sua renderização."""

from __future__ import annotations

import json

import pytest

from src.models import ArticleBlock, DocumentUnit, ParsedDocument, TextRun, UnitType
from src.remissoes import (
    REVOGADO, RESOLVIDO, SUB_INEXISTENTE, detectar, mudancas_desde_ultimo_build,
)
from src.render_html import HTMLRenderer
from src.render_markdown import MarkdownRenderer

pytestmark = pytest.mark.unit

URL_RI = "https://app-plpconsulta-prd.azurewebsites.net/Forms/MostrarArquivo?ID=168&TipArq=1"


def _u(ut, ident, uid, *runs, old=False, revoked=False):
    runs = [r if isinstance(r, TextRun) else TextRun(r) for r in runs]
    return DocumentUnit(ut, ident, uid, runs=runs, is_old_version=old, is_revoked=revoked)


def _art(num, caput, children=(), law="Regimento Interno", prefix="", summary="", revoked=False):
    return ArticleBlock(art_number=num, caput=caput, children=list(children), law_name=law,
                        law_prefix=prefix, summary=summary, is_revoked=revoked)


def _doc():
    """Um RI e uma LOM mínimos."""
    a18 = _art("18", _u(UnitType.ARTIGO, "Art. 18", "art18", "Art. 18 - Compete ao Presidente:"), [
        _u(UnitType.INCISO, "VI", "art18VI", "VI - promulgar as leis nos casos previstos no ",
           TextRun("artigo 369", hyperlink_url=URL_RI, hyperlink_anchor="art369"), ";"),
        _u(UnitType.INCISO, "VII", "art18VII", "VII - observar o § 2º deste artigo e o artigo 162;"),
        _u(UnitType.PARAGRAFO_NUM, "§ 2º", "art18p2",
           "§ 2º - Aplica-se o disposto nos incisos III e IV do artigo 18 da Lei Orgânica."),
        _u(UnitType.PARAGRAFO_NUM, "§ 3º", "art18p3",
           "§ 3º - Ver o art. 4º da Emenda Constitucional nº 103 e o artigo 999."),
    ])
    a162 = _art("162", _u(UnitType.ARTIGO, "Art. 162", "art162",
                          TextRun("Art. 162 - Texto revogado.", strike=True), " (Revogado pela Resolução 1/2019)",
                          old=True, revoked=True), revoked=True)
    a369 = _art("369", _u(UnitType.ARTIGO, "Art. 369", "art369",
                          "Art. 369 - Se a lei não for promulgada, nos casos do artigo 368, o Presidente a promulgará."),
                summary="Promulgação pelo Presidente da Câmara")
    a368 = _art("368", _u(UnitType.ARTIGO, "Art. 368", "art368", "Art. 368 - Texto."))
    lom18 = _art("18", _u(UnitType.ARTIGO, "Art. 18", "art18", "Art. 18 - Perderá o mandato o Vereador:"), [
        _u(UnitType.INCISO, "III", "art18III", "III - que deixar de comparecer;"),
        _u(UnitType.INCISO, "IV", "art18IV", "IV - que perder os direitos políticos;"),
    ], law="Lei Orgânica", prefix="LOM", summary="Perda do mandato")
    return ParsedDocument(elements=[a18, a162, a368, a369, lom18])


def _by_trecho(res):
    return {r.trecho: r for r in res.remissoes}


class TestDeteccao:
    def test_artigo_simples_com_link(self):
        r = _by_trecho(detectar(_doc()))["artigo 369"]
        assert [(a.ref, a.status) for a in r.alvos] == [("369", RESOLVIDO)]
        assert r.exibivel and r.url == URL_RI + "#art369"

    def test_cruzada_com_incisos(self):
        r = _by_trecho(detectar(_doc()))["incisos III e IV do artigo 18 da Lei Orgânica"]
        assert r.classe == "cruzada"
        assert [a.ref for a in r.alvos] == ["LOM:18,III", "LOM:18,IV"]

    def test_mesmo_artigo(self):
        rel = [r for r in detectar(_doc()).remissoes if r.mesmo_artigo]
        assert [(r.trecho, [a.ref for a in r.alvos]) for r in rel] == [("§ 2º deste artigo", ["18,§ 2º"])]

    def test_do_colado_fica_fora_do_trecho(self):
        doc = _doc()
        doc.elements[0].children.append(_u(UnitType.PARAGRAFO_NUM, "§ 7º", "art18p7", "§ 7º - nos termos doartigo 369."))
        assert "artigo 369" in [r.trecho for r in detectar(doc).remissoes if r.origem.ref == "18,§ 7º"]

    def test_origem_revogada_nao_cita(self):
        doc = _doc()
        doc.elements[1].caput.runs = [TextRun("Art. 162 - Ver o artigo 369.", strike=True),
                                      TextRun(" (Revogado pela Resolução 1/2019)")]
        assert not [r for r in detectar(doc).remissoes if r.origem.art == "162"]

    def test_alvo_revogado(self):
        r = _by_trecho(detectar(_doc()))["artigo 162"]
        assert [(a.ref, a.status) for a in r.alvos] == [("162", REVOGADO)] and r.exibivel

    def test_externa_e_inexistente(self):
        res = detectar(_doc())
        by = _by_trecho(res)
        assert by["art. 4º da Emenda Constitucional nº 103"].classe == "externa"
        assert [a.status for a in by["artigo 999"].alvos] == ["artigo_inexistente"]
        assert any("artigo 999" in m for m, _ in res.avisos)

    def test_link_para_outra_norma_e_externa(self):
        """LOM DGT 26-31: 'art. 10' sem qualificador, mas o link aponta para a EC 103/2019."""
        doc = _doc()
        emc = "http://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc103.htm"
        doc.elements[0].children.append(_u(UnitType.PARAGRAFO_NUM, "§ 4º", "art18p4", "§ 4º - nos termos do ",
                                           TextRun("art. 10", hyperlink_url=emc, hyperlink_anchor="art10"), "."))
        assert _by_trecho(detectar(doc))["art. 10"].classe == "externa"

    def test_subdispositivo_inexistente(self):
        doc = _doc()
        doc.elements[0].children.append(_u(UnitType.PARAGRAFO_NUM, "§ 5º", "art18p5", "§ 5º - ver o § 9º do artigo 369."))
        r = _by_trecho(detectar(doc))["§ 9º do artigo 369"]
        assert [a.status for a in r.alvos] == [SUB_INEXISTENTE] and not r.exibivel


class TestExcecoes:
    def test_definir_e_ignorar(self):
        exc = {
            "definir": [{"origem": "18,VII", "trecho": "artigo 162", "alvos": ["368"]}],
            "ignorar": [{"origem": "18,VI", "trecho": "artigo 369"}],
        }
        res = detectar(_doc(), exc)
        by = _by_trecho(res)
        assert "artigo 369" not in by
        assert [a.ref for a in by["artigo 162"].alvos] == ["368"]

    def test_excecao_com_espacos_duplos_antes_do_trecho(self):
        doc = _doc()
        doc.elements[0].children.append(_u(UnitType.PARAGRAFO_NUM, "§ 6º", "art18p6",
                                           "§ 6º  -  Na forma do  parágrafo segundo do artigo anterior."))
        res = detectar(doc, {"definir": [{"origem": "18,§ 6º", "trecho": "parágrafo segundo do artigo anterior",
                                          "alvos": ["369"]}]})
        (r,) = [r for r in res.remissoes if r.origem.ref == "18,§ 6º"]
        assert r.trecho == "parágrafo segundo do artigo anterior"

    def test_excecao_que_nao_encontra_o_trecho_avisa(self):
        res = detectar(_doc(), {"ignorar": [{"origem": "18,VI", "trecho": "artigo 777"}]})
        assert any("não encontrado" in m for m, _ in res.avisos)


class TestRenderizacao:
    """As marcas valem por identidade do dispositivo: renderiza o mesmo documento detectado."""

    def _render(self, doc=None):
        doc = doc or _doc()
        res = detectar(doc)
        return doc, res, HTMLRenderer(res).render(doc)

    def test_gatilho_envolve_o_link_original_e_citado_em(self):
        _, _, html = self._render()
        assert ('<span class="rem rem-exp" tabindex="0" role="button" data-ref="369">'
                f'<a href="{URL_RI.replace("&", "&amp;")}#art369" target="_blank" rel="noopener" tabindex="-1">'
                'artigo 369</a></span>'
                in html)
        assert not _nested_anchors(html)
        assert 'class="rem-backlinks" data-label="Citado em:"' in html
        assert 'data-ref="18,VI" data-label="art. 18, VI"' in html

    def test_mesmo_artigo_nao_vira_gatilho_no_html(self):
        _, _, html = self._render()
        assert '§ 2º deste artigo e o <span class="rem rem-exp"' in html      # "§ 2º deste artigo" fica texto
        assert 'data-ref="162" data-rev="162">artigo 162</span>' in html       # e o 162 da mesma frase vira gatilho

    def test_pontuacao_cortada_do_link_fica_sem_link(self):
        """Link que cobre "artigo 369;": o ";" fora do gatilho não vira um link de um caractere."""
        doc = _doc()
        doc.elements[0].children[0] = _u(UnitType.INCISO, "VI", "art18VI", "VI - nos casos previstos no ",
                                         TextRun("artigo 369;", hyperlink_url=URL_RI, hyperlink_anchor="art369"))
        _, _, html = self._render(doc)
        assert '>artigo 369</a></span>;' in html

    def test_markdown_remete_a(self):
        doc = _doc()
        md = MarkdownRenderer(detectar(doc)).render_document(doc)
        assert "*(remete a: Art. 369 — Promulgação pelo Presidente da Câmara)*" in md
        assert "*(remete a: LOM art. 18, III e IV — Perda do mandato)*" in md
        assert "Art. 162 (revogado)" in md


def _nested_anchors(html_text: str) -> int:
    from html.parser import HTMLParser

    class P(HTMLParser):
        depth = nested = 0

        def handle_starttag(self, tag, attrs):
            if tag == "a":
                self.nested += self.depth > 0
                self.depth += 1

        def handle_endtag(self, tag):
            if tag == "a":
                self.depth -= 1

    p = P()
    p.feed(html_text)
    return p.nested


class TestMudancas:
    def test_compara_com_o_build_anterior(self, tmp_path):
        p = tmp_path / "remissoes.json"
        res = detectar(_doc())
        assert mudancas_desde_ultimo_build(res, p) == []          # primeiro build: só grava
        assert mudancas_desde_ultimo_build(res, p) == ["remissões iguais às do build anterior"]
        p.write_text(json.dumps(["RI art. 1: \"x\" → Art. 2"]), encoding="utf-8")
        out = mudancas_desde_ultimo_build(res, p)
        assert out[0].startswith("remissões desde o build anterior:") and any(x.startswith("- ") for x in out)
