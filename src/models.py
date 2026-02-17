"""Representação intermediária do Regimento Interno."""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional


class UnitType(str, Enum):
    TITULO = "TITULO"
    CAPITULO = "CAPITULO"
    SECAO = "SECAO"
    SUBSECAO = "SUBSECAO"
    SUBTITLE = "SUBTITLE"
    ARTIGO = "ARTIGO"
    PARAGRAFO_UNICO = "PARAGRAFO_UNICO"
    PARAGRAFO_NUM = "PARAGRAFO_NUM"
    INCISO = "INCISO"
    ALINEA = "ALINEA"
    SUB_ALINEA = "SUB_ALINEA"
    ITEM_NUM = "ITEM_NUM"
    EMPTY = "EMPTY"
    OTHER = "OTHER"


@dataclass
class TextRun:
    """Fragmento de texto com formatação inline."""
    text: str
    bold: bool = False
    italic: bool = False
    strike: bool = False
    hyperlink_url: Optional[str] = None
    hyperlink_anchor: Optional[str] = None


@dataclass
class FootnotePara:
    """Parágrafo dentro de uma nota de rodapé."""
    runs: list[TextRun] = field(default_factory=list)
    indent: bool = False


@dataclass
class Footnote:
    """Nota de rodapé associada a um parágrafo."""
    number: int
    paragraphs: list[FootnotePara] = field(default_factory=list)
    is_private: bool = False  # footnotes with "b " prefix (numeração independente)


@dataclass
class DocumentUnit:
    """Unidade genérica do documento (parágrafo, inciso, etc.)."""
    unit_type: UnitType
    identifier: str  # ex: "Art. 43", "§ 1º", "I", "a)", "Parágrafo único"
    uid: str  # ex: "art43", "art43p1", "art43I", "art43Ia"
    runs: list[TextRun] = field(default_factory=list)
    footnotes: list[Footnote] = field(default_factory=list)
    is_revoked: bool = False
    is_old_version: bool = False
    amendment_note: str = ""  # ex: "(Redação dada pela Resolução nº 21/2017)"
    children: list[DocumentUnit] = field(default_factory=list)

    @property
    def full_text(self) -> str:
        return "".join(r.text for r in self.runs)


@dataclass
class SectionHeading:
    """Título de seção (TÍTULO, CAPÍTULO, SEÇÃO, subtítulo)."""
    level: UnitType  # TITULO, CAPITULO, SECAO, SUBTITLE
    text: str  # ex: "TÍTULO I", "CAPÍTULO II"
    subtitle: str = ""  # ex: "DA CÂMARA MUNICIPAL"
    data_section: str = ""  # id para data-section no HTML


@dataclass
class ArticleBlock:
    """Bloco de um artigo com seus sub-dispositivos."""
    art_number: str  # ex: "43", "4-A", "ADT1"
    is_adt: bool = False  # Ato das Disposições Transitórias
    caput: DocumentUnit | None = None
    children: list[DocumentUnit] = field(default_factory=list)
    all_versions: list[DocumentUnit] = field(default_factory=list)
    summary: str = ""  # síntese do artigo (de footnote com prefixo "s ")
    is_revoked: bool = False
    law_name: str = ""  # ex: "Lei Orgânica do Município de São Paulo"
    law_prefix: str = ""  # ex: "LO" (empty = Regimento, the default)


@dataclass
class ParsedDocument:
    """Documento parseado completo."""
    elements: list[SectionHeading | ArticleBlock] = field(default_factory=list)

    def to_dict(self) -> dict:
        """Serializa para JSON-friendly dict."""
        result = []
        for el in self.elements:
            if isinstance(el, SectionHeading):
                result.append({
                    "type": "heading",
                    "level": el.level.value,
                    "text": el.text,
                    "subtitle": el.subtitle,
                    "data_section": el.data_section,
                })
            elif isinstance(el, ArticleBlock):
                d = {
                    "type": "article",
                    "art_number": el.art_number,
                    "is_adt": el.is_adt,
                    "is_revoked": el.is_revoked,
                    "caput": _unit_to_dict(el.caput) if el.caput else None,
                    "children": [_unit_to_dict(c) for c in el.children],
                    "all_versions": [_unit_to_dict(v) for v in el.all_versions],
                }
                if el.summary:
                    d["summary"] = el.summary
                if el.law_name:
                    d["law_name"] = el.law_name
                if el.law_prefix:
                    d["law_prefix"] = el.law_prefix
                result.append(d)
        return {"elements": result}


def _unit_to_dict(u: DocumentUnit) -> dict:
    return {
        "unit_type": u.unit_type.value,
        "identifier": u.identifier,
        "uid": u.uid,
        "text": u.full_text,
        "runs": [_run_to_dict(r) for r in u.runs],
        "is_revoked": u.is_revoked,
        "is_old_version": u.is_old_version,
        "amendment_note": u.amendment_note,
        "children": [_unit_to_dict(c) for c in u.children],
    }


def _run_to_dict(r: TextRun) -> dict:
    d: dict = {"text": r.text}
    if r.bold:
        d["bold"] = True
    if r.italic:
        d["italic"] = True
    if r.strike:
        d["strike"] = True
    if r.hyperlink_url:
        d["url"] = r.hyperlink_url
    if r.hyperlink_anchor:
        d["anchor"] = r.hyperlink_anchor
    return d


@dataclass
class SubjectRef:
    """Referência de dispositivo no índice remissivo."""
    art: str  # número do artigo
    detail: str = ""  # ex: "§ 1º", "II", "§ú"
    law_prefix: str = ""  # ex: "LO" (empty = Regimento)
    hint: str = ""  # ex: "propor privativamente" (from XLSX parentheses)


@dataclass
class SubjectEntry:
    """Entrada do índice remissivo."""
    subject: str
    sub_subject: str = ""
    refs: list[SubjectRef] = field(default_factory=list)
    vides: list[str] = field(default_factory=list)

    def display_name(self) -> str:
        if self.sub_subject:
            return f"{self.subject} — {self.sub_subject}"
        return self.subject


@dataclass
class SubjectIndex:
    """Índice remissivo completo."""
    entries: list[SubjectEntry] = field(default_factory=list)

    def to_list(self) -> list[dict]:
        """Agrupa entries pelo campo subject, com sub-assuntos aninhados."""
        from collections import OrderedDict

        groups: OrderedDict[str, dict] = OrderedDict()
        for e in self.entries:
            key = e.subject
            if key not in groups:
                groups[key] = {"subject": key, "refs": [], "children": [], "vides": []}

            refs_dicts = []
            for r in e.refs:
                rd: dict = {"art": r.art, "detail": r.detail}
                if r.law_prefix:
                    rd["law_prefix"] = r.law_prefix
                if r.hint:
                    rd["hint"] = r.hint
                refs_dicts.append(rd)
            if e.sub_subject:
                child: dict = {
                    "sub_subject": e.sub_subject,
                    "refs": refs_dicts,
                }
                if e.vides:
                    child["vides"] = e.vides
                groups[key]["children"].append(child)
            else:
                groups[key]["refs"].extend(refs_dicts)
                if e.vides:
                    groups[key]["vides"].extend(e.vides)

        result = list(groups.values())
        # Remove empty children/refs/vides lists for cleaner JSON
        for item in result:
            if not item["children"]:
                del item["children"]
            if not item["refs"]:
                del item["refs"]
            if not item["vides"]:
                del item["vides"]
        return sorted(result, key=lambda x: x["subject"].lower())


@dataclass
class SysIndexNode:
    """Nó do índice sistemático."""
    title: str
    section_id: str = ""
    art_range: str = ""
    children: list[SysIndexNode | SysIndexLeaf] = field(default_factory=list)


@dataclass
class SysIndexLeaf:
    """Folha do índice sistemático (artigo)."""
    label: str  # "Art. 43 — Eleição das Presidências"
    art: str  # "43"


def sys_index_to_list(nodes: list[SysIndexNode | SysIndexLeaf]) -> list[dict]:
    result = []
    for n in nodes:
        if isinstance(n, SysIndexLeaf):
            result.append({"label": n.label, "art": n.art})
        else:
            d: dict = {"title": n.title, "children": sys_index_to_list(n.children)}
            if n.section_id:
                d["section_id"] = n.section_id
            if n.art_range:
                d["art_range"] = n.art_range
            result.append(d)
    return result
