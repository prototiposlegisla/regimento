"""Testes de integração: parseia DOCX real e valida invariantes."""

from __future__ import annotations

from collections import Counter

import pytest

from src.models import ArticleBlock, SectionHeading

pytestmark = pytest.mark.integration


# ── Contagens ───────────────────────────────────────────────────────────

class TestArticleCounts:
    def test_total_artigos_regulares(self, resolved_doc):
        """446 artigos regulares (Regimento + Lei Orgânica + CF)."""
        arts = [e for e in resolved_doc.elements if isinstance(e, ArticleBlock) and not e.is_adt]
        assert len(arts) == 446

    def test_artigos_por_lei(self, resolved_doc):
        """Distribuição por lei: RI=397, LO=45, CF=4."""
        arts = [e for e in resolved_doc.elements if isinstance(e, ArticleBlock) and not e.is_adt]
        by_law = Counter(a.law_name for a in arts)
        assert by_law["Regimento Interno"] == 397
        assert by_law["Lei Orgânica"] == 45
        assert by_law["Constituição Federal"] == 4

    def test_artigos_letrados(self, resolved_doc):
        """4 artigos letrados: 183-A, 212-A, 29-A, 55-A."""
        lettered = {
            e.art_number for e in resolved_doc.elements
            if isinstance(e, ArticleBlock) and not e.is_adt and "-" in e.art_number
        }
        for expected in ("183-A", "212-A", "29-A", "55-A"):
            assert expected in lettered, f"Art. {expected} ausente"
        assert len(lettered) == 4

    def test_artigos_adt(self, resolved_doc):
        """14 artigos ADT."""
        adts = [e for e in resolved_doc.elements if isinstance(e, ArticleBlock) and e.is_adt]
        assert len(adts) == 14

    def test_artigos_com_versoes(self, resolved_doc):
        """28 artigos com múltiplas versões históricas."""
        versioned = [
            e for e in resolved_doc.elements
            if isinstance(e, ArticleBlock) and len(e.all_versions) > 0
        ]
        assert len(versioned) == 28


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
        """~952 hyperlinks externos (tolerância 5%)."""
        count = 0
        for el in resolved_doc.elements:
            if not isinstance(el, ArticleBlock):
                continue
            for unit in _all_units(el):
                for run in unit.runs:
                    if run.hyperlink_url:
                        count += 1
        assert count == pytest.approx(952, rel=0.05), f"Hyperlinks externos: {count}"

    def test_anchors_internos(self, resolved_doc):
        """~275 âncoras internas (tolerância 5%)."""
        count = 0
        for el in resolved_doc.elements:
            if not isinstance(el, ArticleBlock):
                continue
            for unit in _all_units(el):
                for run in unit.runs:
                    if run.hyperlink_anchor:
                        count += 1
        assert count == pytest.approx(275, rel=0.05), f"Âncoras internas: {count}"


def _all_units(art: ArticleBlock):
    """Itera por todas as DocumentUnits de um ArticleBlock."""
    if art.caput:
        yield art.caput
    yield from art.children
    yield from art.all_versions
