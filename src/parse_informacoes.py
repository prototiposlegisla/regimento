"""Parser do texto da aba de informações → HTML: informacoes.md (o do repositório) ou informacoes.docx."""

from __future__ import annotations

import html
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def parse_informacoes(path: str | Path) -> str:
    """Parseia o texto da aba (.md ou .docx) e retorna HTML."""
    path = Path(path)
    if path.suffix.lower() == ".md":
        return parse_informacoes_md(path.read_text(encoding="utf-8"))
    return _parse_docx(path)


def _inline(text: str) -> str:
    """Escapa e aplica **negrito** e *itálico*."""
    out = html.escape(text, quote=False)
    out = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", out)
    return re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", out)


def parse_informacoes_md(text: str) -> str:
    """Um Markdown pequeno: parágrafos, "- " listas e "### " seções. Cada seção vira uma sanfona
    (<details>) fechada; o que vem antes da primeira (a assinatura e o título) fica solto, como
    no docx. Comentários <!-- --> ficam de fora."""
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    parts: list[str] = []
    lista: list[str] = []
    aberta = False

    def fecha_lista():
        if lista:
            parts.append("<ul>" + "".join(f"<li>{i}</li>" for i in lista) + "</ul>")
            lista.clear()

    for linha in text.splitlines():
        linha = linha.strip()
        if not linha:
            fecha_lista()
            continue
        m = re.match(r"#{1,6}\s*(.*)$", linha)
        if m:
            fecha_lista()
            if aberta:
                parts.append("</details>")
                aberta = False
            if m.group(1).strip():
                parts.append(f'<details class="info-sec"><summary>{_inline(m.group(1).strip())}</summary>')
                aberta = True
            continue
        if linha.startswith("- "):
            lista.append(_inline(linha[2:].strip()))
            continue
        fecha_lista()
        parts.append(f"<p>{_inline(linha)}</p>")
    fecha_lista()
    if aberta:
        parts.append("</details>")
    return "\n".join(parts)


def _parse_docx(path: Path) -> str:
    """Parseia informacoes.docx (Heading + texto) e retorna HTML."""
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
