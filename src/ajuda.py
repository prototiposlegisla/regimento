"""A parte da aba de informações que o build escreve: até onde vai o texto de cada norma e como usar a busca.

Fica no código, e não em informacoes.docx, para não desatualizar: a última alteração de cada norma sai das
notas de redação do próprio DOCX, e os atalhos acompanham a busca (static/js/04-busca.js, classifyQuery). O texto
livre do usuário continua em informacoes.docx, antes desta parte.
"""

from __future__ import annotations

import html
import re

from .models import ArticleBlock, ParsedDocument

# (norma no DOCX, como aparece na aba, a norma alteradora que as notas citam)
_NORMAS = [
    ("Regimento Interno", "Regimento Interno", r"Resolu[çc][ãa]o"),
    ("Lei Orgânica", "Lei Orgânica", r"Emenda\s+[àa]\s+Lei\s+Org[âa]nica"),
    ("Constituição Estadual", "Constituição Estadual (artigos selecionados)", r"Emenda\s+Constitucional"),
    ("Constituição Federal", "Constituição Federal (artigos selecionados)", r"Emenda\s+Constitucional"),
]
_NOME_CURTO = {"Regimento Interno": "Resolução", "Lei Orgânica": "Emenda à Lei Orgânica"}


def _units(us):
    for u in us:
        yield u
        yield from _units(u.children)


def ultimas_alteracoes(doc: ParsedDocument) -> list[tuple[str, str]]:
    """[(norma, a alteração mais recente citada nas notas de redação dela)]: "Resolução nº 8/2026"."""
    textos: dict[str, list[str]] = {}
    precedentes: list[tuple[int, int]] = []
    for el in doc.elements:
        if not isinstance(el, ArticleBlock):
            continue
        if el.law_prefix == "PREC":
            m = re.fullmatch(r"(\d+)/(\d{4})", el.art_number)
            if m:
                precedentes.append((int(m.group(2)), int(m.group(1))))
            continue
        todos = ([el.caput] if el.caput else []) + list(el.children) + list(el.all_versions)
        textos.setdefault(el.law_name or "Regimento Interno", []).extend(u.full_text for u in _units(todos))
    out = []
    for norma, rotulo, alteradora in _NORMAS:
        pat = re.compile(rf"{alteradora}\s+n\s*[º°o.]*\s*(\d+)[^()]{{0,40}}?(\d{{4}})", re.I)
        citadas = [(int(m.group(2)), int(m.group(1))) for t in textos.get(norma, []) for m in pat.finditer(t)]
        if citadas:
            ano, numero = max(citadas)
            out.append((rotulo, f"{_NOME_CURTO.get(norma, 'Emenda Constitucional')} nº {numero}/{ano}"))
    if precedentes:
        ano, numero = max(precedentes)
        out.append(("Precedentes regimentais", f"até o nº {numero}/{ano}"))
    return out


def html_da_ajuda(doc: ParsedDocument) -> str:
    """O HTML da parte da aba de informações escrita pelo build."""
    linhas = "<br>".join(f"{html.escape(norma)}: {html.escape(alt)}" for norma, alt in ultimas_alteracoes(doc))
    partes = []
    if linhas:
        partes += ["<h3>Texto atualizado até</h3>",
                   "<p>A alteração mais recente incorporada em cada norma:</p>",
                   f"<p>{linhas}</p>"]
    partes += [
        "<h3>Busca</h3>",
        "<p><b>r43</b> vai ao art. 43 do Regimento; <b>l43</b>, ao da Lei Orgânica "
        "(também r183a, l229b, radt1, ladt15a).</p>",
        "<p>Com várias palavras, o artigo precisa ter todas; entre aspas, a frase exata "
        "(\"prazo de votação\"). Acentos não importam.</p>",
        "<p><b>n</b> e um espaço antes dos termos incluem as notas de rodapé: n vereador.</p>",
        "<p><b>Enter</b> vai ao próximo resultado e <b>Shift+Enter</b> ao anterior; <b>Ctrl+F</b> leva à busca; "
        "<b>Esc</b> fecha o índice ou a lista de resultados e, sem nada aberto, limpa a busca.</p>",
        "<h3>Marcadores</h3>",
        "<p>Clique no número de um dispositivo (Art. 5º, § 1º, II, a…) para marcá-lo; outro clique desmarca. "
        "Os botões que aparecem ao lado levam a cada marcado, buscam só nos artigos marcados e copiam o texto "
        "deles. Ficam guardados só neste navegador.</p>",
    ]
    return "\n".join(partes)
