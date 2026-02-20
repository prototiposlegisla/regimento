"""Testes unitários para _extract_amendment_note e _is_revoked_text."""

from __future__ import annotations

import pytest

from src.models import TextRun
from src.parse_docx import _extract_amendment_note, _is_revoked_text

pytestmark = pytest.mark.unit


# ── _extract_amendment_note ─────────────────────────────────────────────

class TestExtractAmendmentNote:
    def _runs(self, text: str) -> list[TextRun]:
        return [TextRun(text=text)]

    def test_redacao_dada(self):
        runs = self._runs("Texto do artigo (Redação dada pela Resolução nº 21/2017)")
        assert _extract_amendment_note(runs) == "(Redação dada pela Resolução nº 21/2017)"

    def test_revogado(self):
        runs = self._runs("Texto (Revogado pela Resolução nº 10/2020)")
        assert _extract_amendment_note(runs) == "(Revogado pela Resolução nº 10/2020)"

    def test_revogada(self):
        runs = self._runs("Texto (Revogada pela Resolução nº 5/2019)")
        assert _extract_amendment_note(runs) == "(Revogada pela Resolução nº 5/2019)"

    def test_acrescentado(self):
        runs = self._runs("Texto (Acrescentado pela Resolução nº 3/2018)")
        assert _extract_amendment_note(runs) == "(Acrescentado pela Resolução nº 3/2018)"

    def test_incluido(self):
        runs = self._runs("Texto (Incluído pela Resolução nº 7/2021)")
        assert _extract_amendment_note(runs) == "(Incluído pela Resolução nº 7/2021)"

    def test_incluida_sem_acento(self):
        runs = self._runs("Texto (Incluida pela Resolução nº 1/2022)")
        assert _extract_amendment_note(runs) == "(Incluida pela Resolução nº 1/2022)"

    def test_redacao_reestabelecida(self):
        runs = self._runs("Texto (Redação reestabelecida pela Resolução nº 2/2019)")
        assert _extract_amendment_note(runs) == "(Redação reestabelecida pela Resolução nº 2/2019)"

    def test_renumerado(self):
        runs = self._runs("Texto (Renumerado pela Resolução nº 8/2023)")
        assert _extract_amendment_note(runs) == "(Renumerado pela Resolução nº 8/2023)"

    def test_parenteses_aninhados(self):
        runs = self._runs("Texto (Redação dada pela Resolução nº 21 (de 2017))")
        result = _extract_amendment_note(runs)
        assert result == "(Redação dada pela Resolução nº 21 (de 2017))"

    def test_sem_emenda(self):
        runs = self._runs("Texto simples sem emenda alguma")
        assert _extract_amendment_note(runs) == ""

    def test_parentese_nao_emenda(self):
        runs = self._runs("Texto com (parênteses) normais")
        assert _extract_amendment_note(runs) == ""

    def test_multiple_runs(self):
        runs = [
            TextRun(text="Texto do artigo "),
            TextRun(text="(Redação dada pela Resolução nº 21/2017)", italic=True),
        ]
        assert _extract_amendment_note(runs) == "(Redação dada pela Resolução nº 21/2017)"


# ── _is_revoked_text ────────────────────────────────────────────────────

class TestIsRevokedText:
    def test_revogado(self):
        assert _is_revoked_text("Texto (Revogado pela Resolução nº 10/2020)") is True

    def test_revogada(self):
        assert _is_revoked_text("Texto (Revogada pela Resolução nº 5/2019)") is True

    def test_case_insensitive(self):
        assert _is_revoked_text("Texto (REVOGADO pela Resolução)") is True

    def test_sem_revogacao(self):
        assert _is_revoked_text("Texto normal sem revogação") is False

    def test_redacao_dada_nao_eh_revogacao(self):
        assert _is_revoked_text("Texto (Redação dada pela Resolução nº 21/2017)") is False
