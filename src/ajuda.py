"""A parte da aba de informações que o build escreve: até onde vai o texto de cada norma.

Fica no código, e não em informacoes.md, para não desatualizar: a última alteração de cada norma sai das
notas de redação do próprio DOCX. O resto da aba (o que é o site, as fontes, como usar cada recurso) está em
informacoes.md, antes desta parte.
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
    """O HTML da parte da aba de informações escrita pelo build: uma sanfona, como as do texto."""
    linhas = "<br>".join(f"{html.escape(norma)}: {html.escape(alt)}" for norma, alt in ultimas_alteracoes(doc))
    if not linhas:
        return ""
    return "\n".join(['<details class="info-sec"><summary>Texto atualizado até</summary>',
                      "<p>A alteração mais recente incorporada em cada norma:</p>",
                      f"<p>{linhas}</p>",
                      "</details>"])
