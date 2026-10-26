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


def test_vide_em_cadeia_aponta_direto_para_o_destino():
    from src.parse_xlsx import resolver_vides_em_cadeia
    idx = SubjectIndex(entries=[
        SubjectEntry("HOMENAGEM", "", [], vides=["HONRARIA"]),
        SubjectEntry("HONRARIA", "", [], vides=["TÍTULOS HONORÍFICOS"]),
        SubjectEntry("TÍTULOS HONORÍFICOS", "Concessão", [SubjectRef("347")]),
        SubjectEntry("PRÊMIOS", "Concessão", [SubjectRef("47", "VI,a,6")], vides=["HONRARIA", "TÍTULOS HONORÍFICOS"]),
    ])
    assert resolver_vides_em_cadeia(idx) == 2
    assert idx.entries[0].vides == ["TÍTULOS HONORÍFICOS"]
    assert idx.entries[3].vides == ["TÍTULOS HONORÍFICOS"]


def test_vide_mostra_o_nome_como_esta_no_destino():
    from src.parse_xlsx import vides_com_nome_exato
    idx = SubjectIndex(entries=[
        SubjectEntry("SERVIDOR PÚBLICO", "Vantagens", [SubjectRef("LOM:92")]),
        SubjectEntry("GRATIFICAÇÃO", "", [], vides=["servidor publico|vantagens", "SERVIDOR PÚBLICO",
                                                     "ASSUNTO QUE NÃO EXISTE|x"]),
    ])
    assert vides_com_nome_exato(idx) == 1
    assert idx.entries[1].vides == ["SERVIDOR PÚBLICO|Vantagens", "SERVIDOR PÚBLICO", "ASSUNTO QUE NÃO EXISTE|x"]


def test_espelhos_pares_com_assunto_e_subassunto_trocados():
    from src.parse_xlsx import espelhos
    idx = SubjectIndex(entries=[
        SubjectEntry("LEI", "Promulgação", [SubjectRef("360")]),
        SubjectEntry("PROMULGAÇÃO", "De Lei", [SubjectRef("360"), SubjectRef("42", law_prefix="LOM")]),
        SubjectEntry("COMISSÕES PERMANENTES", "Pareceres", [SubjectRef("63")]),
        SubjectEntry("PARECER", "De Comissão Permanente", [SubjectRef("63")]),
        # o mesmo assunto visto por um tema, não o espelho
        SubjectEntry("TRÂNSITO", "Parecer da Comissão de Trânsito", [SubjectRef("47", "V,a,6")]),
        SubjectEntry("PARECER", "Da Comissão de Trânsito", [SubjectRef("47", "V")]),
    ])
    pares = {frozenset(m["nome"] for m in par): par for par in espelhos(idx)}
    assert set(pares) == {frozenset({"LEI — Promulgação", "PROMULGAÇÃO — De Lei"}),
                          frozenset({"COMISSÕES PERMANENTES — Pareceres", "PARECER — De Comissão Permanente"})}
    lei = {m["nome"]: m["refs"] for m in pares[frozenset({"LEI — Promulgação", "PROMULGAÇÃO — De Lei"})]}
    assert lei["PROMULGAÇÃO — De Lei"] - lei["LEI — Promulgação"] == {("LOM", "42", "")}


def test_espelho_que_remete_ao_outro_lado_nao_conta():
    from src.parse_xlsx import espelhos
    idx = SubjectIndex(entries=[
        SubjectEntry("PROPOSIÇÕES", "Publicação", [], vides=["PUBLICAÇÃO|De proposições"]),
        SubjectEntry("PUBLICAÇÃO", "De proposições", [SubjectRef("216")]),
    ])
    assert espelhos(idx) == []


def _arts(*arts):
    return [SubjectRef(a) for a in arts]


def test_duplicatas_mesmo_tema_em_duas_casas():
    from src.parse_xlsx import duplicatas
    idx = SubjectIndex(entries=[
        # nome contido e 4 de 5: o mesmo tema arquivado sob a sessão em geral
        SubjectEntry("SESSÃO DA CÂMARA", "Extraordinária", _arts("183", "184", "185", "186", "187")),
        SubjectEntry("SESSÃO EXTRAORDINÁRIA", "", _arts("183", "184", "185", "186", "188", "189")),
        # mesma lista, nomes sem relação
        SubjectEntry("ORDEM DO DIA", "Organização", _arts("171", "172", "173")),
        SubjectEntry("PAUTA", "Elaboração", _arts("171", "172", "173")),
        # parecidas, mas o nome de uma não cabe no da outra
        SubjectEntry("VOTAÇÃO", "Secreta", _arts("293", "294", "295", "296")),
        SubjectEntry("VOTO", "Secreto", _arts("293", "294", "295", "297")),
        # o espelho tem a sua conferência
        SubjectEntry("LEI", "Promulgação", _arts("360", "361", "362")),
        SubjectEntry("PROMULGAÇÃO", "De Lei", _arts("360", "361", "362")),
        # com menos de 3 dispositivos, não conta
        SubjectEntry("A", "X", _arts("1", "2")),
        SubjectEntry("B", "X", _arts("1", "2")),
    ])
    achadas = {(a["nome"], b["nome"], c) for a, b, c in duplicatas(idx)}
    assert achadas == {("SESSÃO DA CÂMARA — Extraordinária", "SESSÃO EXTRAORDINÁRIA", 4),
                       ("ORDEM DO DIA — Organização", "PAUTA — Elaboração", 3)}
    assert {(a["nome"], b["nome"]) for a, b, _ in duplicatas(idx, [["PAUTA — Elaboração", "ordem do dia — organização"]])} \
        == {("SESSÃO DA CÂMARA — Extraordinária", "SESSÃO EXTRAORDINÁRIA")}


def test_espelhos_declarados_e_excecoes(tmp_path):
    from src.parse_xlsx import carregar_excecoes_indice, espelhos_declarados
    arq = tmp_path / "indice_excecoes.toml"
    arq.write_text('[[espelho]]\nentradas = ["AUDIÊNCIA PÚBLICA — Convocação", "COMISSÕES PERMANENTES — Audiências", '
                   '"NÃO EXISTE"]\nmotivo = "x"\n\n[[distintos]]\nentradas = ["SÓ UMA"]\n', encoding="utf-8")
    exc = carregar_excecoes_indice(arq)
    assert exc["distintos"] == []                  # grupo de uma entrada só não vale
    assert carregar_excecoes_indice(tmp_path / "nao.toml") == {"espelho": [], "distintos": []}
    idx = SubjectIndex(entries=[SubjectEntry("AUDIÊNCIA PÚBLICA", "Convocação", _arts("86")),
                                SubjectEntry("COMISSÕES PERMANENTES", "Audiências", _arts("86", "87"))])
    (par,) = espelhos_declarados(idx, [g["entradas"] for g in exc["espelho"]])
    assert par[1]["refs"] - par[0]["refs"] == {("", "87", "")}
