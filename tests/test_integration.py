"""Testes de integração: parseia DOCX real e valida invariantes."""

from __future__ import annotations

from collections import Counter

import pytest

from src.models import ArticleBlock, SectionHeading

pytestmark = pytest.mark.integration


# ── Contagens ───────────────────────────────────────────────────────────

class TestArticleCounts:
    def test_total_artigos_regulares(self, resolved_doc):
        """645 artigos regulares (Regimento + Lei Orgânica + CF)."""
        arts = [e for e in resolved_doc.elements if isinstance(e, ArticleBlock) and not e.is_adt]
        assert len(arts) == 645

    def test_artigos_por_lei(self, resolved_doc):
        """Distribuição por lei: RI=397, LO=244, CF=4."""
        arts = [e for e in resolved_doc.elements if isinstance(e, ArticleBlock) and not e.is_adt]
        by_law = Counter(a.law_name for a in arts)
        assert by_law["Regimento Interno"] == 397
        assert by_law["Lei Orgânica"] == 244
        assert by_law["Constituição Federal"] == 4

    def test_artigos_letrados(self, resolved_doc):
        """9 artigos letrados: RI 183-A e 212-A; LOM 55-A, 69-A, 101-A, 149-A, 229-A e 229-B; CF 29-A."""
        lettered = {
            (e.law_name, e.art_number) for e in resolved_doc.elements
            if isinstance(e, ArticleBlock) and not e.is_adt and "-" in e.art_number
        }
        expected = {("Regimento Interno", n) for n in ("183-A", "212-A")}
        expected |= {("Lei Orgânica", n) for n in ("55-A", "69-A", "101-A", "149-A", "229-A", "229-B")}
        expected |= {("Constituição Federal", "29-A")}
        assert lettered == expected

    def test_artigos_adt(self, resolved_doc):
        """53 artigos de disposições transitórias: 14 do ADT do RI e 39 das DGT da LOM."""
        adts = [e for e in resolved_doc.elements if isinstance(e, ArticleBlock) and e.is_adt]
        assert Counter(a.law_name for a in adts) == {"Regimento Interno": 14, "Lei Orgânica": 39}

    def test_artigos_com_versoes(self, resolved_doc):
        """50 artigos com múltiplas versões do caput."""
        versioned = [
            e for e in resolved_doc.elements
            if isinstance(e, ArticleBlock) and len(e.all_versions) > 0
        ]
        assert len(versioned) == 50


# ── Dispositivos conferidos na Fase 0 ───────────────────────────────────

def _art(doc, law, number):
    return next(e for e in doc.elements
                if isinstance(e, ArticleBlock) and e.law_name == law and e.art_number == number)


def _vigentes(art, ident):
    return [c for c in art.children if c.identifier == ident and not c.is_old_version]


class TestDispositivosConferidos:
    def test_ri_47_primeiro_xi_revogado(self, resolved_doc):
        """O XI da Comissão da Criança e do Adolescente (revogado) está tachado; só um XI vigente."""
        xis = _vigentes(_art(resolved_doc, "Regimento Interno", "47"), "XI")
        assert len(xis) == 1 and "Meio Ambiente" in xis[0].full_text

    def test_ri_283_um_inciso_iv(self, resolved_doc):
        """O 2º IV (cópia do art. 284, IV, revogado, colada por erro no PLP) foi suprimido."""
        (iv,) = _vigentes(_art(resolved_doc, "Regimento Interno", "283"), "IV")
        assert "Pequeno Expediente" in iv.full_text

    def test_lom_42_paragrafo_1_e_1a(self, resolved_doc):
        art = _art(resolved_doc, "Lei Orgânica", "42")
        assert len(_vigentes(art, "§ 1º")) == 1
        (p1a,) = _vigentes(art, "§ 1º-A")
        assert p1a.uid == "art42p1A"

    def test_lom_88_redacao_da_elo_36_vigente(self, resolved_doc):
        """A redação da ELO 39/2015 foi anulada por ADIN (tachada); vale a da ELO 36/2013."""
        art = _art(resolved_doc, "Lei Orgânica", "88")
        for ident in ("§ 1º", "I", "II"):
            (vig,) = _vigentes(art, ident)
            assert "39" not in vig.amendment_note
        assert all("pelo menos" in c.full_text for c in _vigentes(art, "I") + _vigentes(art, "II"))

    def test_lom_35_incisos_revogados(self, resolved_doc):
        art = _art(resolved_doc, "Lei Orgânica", "35")
        assert not _vigentes(art, "I") and not _vigentes(art, "II")

    def test_lom_51_revogado(self, resolved_doc):
        assert _art(resolved_doc, "Lei Orgânica", "51").is_revoked


# ── Integridade estrutural ──────────────────────────────────────────────

class TestStructuralIntegrity:
    def test_todo_artigo_tem_caput(self, resolved_doc):
        for el in resolved_doc.elements:
            if isinstance(el, ArticleBlock):
                assert el.caput is not None, f"Art. {el.art_number} sem caput"

    def test_uids_unicos_por_lei(self, resolved_doc):
        """UIDs (caput + children) são únicos dentro de cada law_name."""
        by_law: dict[str, set[str]] = {}
        for el in resolved_doc.elements:
            if not isinstance(el, ArticleBlock):
                continue
            law = el.law_name
            seen = by_law.setdefault(law, set())
            if el.caput:
                uid = el.caput.uid
                assert uid not in seen, f"UID duplicado em '{law}': {uid}"
                seen.add(uid)
            for child in el.children:
                uid = child.uid
                assert uid not in seen, f"UID duplicado em '{law}': {uid}"
                seen.add(uid)

    def test_art_numbers_unicos_por_lei(self, resolved_doc):
        """Cada art_number aparece uma só vez dentro de cada law_name."""
        by_law: dict[str, list[str]] = {}
        for e in resolved_doc.elements:
            if isinstance(e, ArticleBlock):
                by_law.setdefault(e.law_name, []).append(e.art_number)
        for law, nums in by_law.items():
            assert len(nums) == len(set(nums)), (
                f"art_numbers duplicados em '{law}': "
                f"{[n for n in nums if nums.count(n) > 1]}"
            )

    def test_adt_tem_prefixo(self, resolved_doc):
        for el in resolved_doc.elements:
            if isinstance(el, ArticleBlock) and el.is_adt:
                assert el.art_number.startswith("ADT"), f"ADT sem prefixo: {el.art_number}"


# ── Serialização ────────────────────────────────────────────────────────

class TestSerialization:
    def test_to_dict_sem_erro(self, resolved_doc):
        d = resolved_doc.to_dict()
        assert "elements" in d
        assert len(d["elements"]) > 0


# ── Hyperlinks (tolerância ±5%) ─────────────────────────────────────────

class TestHyperlinks:
    def test_hyperlinks_externos(self, resolved_doc):
        """~1436 hyperlinks externos (tolerância 5%)."""
        count = 0
        for el in resolved_doc.elements:
            if not isinstance(el, ArticleBlock):
                continue
            for unit in _all_units(el):
                for run in unit.runs:
                    if run.hyperlink_url:
                        count += 1
        assert count == pytest.approx(1436, rel=0.05), f"Hyperlinks externos: {count}"

    def test_anchors_internos(self, resolved_doc):
        """~526 links com âncora (#art369 etc.; tolerância 5%)."""
        count = 0
        for el in resolved_doc.elements:
            if not isinstance(el, ArticleBlock):
                continue
            for unit in _all_units(el):
                for run in unit.runs:
                    if run.hyperlink_anchor:
                        count += 1
        assert count == pytest.approx(526, rel=0.05), f"Âncoras internas: {count}"


def _all_units(art: ArticleBlock):
    """Itera por todas as DocumentUnits de um ArticleBlock."""
    if art.caput:
        yield art.caput
    yield from art.children
    yield from art.all_versions
