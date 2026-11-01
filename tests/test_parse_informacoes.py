"""O texto da aba de informações em Markdown (src/parse_informacoes.py)."""

from pathlib import Path

import pytest

from src.parse_informacoes import parse_informacoes, parse_informacoes_md

pytestmark = pytest.mark.unit

TEXTO = """<!--
comentário: fica de fora
-->

Assinatura

Título

### Primeira seção

Um parágrafo com **negrito** e *itálico*, e 3 < 4 & 5.

- um item;
- outro item.

Depois da lista.

### Segunda

Texto.
"""


def test_secoes_viram_sanfonas_fechadas_e_o_comeco_fica_solto():
    h = parse_informacoes_md(TEXTO)
    assert h.startswith("<p>Assinatura</p>\n<p>Título</p>\n<details")
    assert h.count('<details class="info-sec">') == 2 and h.count("</details>") == 2
    assert " open" not in h
    assert "<summary>Primeira seção</summary>" in h and "<summary>Segunda</summary>" in h
    assert "comentário" not in h


def test_listas_paragrafos_e_marcas():
    h = parse_informacoes_md(TEXTO)
    assert "<ul><li>um item;</li><li>outro item.</li></ul>\n<p>Depois da lista.</p>" in h
    assert "<b>negrito</b>" in h and "<i>itálico</i>" in h and "3 &lt; 4 &amp; 5" in h


def test_o_texto_do_repositorio_se_le():
    h = parse_informacoes(Path(__file__).resolve().parent.parent / "informacoes.md")
    assert h.count("<details") >= 5 and h.count("<details") == h.count("</details>")
    assert h.startswith("<p>")
