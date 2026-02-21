"""Parser de informacoes.docx → HTML para aba de informações."""

from __future__ import annotations

import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def parse_informacoes(path: str | Path) -> str:
    """Parseia informacoes.docx (Heading + texto) e retorna HTML."""
    path = Path(path)
    with zipfile.ZipFile(path, "r") as zf:
        data = zf.read("word/document.xml")

    root = ET.fromstring(data)
    body = root.find("w:body", NS)

    html_parts: list[str] = []

    for p in body.findall("w:p", NS):
        style = _get_style(p)
        text = _get_text(p).strip()
        if not text:
            continue

        if style and style.startswith("Heading"):
            html_parts.append(f"<h3>{_esc(text)}</h3>")
        else:
            html_parts.append(f"<p>{_esc(text)}</p>")

    return "\n".join(html_parts)


def _get_style(p: ET.Element) -> str | None:
    pPr = p.find("w:pPr", NS)
    if pPr is not None:
        ps = pPr.find("w:pStyle", NS)
        if ps is not None:
            return ps.get(f"{{{NS['w']}}}val")
    return None


def _get_text(p: ET.Element) -> str:
    parts = []
    for r in p.findall("w:r", NS):
        t_el = r.find("w:t", NS)
        if t_el is not None and t_el.text:
            parts.append(t_el.text)
    return "".join(parts)


def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
