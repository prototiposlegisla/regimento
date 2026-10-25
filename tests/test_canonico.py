"""Testes unitários do texto canônico para os outros projetos (src/canonico.py)."""

from __future__ import annotations

import json

import pytest

from src.canonico import _linhas_jsonl
from src.models import ArticleBlock, DocumentUnit, ParsedDocument, SectionHeading, TextRun, UnitType
from src.render_markdown import MarkdownRenderer

pytestmark = pytest.mark.unit

URL = "https://app-plpconsulta-prd.azurewebsites.net/Forms/MostrarArquivo?ID=168&TipArq=1"


def _doc():
    ri = SectionHeading(UnitType.TITULO, "Regimento Interno", data_section="norma1")
    tit = SectionHeading(UnitType.TITULO, "TÍTULO I", "DA CÂMARA", data_section="tit1")
    caput = DocumentUnit(UnitType.ARTIGO, "Art. 68", "art68",
                         [TextRun("Art. 68 - As Comissões pedem informações.")])
    p1 = DocumentUnit(UnitType.PARAGRAFO_NUM, "§ 1º", "art68p1",
                      [TextRun("§ 1º - Suspende os prazos do "), TextRun("artigo 63", hyperlink_url=URL),
                       TextRun(".")])
    inc = DocumentUnit(UnitType.INCISO, "I", "art68p1I", [TextRun("I - inciso revogado.")], is_revoked=True)
    a68 = ArticleBlock(art_number="68", caput=caput, children=[p1, inc], summary="Pedido de informações",
                       law_name="Regimento Interno")
    adt = ArticleBlock(art_number="ADT1", is_adt=True, law_name="Regimento Interno",
                       caput=DocumentUnit(UnitType.ARTIGO, "Art. 1º", "adt1", [TextRun("Art. 1º - Transição.")]))
    lom = SectionHeading(UnitType.TITULO, "Lei Orgânica", data_section="norma2")
    a41 = ArticleBlock(art_number="41", law_name="Lei Orgânica",
                       caput=DocumentUnit(UnitType.ARTIGO, "Art. 41", "lom41", [TextRun("Art. 41 - Audiências.")]))
    return ParsedDocument(elements=[ri, tit, a68, adt, lom, a41])


class TestMarkdownCanonico:
    def test_uma_norma_por_texto(self):
        normas = MarkdownRenderer(canonico=True).render_normas(_doc())
        assert list(normas) == ["Regimento Interno", "Lei Orgânica"]
        assert "#### Art. 41" in normas["Lei Orgânica"] and "#### Art. 41" not in normas["Regimento Interno"]

    def test_sem_links_com_revogado_e_adt(self):
        ri = MarkdownRenderer(canonico=True).render_normas(_doc())["Regimento Interno"]
        assert "**§ 1º** — Suspende os prazos do artigo 63." in ri and "](" not in ri
        assert "**I** — inciso revogado. *(revogado)*" in ri
        assert "#### Art. 1 (ADT)" in ri

    def test_chatbot_mantem_links(self):
        md = MarkdownRenderer().render_document(_doc())
        assert f"[artigo 63]({URL})" in md and "(revogado)*" not in md and "#### Art. ADT1" in md


class TestJsonl:
    def test_um_artigo_por_linha(self):
        regs = [json.loads(l) for l in _linhas_jsonl(_doc())]
        assert [(r["norma"], r["art"]) for r in regs] == [("RI", "68"), ("RI", "1"), ("LOM", "41")]
        a68 = regs[0]
        assert a68["titulo"] == "Pedido de informações" and a68["secao"] == ["TÍTULO I — DA CÂMARA"]
        assert [d["caminho"] for d in a68["dispositivos"]] == ["", "§ 1º", "§ 1º,I"]
        assert a68["dispositivos"][2]["revogado"] is True and "revogado" not in a68["dispositivos"][1]
        assert regs[1]["adt"] is True and regs[2]["secao"] == []
