"""Testes unitários da montagem da página (dados grandes em blocos JSON)."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from src.assemble import assemble, page_characters, web_fonts

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
    # o script da página uma vez (o do cabeçalho, recuado, é o que guarda um toque
    # no ☰ antes dele)
    assert html.count("\n<script>\n") == 1
    assert re.search(r"pageData\('data-subject-index'\)", html)
    # os dados todos depois do script, para a página responder antes de eles chegarem
    # numa rede lenta (o script os espera onde precisa deles)
    script = html.index("\n<script>\n")
    for late in ("data-subject-index", "data-referencias-index", "data-consulta-index", "data-correlato-notas"):
        assert html.index(f'id="{late}"') > script


def test_caracteres_da_pagina_incluem_os_escapes_do_css_e_do_script():
    pagina = 'a{content:"\\261E\\2002"} x = "\\u00a0\\u{1F4D6}"; &para; ç'
    chars = set(page_characters(pagina))
    for c in "☞  \U0001F4D6¶ç":
        assert c in chars
    # e a margem para o que se digita na busca
    assert {"ã", "Ç", "ü", "—", "º"} <= chars


def test_fontes_cortadas_aos_caracteres_da_pagina_e_sem_o_nome_reservado(tmp_path):
    TTFont = pytest.importorskip("fontTools.ttLib").TTFont
    src = sorted((BASE_DIR / "static" / "fonts").glob("*.woff2"))
    texto = "Câmara Municipal — Art. 1º ☞ cf."
    web_fonts(src, tmp_path, page_characters(texto))
    for f in src:
        original, cortada = TTFont(f), TTFont(tmp_path / f.name)
        o, c = original.getBestCmap(), cortada.getBestCmap()
        # menor, com cada caractere da página que a original tinha, e o mesmo glifo
        assert (tmp_path / f.name).stat().st_size < f.stat().st_size
        for ch in texto:
            if ord(ch) in o:
                assert c.get(ord(ch)) == o[ord(ch)], (f.name, ch)
        assert len(c) < len(o)
        # o nome reservado pela licença (OFL) não fica nos nomes da fonte; os avisos ficam
        nomes = {r.nameID: r.toUnicode() for r in cortada["name"].names}
        assert not any("Merriweather" in t for i, t in nomes.items() if i in (1, 4, 6, 16))
        assert nomes[0] == {r.nameID: r.toUnicode() for r in original["name"].names}[0]


def test_faixa_do_remissivo_conta_assuntos_e_entradas_por_artigo():
    from src.render_html import contagens_do_remissivo
    indice = [
        # o assunto e um subassunto citam o art. 5 (duas entradas, um assunto);
        # dois dispositivos do mesmo artigo contam uma vez
        {"subject": "Mesa", "refs": [{"art": "5", "detail": "caput"}, {"art": "5", "detail": "§1"}],
         "children": [{"sub_subject": "eleição", "refs": [{"art": "5"}, {"art": "7"}]}]},
        {"subject": "Comissões", "refs": [], "children": [{"sub_subject": "prazo", "refs": [{"art": "5"}]}]},
        {"subject": "Veto", "refs": [{"law_prefix": "LOM", "art": "5"}]},
    ]
    faixas = contagens_do_remissivo(indice)
    assert 'data-label="2 assuntos · 3 entradas"' in faixas[("", "5")]
    assert 'data-label="1 assunto · 1 entrada"' in faixas[("", "7")]
    assert 'data-label="1 assunto · 1 entrada"' in faixas[("LOM", "5")]
    assert set(faixas) == {("", "5"), ("", "7"), ("LOM", "5")}
