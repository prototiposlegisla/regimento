"""Texto canônico das normas para os outros projetos (pasta canonico/).

O build do site grava, a cada versão pública, uma pasta canonico/ com o texto que
os demais projetos do legislasampa leem — nunca o intermediate/, que é só depuração:

  regimento-interno.md, lei-organica.md, constituicao-estadual-trechos.md,
  constituicao-federal-trechos.md,
  precedentes-regimentais.md   para a IA ler e buscar ("#### Art. 68 — título")
  indice-remissivo.md          o índice remissivo, por assunto
  normas.jsonl                 para programas: um artigo por linha, com a rede de ligações
                               (remissões, correlatos, legislação correlata, índice)
  LEIA-ME.md                   o formato, para quem chega à pasta

Sempre a versão pública (sem notas privadas, sem correlatos nem propostas do índice
ainda não aprovados) e sem links.

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
from .remissoes import EXIBIVEIS, LAW_SHORT, REVOGADO, TACHADO, Alvo
from .render_markdown import MarkdownRenderer

BASE_DIR = Path(__file__).resolve().parent.parent
DESTINO = BASE_DIR / "canonico"

# Nome da norma no DOCX -> (arquivo Markdown, sigla no normas.jsonl)
NORMAS = {
    "Regimento Interno": ("regimento-interno.md", "RI"),
    "Lei Orgânica": ("lei-organica.md", "LOM"),
    "Constituição Estadual": ("constituicao-estadual-trechos.md", "CE"),
    "Constituição Federal": ("constituicao-federal-trechos.md", "CF"),
    "Precedentes Regimentais": ("precedentes-regimentais.md", "PREC"),
}
JSONL = "normas.jsonl"
INDICE = "indice-remissivo.md"
LEIA_ME = "LEIA-ME.md"


def fontes() -> tuple[Path, Path, Path]:
    """(DOCX, planilha de remissões, índice remissivo) que o build lê, pelo config.local.toml."""
    sources = {}
    config = BASE_DIR / "config.local.toml"
    if config.exists():
        with open(config, "rb") as f:
            sources = tomllib.load(f).get("sources", {})
    docx = Path(sources.get("docx", BASE_DIR / "regimentoInterno.docx"))
    return (docx, Path(sources.get("remissoes", docx.parent / "remissoes.xlsx")),
            Path(sources.get("xlsx", BASE_DIR / "remissivo.xlsx")))


# ----------------------------------------------------------------------------- normas.jsonl
def _alvo(a: Alvo) -> dict:
    """Endereço de outro dispositivo, no formato dos registros: {"norma", "art", "caminho"}."""
    d = {"norma": a.law, "art": re.sub(r"^ADT", "", a.art), "caminho": a.path}
    if a.art.startswith("ADT"):
        d["adt"] = True
    if a.status == REVOGADO:
        d["revogado"] = True
    elif a.status == TACHADO:
        d["redacao_anterior"] = True
    return d


# Nome do tipo de correlato como na planilha remissoes.xlsx (remissoes.TIPOS)
_TIPO_NOME = {"eq": "mesma regra", "det": "detalha", "fund": "fundamento", "div": "diverge",
              "sim": "correspondente", "exc": "exceção"}


def _ligacoes(unit: DocumentUnit, rede, indice: list[str]) -> dict:
    """A rede do dispositivo: remissões que ele faz, correlatos, legislação correlata, índice.

    rede = (remissões por dispositivo, correlatos por dispositivo), de remissoes.Resultado.
    """
    rem_by, imp_by = rede
    d = {}
    alvos = []
    for rem in rem_by.get(id(unit), ()):
        for a in rem.alvos:
            if a.status in EXIBIVEIS and _alvo(a) not in alvos:
                alvos.append(_alvo(a))
    if alvos:
        d["remete_a"] = alvos
    correlatos = []
    for im, lado in imp_by.get(id(unit), ()):
        outro = im.destino if lado == "src" else im.origem
        c = {"relacao": MarkdownRenderer.relacao(im, lado),
             "tipo": _TIPO_NOME[im.tipo], **_alvo(outro)}
        if im.nota:
            c["nota"] = im.nota
        correlatos.append(c)
    if correlatos:
        d["correlatos"] = correlatos
    legislacao = [_texto(p.runs) for p in unit.legislacao]
    if any(legislacao):
        d["legislacao"] = [t for t in legislacao if t]
    if indice:
        d["indice"] = indice
    return d


def _texto(runs) -> str:
    return "".join(r.text for r in runs).replace("\xa0", " ").strip()


def _dispositivo(unit: DocumentUnit, caminho: str, rede=({}, {}), indice: list[str] | None = None) -> dict:
    texto = unit.full_text.replace("\xa0", " ").strip()
    # trecho tachado dentro de dispositivo vigente (suspenso por ADIN, por exemplo): fica fora do
    # texto em vigor e vai à parte, como o ~~…~~ dos Markdown
    tachado = [r.text.replace("\xa0", " ").strip() for r in unit.runs if r.strike and r.text.strip()]
    if tachado and any(not r.strike and r.text.strip() for r in unit.runs):
        texto = re.sub(r" {2,}", " ", "".join(r.text for r in unit.runs if not r.strike).replace("\xa0", " ")).strip()
    else:
        tachado = []
    d = {"caminho": caminho, "id": unit.identifier, "tipo": unit.unit_type.value, "texto": texto}
    if tachado:
        d["tachado"] = tachado
    if unit.is_revoked:
        d["revogado"] = True
    if unit.amendment_note:
        d["nota_alteracao"] = unit.amendment_note.replace("\xa0", " ").strip()
    notas = [" ".join(_texto(p.runs) for p in fn.paragraphs).strip()
             for fn in unit.footnotes if not fn.is_private]
    if any(notas):
        d["notas"] = [n for n in notas if n]
    d.update(_ligacoes(unit, rede, indice or []))
    return d


def indice_por_artigo(subject_list: list[dict]) -> dict[tuple[str, str], list[tuple[str, str | None]]]:
    """{(norma, art): [(entrada do índice, caminho)]}; caminho None = o artigo inteiro, "" = o caput.

    A entrada é "ASSUNTO" ou "ASSUNTO — Subassunto", como na linha "No índice remissivo:" do site.
    """
    out: dict[tuple[str, str], list[tuple[str, str | None]]] = {}

    def add(entrada, refs):
        for r in refs:
            detalhe = r.get("detail", "")
            caminho = None if not detalhe else "" if detalhe == "caput" else detalhe
            par = (entrada, caminho)
            lst = out.setdefault((r.get("law_prefix") or "RI", r["art"]), [])
            if par not in lst:
                lst.append(par)

    for item in subject_list:
        add(item["subject"], item.get("refs", ()))
        for ch in item.get("children", ()):
            add(f"{item['subject']} — {ch['sub_subject']}", ch.get("refs", ()))
    return out


def _linhas_jsonl(doc, remissoes=None, indice: dict | None = None) -> list[str]:
    """Um artigo por linha, só com a redação vigente dos dispositivos e a rede de ligações."""
    indice = indice or {}
    citado = remissoes.citado_em() if remissoes else {}
    rede = (remissoes.por_unidade(), remissoes.implicitas_por_unidade()) if remissoes else ({}, {})
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
        # entradas do índice por caminho; a que cita caminho que não é de dispositivo vigente
        # (o build já avisa) fica com o artigo inteiro
        entradas: dict[str | None, list[str]] = {}
        for entrada, caminho in indice.get((sigla, el.art_number), ()):
            entradas.setdefault(caminho, []).append(entrada)
        dispositivos, ctx = [], ["", "", "", ""]
        if el.caput and not el.caput.is_old_version:
            dispositivos.append(_dispositivo(el.caput, "", rede, entradas.pop("", None)))
        for c in el.children:
            # redação tachada fica fora do caminho, como no data-path do site (remissoes._Corpus)
            if not c.is_old_version:
                caminho = unit_path(c, ctx)
                dispositivos.append(_dispositivo(c, caminho, rede, entradas.pop(caminho, None) if caminho else None))
        reg = {"norma": sigla, "art": art}
        if el.is_adt:
            reg["adt"] = True
        if el.summary:
            reg["titulo"] = el.summary
        if el.is_revoked:
            reg["revogado"] = True
        reg["secao"] = [secao[n] for n in ordem if n in secao]
        sobra = [e for lst in entradas.values() for e in lst]
        if sobra:
            reg["indice"] = list(dict.fromkeys(sobra))
        if citado.get((sigla, el.art_number)):
            reg["citado_por"] = [_alvo(o) for o in citado[(sigla, el.art_number)]]
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

- `{INDICE}` — o índice remissivo, por assunto (`## ASSUNTO`, `### Subassunto`, uma linha por dispositivo: `- LOM art. 40, § 1º`)

Cada artigo começa por `#### Art. N — título` (no Ato das Disposições Transitórias, `#### Art. N (ADT) — título`). Os dispositivos vêm em `**§ 1º** — texto`, `**I** — texto`. Dispositivo revogado traz *(revogado)*.

Depois do texto de cada dispositivo pode vir a rede de ligações:

- *(remete a: …)* — os dispositivos que o texto cita;
- *(correlatos: …)* — dispositivos ligados pelo conteúdo, sem citação, com a relação lida deste lado ("mesma regra que", "detalha" / "detalhado em", "tem fundamento em" / "é fundamento de", "diverge de", "tem como regra federal correspondente" / "é a regra federal correspondente a" (com a CE, "regra estadual"), "é exceção à regra geral de" / "tem como exceção" e, dentro da mesma norma, "corresponde a": partes de um mesmo procedimento ou regras paralelas) e uma nota que explica a ligação;
- *(legislação correlata: …)* — leis e decretos que tratam do assunto.

Todo alvo traz a sigla da norma — `RI art. 102, § 5º`, `LOM art. 18`, `CE art. 144`, `CF art. 47`, `LOM art. 29 (ADT)` —, também quando é da mesma norma do arquivo. No fim do artigo podem vir *Citado em: …* (os dispositivos de outros artigos que o citam) e *No índice remissivo: …* (as entradas do índice que o citam; entre parênteses, quando citam só alguns dispositivos), e depois as *Versões anteriores deste artigo*, marcadas *[Versão supersedida]* — que não são texto vigente.

Para achar um artigo: buscar `#### Art. 68 ` (com o espaço) no arquivo da norma.

## Para programas: `{JSONL}`

Um artigo por linha, só com a redação vigente:

```
{{"norma": "LOM", "art": "41", "titulo": "...", "secao": ["TÍTULO II — ...", "CAPÍTULO I — ..."],
 "citado_por": [{{"norma": "RI", "art": "66", "caminho": ""}}, ...],
 "dispositivos": [{{"caminho": "", "id": "Art. 41", "tipo": "ARTIGO", "texto": "...", "nota_alteracao": "...",
                   "remete_a": [{{"norma": "...", "art": "...", "caminho": "..."}}],
                   "correlatos": [{{"relacao": "mesma regra que", "tipo": "mesma regra", "norma": "RI", "art": "330",
                                   "caminho": "§ú", "nota": "..."}}],
                   "legislacao": ["Lei nº ... — ementa"],
                   "indice": ["AUDIÊNCIA PÚBLICA — Obrigatória"]}},
                  {{"caminho": "§ 1º,II", "id": "II", "tipo": "INCISO", "texto": "...", "revogado": true}}]}}
```

- `norma`: RI, LOM, CE (Constituição do Estado de São Paulo), CF ou PREC; `art`: o número sem "Art." ("4-A"; no ADT, o número com `"adt": true`).
- `caminho`: a posição do dispositivo no artigo (`""` é o caput; "§ 1º,II,a"; "§ú" é o parágrafo único).
- `remete_a`, `correlatos`, `citado_por`: endereços no mesmo formato (`norma`, `art`, `caminho`; `caminho` `""` = o artigo inteiro ou o caput). O alvo pode trazer `"revogado": true` ou `"redacao_anterior": true` (a citação aponta para redação já substituída).
- `correlatos`: `relacao` é a ligação lida a partir deste dispositivo (as mesmas frases do Markdown); `tipo` é o nome na planilha (mesma regra, detalha, fundamento, diverge, correspondente, exceção).
- `indice`: as entradas do índice remissivo ("ASSUNTO" ou "ASSUNTO — Subassunto"). No dispositivo, as que o citam; no artigo, as que citam o artigo inteiro.
- `tachado`: os trechos tachados de um dispositivo vigente (suspensos por ADIN, por exemplo), que ficam fora do `texto`; no Markdown, entre `~~`.
- `revogado`, `adt` e as listas só aparecem quando há o que mostrar.

Para saber se a pasta está em dia: `python -m src.canonico --check` no projeto `regimento` (exit 1 se o DOCX ou uma das planilhas for mais novo).
"""


def _carregar_indice(doc, indice_xlsx: Path) -> list[dict]:
    """Índice remissivo como o build o monta (sem propostas), em SubjectIndex.to_list()."""
    from types import SimpleNamespace

    if str(BASE_DIR) not in sys.path:
        sys.path.insert(0, str(BASE_DIR))
    from build import ValidationReport, _carregar_indice as carregar  # a conferência do índice mora no build

    subject_index, _ = carregar(SimpleNamespace(xlsx=str(indice_xlsx), com_propostas=False), doc,
                                ValidationReport())
    return subject_index.to_list() if subject_index else []


def gerar(docx: Path | None = None, remissoes_xlsx: Path | None = None, destino: Path = DESTINO,
          indice_xlsx: Path | None = None) -> list[str]:
    """Gera a pasta canonico/ a partir do DOCX e das planilhas. Devolve as linhas de log."""
    from .parse_docx import parse_docx
    from .remissoes import carregar_excecoes, carregar_implicitas, detectar
    from .resolve_amendments import resolve_amendments

    padrao_docx, padrao_xlsx, padrao_indice = fontes()
    docx = Path(docx or padrao_docx)
    remissoes_xlsx = Path(remissoes_xlsx or padrao_xlsx)
    doc = resolve_amendments(parse_docx(docx, include_private=False))
    remissoes = detectar(doc, carregar_excecoes(BASE_DIR / "remissoes_excecoes.toml"),
                         carregar_implicitas(remissoes_xlsx), privadas=False, propostas=False)
    subject_list = _carregar_indice(doc, Path(indice_xlsx or padrao_indice))
    indice = indice_por_artigo(subject_list)
    renderer = MarkdownRenderer(remissoes, canonico=True, indice=indice)
    textos = renderer.render_normas(doc)

    destino.mkdir(exist_ok=True)
    log = []
    gerado = f"{datetime.now():%d/%m/%Y %H:%M}"
    for nome, (arquivo, _) in NORMAS.items():
        if nome not in textos:
            log.append(f"⚠ norma ausente no DOCX: {nome}")
            continue
        (destino / arquivo).write_text(textos[nome], encoding="utf-8")
        log.append(f"→ {arquivo} ({len(textos[nome]) / 1024:.0f} KB)")
    if subject_list:
        texto = renderer.render_subject_index(subject_list)
        (destino / INDICE).write_text(texto, encoding="utf-8")
        log.append(f"→ {INDICE} ({len(texto) / 1024:.0f} KB)")
    else:
        log.append("⚠ índice remissivo não encontrado: canonico/ sai sem as entradas do índice")
    linhas = _linhas_jsonl(doc, remissoes, indice)
    (destino / JSONL).write_text("\n".join(linhas) + "\n", encoding="utf-8")
    log.append(f"→ {JSONL} ({len(linhas)} artigos)")
    (destino / LEIA_ME).write_text(_leia_me(docx, gerado), encoding="utf-8")
    return log


def verificar(docx: Path | None = None, destino: Path = DESTINO) -> tuple[bool, str]:
    """(em dia, mensagem): a pasta é mais nova que o DOCX, as planilhas e o código que a gera?"""
    padrao_docx, remissoes_xlsx, indice_xlsx = fontes()
    docx = Path(docx or padrao_docx)
    if not docx.exists():
        return False, f"DOCX não encontrado: {docx}"
    arquivos = [destino / arq for arq, _ in NORMAS.values()] + [destino / JSONL, destino / INDICE]
    if not all(p.exists() for p in arquivos):
        return False, "canonico/ incompleto: rode python -m src.canonico no projeto regimento"
    t_canonico = min(p.stat().st_mtime for p in arquivos)
    t_codigo = max(p.stat().st_mtime for p in (BASE_DIR / "src").glob("*.py"))
    fmt = lambda t: f"{datetime.fromtimestamp(t):%Y-%m-%d %H:%M}"  # noqa: E731
    if docx.stat().st_mtime > t_canonico:
        return False, (f"DEFASADO: o DOCX ({fmt(docx.stat().st_mtime)}) é mais novo que canonico/ "
                       f"({fmt(t_canonico)}). Rode python -m src.canonico no projeto regimento.")
    for nome, planilha in (("a planilha de remissões", remissoes_xlsx), ("o índice remissivo", indice_xlsx)):
        if planilha.exists() and planilha.stat().st_mtime > t_canonico:
            return False, (f"DEFASADO: {nome} ({fmt(planilha.stat().st_mtime)}) é mais nova que canonico/ "
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
