"""Texto canônico das normas para os outros projetos (pasta canonico/).

O build do site grava, a cada versão pública, uma pasta canonico/ com o texto que
os demais projetos do legislasampa leem — nunca o intermediate/, que é só depuração:

  regimento-interno.md, lei-organica.md, constituicao-federal-trechos.md,
  precedentes-regimentais.md   para a IA ler e buscar ("#### Art. 68 — título")
  normas.jsonl                 para programas: um artigo por linha
  LEIA-ME.md                   o formato, para quem chega à pasta

Sempre a versão pública (sem notas privadas, sem correlatos propostos) e sem links.

Uso:
  python -m src.canonico            regenera a pasta (sem gerar o site)
  python -m src.canonico --check    exit 1 se a pasta estiver mais velha que o DOCX
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
from datetime import datetime
from pathlib import Path

from .models import ArticleBlock, DocumentUnit, SectionHeading, UnitType, unit_path
from .remissoes import LAW_SHORT

BASE_DIR = Path(__file__).resolve().parent.parent
DESTINO = BASE_DIR / "canonico"

# Nome da norma no DOCX -> (arquivo Markdown, sigla no normas.jsonl)
NORMAS = {
    "Regimento Interno": ("regimento-interno.md", "RI"),
    "Lei Orgânica": ("lei-organica.md", "LOM"),
    "Constituição Federal": ("constituicao-federal-trechos.md", "CF"),
    "Precedentes Regimentais": ("precedentes-regimentais.md", "PREC"),
}
JSONL = "normas.jsonl"
LEIA_ME = "LEIA-ME.md"


def fontes() -> tuple[Path, Path]:
    """(DOCX, planilha de remissões) que o build lê, pelo config.local.toml."""
    sources = {}
    config = BASE_DIR / "config.local.toml"
    if config.exists():
        with open(config, "rb") as f:
            sources = tomllib.load(f).get("sources", {})
    docx = Path(sources.get("docx", BASE_DIR / "regimentoInterno.docx"))
    return docx, Path(sources.get("remissoes", docx.parent / "remissoes.xlsx"))


# ----------------------------------------------------------------------------- normas.jsonl
def _dispositivo(unit: DocumentUnit, caminho: str) -> dict:
    d = {"caminho": caminho, "id": unit.identifier, "tipo": unit.unit_type.value,
         "texto": unit.full_text.replace("\xa0", " ").strip()}
    if unit.is_revoked:
        d["revogado"] = True
    if unit.amendment_note:
        d["nota_alteracao"] = unit.amendment_note.replace("\xa0", " ").strip()
    notas = [" ".join("".join(r.text for r in p.runs).strip() for p in fn.paragraphs).strip()
             for fn in unit.footnotes if not fn.is_private]
    if any(notas):
        d["notas"] = [n for n in notas if n]
    return d


def _linhas_jsonl(doc) -> list[str]:
    """Um artigo por linha, só com a redação vigente dos dispositivos."""
    linhas: list[str] = []
    secao: dict[UnitType, str] = {}
    ordem = [UnitType.TITULO, UnitType.CAPITULO, UnitType.SECAO, UnitType.SUBSECAO]
    for el in doc.elements:
        if isinstance(el, SectionHeading):
            if el.data_section.startswith("norma"):
                secao = {}
                continue
            if el.level in ordem:
                for nivel in ordem[ordem.index(el.level):]:
                    secao.pop(nivel, None)
                secao[el.level] = el.text.replace("\xa0", " ") + (f" — {el.subtitle}" if el.subtitle else "")
            continue
        if not isinstance(el, ArticleBlock):
            continue
        sigla = el.law_prefix or LAW_SHORT.get(el.law_name, "RI")
        art = re.sub(r"^ADT", "", el.art_number) if el.is_adt else el.art_number
        dispositivos, ctx = [], ["", "", "", ""]
        if el.caput and not el.caput.is_old_version:
            dispositivos.append(_dispositivo(el.caput, ""))
        for c in el.children:
            # redação tachada fica fora do caminho, como no data-path do site (remissoes._Corpus)
            if not c.is_old_version:
                dispositivos.append(_dispositivo(c, unit_path(c, ctx)))
        reg = {"norma": sigla, "art": art}
        if el.is_adt:
            reg["adt"] = True
        if el.summary:
            reg["titulo"] = el.summary
        if el.is_revoked:
            reg["revogado"] = True
        reg["secao"] = [secao[n] for n in ordem if n in secao]
        reg["dispositivos"] = dispositivos
        linhas.append(json.dumps(reg, ensure_ascii=False))
    return linhas


# ----------------------------------------------------------------------------- geração
def _leia_me(docx: Path, gerado: str) -> str:
    arquivos = "\n".join(f"- `{arq}` — {nome}" for nome, (arq, _) in NORMAS.items())
    return f"""# Texto canônico das normas

> Gerado automaticamente pelo projeto `regimento` (`src/canonico.py`) a cada build público. **Não editar à mão.** Fonte: `{docx.name}`, de {datetime.fromtimestamp(docx.stat().st_mtime):%d/%m/%Y %H:%M}. Gerado em {gerado}.

É o texto que os outros projetos devem ler — nunca `intermediate/`, que é só de depuração. Versão pública: sem notas privadas e sem links.

## Para a IA ler e buscar

{arquivos}

Cada artigo começa por `#### Art. N — título` (no Ato das Disposições Transitórias, `#### Art. N (ADT) — título`). Os dispositivos vêm em `**§ 1º** — texto`, `**I** — texto`. Depois do texto podem vir *(remete a: …)*, *(correlatos: …)* e *(legislação correlata: …)*, e, no fim do artigo, as *Versões anteriores deste artigo*, marcadas *[Versão supersedida]* — que não são texto vigente. Dispositivo revogado traz *(revogado)*.

Para achar um artigo: buscar `#### Art. 68 ` (com o espaço) no arquivo da norma.

## Para programas: `{JSONL}`

Um artigo por linha, só com a redação vigente:

```
{{"norma": "LOM", "art": "41", "titulo": "...", "secao": ["TÍTULO II — ...", "CAPÍTULO I — ..."],
 "dispositivos": [{{"caminho": "", "id": "Art. 41", "tipo": "CAPUT", "texto": "...", "nota_alteracao": "..."}},
                  {{"caminho": "§ 1º,II", "id": "II", "tipo": "INCISO", "texto": "...", "revogado": true}}]}}
```

- `norma`: RI, LOM, CF ou PREC; `art`: o número sem "Art." ("4-A"; no ADT, o número com `"adt": true`).
- `caminho`: a posição do dispositivo no artigo (`""` é o caput; "§ 1º,II,a"; "§ú" é o parágrafo único).
- `revogado` e `adt` só aparecem quando verdadeiros.

Para saber se a pasta está em dia: `python -m src.canonico --check` no projeto `regimento` (exit 1 se o DOCX for mais novo).
"""


def gerar(docx: Path | None = None, remissoes_xlsx: Path | None = None, destino: Path = DESTINO) -> list[str]:
    """Gera a pasta canonico/ a partir do DOCX. Devolve as linhas de log."""
    from .parse_docx import parse_docx
    from .remissoes import carregar_excecoes, carregar_implicitas, detectar
    from .render_markdown import MarkdownRenderer
    from .resolve_amendments import resolve_amendments

    padrao_docx, padrao_xlsx = fontes()
    docx = Path(docx or padrao_docx)
    remissoes_xlsx = Path(remissoes_xlsx or padrao_xlsx)
    doc = resolve_amendments(parse_docx(docx, include_private=False))
    remissoes = detectar(doc, carregar_excecoes(BASE_DIR / "remissoes_excecoes.toml"),
                         carregar_implicitas(remissoes_xlsx), privadas=False, propostas=False)
    textos = MarkdownRenderer(remissoes, canonico=True).render_normas(doc)

    destino.mkdir(exist_ok=True)
    log = []
    gerado = f"{datetime.now():%d/%m/%Y %H:%M}"
    for nome, (arquivo, _) in NORMAS.items():
        if nome not in textos:
            log.append(f"⚠ norma ausente no DOCX: {nome}")
            continue
        (destino / arquivo).write_text(textos[nome], encoding="utf-8")
        log.append(f"→ {arquivo} ({len(textos[nome]) / 1024:.0f} KB)")
    linhas = _linhas_jsonl(doc)
    (destino / JSONL).write_text("\n".join(linhas) + "\n", encoding="utf-8")
    log.append(f"→ {JSONL} ({len(linhas)} artigos)")
    (destino / LEIA_ME).write_text(_leia_me(docx, gerado), encoding="utf-8")
    return log


def verificar(docx: Path | None = None, destino: Path = DESTINO) -> tuple[bool, str]:
    """(em dia, mensagem): a pasta é mais nova que o DOCX e que o código que a gera?"""
    docx = Path(docx or fontes()[0])
    if not docx.exists():
        return False, f"DOCX não encontrado: {docx}"
    arquivos = [destino / arq for arq, _ in NORMAS.values()] + [destino / JSONL]
    if not all(p.exists() for p in arquivos):
        return False, "canonico/ incompleto: rode python -m src.canonico no projeto regimento"
    t_canonico = min(p.stat().st_mtime for p in arquivos)
    t_codigo = max(p.stat().st_mtime for p in (BASE_DIR / "src").glob("*.py"))
    fmt = lambda t: f"{datetime.fromtimestamp(t):%Y-%m-%d %H:%M}"  # noqa: E731
    if docx.stat().st_mtime > t_canonico:
        return False, (f"DEFASADO: o DOCX ({fmt(docx.stat().st_mtime)}) é mais novo que canonico/ "
                       f"({fmt(t_canonico)}). Rode python -m src.canonico no projeto regimento.")
    if t_codigo > t_canonico:
        return False, (f"DEFASADO: o código do regimento ({fmt(t_codigo)}) é mais novo que canonico/ "
                       f"({fmt(t_canonico)}). Rode python -m src.canonico no projeto regimento.")
    return True, f"canonico/ em dia (DOCX de {fmt(docx.stat().st_mtime)})."


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Texto canônico das normas para os outros projetos.")
    ap.add_argument("--check", action="store_true", help="só verifica se canonico/ está em dia")
    args = ap.parse_args(argv)
    if args.check:
        ok, msg = verificar()
        print(msg)
        return 0 if ok else 1
    try:
        for linha in gerar():
            print(linha)
    except PermissionError:
        print("Não foi possível abrir o DOCX: feche-o no Word e tente de novo.")
        return 1
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
