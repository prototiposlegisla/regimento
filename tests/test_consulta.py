"""Testes unitários da consulta rápida (consulta-rapida.yaml → aba Referências e busca)."""

from __future__ import annotations

import pytest

from src.consulta import conferir, destaque, extenso, montar, para_o_site, parse_arts
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
        # a norma vale até a próxima
        assert parse_arts("LOM 48, 62 · RI 28") == [("LOM", "48", ""), ("LOM", "62", ""), ("RI", "28", "")]

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
        assert secoes[0]["items"][2]["terms"] == "afastamento"
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
