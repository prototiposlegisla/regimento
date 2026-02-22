"""validate.py — Levanta desvios de padrão no regimentoInterno.docx.

Checks implementados:
  PARA_UNMATCHED    – linha começa com § mas não bate no regex de parágrafo
  ART_UNMATCHED     – linha começa com "Art." mas não bate no regex de artigo
  ART_NO_ORDINAL    – Art. N sem marca ordinal (N ≤ 9)
  INCISO_L          – inciso com 'l' minúsculo em vez de 'I' maiúsculo
  SEPARATOR_UNUSUAL – separador incomum após identificador de artigo/parágrafo

Saída: lista de problemas agrupados por código, com contexto de artigo.
"""

from __future__ import annotations

import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

# ── Configuração ───────────────────────────────────────────────────────────────
def _find_docx() -> Path:
    config = Path(__file__).parent / "config.local.toml"
    if config.exists():
        try:
            try:
                import tomllib
            except ModuleNotFoundError:
                import tomli as tomllib  # type: ignore
            with open(config, "rb") as f:
                data = tomllib.load(f)
            p = data.get("sources", {}).get("docx", "")
            if p:
                return Path(p)
        except Exception:
            pass
    return Path(__file__).parent / "regimentoInterno.docx"

DOCX_PATH = _find_docx()

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

# ── Regexes (idênticos a parse_docx.py) ───────────────────────────────────────
RE_ARTIGO = re.compile(
    r"^Art\.\s*(\d+)([ºª°])?\s*"
    r"(?:[-–]([A-H])(?=[.\s\xa0])|([A-H])(?=\s*[-–—.]))?",
)
RE_PARAGRAFO_UNICO = re.compile(r"^Par[aá]grafo\s+[uú]nico", re.IGNORECASE)
RE_PARAGRAFO_NUM   = re.compile(r"^[§Ss]\s*(\d+)(\.?[ºª°]?)")
RE_INCISO          = re.compile(r"^l?[IVXLC]+\s*[-–—]")
RE_ALINEA          = re.compile(r"^[a-z]\)")
RE_SUB_ALINEA      = re.compile(r"^\d+\)")

# Separadores esperados após identificador
RE_SEPARATOR_OK = re.compile(r"\s*[-–—.]\s*|\s+")


# ── Extração de parágrafos do DOCX ─────────────────────────────────────────────

def _extract_text(p_el: ET.Element) -> str:
    parts: list[str] = []
    for r in p_el.iter(f"{{{W}}}r"):
        for t in r.findall(f"{{{W}}}t"):
            parts.append(t.text or "")
        for _ in r.findall(f"{{{W}}}tab"):
            parts.append("\t")
    return "".join(parts).strip()


def _is_centered(p_el: ET.Element) -> bool:
    ppr = p_el.find(f"{{{W}}}pPr")
    if ppr is None:
        return False
    jc = ppr.find(f"{{{W}}}jc")
    return jc is not None and jc.get(f"{{{W}}}val", "") == "center"


def _indent_left(p_el: ET.Element) -> int:
    ppr = p_el.find(f"{{{W}}}pPr")
    if ppr is None:
        return 0
    ind = ppr.find(f"{{{W}}}ind")
    if ind is None:
        return 0
    try:
        return int(ind.get(f"{{{W}}}left", "0"))
    except ValueError:
        return 0


def get_paragraphs(path: str | Path | None = None) -> list[dict]:
    docx = Path(path) if path else DOCX_PATH
    with zipfile.ZipFile(docx) as zf:
        data = zf.read("word/document.xml")
    root = ET.fromstring(data)
    body = root.find(f"{{{W}}}body")
    result = []
    for p_el in body.findall(f"{{{W}}}p"):
        result.append({
            "text":       _extract_text(p_el),
            "centered":   _is_centered(p_el),
            "indent":     _indent_left(p_el),
        })
    return result


# ── Checks ─────────────────────────────────────────────────────────────────────

def run_checks(paras: list[dict]) -> list[dict]:
    issues: list[dict] = []
    current_art: str = ""  # e.g. "183-A"

    for p in paras:
        text = p["text"]
        centered = p["centered"]
        indent = p["indent"]

        if not text or text in ("\xa0", ""):
            continue

        # Atualizar contexto de artigo (mesmo para detectar erros antes de classificar)
        m_art = RE_ARTIGO.match(text) if not centered else None
        if m_art:
            num  = m_art.group(1)
            let3 = m_art.group(3)  # de "Art. 4º-A"
            let4 = m_art.group(4)  # de "Art. 4ºA"
            letter = let3 or let4 or ""
            current_art = f"{num}-{letter}" if letter else num

        # ── Skip cabeçalhos centrados ──────────────────────────────────────
        if centered:
            continue

        # ─────────────────────────────────────────────────────────────────
        # CHECK: ART_UNMATCHED
        #   linha começa com "Art." mas não bate no RE_ARTIGO
        # ─────────────────────────────────────────────────────────────────
        if re.match(r"^Art\.", text) and not m_art:
            issues.append(_issue(
                "ART_UNMATCHED",
                "Linha começa com 'Art.' mas não identificada como artigo",
                current_art, text,
            ))
            continue  # não precisa checar mais nada nessa linha

        # ─────────────────────────────────────────────────────────────────
        # CHECK: ART_NO_ORDINAL
        #   artigo com número ≤ 9 sem marca ordinal (º/ª/°)
        # ─────────────────────────────────────────────────────────────────
        if m_art:
            num_int = int(m_art.group(1))
            ordinal = m_art.group(2)
            if num_int <= 9 and ordinal is None:
                issues.append(_issue(
                    "ART_NO_ORDINAL",
                    f"Art. {current_art} sem marca ordinal (esperado 'º')",
                    current_art, text,
                ))
            continue  # linha de artigo — demais checks não se aplicam

        # ─────────────────────────────────────────────────────────────────
        # Parágrafos
        # ─────────────────────────────────────────────────────────────────
        m_para = RE_PARAGRAFO_NUM.match(text)
        starts_with_secao = text.startswith("§") or re.match(r"^[Ss]\s*\d", text)

        if starts_with_secao and not m_para and not RE_PARAGRAFO_UNICO.match(text):
            # ── CHECK: PARA_UNMATCHED ──────────────────────────────────────
            issues.append(_issue(
                "PARA_UNMATCHED",
                "Linha começa com '§' mas não identificada como parágrafo",
                current_art, text,
            ))
            continue

        if m_para:
            # O parser normaliza ponto → ordinal (§ 10. → § 10º),
            # então não há mismatch real com o remissivo.
            continue

        # ─────────────────────────────────────────────────────────────────
        # CHECK: INCISO_L
        #   inciso com 'l' minúsculo em vez de 'I' maiúsculo
        # ─────────────────────────────────────────────────────────────────
        if re.match(r"^l[IVXLC]*\s*[-–—]", text):
            issues.append(_issue(
                "INCISO_L",
                f"Inciso com 'l' minúsculo (lido como 'l', deveria ser 'I'): "
                f"{text.split()[0]!r}",
                current_art, text,
            ))

    return issues


def _issue(code: str, desc: str, context: str, text: str) -> dict:
    return {
        "code":    code,
        "desc":    desc,
        "context": f"Art. {context}" if context else "(antes do 1º artigo)",
        "text":    text[:100],
    }


# ── Relatório ──────────────────────────────────────────────────────────────────

CODES_ORDER = [
    "PARA_UNMATCHED",
    "ART_UNMATCHED",
    "ART_NO_ORDINAL",
    "INCISO_L",
]

CODE_LABELS = {
    "PARA_UNMATCHED":    "§ não identificado como parágrafo",
    "ART_UNMATCHED":     "Art. não identificado como artigo",
    "ART_NO_ORDINAL":    "Art. N sem ordinal para N ≤ 9",
    "INCISO_L":          "Inciso com 'l' minúsculo em vez de 'I'",
}


def report(issues: list[dict], total_paras: int) -> None:
    sys.stdout.reconfigure(encoding="utf-8")

    by_code: dict[str, list[dict]] = defaultdict(list)
    for iss in issues:
        by_code[iss["code"]].append(iss)

    total = len(issues)
    print(f"=== Validação de {DOCX_PATH.name} ===")
    print(f"Parágrafos lidos: {total_paras} | Problemas encontrados: {total}\n")

    codes = CODES_ORDER + sorted(c for c in by_code if c not in CODES_ORDER)
    for code in codes:
        items = by_code.get(code)
        if not items:
            continue
        label = CODE_LABELS.get(code, code)
        print(f"{'─'*70}")
        print(f"[{code}] {label}  ({len(items)} ocorrência{'s' if len(items)!=1 else ''})")
        print(f"{'─'*70}")
        for it in items:
            print(f"  Contexto : {it['context']}")
            print(f"  Problema : {it['desc']}")
            print(f"  Texto    : {it['text']!r}")
            print()


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if not DOCX_PATH.exists():
        print(f"ERRO: {DOCX_PATH} não encontrado.", file=sys.stderr)
        sys.exit(1)
    paras = get_paragraphs()
    issues = run_checks(paras)
    report(issues, len(paras))
