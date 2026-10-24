"""Testes unitários do índice remissivo: leitura dos dispositivos e aba Propostas (src/parse_xlsx.py)."""

from __future__ import annotations

import pytest

from src.models import SubjectEntry, SubjectIndex, SubjectRef
from src.parse_xlsx import Proposta, _normalize_detail, _parse_dispositivos, aplicar_propostas

pytestmark = pytest.mark.unit


class TestDispositivos:
    @pytest.mark.parametrize("raw, esperado", [
        ("II", "II"),
        ("§1", "§ 1º"),
        ("§10", "§ 10º"),
        ("§ 3", "§ 3º"),
        ("§1-A", "§ 1º-A"),
        ("PU", "§ú"),
        ("§ú", "§ú"),
        ("p2", "§ 2º"),
        ("§1,III", "§ 1º,III"),
        ("PU,II", "§ú,II"),
        ("V,a,4", "V,a,4"),
        ("caput", "caput"),
    ])
    def test_detalhe_no_formato_do_data_path(self, raw, esperado):
        assert _normalize_detail(raw) == esperado

    def test_intervalo_so_com_letrados_da_mesma_norma(self):
        letrados = {"": {"40-A"}, "LOM": {"39-A", "40-B"}}
        refs = _parse_dispositivos("39-40", letrados)
        assert [r.art for r in refs] == ["39", "40", "40-A"]
        assert all(r.from_range for r in refs)
        refs = _parse_dispositivos("LOM:39-40", letrados)
        assert [r.art for r in refs] == ["39", "39-A", "40", "40-B"]

    def test_precedente(self):
        (r,) = _parse_dispositivos("PREC:2/2004")
        assert (r.law_prefix, r.art, r.detail) == ("PREC", "2/2004", "")


def _indice():
    return SubjectIndex(entries=[
        SubjectEntry("VETO", "", [SubjectRef("40")]),
        SubjectEntry("VETO", "Prazo", [SubjectRef("41"), SubjectRef("42", "§ 1º")]),
        SubjectEntry("VEREADORES", "Posse", [SubjectRef("3")], vides=["VETO|Prazo"]),
        SubjectEntry("VEREADOR", "Posse", [SubjectRef("15", law_prefix="LOM")]),
        SubjectEntry("VEREADOR", "Licença", [SubjectRef("16", law_prefix="LOM")]),
    ])


def _p(acao, assunto, sub="", disp="", para="", status="aprovado", id="P1"):
    return Proposta(id=id, acao=acao, assunto=assunto, subassunto=sub, dispositivo=disp, para=para,
                    status=status, linha=2)


def _refs(index, assunto, sub=""):
    return [(r.law_prefix, r.art, r.detail) for e in index.entries
            if e.subject == assunto and e.sub_subject == sub for r in e.refs]


class TestPropostas:
    def test_incluir_em_assunto_existente_e_novo(self):
        idx = _indice()
        n, n_prop, avisos = aplicar_propostas(idx, [
            _p("incluir", "VETO", "Prazo", "LOM:42,§1"),
            _p("incluir", "DESTAQUE", "", "250\n251,II"),
        ])
        assert (n, n_prop, avisos) == (2, 0, [])
        assert _refs(idx, "VETO", "Prazo")[-1] == ("LOM", "42", "§ 1º")
        assert _refs(idx, "DESTAQUE") == [("", "250", ""), ("", "251", "II")]

    def test_proposto_so_na_previa_e_com_o_id_na_dica(self):
        idx = _indice()
        aplicar_propostas(idx, [_p("incluir", "VETO", "", "43", status="proposto", id="P7")])
        assert _refs(idx, "VETO") == [("", "40", "")]
        idx = _indice()
        n, n_prop, _ = aplicar_propostas(idx, [_p("incluir", "VETO", "", "43", status="proposto", id="P7")],
                                         incluir_propostas=True)
        assert (n, n_prop) == (1, 1)
        nova = idx.entries[0].refs[-1]
        assert (nova.art, nova.proposta, nova.hint) == ("43", "P7", "proposta P7")

    def test_rejeitado_e_aplicado_nao_fazem_nada(self):
        idx = _indice()
        n, _, avisos = aplicar_propostas(idx, [_p("excluir", "VETO", "", "40", status="rejeitado"),
                                               _p("excluir", "VETO", "", "40", status="aplicado")])
        assert (n, avisos, _refs(idx, "VETO")) == (0, [], [("", "40", "")])

    def test_excluir_e_trocar(self):
        idx = _indice()
        n, _, avisos = aplicar_propostas(idx, [
            _p("excluir", "VETO", "Prazo", "41"),
            _p("trocar", "VETO", "Prazo", "42,§1", para="42,§2\n42,§3"),
        ])
        assert avisos == []
        assert _refs(idx, "VETO", "Prazo") == [("", "42", "§ 2º"), ("", "42", "§ 3º")]

    def test_excluir_o_que_nao_esta_avisa(self):
        idx = _indice()
        _, _, avisos = aplicar_propostas(idx, [_p("excluir", "VETO", "Prazo", "99"),
                                               _p("trocar", "NADA", "", "1", para="2")])
        assert [m for m, _ in avisos] == ["'99' não está em VETO > Prazo", "Assunto não encontrado: NADA"]

    def test_renomear_assunto_inteiro_funde_e_leva_os_vides(self):
        idx = _indice()
        _, _, avisos = aplicar_propostas(idx, [_p("renomear", "VEREADOR", para="VEREADORES"),
                                               _p("renomear", "VETO", "Prazo", para="VETO|Prazos")])
        assert avisos == []
        lista = {e["subject"]: e for e in idx.to_list()}
        assert "VEREADOR" not in lista
        filhos = {c["sub_subject"]: c for c in lista["VEREADORES"]["children"]}
        assert [r["art"] for r in filhos["Posse"]["refs"]] == ["3", "15"]
        assert "Licença" in filhos
        assert filhos["Posse"]["vides"] == ["VETO|Prazos"]

    def test_renomear_subassunto_para_um_que_ja_existe(self):
        idx = _indice()
        aplicar_propostas(idx, [_p("renomear", "VEREADOR", "Licença", para="VEREADOR|Posse")])
        assert _refs(idx, "VEREADOR", "Posse") == [("LOM", "15", ""), ("LOM", "16", "")]
        assert not any(e.sub_subject == "Licença" for e in idx.entries)

    def test_vide_e_excluir_vide(self):
        idx = _indice()
        _, _, avisos = aplicar_propostas(idx, [_p("vide", "VETO", "", para="SANÇÃO"),
                                               _p("excluir vide", "VEREADORES", "Posse", para="VETO|Prazo")])
        assert avisos == []
        assert idx.entries[0].vides == ["SANÇÃO"]
        assert idx.entries[2].vides == []

    def test_status_e_acao_desconhecidos(self):
        idx = _indice()
        _, _, avisos = aplicar_propostas(idx, [_p("incluir", "VETO", disp="1", status="talvez"),
                                               _p("mover", "VETO", disp="1")])
        assert [m.split(" (")[0] for m, _ in avisos] == ["Status desconhecido 'talvez'", "Ação desconhecida 'mover'"]


def test_referencia_repetida_aparece_uma_vez():
    idx = SubjectIndex(entries=[SubjectEntry("VOTO", "Nominal", [SubjectRef("34", "II"), SubjectRef("34", "§ 1º"),
                                                                 SubjectRef("34", "II")])])
    (item,) = idx.to_list()
    assert [r["detail"] for r in item["children"][0]["refs"]] == ["II", "§ 1º"]
