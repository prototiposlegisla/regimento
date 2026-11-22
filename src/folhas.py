"""Folhas impressas da consulta rápida (Cheatsheet/formatos/folha-*.typ): recompila as que ficaram
para trás do consulta-rapida.yaml, para o PDF não divergir do site.

As folhas leem o yaml por caminho fixo (`/FontesAtual/consulta-rapida.yaml`, a partir da raiz dada ao
Typst). Por isso só se recompila quando o yaml do build é esse arquivo; um yaml de teste em outro
lugar não mexe nos PDFs.

Letra automática: a folha que traz a linha `// auto-base: <mín> <máx>` e lê `sys.inputs.at("base",
default: "…")` tem a letra escolhida aqui. Com a menor letra vê-se quantas folhas frente e verso o
conteúdo pede; depois se procura a maior letra que ainda cabe nelas, para não sobrar papel em branco.
Com `// auto-ar: <mín> <máx>`, o que sobrar na última página vira entrelinha e espaço entre blocos.
Com `// auto-folhas: <n>`, o número de folhas é esse, e não o que a menor letra pede (a versão em duas
folhas da folha do teclado). O desenho comum a mais de uma folha fica num `_*.typ`, que não é compilado
sozinho; mudou ele, todas as folhas são refeitas.
Os valores achados são regravados nos `default` do .typ, de modo que compilar à mão dá o mesmo PDF.
Fontes que não são do sistema ficam na pasta `fontes`, ao lado do .typ.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

YAML_NA_RAIZ = ("FontesAtual", "consulta-rapida.yaml")


def pasta_padrao(consulta: Path) -> Path:
    """Cheatsheet/formatos, ao lado de FontesAtual."""
    return consulta.resolve().parent.parent / "Cheatsheet" / "formatos"


def achar_typst() -> str | None:
    exe = shutil.which("typst")
    if exe:
        return exe
    # instalado pelo winget: o PATH novo não chega a terminais já abertos
    local = os.environ.get("LOCALAPPDATA")
    if local:
        for p in sorted(Path(local, "Microsoft", "WinGet", "Packages").glob("Typst.Typst_*/**/typst.exe")):
            return str(p)
    return None


def atrasadas(consulta: Path, pasta: Path) -> list[Path]:
    """Os .typ cujo PDF não existe ou é mais antigo que o yaml, que o próprio .typ ou que um `_*.typ`
    (o desenho que as folhas importam)."""
    yaml_mtime = max([consulta.stat().st_mtime] + [p.stat().st_mtime for p in pasta.glob("_*.typ")])
    fora = []
    for typ in sorted(pasta.glob("folha-*.typ")):
        pdf = typ.with_suffix(".pdf")
        if not pdf.exists() or pdf.stat().st_mtime < max(yaml_mtime, typ.stat().st_mtime):
            fora.append(typ)
    return fora


AUTO = re.compile(r"^//\s*auto-(base|ar):\s*([\d.]+)\s+([\d.]+)", re.M)
FOLHAS = re.compile(r"^//\s*auto-folhas:\s*(\d+)", re.M)
PASSO = 0.01


def _default(nome: str) -> re.Pattern:
    return re.compile(r'(sys\.inputs\.at\("' + nome + r'",\s*default:\s*")([\d.]+)(")')


def _fmt(passos: int) -> str:
    return f"{passos * PASSO:.2f}".rstrip("0").rstrip(".")


def _extras(typ: Path) -> list[str]:
    """Fontes próprias da folha: pasta `fontes` ao lado do .typ."""
    fontes = typ.parent / "fontes"
    return ["--font-path", str(fontes)] if fontes.is_dir() else []


def _paginas(typst: str, raiz: Path, typ: Path, entradas: dict[str, str], extras: list[str] | None = None) -> int | None:
    """Quantas páginas a folha dá com essas entradas (None se não compilar)."""
    args = [typst, "compile", "--root", str(raiz)]
    for k, v in entradas.items():
        args += ["--input", f"{k}={v}"]
    with tempfile.TemporaryDirectory() as tmp:
        r = subprocess.run(args + (_extras(typ) if extras is None else extras)
                           + ["--ppi", "8", str(typ), str(Path(tmp) / "p{p}.png")],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0:
            return None
        return len(list(Path(tmp).glob("p*.png")))


def _maior(cabe, lo: int, hi: int) -> int:
    """O maior passo em [lo, hi] que ainda cabe (supõe que lo cabe)."""
    while lo < hi:
        meio = (lo + hi + 1) // 2
        if cabe(meio):
            lo = meio
        else:
            hi = meio - 1
    return lo


def procurar(typst: str, raiz: Path, typ: Path, entradas: dict[str, str] | None = None,
             extras: list[str] | None = None) -> tuple[dict[str, str], int] | None:
    """Enche folhas inteiras, sem sobra: com a menor letra vê quantas folhas frente e verso o conteúdo
    pede; acha a maior letra que cabe nelas (`auto-base`); depois estica o ar — entrelinha e espaço
    entre blocos — até a última página encher (`auto-ar`). Devolve ({"base": …, "ar": …}, páginas)."""
    texto = typ.read_text(encoding="utf-8")
    faixas = {m.group(1): (round(float(m.group(2)) / PASSO), round(float(m.group(3)) / PASSO)) for m in AUTO.finditer(texto)}
    if "base" not in faixas or not _default("base").search(texto):
        return None
    fixas = dict(entradas or {})
    tem_ar = "ar" in faixas and _default("ar").search(texto)
    ar_min = _fmt(faixas["ar"][0]) if tem_ar else None

    def pag(base: int, ar: int | None = None) -> int | None:
        e = {"base": _fmt(base)}            # a letra vai sempre primeiro
        if tem_ar:
            e["ar"] = _fmt(ar) if ar is not None else ar_min
        return _paginas(typst, raiz, typ, {**e, **fixas}, extras)

    lo, hi = faixas["base"]
    minimo = pag(lo)
    if minimo is None:
        return None
    alvo = minimo + minimo % 2          # folhas frente e verso: sempre par
    fixo = FOLHAS.search(texto)
    if fixo:
        if minimo > 2 * int(fixo.group(1)):
            return None                 # nem com a menor letra cabe nas folhas pedidas
        alvo = 2 * int(fixo.group(1))

    def cabe(n: int | None) -> bool:
        return n is not None and n <= alvo

    base = _maior(lambda b: cabe(pag(b)), lo, hi)
    achados = {"base": _fmt(base)}
    if tem_ar:
        achados["ar"] = _fmt(_maior(lambda a: cabe(pag(base, a)), *faixas["ar"]))
    return achados, alvo


def ajustar_letra(typst: str, raiz: Path, typ: Path) -> str | None:
    """Procura letra e ar e grava nos defaults do .typ. Devolve um resumo para o aviso do build."""
    achado = procurar(typst, raiz, typ)
    if not achado:
        return None
    achados, alvo = achado
    texto = typ.read_text(encoding="utf-8")
    novo = texto
    for nome, valor in achados.items():
        novo = _default(nome).sub(lambda x, v=valor: x.group(1) + v + x.group(3), novo, count=1)
    if novo != texto:
        typ.write_text(novo, encoding="utf-8", newline="\n")
    return f"{achados['base']} pt, {alvo // 2} folha{'s' if alvo > 2 else ''}"


def recompilar(consulta: Path, pasta: Path | None = None, typst: str | None = None) -> tuple[list[str], list[str]]:
    """Recompila as folhas atrasadas. Devolve (feitas, problemas); problema não derruba o build."""
    consulta = Path(consulta)
    if not consulta.exists():
        return [], []
    pasta = Path(pasta) if pasta else pasta_padrao(consulta)
    if not pasta.is_dir():
        return [], []
    raiz = consulta.resolve().parent.parent
    if consulta.resolve() != raiz.joinpath(*YAML_NA_RAIZ).resolve():
        return [], []   # yaml de teste: as folhas não o leem
    try:
        pasta.resolve().relative_to(raiz)
    except ValueError:
        return [], [f"{pasta}: fora de {raiz}, as folhas não alcançam o yaml"]
    fora = atrasadas(consulta, pasta)
    if not fora:
        return [], []
    typst = typst or achar_typst()
    if not typst:
        return [], [f"Typst não encontrado: {', '.join(t.stem for t in fora)} ficaram para trás do yaml"]
    feitas, problemas = [], []
    for typ in fora:
        letra = ajustar_letra(typst, raiz, typ)
        r = subprocess.run([typst, "compile", "--root", str(raiz), *_extras(typ), str(typ), str(typ.with_suffix(".pdf"))],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        if r.returncode == 0:
            feitas.append(f"{typ.stem} ({letra})" if letra else typ.stem)
        else:
            erro = (r.stderr or r.stdout).strip()
            if "os error 32" in erro:
                erro = "o PDF está aberto em outro programa; feche e rode o build de novo"
            problemas.append(f"{typ.stem}: {erro.splitlines()[0] if erro else 'falhou'}")
    return feitas, problemas
