"""Leva as propostas aprovadas da aba Propostas para a aba principal do remissivo.xlsx.

A aba principal é reescrita a partir do índice com as propostas aplicadas (uma linha por
assunto/subassunto, em ordem alfabética, intervalos recompostos), e as propostas aprovadas
passam a "aplicado". Antes de gravar, confere que a planilha nova gera exatamente o mesmo
índice que a antiga com as propostas.

Uso:
  python -m src.consolidar_indice            prévia: grava a planilha nova ao lado (…consolidado.xlsx)
  python -m src.consolidar_indice --gravar   substitui a planilha (backup antes)
"""
from __future__ import annotations

import argparse
import io
import re
import shutil
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

from .parse_xlsx import (SubjectIndex, aba_principal, aplicar_propostas, carregar_propostas,
                         parse_law_mapping, parse_xlsx)

BASE_DIR = Path(__file__).resolve().parent.parent


def _chave_ordem(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "").lower()
    return "".join(c for c in s if not unicodedata.combining(c))


def _detalhe(d: str) -> str:
    """"§ 1º,II" → "§1,II" (a notação curta da planilha; o parser volta ao formato do site)."""
    return re.sub(r"§ (\d+)º", r"§\1", d)


def _linhas_dispositivos(refs) -> list[str]:
    """Uma linha por referência; as que vieram de um intervalo voltam a ser "a-b"."""
    out: list[str] = []
    i = 0
    while i < len(refs):
        r = refs[i]
        pref = f"{r.law_prefix}:" if r.law_prefix else ""
        dica = f"({r.hint})" if r.hint else ""
        if r.from_range and r.art.isdigit():
            j, ult = i + 1, int(r.art)
            while j < len(refs) and refs[j].from_range and refs[j].law_prefix == r.law_prefix \
                    and refs[j].hint == r.hint:
                if refs[j].art.isdigit():
                    if int(refs[j].art) != ult + 1:
                        break
                    ult = int(refs[j].art)
                j += 1
            out.append(f"{pref}{r.art}-{ult}{dica}" if ult > int(r.art) else f"{pref}{r.art}{dica}")
            i = j
            continue
        out.append(f"{pref}{r.art}" + (f",{_detalhe(r.detail)}" if r.detail else "") + dica)
        i += 1
    return out


def _linhas(index: SubjectIndex) -> list[tuple[str, str, str, str]]:
    """(Assunto, SubAssunto, Dispositivos, Vides), fundindo as entradas repetidas."""
    juntas: dict[tuple[str, str], list] = {}
    for e in index.entries:
        k = (_chave_ordem(e.subject), _chave_ordem(e.sub_subject))
        if k not in juntas:
            juntas[k] = [e.subject, e.sub_subject, [], []]
        alvo = juntas[k]
        vistos = {(r.law_prefix, r.art, r.detail) for r in alvo[2]}
        alvo[2] += [r for r in e.refs if (r.law_prefix, r.art, r.detail) not in vistos or r.from_range]
        alvo[3] += [v for v in e.vides if v not in alvo[3]]
    linhas = []
    for k in sorted(juntas, key=lambda k: (k[0], k[1] != "", k[1])):
        a, s, refs, vides = juntas[k]
        linhas.append((a, s, "\n".join(_linhas_dispositivos(refs)), "\n".join(vides)))
    return linhas


def _assinatura(index: SubjectIndex) -> dict:
    """O índice como o site o vê, sem depender da ordem das linhas."""
    out = {}
    for item in index.to_list():
        grupos = {"": item.get("refs", [])}
        grupos.update({c["sub_subject"].lower(): c["refs"] for c in item.get("children", [])})
        vides = {"": item.get("vides", [])}
        vides.update({c["sub_subject"].lower(): c.get("vides", []) for c in item.get("children", [])})
        out[item["subject"].lower()] = {
            s: (frozenset((r.get("law_prefix", ""), r["art"], r["detail"], r.get("hint", "")) for r in refs),
                frozenset(vides.get(s, [])))
            for s, refs in grupos.items()}
    return out


def _letrados(docx: Path, law_mapping: dict[str, str]) -> dict[str, set[str]]:
    from .parse_docx import parse_docx
    doc = parse_docx(str(docx), include_private=False)
    out: dict[str, set[str]] = {}
    for el in doc.elements:
        if hasattr(el, "art_number") and re.search(r"-[A-Za-z]", el.art_number):
            prefix = el.law_prefix or law_mapping.get(getattr(el, "law_name", None) or "", "")
            out.setdefault(prefix, set()).add(el.art_number)
    return out


def main(argv: list[str] | None = None) -> int:
    if sys.stdout.encoding != "utf-8":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    import tomllib

    import openpyxl

    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--gravar", action="store_true")
    args = ap.parse_args(argv)
    cfg = {}
    if (BASE_DIR / "config.local.toml").exists():
        cfg = tomllib.loads((BASE_DIR / "config.local.toml").read_text(encoding="utf-8")).get("sources", {})
    xlsx = Path(cfg.get("xlsx", BASE_DIR / "remissivo.xlsx"))
    docx = Path(cfg.get("docx", BASE_DIR / "regimentoInterno.docx"))

    law_mapping = parse_law_mapping(xlsx)
    letrados = _letrados(docx, law_mapping)
    index = parse_xlsx(xlsx, known_lettered=letrados)
    propostas = carregar_propostas(xlsx)
    n, n_prop, avisos = aplicar_propostas(index, propostas, known_lettered=letrados)
    if avisos:
        print("Propostas que não se aplicam (resolva antes de consolidar):")
        for m, c in avisos:
            print(f"  · {m}  ({c})")
        return 1
    linhas = _linhas(index)

    destino = xlsx if args.gravar else xlsx.with_name(xlsx.stem + ".consolidado.xlsx")
    if args.gravar:
        backup = xlsx.with_name(f"{xlsx.stem}.antes-consolidacao-{datetime.now():%Y%m%d-%H%M}.xlsx")
        shutil.copy2(xlsx, backup)
        print(f"backup: {backup.name}")
    wb = openpyxl.load_workbook(xlsx)
    ws = aba_principal(wb)
    ws.delete_rows(2, ws.max_row)
    for linha in linhas:
        ws.append([c or None for c in linha])
    aplicadas = 0
    if "Propostas" in wb.sheetnames:
        wp = wb["Propostas"]
        h = [c.value for c in wp[1]]
        i_st, i_rev = h.index("Status") + 1, h.index("Revisão") + 1
        for r in range(2, wp.max_row + 1):
            if str(wp.cell(r, i_st).value or "").strip().lower() in ("aprovado", "aprovada"):
                wp.cell(r, i_st).value = "aplicado"
                wp.cell(r, i_rev).value = (wp.cell(r, i_rev).value or "") + \
                    f" | levada à aba principal em {datetime.now():%d/%m/%Y}"
                aplicadas += 1
    wb.save(destino)

    # a planilha nova (sem propostas pendentes) tem de dar o mesmo índice
    novo = parse_xlsx(destino, known_lettered=letrados)
    _, _, av2 = aplicar_propostas(novo, carregar_propostas(destino), known_lettered=letrados)
    if _assinatura(novo) != _assinatura(index) or av2:
        print("⚠ a planilha consolidada NÃO reproduz o índice; nada foi substituído" if args.gravar else
              "⚠ a planilha consolidada NÃO reproduz o índice")
        if args.gravar:
            shutil.copy2(backup, xlsx)
        a, b = _assinatura(index), _assinatura(novo)
        for s in sorted(set(a) | set(b)):
            if a.get(s) != b.get(s):
                print("  diferença em", s)
                break
        return 1
    print(f"{len(linhas)} linhas na aba principal; {aplicadas} propostas marcadas como aplicadas → {destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
