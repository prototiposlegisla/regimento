"""Testes unitários: tachado, § com letra, notas de rodapé, links com âncora e remoção do identificador."""

from __future__ import annotations

import io
import zipfile

import pytest

from src.models import DocumentUnit, TextRun, UnitType
from src.parse_docx import (
    _classify_one, _is_predominantly_struck, _parse_footnotes_xml, _uid_suffix, note_tail_spans,
)
from src.render_html import HTMLRenderer
from src.render_markdown import MarkdownRenderer

pytestmark = pytest.mark.unit


# ── Tachado ─────────────────────────────────────────────────────────────

class TestTachado:
    def test_sem_tachado(self):
        assert _is_predominantly_struck([TextRun("I - texto vigente;")]) is False

    def test_maioria_tachada(self):
        runs = [TextRun("I"), TextRun(" - texto antigo do inciso;", strike=True)]
        assert _is_predominantly_struck(runs) is True

    def test_corpo_tachado_nota_longa_sem_tachado(self):
        """RI art. 47, XI: o texto é tachado, as notas (mais longas) não."""
        runs = [
            TextRun("XI - Da Comissão Extraordinária", strike=True),
            TextRun(": "),
            TextRun("(Redação dada pela Resolução 01 de 04 de novembro de 2001)"),
            TextRun(" "),
            TextRun("(Revogado pela Resolução nº 1 de 2007)"),
        ]
        assert _is_predominantly_struck(runs) is True

    def test_so_um_trecho_tachado_continua_vigente(self):
        """Inciso vigente com uma parte declarada inconstitucional (tachada)."""
        runs = [
            TextRun("IV — convocar os Secretários Municipais, os responsáveis pela administração direta e indireta "),
            TextRun("e os Conselheiros do Tribunal de Contas para prestar informações;", strike=True),
            TextRun(" (Vide Adin 11.754-0/6, que declarou inconstitucional parte deste inciso)"),
        ]
        assert _is_predominantly_struck(runs) is False


# ── § com letra ─────────────────────────────────────────────────────────

class TestParagrafoComLetra:
    def test_paragrafo_1_a(self, make_raw):
        cp = _classify_one(make_raw("§ 1º-A. O veto parcial somente abrangerá texto integral de artigo."))
        assert cp.unit_type == UnitType.PARAGRAFO_NUM
        assert cp.identifier == "§ 1º-A"
        assert _uid_suffix(cp) == "p1A"

    @pytest.mark.parametrize("text", [
        "§ 1º - A destituição automática de cargo da Mesa...",
        "§ 5º- A Comissão Processante terá prazo máximo...",
        "§ 1º- E vedada a concessão de títulos honoríficos...",
    ])
    def test_artigo_a_depois_do_separador_nao_eh_letra(self, make_raw, text):
        cp = _classify_one(make_raw(text))
        assert cp.identifier in ("§ 1º", "§ 5º")
        assert _uid_suffix(cp) in ("p1", "p5")


# ── Notas de rodapé ─────────────────────────────────────────────────────

def _footnotes_zip(*notes: tuple[int, list[str]]) -> zipfile.ZipFile:
    """ZIP em memória com word/footnotes.xml; cada nota = (id, [texto de cada parágrafo])."""
    w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = ""
    for fid, paras in notes:
        ps = "".join(
            f'<w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>'
            f'<w:r><w:t xml:space="preserve">{t}</w:t></w:r></w:p>'
            for t in paras
        )
        body += f'<w:footnote w:id="{fid}">{ps}</w:footnote>'
    xml = f'<?xml version="1.0" encoding="UTF-8"?><w:footnotes xmlns:w="{w}">{body}</w:footnotes>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/footnotes.xml", xml)
    buf.seek(0)
    return zipfile.ZipFile(buf)


def _text(paras) -> str:
    return " | ".join("".join(r.text for r in p.runs).strip() for p in paras)


class TestNotasDeRodape:
    NOTES = ((2, ["S Sede da Câmara"]), (3, ["Nota pública"]), (4, ["b Nota B sobre o art. 9º"]))

    def test_sintese_vira_summary(self):
        footnotes, summaries, _ = _parse_footnotes_xml(_footnotes_zip(*self.NOTES))
        assert summaries == {2: "Sede da Câmara"}
        assert 2 not in footnotes

    def test_versao_publica_exclui_nota_privada(self):
        footnotes, _, private = _parse_footnotes_xml(_footnotes_zip(*self.NOTES))
        assert set(footnotes) == {3}
        assert private == set()

    def test_versao_privada_tira_so_o_prefixo(self):
        """"b Nota B sobre..." → "Nota B sobre..." (o "B " do meio fica)."""
        footnotes, _, private = _parse_footnotes_xml(_footnotes_zip(*self.NOTES), include_private=True)
        assert private == {4}
        assert _text(footnotes[4]) == "Nota B sobre o art. 9º"

    def test_nota_privada_com_b_sozinho_no_primeiro_paragrafo(self):
        footnotes, _, private = _parse_footnotes_xml(
            _footnotes_zip((6, [" b", "Nota para o Regimento B."])), include_private=True)
        assert private == {6}
        assert _text(footnotes[6]).endswith("Nota para o Regimento B.")


# ── Links com âncora ────────────────────────────────────────────────────

class TestLinkComAncora:
    URL = "https://app-plpconsulta-prd.azurewebsites.net/Forms/MostrarArquivo?ID=168&TipArq=1"

    def test_ancora_de_artigo(self):
        assert TextRun("artigo 369", hyperlink_url=self.URL, hyperlink_anchor="art369").link_url == self.URL + "#art369"

    def test_ancora_com_simbolo_codificada_uma_vez(self):
        run = TextRun("§ 4º", hyperlink_url=self.URL, hyperlink_anchor="art40%C2%A74")
        assert run.link_url == self.URL + "#art40%C2%A74"

    @pytest.mark.parametrize("anchor,fragment", [
        ("seção IX", "#se%C3%A7%C3%A3o%20IX"),
        ("se%C3%A7%C3%A3o%20IX", "#se%C3%A7%C3%A3o%20IX"),  # já codificada: não codifica de novo
        ("ATO_DAS_DISPOSIÇÕES_TRANSITÓRIAS", "#ATO_DAS_DISPOSI%C3%87%C3%95ES_TRANSIT%C3%93RIAS"),
    ])
    def test_ancora_de_texto_livre(self, anchor, fragment):
        """A página do PLP também tem âncoras de texto livre (name="seção IX")."""
        assert TextRun("x", hyperlink_url=self.URL, hyperlink_anchor=anchor).link_url == self.URL + fragment

    def test_sem_url(self):
        assert TextRun("x", hyperlink_anchor="art369").link_url is None

    def test_html_usa_a_ancora(self):
        unit = DocumentUnit(UnitType.INCISO, "VI", "art18VI", runs=[
            TextRun("VI - nos casos previstos no "),
            TextRun("artigo 369", hyperlink_url=self.URL, hyperlink_anchor="art369"),
        ])
        html = HTMLRenderer()._render_runs_after_identifier(unit)
        assert 'href="' + self.URL.replace("&", "&amp;") + '#art369"' in html


# ── Identificador no início do texto ────────────────────────────────────

class TestIdentificador:
    def _unit(self, ident, text, ut=UnitType.ARTIGO):
        return DocumentUnit(ut, ident, "x", runs=[TextRun(text)])

    @pytest.mark.parametrize("ident,text,expected", [
        ("Art. 29", "\xa0\xa0Art.\xa029. O Município reger-se-á por lei orgânica", "O Município reger-se-á por lei orgânica"),
        ("Art. 62", "Art.62\xa0- As deliberações das Comissões", "As deliberações das Comissões"),
        ("I", "\xa0I - votação adiada;", "votação adiada;"),
        ("§ 1º-A", "§ 1º-A.\xa0O veto parcial", "O veto parcial"),
        ("§ 2º", "§ 2.º\xa0— A proposta será discutida", "A proposta será discutida"),
    ])
    def test_remove_identificador(self, ident, text, expected):
        unit = self._unit(ident, text)
        assert HTMLRenderer()._render_runs_after_identifier(unit).strip() == expected
        assert MarkdownRenderer()._render_runs_after_identifier(unit).strip() == expected.replace("\xa0", " ")


# ── Versão antiga: nota não se repete ───────────────────────────────────

class TestVersaoAntiga:
    NOTE = "(Revogado pela Emenda à Lei Orgânica nº 26 de 2005)"

    def _unit(self):
        return DocumentUnit(UnitType.ALINEA, "b)", "x", is_old_version=True, amendment_note=self.NOTE,
                            runs=[TextRun("b)"), TextRun(" permuta;", strike=True), TextRun(" " + self.NOTE)])

    def test_html_marca_a_nota_sem_repetir(self):
        html = HTMLRenderer()._render_old_version(self._unit(), is_child=True)
        assert html.count("Revogado pela") == 1
        assert f'<span class="amendment-note">{self.NOTE}</span>' in html

    def test_markdown_nao_repete_a_nota(self):
        md = MarkdownRenderer()._render_old_version(self._unit())
        assert md.count("Revogado pela") == 1


# ── Casos apontados na verificação ──────────────────────────────────────

class TestTachadoCasosDeBorda:
    def test_identificador_nao_conta_no_corpo(self):
        """"VIII - ~~multa;~~ (Revogado...)": só o identificador e a nota ficaram sem tachado."""
        runs = [TextRun("VIII - "), TextRun("multa;", strike=True),
                TextRun(" (Revogado pela Resolução nº 1 de 2007)")]
        assert _is_predominantly_struck(runs) is True

    def test_nota_de_adin_longa(self):
        runs = [TextRun("Art. 51 — "), TextRun("A Câmara Municipal exercerá a fiscalização.", strike=True),
                TextRun(" (Adin 11.754-0/6 - Tribunal de Justiça do Estado de São Paulo - trânsito em julgado)")]
        assert _is_predominantly_struck(runs) is True

    def test_vide_no_meio_do_texto_nao_eh_nota(self):
        runs = [TextRun("I - "), TextRun("os casos do artigo anterior", strike=True),
                TextRun(" (vide art. 5º), e ainda todos os demais casos previstos nesta lei;")]
        assert _is_predominantly_struck(runs) is False

    def test_cadeia_final_de_notas(self):
        text = "XI - Da Comissão: (Redação dada pela Res. 1 de 2001) (Revogado pela Res. nº 1 de 2007)."
        assert [text[s:e] for s, e in note_tail_spans(text)] == [
            "(Redação dada pela Res. 1 de 2001)", "(Revogado pela Res. nº 1 de 2007)"]
        assert note_tail_spans("I - os casos (vide art. 5º), e ainda os demais;") == []


class TestParagrafoComLetraNegativos:
    @pytest.mark.parametrize("text,ident", [
        ("§ 3º-O Presidente designará o relator.", "§ 3º"),
        ("§ 2º-A Mesa decidirá.", "§ 2º"),
        ("§ 1º-A - O veto parcial", "§ 1º-A"),
    ])
    def test_letra_so_no_formato_oficial(self, make_raw, text, ident):
        assert _classify_one(make_raw(text)).identifier == ident


class TestIdentificadorOrdinal:
    @pytest.mark.parametrize("ident,text,expected", [
        ("§ 10º", "§ 10\xa0- Poderá ser requerido", "Poderá ser requerido"),
        ("§ 1º", "§ 1°- Quando o projeto", "Quando o projeto"),
        ("§ 2º", "\xa0§ 2° - Ficará prejudicado", "Ficará prejudicado"),
        ("§ 1º", "§ 1\xa0o\xa0A Câmara Municipal não gastará", "A Câmara Municipal não gastará"),
        ("§ 11º", "§ 11 O registro completo será a ata", "O registro completo será a ata"),
    ])
    def test_variacoes_da_marca_ordinal(self, ident, text, expected):
        unit = DocumentUnit(UnitType.PARAGRAFO_NUM, ident, "x", runs=[TextRun(text)])
        assert HTMLRenderer()._render_runs_after_identifier(unit).strip() == expected
        assert MarkdownRenderer()._render_runs_after_identifier(unit).strip() == expected.replace("\xa0", " ")


class TestLinkAncoraDeInciso:
    def test_ancora_de_inciso(self):
        url = "https://www.planalto.gov.br/ccivil_03/constituicao/Emendas/Emc/emc16.htm"
        assert TextRun("x", hyperlink_url=url, hyperlink_anchor="art29ii").link_url == url + "#art29ii"


class TestVersaoAntigaIdentENotas:
    def test_data_ident_do_parser_e_todas_as_notas_marcadas(self):
        unit = DocumentUnit(
            UnitType.INCISO, "XI", "x", is_old_version=True,
            amendment_note="(Redação dada pela Resolução 01 de 2001)",
            runs=[TextRun("XI - Da Comissão Extraordinária:", strike=True),
                  TextRun(" (Redação dada pela Resolução 01 de 2001) (Revogado pela Resolução nº 1 de 2007)")])
        html = HTMLRenderer()._render_old_version(unit, is_child=True, path="XI")
        assert 'data-ident="XI"' in html and 'data-path="XI"' in html
        # a cadeia final de notas inteira num só span (sem separador tachado solto entre elas)
        assert ('<span class="amendment-note">(Redação dada pela Resolução 01 de 2001) '
                '(Revogado pela Resolução nº 1 de 2007)</span>') in html

    def test_nota_desconhecida_no_fim_nao_duplica(self):
        """RI 242: "(Renumerado ...) (Novamente designado ...)" — a nota não é repetida no fim."""
        note = "(Renumerado pela Resolução 3 de 20 de abril de 1995)"
        unit = DocumentUnit(UnitType.PARAGRAFO_UNICO, "Parágrafo único", "x", is_old_version=True,
                            amendment_note=note,
                            runs=[TextRun("Parágrafo único - Texto antigo. ", strike=True),
                                  TextRun(note + ' (Novamente designado "paragrafo único" pela Resolução nº 2 de 1999)')])
        html = HTMLRenderer()._render_old_version(unit, is_child=True)
        assert html.count("Renumerado pela") == 1

    def test_nota_privada_sem_quebra_de_linha_inicial(self):
        from src.models import Footnote, FootnotePara
        fn = Footnote(number=1, is_private=True,
                      paragraphs=[FootnotePara(runs=[]), FootnotePara(runs=[TextRun("Nota para o Regimento B.")])])
        assert "</strong> Nota para o Regimento B." in HTMLRenderer()._render_footnote(fn)
