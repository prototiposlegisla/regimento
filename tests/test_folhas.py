"""Folhas impressas: o build recompila só as que ficaram para trás do yaml."""

import os
import sys

from src import folhas


def _arvore(tmp_path):
    fontes = tmp_path / "FontesAtual"
    formatos = tmp_path / "Cheatsheet" / "formatos"
    fontes.mkdir()
    formatos.mkdir(parents=True)
    consulta = fontes / "consulta-rapida.yaml"
    consulta.write_text("titulo: x\n", encoding="utf-8")
    return consulta, formatos


def _data(path, quando):
    os.utime(path, (quando, quando))


def _typst_falso(tmp_path, codigo=0, erro=""):
    """Um 'typst' que grava o PDF pedido (ou falha com a mensagem dada)."""
    script = tmp_path / "typst_falso.py"
    script.write_text(
        "import sys\n"
        f"if {codigo}:\n"
        f"    sys.stderr.write({erro!r}); sys.exit({codigo})\n"
        "open(sys.argv[-1], 'w').write('pdf')\n",
        encoding="utf-8",
    )
    bat = tmp_path / "typst_falso.bat"
    bat.write_text(f'@"{sys.executable}" "{script}" %*\n', encoding="utf-8")
    return str(bat)


def test_atrasada_e_a_que_tem_pdf_mais_antigo_que_o_yaml_ou_que_o_typ(tmp_path):
    consulta, formatos = _arvore(tmp_path)
    for nome in ("folha-a", "folha-b", "folha-c", "folha-d"):
        (formatos / f"{nome}.typ").write_text("", encoding="utf-8")
        _data(formatos / f"{nome}.typ", 1000)
    _data(consulta, 2000)
    for nome, quando in (("folha-a", 3000), ("folha-b", 1500)):   # a em dia; b anterior ao yaml; c sem PDF
        (formatos / f"{nome}.pdf").write_text("", encoding="utf-8")
        _data(formatos / f"{nome}.pdf", quando)
    (formatos / "folha-d.pdf").write_text("", encoding="utf-8")   # d: o .typ mudou depois do PDF
    _data(formatos / "folha-d.pdf", 3000)
    _data(formatos / "folha-d.typ", 4000)
    (formatos / "art274.typ").write_text("", encoding="utf-8")    # não é folha
    assert [t.stem for t in folhas.atrasadas(consulta, formatos)] == ["folha-b", "folha-c", "folha-d"]


def test_recompila_as_atrasadas_e_depois_nao_ha_o_que_fazer(tmp_path):
    consulta, formatos = _arvore(tmp_path)
    (formatos / "folha-a.typ").write_text("", encoding="utf-8")
    typst = _typst_falso(tmp_path)
    assert folhas.recompilar(consulta, typst=typst) == (["folha-a"], [])
    assert (formatos / "folha-a.pdf").exists()
    assert folhas.recompilar(consulta, typst=typst) == ([], [])


def test_yaml_de_teste_em_outro_lugar_nao_mexe_nas_folhas(tmp_path):
    consulta, formatos = _arvore(tmp_path)
    (formatos / "folha-a.typ").write_text("", encoding="utf-8")
    teste = tmp_path / "FontesAtual" / "consulta-teste.yaml"
    teste.write_text("titulo: x\n", encoding="utf-8")
    assert folhas.recompilar(teste, formatos, typst=_typst_falso(tmp_path)) == ([], [])
    assert not (formatos / "folha-a.pdf").exists()


def test_pdf_aberto_vira_aviso_e_nao_erro(tmp_path):
    consulta, formatos = _arvore(tmp_path)
    (formatos / "folha-a.typ").write_text("", encoding="utf-8")
    typst = _typst_falso(tmp_path, 1, "error: failed to write PDF file (os error 32)")
    feitas, problemas = folhas.recompilar(consulta, typst=typst)
    assert feitas == []
    assert len(problemas) == 1 and "aberto em outro programa" in problemas[0]


def test_sem_pasta_de_folhas_nao_faz_nada(tmp_path):
    consulta = tmp_path / "FontesAtual" / "consulta-rapida.yaml"
    consulta.parent.mkdir()
    consulta.write_text("titulo: x\n", encoding="utf-8")
    assert folhas.recompilar(consulta) == ([], [])


def _typst_que_pagina(tmp_path):
    """Um 'typst' em que a folha dá round(base) páginas: 3 pt → 3, 4,49 pt → 4, 4,5 pt → 5…"""
    script = tmp_path / "typst_paginas.py"
    script.write_text(
        "import sys\n"
        "a = sys.argv[1:]\n"
        "base = float(a[a.index('--input') + 1].split('=')[1]) if '--input' in a else None\n"
        "if base is None:\n"
        "    open(a[-1], 'w').write('pdf'); sys.exit(0)\n"
        "for i in range(int(base + 0.5 + 1e-9)):\n"
        "    open(a[-1].replace('{p}', str(i + 1)), 'w').write('x')\n",
        encoding="utf-8",
    )
    bat = tmp_path / "typst_paginas.bat"
    bat.write_text(f'@"{sys.executable}" "{script}" %*\n', encoding="utf-8")
    return str(bat)


def test_letra_automatica_enche_folhas_inteiras(tmp_path):
    consulta, formatos = _arvore(tmp_path)
    typ = formatos / "folha-a.typ"
    typ.write_text('// auto-base: 3.0 7.0\n#let base = float(sys.inputs.at("base", default: "5")) * 1pt\n',
                   encoding="utf-8")
    # com 3 pt dá 3 páginas → alvo 4 (duas folhas) → maior letra com até 4 páginas: 4,49 pt
    assert folhas.recompilar(consulta, typst=_typst_que_pagina(tmp_path)) == (["folha-a (4.49 pt, 2 folhas)"], [])
    assert 'default: "4.49"' in typ.read_text(encoding="utf-8")
    assert folhas.recompilar(consulta, typst=_typst_que_pagina(tmp_path)) == ([], [])


def test_folha_sem_marcador_nao_tem_a_letra_mexida(tmp_path):
    consulta, formatos = _arvore(tmp_path)
    typ = formatos / "folha-a.typ"
    typ.write_text('#let base = float(sys.inputs.at("base", default: "5")) * 1pt\n', encoding="utf-8")
    assert folhas.recompilar(consulta, typst=_typst_que_pagina(tmp_path)) == (["folha-a"], [])
    assert 'default: "5"' in typ.read_text(encoding="utf-8")
