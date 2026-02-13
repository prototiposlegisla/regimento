"""Parser de remissivo.xlsx → SubjectIndex."""

from __future__ import annotations

import re
from pathlib import Path

from .models import SubjectEntry, SubjectIndex, SubjectRef


def parse_xlsx(path: str | Path) -> SubjectIndex:
    """Parseia remissivo.xlsx e retorna SubjectIndex."""
    import openpyxl

    path = Path(path)
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(min_row=2, values_only=True))
    wb.close()

    entries: list[SubjectEntry] = []
    for row in rows:
        if not row or len(row) < 3:
            continue

        assunto = str(row[0] or "").strip()
        sub_assunto = str(row[1] or "").strip() if row[1] else ""
        dispositivos_raw = str(row[2] or "").strip() if row[2] else ""
        vides_raw = str(row[3] or "").strip() if len(row) > 3 and row[3] else ""

        if not assunto:
            continue

        refs = _parse_dispositivos(dispositivos_raw)
        vides = [v.strip() for v in vides_raw.split("\n") if v.strip()] if vides_raw else []

        entries.append(SubjectEntry(
            subject=assunto,
            sub_subject=sub_assunto,
            refs=refs,
            vides=vides,
        ))

    return SubjectIndex(entries=entries)


def _parse_dispositivos(raw: str) -> list[SubjectRef]:
    """Converte string de dispositivos em lista de SubjectRef.

    Formatos aceitos:
    - "211-275"       → range de artigos
    - "175,II"        → artigo + inciso
    - "176,§10"       → artigo + parágrafo
    - "176,PU"        → artigo + parágrafo único
    - "176"           → artigo só
    - Múltiplos separados por \\n
    """
    refs: list[SubjectRef] = []
    lines = raw.split("\n")

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Range: "211-275"
        range_m = re.match(r"^(\d+)\s*[-–—]\s*(\d+)$", line)
        if range_m:
            start = int(range_m.group(1))
            end = int(range_m.group(2))
            for n in range(start, end + 1):
                refs.append(SubjectRef(art=str(n)))
            continue

        # Single or with detail: "175,II" or "176,§10" or "176"
        parts = line.split(",", 1)
        art = parts[0].strip()

        if not re.match(r"^\d+[-A-Za-z]*$", art):
            # Not a valid article reference, skip
            continue

        if len(parts) == 1:
            refs.append(SubjectRef(art=art))
        else:
            detail_raw = parts[1].strip()
            detail = _normalize_detail(detail_raw)
            refs.append(SubjectRef(art=art, detail=detail))

    return refs


def _normalize_detail(raw: str) -> str:
    """Normaliza detalhe do dispositivo para exibição.

    "II" → "II"
    "§10" → "§ 10"
    "§1" → "§ 1º"
    "PU" → "Parágrafo único"
    "p1" → "§ 1º"
    """
    raw = raw.strip()

    if raw.upper() == "PU":
        return "Parágrafo único"

    # §N → § Nº
    m = re.match(r"^[§Ss]\s*(\d+)$", raw)
    if m:
        num = m.group(1)
        return f"§ {num}º"

    # pN → § Nº
    m = re.match(r"^p(\d+)$", raw, re.IGNORECASE)
    if m:
        num = m.group(1)
        return f"§ {num}º"

    # Roman numeral (inciso)
    if re.match(r"^[IVXLC]+$", raw):
        return raw

    # Alínea
    if re.match(r"^[a-z]\)$", raw):
        return raw

    return raw
