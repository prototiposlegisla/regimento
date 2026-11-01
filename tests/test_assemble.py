"""Testes unitários da montagem da página (dados grandes em blocos JSON)."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from src.assemble import assemble

pytestmark = pytest.mark.unit

BASE_DIR = Path(__file__).resolve().parent.parent


def _blocks(html: str) -> dict[str, object]:
    return {m.group(1): json.loads(m.group(2)) for m in re.finditer(
        r'<script type="application/json" id="([\w-]+)">(.*?)</script>', html, re.S)}


def test_dados_grandes_vao_em_blocos_json_que_voltam_intactos(tmp_path):
    traicoeiro = 'fim </script><script>alert(1)</script> e <!-- comentário'
    out = tmp_path / "index.html"
    assemble(
        cards_html="<div class=\"card\"></div>",
        systematic_index=[],
        subject_index=[{"subject": traicoeiro, "refs": []}],
        referencias_index=[{"category": "Legislação correlata", "groups": []}],
        consulta_index=[],
        summaries_map={},
        info_html="",
        base_dir=BASE_DIR,
        output_path=out,
        correlato_notas=[traicoeiro, "outra nota"],
    )
    html = out.read_text(encoding="utf-8")
    blocos = _blocks(html)
    assert blocos["data-subject-index"] == [{"subject": traicoeiro, "refs": []}]
    assert blocos["data-correlato-notas"] == [traicoeiro, "outra nota"]
    assert blocos["data-consulta-index"] == []
    # nada nos dados fecha o bloco antes da hora: o script da página vem inteiro depois
    # (o do cabeçalho, recuado, é o que guarda um toque no ☰ antes dele)
    assert html.count("\n<script>\n") == 1
    assert "pageData('data-subject-index', false)" in html
    # o remissivo (lido ao começar) vem antes do script; os lidos sob demanda depois,
    # para a página responder antes de eles chegarem numa rede lenta
    script = html.index("\n<script>\n")
    assert html.index('id="data-subject-index"') < script
    for late in ("data-referencias-index", "data-consulta-index", "data-correlato-notas"):
        assert html.index(f'id="{late}"') > script
