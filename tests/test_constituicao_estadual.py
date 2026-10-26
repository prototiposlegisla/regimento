"""Constituição Estadual (compilação da ALESP): formato do texto, remissões e rótulos."""

from __future__ import annotations

import pytest

from src.models import ArticleBlock, DocumentUnit, ParsedDocument, TextRun, UnitType
from src.parse_docx import _build_document, _classify_one, _is_revoked_text, note_tail_spans
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


class TestPosicaoDaCE:
    """A CE vem antes da CF no DOCX, mas os uids repetidos se desempatam na ordem de entrada
    das normas no site: mudar a CE de lugar não muda o uid (os marcadores salvos são por uid)."""

    def _uids(self, make_raw, ordem):
        secoes = {
            "CF": ["Art. 5º Todos são iguais perante a lei.", "§ 1º As normas têm aplicação imediata."],
            "CE": ["Artigo 5° - São Poderes do Estado.", "§1° - É vedado a qualquer dos Poderes delegar."],
        }
        nomes = {"CF": "Constituição Federal", "CE": "Constituição Estadual"}
        raw = []
        for sigla in ordem:
            raw.append(_classify_one(make_raw(f"NORMA: {nomes[sigla]}", is_centered=True)))
            raw += [_classify_one(make_raw(t)) for t in secoes[sigla]]
        doc = _build_document(raw)
        return {(e.law_name, c.identifier): c.uid for e in doc.elements if isinstance(e, ArticleBlock)
                for c in e.children}

    def test_uid_nao_depende_da_posicao(self, make_raw):
        assert self._uids(make_raw, ["CF", "CE"]) == self._uids(make_raw, ["CE", "CF"])
        assert self._uids(make_raw, ["CE", "CF"])[("Constituição Federal", "§ 1º")] == "art5p1"


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


# ── Correções da 4ª sessão do laboratório (o44, o45, o46, o50, o52) ─────

class TestCorrecoesDaCE:
    def test_declarado_inconstitucional_conta_como_revogado(self):
        """o45: o corpo do dispositivo é só a declaração da ALESP."""
        assert _is_revoked_text("§ 6º - Declarado inconstitucional, em controle concentrado, pelo Supremo Tribunal "
                                "Federal. (ADI n° 1021)")
        assert not _is_revoked_text("I - nas infrações penais comuns, o Vice-Governador (Expressão \"o Defensor "
                                    "Público-Geral\" declarada inconstitucional pelo STF)")

    def test_notas_tachadas_da_alesp_nao_tornam_antigo_o_texto_vigente(self):
        """o46: CE 126, com o histórico de liminar cassada tachado depois do texto em vigor."""
        from src.parse_docx import _is_predominantly_struck
        runs = [TextRun("Artigo 126 - O Regime Próprio de Previdência Social dos servidores terá caráter contributivo. "),
                TextRun("(Eficácia suspensa por força de liminar concedida na ADI 2044985-25.2020) (Liminar suspensa "
                        "por decisão proferida na SL 1305) (... extinguiu o processo sem resolução do mérito ...)",
                        strike=True)]
        assert _is_predominantly_struck(runs) is False

    def test_alinea_dentro_do_item_numerado(self):
        """o50: CE 9, § 5º — "1 - ... a) b) c)" e "2 - ..."; no RI, o item segue dentro da alínea."""
        from src.models import unit_path
        ctx = [""] * 4
        seq = [(UnitType.PARAGRAFO_NUM, "§ 5º"), (UnitType.ITEM_NUM, "1"), (UnitType.ALINEA, "a)"),
               (UnitType.ALINEA, "c)"), (UnitType.ITEM_NUM, "2")]
        paths = [unit_path(_u(t, i, "x", i), ctx) for t, i in seq]
        assert paths == ["§ 5º", "§ 5º,1", "§ 5º,1,a", "§ 5º,1,c", "§ 5º,2"]
        ctx = [""] * 4
        seq = [(UnitType.INCISO, "V"), (UnitType.ALINEA, "j)"), (UnitType.ITEM_NUM, "1")]
        assert [unit_path(_u(t, i, "x", i), ctx) for t, i in seq] == ["V", "V,j", "V,j,1"]

    def test_artigo_fora_da_pagina_nao_leva_os_outros_da_lista(self):
        """o44: "artigos 241 e 999 desta Constituição": o 241 continua com link."""
        doc = _doc()
        doc.elements[1].caput = _u(UnitType.ARTIGO, "Art. 115", "art115",
                                   "Artigo 115 - Observados os artigos 241 e 999 desta Constituição:")
        assert _alvos(detectar(doc), "CE:115") == ["CE:241"]

    def test_inciso_citado_dentro_do_paragrafo(self):
        """o52: "inciso II" num inciso do § 2º é o do § 2º; no próprio parágrafo, o do caput."""
        art = ArticleBlock(
            art_number="155", law_name="Constituição Federal", law_prefix="CF",
            caput=_u(UnitType.ARTIGO, "Art. 155", "art155", "Art. 155. Compete aos Estados instituir impostos sobre:"),
            children=[_u(UnitType.INCISO, "I", "art155I", "I - transmissão causa mortis;"),
                      _u(UnitType.INCISO, "II", "art155II", "II - circulação de mercadorias;"),
                      _u(UnitType.PARAGRAFO_NUM, "§ 2º", "art155p2", "§ 2º O imposto previsto no inciso II atenderá:"),
                      _u(UnitType.INCISO, "I", "art155p2I", "I - será não cumulativo;"),
                      _u(UnitType.INCISO, "II", "art155p2II", "II - a isenção, salvo o disposto no inciso I:")])
        res = detectar(ParsedDocument(elements=[art]))
        alvos = lambda o: [a.ref for r in res.remissoes if r.origem.ref == o for a in r.alvos]   # no mesmo artigo
        assert alvos("CF:155,§ 2º") == ["CF:155,II"]
        assert alvos("CF:155,§ 2º,II") == ["CF:155,§ 2º,I"]
