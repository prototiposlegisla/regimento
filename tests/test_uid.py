"""Testes unitários para _uid_suffix e _make_hierarchical_uid."""

from __future__ import annotations

import pytest

from src.models import UnitType
from src.parse_docx import _uid_suffix, _make_hierarchical_uid

pytestmark = pytest.mark.unit


# ── _uid_suffix ─────────────────────────────────────────────────────────

class TestUidSuffix:
    def test_paragrafo_unico(self, make_classified):
        cp = make_classified(UnitType.PARAGRAFO_UNICO, "Parágrafo único - Texto", identifier="Parágrafo único")
        assert _uid_suffix(cp) == "pu"

    def test_paragrafo_num(self, make_classified):
        cp = make_classified(UnitType.PARAGRAFO_NUM, "§ 3º - Texto", identifier="§ 3º")
        assert _uid_suffix(cp) == "p3"

    def test_inciso(self, make_classified):
        cp = make_classified(UnitType.INCISO, "IV - Texto", identifier="IV")
        assert _uid_suffix(cp) == "IV"

    def test_inciso_typo_l(self, make_classified):
        cp = make_classified(UnitType.INCISO, "lII - Texto", identifier="III")
        assert _uid_suffix(cp) == "III"

    def test_alinea(self, make_classified):
        cp = make_classified(UnitType.ALINEA, "b) texto", identifier="b)")
        assert _uid_suffix(cp) == "b"

    def test_sub_alinea(self, make_classified):
        cp = make_classified(UnitType.SUB_ALINEA, "2) texto", identifier="2)")
        assert _uid_suffix(cp) == "sub2"

    def test_item_num(self, make_classified):
        cp = make_classified(UnitType.ITEM_NUM, "5 - texto", identifier="5")
        assert _uid_suffix(cp) == "item5"

    def test_other_retorna_vazio(self, make_classified):
        cp = make_classified(UnitType.OTHER, "Texto qualquer", identifier="")
        assert _uid_suffix(cp) == ""


# ── _make_hierarchical_uid ──────────────────────────────────────────────

class TestMakeHierarchicalUid:
    def test_paragrafo_simples(self, make_classified):
        ctx = ["", "", "", ""]
        cp = make_classified(UnitType.PARAGRAFO_NUM, "§ 1º - Texto", identifier="§ 1º")
        uid = _make_hierarchical_uid("art43", cp, ctx)
        assert uid == "art43p1"
        assert ctx == ["p1", "", "", ""]

    def test_inciso_apos_paragrafo(self, make_classified):
        ctx = ["p1", "", "", ""]
        cp = make_classified(UnitType.INCISO, "II - Texto", identifier="II")
        uid = _make_hierarchical_uid("art43", cp, ctx)
        assert uid == "art43p1II"
        assert ctx == ["p1", "II", "", ""]

    def test_alinea_apos_inciso(self, make_classified):
        ctx = ["p1", "II", "", ""]
        cp = make_classified(UnitType.ALINEA, "a) texto", identifier="a)")
        uid = _make_hierarchical_uid("art43", cp, ctx)
        assert uid == "art43p1IIa"
        assert ctx == ["p1", "II", "a", ""]

    def test_sub_alinea_apos_alinea(self, make_classified):
        ctx = ["p1", "II", "a", ""]
        cp = make_classified(UnitType.SUB_ALINEA, "1) texto", identifier="1)")
        uid = _make_hierarchical_uid("art43", cp, ctx)
        assert uid == "art43p1IIasub1"
        assert ctx == ["p1", "II", "a", "sub1"]

    def test_inciso_reseta_alinea(self, make_classified):
        """Novo inciso reseta alínea e sub-alínea."""
        ctx = ["p1", "I", "c", "sub2"]
        cp = make_classified(UnitType.INCISO, "III - Texto", identifier="III")
        uid = _make_hierarchical_uid("art43", cp, ctx)
        assert uid == "art43p1III"
        assert ctx == ["p1", "III", "", ""]

    def test_paragrafo_reseta_tudo(self, make_classified):
        ctx = ["p1", "II", "a", "sub1"]
        cp = make_classified(UnitType.PARAGRAFO_NUM, "§ 2º - Texto", identifier="§ 2º")
        uid = _make_hierarchical_uid("art43", cp, ctx)
        assert uid == "art43p2"
        assert ctx == ["p2", "", "", ""]

    def test_paragrafo_unico(self, make_classified):
        ctx = ["", "", "", ""]
        cp = make_classified(UnitType.PARAGRAFO_UNICO, "Parágrafo único - Texto", identifier="Parágrafo único")
        uid = _make_hierarchical_uid("art10", cp, ctx)
        assert uid == "art10pu"

    def test_inciso_direto_sem_paragrafo(self, make_classified):
        """Inciso sem parágrafo precedente → art + inciso."""
        ctx = ["", "", "", ""]
        cp = make_classified(UnitType.INCISO, "I - Texto", identifier="I")
        uid = _make_hierarchical_uid("art5", cp, ctx)
        assert uid == "art5I"

    def test_item_num_nao_reseta_contexto(self, make_classified):
        """ITEM_NUM se concatena ao contexto sem resetar."""
        ctx = ["p1", "II", "a", ""]
        cp = make_classified(UnitType.ITEM_NUM, "3 - texto", identifier="3")
        uid = _make_hierarchical_uid("art43", cp, ctx)
        assert uid == "art43p1IIaitem3"
        # ctx não é modificado por ITEM_NUM
        assert ctx == ["p1", "II", "a", ""]

    def test_other_retorna_prefix(self, make_classified):
        ctx = ["p1", "", "", ""]
        cp = make_classified(UnitType.OTHER, "Texto qualquer", identifier="")
        uid = _make_hierarchical_uid("art43", cp, ctx)
        assert uid == "art43"

    def test_adt_prefix(self, make_classified):
        ctx = ["", "", "", ""]
        cp = make_classified(UnitType.PARAGRAFO_NUM, "§ 1º - Texto", identifier="§ 1º")
        uid = _make_hierarchical_uid("artADT4", cp, ctx)
        assert uid == "artADT4p1"
