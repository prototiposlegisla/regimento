"""Parser de referencias.docx usando stdlib (zipfile + xml.etree)."""

from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

# Matches "– Art. 10", "– Art. 18, XII", "– Art. 1º, §2º" at end of text
RE_ART_REF = re.compile(r"\s*[–—-]\s*Art\.\s*(.+)$")


def parse_referencias(path: str | Path) -> list[dict]:
    """Parseia referencias.docx e retorna lista de categorias com grupos e entries."""
    path = Path(path)
    with zipfile.ZipFile(path, "r") as zf:
        data = zf.read("word/document.xml")

    root = ET.fromstring(data)
    body = root.find("w:body", NS)
    paragraphs = _extract_paragraphs(body)

    return _build_structure(paragraphs)


def _extract_paragraphs(body: ET.Element) -> list[dict]:
    """Extrai informações de cada parágrafo: estilo, runs, texto."""
    result = []
    for p in body.findall("w:p", NS):
        pPr = p.find("w:pPr", NS)
        style = None
        if pPr is not None:
            ps = pPr.find("w:pStyle", NS)
            if ps is not None:
                style = ps.get(f"{{{NS['w']}}}val")

        runs = []
        all_bold = True
        full_text = ""
        for r in p.findall("w:r", NS):
            t_el = r.find("w:t", NS)
            text = t_el.text if t_el is not None else ""
            rPr = r.find("w:rPr", NS)
            is_bold = rPr is not None and rPr.find("w:b", NS) is not None
            runs.append({"text": text, "bold": is_bold})
            full_text += text
            if text.strip() and not is_bold:
                all_bold = False

        result.append({
            "style": style,
            "runs": runs,
            "text": full_text,
            "all_bold": all_bold,
            "empty": not full_text.strip(),
        })

    return result


def _runs_to_html(runs: list[dict], strip_ref: bool = True) -> str:
    """Converte runs em HTML preservando bold inline."""
    # Build full text first, then strip trailing art ref
    full_text = "".join(r["text"] for r in runs)
    ref_suffix = ""
    if strip_ref:
        m = RE_ART_REF.search(full_text)
        if m:
            ref_suffix = full_text[m.start():]
            # We need to strip this from the runs output
            cut_pos = m.start()
        else:
            cut_pos = len(full_text)
    else:
        cut_pos = len(full_text)

    html_parts = []
    pos = 0
    for run in runs:
        t = run["text"]
        if pos + len(t) <= cut_pos:
            # Entire run is before the cut
            if run["bold"] and t.strip():
                html_parts.append(f"<b>{_esc(t)}</b>")
            else:
                html_parts.append(_esc(t))
        elif pos < cut_pos:
            # Partial run
            keep = t[:cut_pos - pos]
            if run["bold"] and keep.strip():
                html_parts.append(f"<b>{_esc(keep)}</b>")
            else:
                html_parts.append(_esc(keep))
        pos += len(t)

    return "".join(html_parts).strip()


def _esc(text: str) -> str:
    """Escapa HTML básico."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _extract_art_ref(text: str) -> str | None:
    """Extrai referência de artigo do final do texto (ex: '10', '18, XII')."""
    m = RE_ART_REF.search(text)
    if m:
        return m.group(1).strip().rstrip(".")
    return None


def _build_structure(paragraphs: list[dict]) -> list[dict]:
    """Agrupa parágrafos em categorias → subcategorias → entries."""
    categories: list[dict] = []
    current_cat: dict | None = None
    current_group: dict | None = None

    for para in paragraphs:
        if para["empty"]:
            continue

        # Heading1 = new category
        if para["style"] and para["style"].startswith("Heading"):
            current_cat = {
                "category": para["text"].strip(),
                "groups": [],
            }
            categories.append(current_cat)
            current_group = None
            continue

        # All bold, uppercase = subcategory
        if para["all_bold"] and para["text"].strip() == para["text"].strip().upper():
            if current_cat is None:
                current_cat = {"category": "Geral", "groups": []}
                categories.append(current_cat)
            current_group = {
                "title": para["text"].strip(),
                "entries": [],
            }
            current_cat["groups"].append(current_group)
            continue

        # Otherwise = entry
        if current_cat is None:
            current_cat = {"category": "Geral", "groups": []}
            categories.append(current_cat)
        if current_group is None:
            current_group = {"title": "", "entries": []}
            current_cat["groups"].append(current_group)

        art_ref = _extract_art_ref(para["text"])
        html = _runs_to_html(para["runs"], strip_ref=True)

        current_group["entries"].append({
            "html": html,
            "art_ref": art_ref,
        })

    return categories
