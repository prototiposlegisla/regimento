"""Testes unitários dos Precedentes Regimentais: leitura da seção do DOCX, remissões, site e índice."""

from __future__ import annotations

import pytest

from src.build_index import build_systematic_index
from src.models import PREC, ArticleBlock, DocumentUnit, ParsedDocument, SectionHeading, TextRun, UnitType, prec_label
from src.parse_docx import _build_document, _ClassifiedParagraph
from src.remissoes import RE_CIT_PREC, detectar
from src.render_html import HTMLRenderer
from src.render_markdown import MarkdownRenderer

pytestmark = pytest.mark.unit

SAGAL = "https://app-plpconsulta-prd.azurewebsites.net/Forms/MostrarArquivo?TIPO=PRG&NUMERO=2&ANO=2004&DOCUMENTO=Atualizado"


def _cp(text, unit_type=UnitType.OTHER, *, centered=False, runs=None, footnote_ids=(), identifier="",
        art_number="", strike=False):
    return _ClassifiedParagraph(
        unit_type=unit_type, identifier=identifier, text=text, runs=runs or [TextRun(text)],
        is_centered=centered, has_strike=strike, indent_left=0, bookmark_name="",
        art_number=art_number, footnote_ids=list(footnote_ids),
    )


def _secao():
    """RI com um artigo, depois a seção dos precedentes."""
    return [
        _cp("NORMA: Regimento Interno", UnitType.SUBTITLE, centered=True),
        _cp("Art. 13 - À Mesa compete:", UnitType.ARTIGO, identifier="Art. 13", art_number="13"),
        _cp("NORMA: Precedentes Regimentais", UnitType.SUBTITLE, centered=True),
        _cp("texto solto antes do primeiro título"),
        _cp("PRECEDENTE REGIMENTAL Nº 2/2004", UnitType.SUBTITLE, centered=True, footnote_ids=[7],
            runs=[TextRun("PRECEDENTE REGIMENTAL Nº 2/2004", bold=True, hyperlink_url=SAGAL)]),
        _cp("(Lido na 307ª Sessão Ordinária, de 07/04/04)"),
        _cp("CAPÍTULO I", UnitType.CAPITULO, centered=True),
        _cp("1 - As sessões extraordinárias...", UnitType.ITEM_NUM, identifier="1"),
        _cp("Parágrafo único. Texto.", UnitType.PARAGRAFO_UNICO, identifier="Parágrafo único"),
        _cp("Art. 5º - citado no texto", UnitType.ARTIGO, identifier="Art. 5º", art_number="5"),
        _cp("PRECEDENTE REGIMENTAL SEM NÚMERO, DE 1997", UnitType.SUBTITLE, centered=True),
        _cp("Encerramento da discussão."),
    ]


class TestLeitura:
    def test_cada_titulo_abre_um_precedente(self):
        doc = _build_document(_secao(), summaries_map={7: "Convocação de sessão extraordinária"})
        precs = [e for e in doc.elements if isinstance(e, ArticleBlock) and e.law_prefix == PREC]
        assert [p.art_number for p in precs] == ["2/2004", "0/1997"]
        p = precs[0]
        assert p.law_name == "Precedentes Regimentais"
        assert p.summary == "Convocação de sessão extraordinária"
        assert p.source_url == SAGAL
        assert p.caput.identifier == "Precedente Regimental nº 2/2004"
        assert p.caput.uid == "artPREC2-2004"
        assert precs[1].caput.identifier == "Precedente Regimental sem número, de 1997"

    def test_texto_corrido_sem_dispositivos_nem_titulos(self):
        """Itens, parágrafos, "CAPÍTULO I" e até "Art. 5º" do texto ficam como parágrafos do precedente."""
        doc = _build_document(_secao())
        p = next(e for e in doc.elements if isinstance(e, ArticleBlock) and e.art_number == "2/2004")
        assert [c.full_text for c in p.children] == [
            "(Lido na 307ª Sessão Ordinária, de 07/04/04)", "CAPÍTULO I", "1 - As sessões extraordinárias...",
            "Parágrafo único. Texto.", "Art. 5º - citado no texto"]
        assert {c.unit_type for c in p.children} == {UnitType.OTHER}
        assert [c.uid for c in p.children][:2] == ["artPREC2-2004_1", "artPREC2-2004_2"]
        # o RI segue normal; o texto antes do primeiro título é ignorado; nenhum título vira seção
        assert any(isinstance(e, ArticleBlock) and e.art_number == "13" and not e.law_prefix for e in doc.elements)
        assert [e.text for e in doc.elements if isinstance(e, SectionHeading)] == [
            "Regimento Interno", "Precedentes Regimentais"]

    @pytest.mark.parametrize("titulo, num", [
        ("PRECEDENTE REGIMENTAL Nº 1/2026", "1/2026"),
        ("Precedente Regimental nº 02/2020", "2/2020"),
        ("PRECEDENTE REGIMENTAL SEM NÚMERO, DE 1997", "0/1997"),
        # como nas publicações oficiais (consolidação do Regimento, SAGAL, Diário Oficial)
        ("PRECEDENTE REGIMENTAL nº 02/93", "2/1993"),
        ("PRECEDENTE REGIMENTAL  01/2026", "1/2026"),
        ("PRECEDENTE REGIMENTAL N.º 2/26", "2/2026"),
        ("PRECEDENTE REGIMENTAL Nº 3, DE 08 DE OUTUBRO DE 2021", "3/2021"),
        ("PRECEDENTE REGIMENTAL Nº 2, DE 2026", "2/2026"),
    ])
    def test_variantes_do_titulo(self, titulo, num):
        from src.parse_docx import RE_PRECEDENTE, prec_number
        assert prec_number(RE_PRECEDENTE.match(titulo)) == num

    def test_titulo_nao_reconhecido_e_numero_repetido_avisam(self):
        from src.resolve_amendments import structure_warnings
        secao = _secao() + [
            _cp("PRECEDENTE REGIMENTAL (sem número)", UnitType.SUBTITLE, centered=True),   # sem o ano
            _cp("PRECEDENTE REGIMENTAL Nº 02/2004", UnitType.SUBTITLE, centered=True),
        ]
        avisos = [m for m, _ in structure_warnings(_build_document(secao))]
        assert any("Título de precedente não reconhecido" in m and "(sem número)" in m for m in avisos)
        assert any("número repetido" in m for m in avisos)

    def test_prec_label(self):
        assert prec_label("2/2004") == "nº 2/2004"
        assert prec_label("0/1997") == "sem número, de 1997"


# ── remissões ─────────────────────────────────────────────────────────────

def _u(ut, ident, uid, *runs):
    return DocumentUnit(ut, ident, uid, runs=[r if isinstance(r, TextRun) else TextRun(r) for r in runs])


def _ri(num, text, children=(), adt=False, law="Regimento Interno", prefix=""):
    uid = f"art{'ADT' if adt else ''}{num}"
    return ArticleBlock(art_number=("ADT" if adt else "") + num, is_adt=adt, law_name=law, law_prefix=prefix,
                        caput=_u(UnitType.ARTIGO, f"Art. {num}", uid, f"Art. {num} - {text}"),
                        children=list(children))


def _prec(art, *paras, summary=""):
    uid = f"artPREC{art.replace('/', '-')}"
    return ArticleBlock(
        art_number=art, law_name="Precedentes Regimentais", law_prefix=PREC, summary=summary, source_url=SAGAL,
        caput=_u(UnitType.ARTIGO, f"Precedente Regimental {prec_label(art)}", uid, f"PRECEDENTE REGIMENTAL Nº {art}"),
        children=[_u(UnitType.OTHER, "", f"{uid}_{i}", t) for i, t in enumerate(paras, 1)])


def _doc():
    ri = [
        _ri("13", "À Mesa compete. (Vide Precedente Regimental nº 02/2004)"),
        _ri("16", "O Presidente representa a Câmara."),
        _ri("17", "Compete ao Presidente:", [
            _u(UnitType.INCISO, "I", "art17I", "I - quanto às sessões:"),
            _u(UnitType.ALINEA, "a)", "art17Ia", "a) convocá-las;"),
        ]),
        *[_ri(n, "Texto.") for n in ("157", "158", "159", "185", "183-A", "313")],
        _ri("4-D", "Texto do ADT.", adt=True),
        _ri("33", "Texto da LOM.", law="Lei Orgânica", prefix="LOM"),
    ]
    precs = [
        _prec("2/2004",
              "Decisão e interpretação, na forma do art. 313 do Regimento Interno.",
              "Dispositivos do regimentais indicados: Artigos 13; 16; 17, inciso I, letra 'a'; 157 a 159; e 185.",
              summary="Convocação de sessão extraordinária"),
        _prec("1/2020", "Dispositivos regimentais: Artigos 183-A e 4D do Ato das Disposições Transitórias.",
              "4 - Os atos, conforme previsto no artigo anterior, dar-se-ão...",
              "Determina que se publique o Precedente Regimental nº 01/2020."),
        _prec("2/2001", "EXPRESSAO INSCRITA NO ART. 33 DA LOM.", "Vide Precedente Regimental nº 9/2004."),
        _prec("1/2002", "Dispositivos regimentais indicados: artigo 17, § único; artigo 13."),
    ]
    return ParsedDocument(elements=ri + precs)


def _alvos(res, origem):
    return [[a.ref for a in r.alvos] for r in res.remissoes if r.origem.ref == origem and r.exibivel]


class TestCitacoes:
    @pytest.mark.parametrize("texto, n, ano", [
        ("Precedente Regimental nº 02/2004", "02", "2004"),
        ("Precedente Regimental nº 01 de 2015", "01", "2015"),
        ("Precedente Regimental 1 de 2001", "1", "2001"),
        ("Precedente Regimental nº 01 de 24 de março de 2020", "01", "2020"),
        ("Precedente Regimental nº 02, de 24 de junho de 2020", "02", "2020"),
        ("Precedente Regimental nº 02/19", "02", "19"),
        ("Precedente Regimental No 1/2001", "1", "2001"),
        ("Precedente Nº 01/15", "01", "15"),
        ("Precedente Regimental nº 1/ 15", "1", "15"),
    ])
    def test_variantes(self, texto, n, ano):
        m = RE_CIT_PREC.search(f"(Vide {texto})")
        assert m.group(0) == texto
        assert (m.group("n"), m.group("a1") or m.group("a2")) == (n, ano)

    def test_sem_numero_e_erro_de_digitacao(self):
        for t in ("Precedente Regimental sem número, de 1997", "Procedente Regimental sem número, de 1997"):
            assert RE_CIT_PREC.search(t).group("a3") == "1997"
        assert RE_CIT_PREC.search("constituem em precedente regimental, na forma do art. 313") is None

    def test_nota_vide_do_regimento_e_citado_em(self):
        res = detectar(_doc())
        assert _alvos(res, "13") == [["PREC:2/2004"]]
        cit = res.citado_em()
        assert [o.ref for o in cit[(PREC, "2/2004")]] == ["13"]
        assert "PREC:2/2004" in [o.ref for o in cit[("RI", "13")]]

    def test_lista_de_dispositivos_do_precedente(self):
        """No precedente o Regimento é a norma padrão; cada trecho entre ";" é uma citação."""
        res = detectar(_doc())
        assert _alvos(res, "PREC:2/2004") == [
            ["313"], ["13"], ["16"], ["17,I,a"], ["157", "158", "159"], ["185"]]

    def test_ato_das_disposicoes_transitorias_e_lom(self):
        res = detectar(_doc())
        assert _alvos(res, "PREC:1/2020") == [["183-A", "ADT4-D"]]
        assert _alvos(res, "PREC:2/2001") == [["LOM:33"]]

    def test_artigo_anterior_e_autocitacao_nao_viram_gatilho(self):
        res = detectar(_doc())
        trechos = [r.trecho for r in res.remissoes if r.origem.ref == "PREC:1/2020" and r.exibivel]
        assert all("anterior" not in t and "01/2020" not in t for t in trechos)

    def test_precedente_inexistente_avisa(self):
        res = detectar(_doc())
        assert any("precedente inexistente" in m and "Precedente nº 9/2004" in m for m, _ in res.avisos)

    def test_paragrafo_unico_com_simbolo(self):
        """"§ único" (só nos precedentes) é o parágrafo único."""
        doc = _doc()
        doc.elements[2].children.append(_u(UnitType.PARAGRAFO_UNICO, "Parágrafo único", "art17pu",
                                           "Parágrafo único - Texto."))
        assert _alvos(detectar(doc), "PREC:1/2002") == [["17,§ú"], ["13"]]

    def test_excecao_alcanca_a_citacao_dentro_da_nota(self):
        exc = {"ignorar": [{"origem": "13", "trecho": "Precedente Regimental nº 02/2004"}],
               "definir": [{"origem": "PREC:2/2004", "trecho": "art. 313", "alvos": ["16"]}]}
        res = detectar(_doc(), exc)
        assert not any("não encontrado" in m for m, _ in res.avisos)
        assert _alvos(res, "13") == []
        assert ["313"] not in _alvos(res, "PREC:2/2004")


class TestSite:
    def _html(self):
        doc = _doc()
        return HTMLRenderer(detectar(doc)).render(doc)

    def test_card_do_precedente(self):
        html = self._html()
        assert ('<div class="card card-artigo card-prec" data-art="2/2004" data-law="PREC" '
                f'data-src="{SAGAL.replace("&", "&amp;")}">') in html
        assert '<span class="art-compact-label">Precedente nº 2/2004</span>' in html
        assert '<p><span class="unit-id" data-uid="artPREC2-2004">Precedente Regimental nº 2/2004</span></p>' in html
        assert ('<p class="prec-para">Dispositivos do regimentais indicados: '
                '<span class="rem rem-exp" tabindex="0" role="button" data-ref="13">Artigos 13</span>;') in html
        assert 'data-ref="157;158;159">157 a 159</span>' in html

    def test_regimento_ganha_gatilho_e_linha_de_precedentes(self):
        html = self._html()
        assert ('(Vide <span class="rem rem-exp" tabindex="0" role="button" data-ref="PREC:2/2004">'
                'Precedente Regimental nº 02/2004</span>)') in html
        assert ('<div class="rem-backlinks rem-precs" data-label="Precedentes regimentais:">'
                '<span class="rem rem-back" tabindex="0" role="button" data-ref="PREC:2/2004" '
                'data-label="nº 2/2004"></span></div>') in html
        # e o precedente lista o artigo que o cita
        assert 'data-ref="13" data-label="art. 13"></span>' in html

    def test_redacao_alterada_por_outro_precedente(self):
        """Como no PLP: o item antigo tachado, o novo com a nota "(Redação dada pelo ...)" ligada
        ao precedente; o número do item liga as duas redações para a comparação."""
        doc = _doc()
        link = SAGAL.replace("NUMERO=2&ANO=2004", "NUMERO=1&ANO=2020")
        old = _u(UnitType.OTHER, "", "artPREC2-2004_9", TextRun("6) Texto antigo.", strike=True))
        old.is_old_version = True
        new = _u(UnitType.OTHER, "", "artPREC2-2004_10", "6) Texto novo. ",
                 TextRun("(Redação dada pelo Precedente Regimental nº 1/2020)", hyperlink_url=link))
        doc.elements[-4].children += [old, new]
        html = HTMLRenderer(detectar(doc)).render(doc)
        assert '<p class="old-version" data-item="6">6) Texto antigo.</p>' in html
        assert ('<p class="prec-para" data-item="6">6) Texto novo. (Redação dada pelo '
                '<span class="rem rem-exp" tabindex="0" role="button" data-ref="PREC:1/2020">'
                f'<a href="{link.replace("&", "&amp;")}" target="_blank" rel="noopener" tabindex="-1">'
                'Precedente Regimental nº 1/2020</a></span>)</p>') in html

    def test_markdown(self):
        doc = _doc()
        md = MarkdownRenderer(detectar(doc)).render_document(doc)
        assert "#### Precedente Regimental nº 2/2004 — Convocação de sessão extraordinária" in md
        assert "*(remete a: Precedente nº 2/2004 — Convocação de sessão extraordinária)*" in md
        assert f"*Texto oficial: {SAGAL}*" in md

    def test_markdown_sem_numero_inteiro(self):
        doc = _doc()
        doc.elements[0].caput.runs.append(TextRun(" (Vide Precedente Regimental sem número, de 1997)"))
        doc.elements.append(_prec("0/1997", "Texto.", summary="Encerramento da discussão"))
        md = MarkdownRenderer(detectar(doc)).render_document(doc)
        assert "Precedente sem número, de 1997 — Encerramento da discussão" in md


class TestIndice:
    def test_uma_folha_por_precedente(self):
        doc = _build_document(_secao(), summaries_map={7: "Convocação de sessão extraordinária"})
        idx = build_systematic_index(doc)
        node = next(n for n in idx if n["title"] == "Precedentes Regimentais")
        assert "art_range" not in node
        assert node["children"] == [
            {"label": "nº 2/2004 — Convocação de sessão extraordinária", "art": "2/2004", "law": "PREC"},
            {"label": "sem número, de 1997", "art": "0/1997", "law": "PREC"},
        ]


class TestValidate:
    def test_secao_de_precedentes_nao_e_conferida(self):
        from validate import run_checks
        paras = [{"text": t, "centered": c, "indent": 0} for t, c in [
            ("NORMA: Regimento Interno", True), ("Art.5 - sem ordinal", False),
            ("NORMA: Precedentes Regimentais", True), ("Art.6 - sem ordinal", False), ("§ texto", False),
        ]]
        assert [i["context"] for i in run_checks(paras)] == ["Art. 5"]
