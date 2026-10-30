"""Testes unitários da consulta rápida (consulta-rapida.yaml → aba Referências e busca)."""

from __future__ import annotations

import pytest

from src.consulta import conferir, destaque, extenso, montar, ordenar, ordenar_yaml, para_o_site, parse_arts
from src.models import ArticleBlock, DocumentUnit, ParsedDocument, TextRun, UnitType
from src.render_markdown import MarkdownRenderer

pytestmark = pytest.mark.unit


def _art(num, caput, *filhos, law="Regimento Interno"):
    c = DocumentUnit(UnitType.ARTIGO, f"Art. {num}", f"art{num}", [TextRun(caput)])
    children = [DocumentUnit(t, ident, f"art{num}{ident}", [TextRun(txt)]) for t, ident, txt in filhos]
    return ArticleBlock(art_number=num, caput=c, children=children, law_name=law)


def _doc():
    return ParsedDocument(elements=[
        _art("63", "Art. 63 - O prazo para parecer é de 15 (quinze) dias.",
             (UnitType.PARAGRAFO_NUM, "§ 4º", "§ 4º - A vista será concedida por 2 (dois) dias.")),
        _art("103", "Art. 103 - Dependem do voto favorável:",
             (UnitType.INCISO, "I", "I - da maioria absoluta dos membros da Câmara:"),
             (UnitType.ALINEA, "o)", "o) — rejeição de veto;")),
        _art("15", "Art. 15 - A licença será de quinze dias.", law="Lei Orgânica"),
    ])


class TestArtigos:
    def test_dispositivos_e_normas(self):
        assert parse_arts("103 I o · 368") == [("RI", "103", "I,o"), ("RI", "368", "")]
        assert parse_arts("63 §4º") == [("RI", "63", "§ 4º")]
        assert parse_arts("177 §ún") == [("RI", "177", "§ú")]
        # a norma vale entre vírgulas; depois de '·', volta ao RI
        assert parse_arts("LOM 48, 62 · RI 28") == [("LOM", "48", ""), ("LOM", "62", ""), ("RI", "28", "")]
        assert parse_arts("LOM 22 · 117") == [("LOM", "22", ""), ("RI", "117", "")]
        assert parse_arts("184 · PREC 2/2001") == [("RI", "184", ""), ("PREC", "2/2001", "")]

    def test_intervalos(self):
        assert parse_arts("10–11") == [("RI", "10", ""), ("RI", "11", "")]
        # de dispositivos, o primeiro
        assert parse_arts("38 §1º-§2º") == [("RI", "38", "§ 1º")]
        assert parse_arts("306 V g-h") == [("RI", "306", "V,g")]
        assert parse_arts("LOM 41 II-IV; RI 330: mín. 2") == [("LOM", "41", "II"), ("RI", "330", "")]

    def test_letrado_e_vazio(self):
        assert parse_arts("183-A §9º") == [("RI", "183-A", "§ 9º")]
        assert parse_arts("—") == []
        assert parse_arts("297/104 (revog.)") == [("RI", "297", ""), ("RI", "104", "")]


class TestDestaque:
    @pytest.mark.parametrize("valor, esperado", [
        ("15 d", ("15", "dias")),
        ("3 d úteis", ("3", "dias úteis")),
        ("48 h", ("48", "horas")),
        ("20 / 10 min", ("20 / 10", "min")),
        ("absoluta (28)", ("28", "absoluta")),
        ("admissão 3/5 (33) + perda 2/3 (37)", ("33 + 37", "admissão 3/5 + perda 2/3")),
        ("1h45", ("1h45", "")),
        ("quinzenal", ("quinzenal", "")),
        ("5% eleitorado", ("5%", "eleitorado")),
        ("maioria dos membros", ("maioria", "dos membros")),
        ("> 30 d", ("> 30", "dias")),
    ])
    def test_valor(self, valor, esperado):
        assert destaque(valor) == esperado

    def test_extenso(self):
        assert "quarenta e oito" in extenso(48)
        assert "cento e vinte" in extenso(120)
        assert "duas" in extenso(2) and "catorze" in extenso(14)


class TestMontarEConferir:
    DADOS = {
        "prazos": [
            {"prazo": "2 d", "evento": "Pedido de vista", "obs": "improrrogável", "art": "63 §4º"},
            {"prazo": "30 d", "evento": "Errado", "art": "63"},
            {"prazo": "15 d", "evento": "Licença", "art": "LOM 15", "termos": "afastamento"},
        ],
        "quorum_materia": [
            {"materia": "Rejeição de veto", "quorum": "absoluta (28)", "art": "103 I o"},
            {"materia": "Plano Diretor", "quorum": "especial 3/5 (33)", "art": "103 II b"},
        ],
        "aparte_cabe": ["Grande Expediente (160)"],
        "ritos": [{"titulo": "Veto", "passos": ["Prefeito veta", "Câmara aprecia"], "art": "368"}],
    }

    def test_secoes_do_site(self):
        secoes = para_o_site(montar(self.DADOS))
        assert [s["key"] for s in secoes] == ["prazos", "quorum_materia", "hipoteses", "ritos"]
        vista = secoes[0]["items"][0]
        assert (vista["v"], vista["u"], vista["label"], vista["obs"]) == ("2", "dias", "Pedido de vista", "improrrogável")
        assert vista["refs"] == [{"law": "RI", "art": "63", "label": "art. 63, § 4º", "path": "§ 4º"}]
        assert "_bruto" not in vista
        assert secoes[0]["items"][1]["terms"] == "afastamento"   # em ordem: 2 d, 15 d, 30 d
        aparte = secoes[2]["items"][0]
        assert aparte["list"][0]["text"] == "Grande Expediente" and aparte["list"][0]["art"] == "160"
        assert secoes[3]["items"][0]["steps"] == ["Prefeito veta", "Câmara aprecia"]

    def test_conferencia_com_o_texto(self):
        avisos: list = []
        conferir(montar(self.DADOS), _doc(), avisos)
        msgs = {(sev, msg, ctx.split(": ", 1)[1]) for sev, msg, ctx in avisos}
        # o número que não está no artigo
        assert ("aviso", "«30» não aparece no texto (art. 63)", "30 — Errado") in msgs
        # artigo inexistente (o 160 e o 368 não estão no documento de teste)
        assert ("erro", "art. 368 — artigo inexistente", "Veto") in msgs
        assert any(m == "art. 160 — artigo inexistente" for _, m, _ in msgs)
        # dispositivo inexistente e maioria que o texto não tem
        assert ("aviso", "art. 103, II, b — dispositivo inexistente", "33 — Plano Diretor") in msgs
        assert ("aviso", "«maioria especial» não aparece no texto (art. 103)", "33 — Plano Diretor") in msgs
        # o que confere não gera aviso: vista (2 dias no § 4º), veto (maioria absoluta), licença (por extenso)
        assert not any("Pedido de vista" in ctx or "Rejeição de veto" in ctx or "Licença" in ctx
                       for _, _, ctx in avisos)

    def test_markdown_para_o_chatbot(self):
        md = MarkdownRenderer().render_consulta(para_o_site(montar(self.DADOS)))
        assert "- **2 dias** — Pedido de vista (improrrogável) — art. 63, § 4º" in md
        assert "1. Prefeito veta" in md


class TestTemas:
    """A seção "temas": uma ficha por assunto, cada fato com o artigo entre parênteses no fim."""
    DADOS = {
        "temas": [{"titulo": "Vista", "termos": "pedido de vista",
                   "itens": ["2 dias, improrrogável (63 §4º)",
                             "3 dias (63 §4º)",
                             "1/3 (19) presente, na 1ª sessão (63 §4º)",
                             "2 dias ⚠ o 63 diz 15 (63 §4º)"]}],
        "prazos": [{"prazo": "15 d", "evento": "Parecer", "art": "63"}],
    }

    def test_vem_primeiro_com_o_artigo_de_cada_fato(self):
        secoes = para_o_site(montar(self.DADOS))
        assert [s["key"] for s in secoes] == ["temas", "prazos"]
        ficha = secoes[0]["items"][0]
        assert (ficha["label"], ficha["terms"]) == ("Vista", "pedido de vista")
        assert ficha["list"][0]["text"] == "2 dias, improrrogável" and ficha["list"][0]["art"] == "63 §4º"
        assert ficha["list"][0]["refs"] == [{"law": "RI", "art": "63", "label": "art. 63, § 4º", "path": "§ 4º"}]

    def test_conferencia_de_cada_fato(self):
        avisos: list = []
        conferir(montar(self.DADOS), _doc(), avisos)
        temas = [(msg, ctx) for _, msg, ctx in avisos if "Vista ›" in ctx]
        # o número que não está no artigo citado na linha
        assert [m for m, c in temas if c.endswith("3 dias")] == ["«3» não aparece no texto (63 §4º)"]
        # a conta sobre 55 ("(19)"), o ordinal ("1ª") e o que vem depois do ⚠ não se conferem; a fração sim
        assert [m for m, c in temas if "1/3" in c] == ["«1/3» não aparece no texto (63 §4º)"]
        assert not any("⚠" in c or c.endswith("improrrogável") for _, c in temas)


class TestTemasAvisos:
    def test_fato_sem_artigo_e_grupo_fora_de_sequencia(self):
        dados = {"temas": [{"titulo": "A", "grupo": "G1", "itens": ["sem artigo"]},
                           {"titulo": "B", "grupo": "G2", "itens": ["2 dias (63 §4º)"]},
                           {"titulo": "C", "grupo": "G1", "itens": ["2 dias (63 §4º)"]}]}
        avisos: list = []
        conferir(montar(dados), _doc(), avisos)
        msgs = [m for _, m, _ in avisos]
        assert "fato sem o artigo entre parênteses no fim" in msgs
        assert "grupo «G1» fora de sequência" in msgs


class TestOrdem:
    def _valores(self, key, campo, valores, arts=None):
        dados = {key: [{campo: v, "art": (arts or {}).get(v, "1")} for v in valores]}
        return [e[campo] for e in ordenar(dados)[key]]

    def test_prazos_do_mais_curto_ao_mais_longo(self):
        assert self._valores("prazos", "prazo", [
            "quinzenal", "5 sessões", "3 meses", "90 d", "> 30 d", "30 d úteis", "30 d", "2 d", "48 h", "15 min",
            "1º d útil", "1x/semana", "10 / 15 d", "2 d úteis / 30 d"]) == [
            "15 min", "48 h", "2 d", "2 d úteis / 30 d", "10 / 15 d", "30 d", "30 d úteis", "> 30 d", "90 d",
            "3 meses", "1º d útil", "5 sessões", "1x/semana", "quinzenal"]

    def test_tempos(self):
        assert self._valores("tempos", "t", ["4 h", "1h45", "1–4 h", "60 min", "5 / 10 min", "2 min"]) == [
            "2 min", "5 / 10 min", "60 min", "1–4 h", "1h45", "4 h"]

    def test_quoruns_e_subscricao(self):
        assert self._valores("quorum_materia", "quorum", [
            "maioria dos membros da Comissão", "qualificada 2/3 (37)", "absoluta (28)", "simples",
            "requerimento 1/3 (19)", "especial 3/5 (33)"]) == [
            "simples", "requerimento 1/3 (19)", "absoluta (28)", "especial 3/5 (33)", "qualificada 2/3 (37)",
            "maioria dos membros da Comissão"]
        assert self._valores("subscricao", "frac", [
            "5% eleitorado", "maioria membros", "2/3 (37)", "1% eleitorado", "1/10 (6)"]) == [
            "1/10 (6)", "2/3 (37)", "maioria membros", "1% eleitorado", "5% eleitorado"]

    def test_datas_pelo_calendario(self):
        assert self._valores("datas", "d", [
            "dia 20", "31 dez", "ter · qua · qui, 15h", "15 abr", "1º jan, 15h", "jan · jul", "30 d/bimestre",
            "1ª ter do mês", "1º fev–30 jun · 1º ago–15 dez"]) == [
            "jan · jul", "1º jan, 15h", "1º fev–30 jun · 1º ago–15 dez", "15 abr", "31 dez",
            "ter · qua · qui, 15h", "1ª ter do mês", "dia 20", "30 d/bimestre"]

    def test_empate_e_numeros_pelo_artigo(self):
        arts = {"a": "LOM 12", "b": "103 I o", "c": "103 I a-f", "d": "PREC 2/2001", "e": "63 §4º", "f": "63"}
        assert self._valores("numeros", "valor", list("abcdef"), arts) == list("fecbad")
        assert self._valores("prazos", "prazo", ["15 d", "15 d "], {"15 d": "LOM 1", "15 d ": "RI 2"}) == ["15 d ", "15 d"]

    def test_yaml_reordenado_linha_a_linha(self):
        texto = ("# cabeçalho\ntitulo: x\nprazos:\n  - {prazo: \"30 d\", evento: \"B\", art: \"2\"}\n"
                 "  - {prazo: \"2 d\", evento: \"A\",\n     art: \"1\"}\n\ntempos:\n  - {t: \"5 min\", art: \"1\"}\n")
        novo = ordenar_yaml(texto)
        assert novo == ("# cabeçalho\ntitulo: x\nprazos:\n  - {prazo: \"2 d\", evento: \"A\",\n     art: \"1\"}\n"
                        "  - {prazo: \"30 d\", evento: \"B\", art: \"2\"}\n\ntempos:\n  - {t: \"5 min\", art: \"1\"}\n")
        assert ordenar_yaml(novo) == novo
        with pytest.raises(ValueError):
            ordenar_yaml("prazos:\n  - {prazo: \"3 d\"}\n  # nota\n  - {prazo: \"2 d\"}\n")

    def test_site_sai_em_ordem(self):
        secoes = montar({"prazos": [{"prazo": "15 d", "evento": "X", "art": "63"},
                                    {"prazo": "2 d", "evento": "Y", "art": "63 §4º"}]})
        assert [i["label"] for i in secoes[0]["items"]] == ["Y", "X"]
