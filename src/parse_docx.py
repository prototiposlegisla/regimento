"""Parser de regimentoInterno.docx usando stdlib (zipfile + xml.etree)."""

from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from .models import (
    TextRun, DocumentUnit, SectionHeading, ArticleBlock,
    ParsedDocument, UnitType, Footnote, FootnotePara, PREC, prec_label,
)

# ── Namespaces ──────────────────────────────────────────────────────────
NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "w14": "http://schemas.microsoft.com/office/word/2010/wordml",
}

REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
HYPERLINK_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
)

# ── Regex de classificação ──────────────────────────────────────────────
RE_TITULO = re.compile(r"^T[ÍI]TULO\s+", re.IGNORECASE)
RE_CAPITULO = re.compile(r"^CAP[ÍI]TULO\s+", re.IGNORECASE)
RE_SECAO = re.compile(r"^SE[ÇC][ÃA]O\s+", re.IGNORECASE)
RE_SUBSECAO = re.compile(r"^SUBSE[ÇC][ÃA]O\s+", re.IGNORECASE)
# Matches: Art. 43, Art. 183-A, Art. 4ºA, Art. 4º-C.
# Group 1 = number, Group 2 = ordinal mark, Group 3/4 = optional letter suffix
RE_ARTIGO = re.compile(
    r"^Art\.\s*(\d+)([ºª°])?\s*"
    r"(?:[-–]([A-H])(?=[.\s\xa0])|([A-H])(?=\s*[-–—.]))?",
)
RE_PARAGRAFO_UNICO = re.compile(r"^Par[aá]grafo\s+[uú]nico", re.IGNORECASE)
# Group 3 = letter of an inserted paragraph, as in "§ 1º-A.", "§ 1º-A -" or, in the CF,
# "§ 9º-B Os recursos" / "§ 9º-A Do limite" (hyphen and letter glued to the number; an "A"
# then a capitalized word only if that word can't follow the article "A": "A O", "A Do");
# "§ 1º - A destituição...", "§ 2º-A Mesa decidirá" and "§ 3º-O Presidente..." are not
RE_PARAGRAFO_NUM = re.compile(
    r"^[§Ss]\s*(\d+)(\.?[ºª°]?)"
    r"(?:-(?=[B-H](?:\.|[\s\xa0]*[-–—]|[\s\xa0]+[A-ZÀ-Ú])"
    r"|A(?:\.|[\s\xa0]*[-–—]|[\s\xa0]+(?:O|Os|As|Do|Da|Dos|Das|No|Na|Nos|Nas|Ao|Aos|Em|É|Para)\b))([A-H]))?"
)
# "IV - texto"; na CF do Planalto, às vezes sem o travessão: "II que exerçam atividades de risco"
RE_INCISO = re.compile(r"^l?[IVXLC]+(?:\s*[-–—]|\s+(?=[a-záéíóúâêôãõç]))")
RE_ALINEA = re.compile(r"^[a-z]\)")
RE_SUB_ALINEA = re.compile(r"^\d+\)")
RE_ITEM_NUM = re.compile(r"^\d+\s*[-–—]")
RE_SUBTITLE_PREFIX = re.compile(
    r"^(D[AOES]S?\s|ATO\s|DISPOSIÇÕES|DISPOSICOES)", re.IGNORECASE
)
RE_ADT_MARKER = re.compile(
    r"ATO\s+D[AO]S?\s+DISPOSI[ÇC][ÕO]ES\s+TRANSIT[ÓO]RIAS",
    re.IGNORECASE,
)
RE_DGT_MARKER = re.compile(
    r"DISPOSI[ÇC][ÕO]ES\s+GERAIS\s+E\s+TRANSIT[ÓO]RIAS",
    re.IGNORECASE,
)
RE_AMENDMENT = re.compile(
    r"\((Reda[çc][ãa]o\s+dada|Revogad[oa]|Reda[çc][ãa]o\s+reestabelecida|"
    r"Acrescentad[oa]|Renumerad[oa]|Inclu[ií]d[oa])",
    re.IGNORECASE,
)
RE_NORMA = re.compile(r"^NORMA:\s*(.+)", re.IGNORECASE)
# Seção dos precedentes ("NORMA: Precedentes Regimentais") e o título de cada um:
# "PRECEDENTE REGIMENTAL Nº 2/2004", "SEM NÚMERO, DE 1997" e as variantes das
# publicações oficiais ("nº 02/93", "01/2026", "N.º 2", "Nº 3, DE 8 DE OUTUBRO DE 2021")
RE_NORMA_PREC = re.compile(r"^Precedentes\s+Regimentais", re.IGNORECASE)
RE_PRECEDENTE = re.compile(
    r"^PRECEDENTE\s+REGIMENTAL\s+(?:N\s*\.?\s*[º°o]?\.?\s*)?"
    r"(?:(\d{1,3})\s*(?:/\s*(\d{4}|\d{2})(?!\d)|,?\s+DE\s+(?:\d{1,2}º?\s+DE\s+[A-ZÇa-zç]+\s+DE\s+)?(\d{4}))"
    r"|\(?SEM\s+N[ÚU]MERO\)?,?\s+DE\s+(\d{4}))",
    re.IGNORECASE,
)
RE_TITULO_PREC = re.compile(r"^\s*PRECEDENTE\s+REGIMENTAL\b", re.IGNORECASE)   # para avisar se não casar


def prec_number(m: re.Match) -> str:
    """"número/ano" de um título de precedente ("0/1997" = sem número)."""
    ano = m.group(2) or m.group(3) or m.group(4)
    if len(ano) == 2:
        ano = str((2000 if int(ano) < 50 else 1900) + int(ano))
    return f"{int(m.group(1)) if m.group(1) else 0}/{ano}"
# Início da primeira nota de um dispositivo: "(Redação dada...", "(Revogado...", "(Vide..." etc.
RE_NOTE_START = re.compile(
    r"\(\s*(?:Reda[çc][ãa]o|Inclu[ií]d|Inserid|Acrescentad|Revogad|Renumerad|Alterad|"
    r"Vide\b|Suprimid|Declarad|Adin\b|ADI\b|Precedente|NR\)|Vig[êe]ncia|Produ[çc][ãa]o|"
    r"Novamente|Designad|Restabelecid|Reestabelecid)",
    re.IGNORECASE,
)
# Identificador no início do dispositivo, com o separador: "Art. 5º -", "§ 1º-A.", "IV —", "b)"
RE_LEADING_IDENT = re.compile(
    r"^\s*(?:Art\.?\s*\d+\s*[ºª°]?(?:-?[A-H](?=[.\s\xa0\-–—]))?|[§Ss]\s*\d+\s*\.?\s*[ºª°]?(?:-[A-H]\b)?|"
    r"Par[aá]grafo\s+[uú]nico|l?[IVXLC]+(?=\s*[-–—])|[a-z]\)|\d+\s*\)|\d+(?=\s*[-–—]))"
    r"\s*[-–—.:]?\s*",
    re.IGNORECASE,
)


def parse_docx(path: str | Path, *, include_private: bool = False) -> ParsedDocument:
    """Parseia o DOCX e retorna um ParsedDocument.

    Args:
        include_private: Se True, inclui footnotes com prefixo "b " (notas privadas).
    """
    path = Path(path)
    with zipfile.ZipFile(path, "r") as zf:
        rels = _parse_rels(zf)
        footnotes_map, summaries_map, private_fn_ids, legislacao_map = _parse_footnotes_xml(
            zf, include_private=include_private, rels=_parse_rels(zf, "word/_rels/footnotes.xml.rels"))
        paragraphs = _parse_document_xml(zf, rels)

    raw_units = _classify_paragraphs(paragraphs)
    doc = _build_document(raw_units, footnotes_map, summaries_map, private_fn_ids, legislacao_map)
    return doc


# ── Leitura do XML ─────────────────────────────────────────────────────

def _parse_rels(zf: zipfile.ZipFile, name: str = "word/_rels/document.xml.rels") -> dict[str, tuple[str, str]]:
    """Parseia os links de um .rels (word/_rels/document.xml.rels) → {rId: (url, target_mode)}."""
    rels: dict[str, tuple[str, str]] = {}
    try:
        data = zf.read(name)
    except KeyError:
        return rels

    root = ET.fromstring(data)
    for rel in root:
        tag = rel.tag
        if "}" in tag:
            tag = tag.split("}", 1)[1]
        if tag == "Relationship":
            rid = rel.get("Id", "")
            rtype = rel.get("Type", "")
            target = rel.get("Target", "")
            mode = rel.get("TargetMode", "")
            if HYPERLINK_TYPE in rtype:
                rels[rid] = (target, mode)
    return rels


def _parse_footnotes_xml(
    zf: zipfile.ZipFile,
    *,
    include_private: bool = False,
    rels: dict[str, tuple[str, str]] | None = None,
) -> tuple[dict[int, list[FootnotePara]], dict[int, str], set[int], dict[int, list[FootnotePara]]]:
    """Parseia word/footnotes.xml → (footnotes_map, summaries_map, private_fn_ids, legislacao_map).

    Footnotes whose content starts with "b " (build notes) are excluded
    unless *include_private* is True.
    Footnotes whose content starts with "s " are extracted as article
    summaries (the text after "s " is the summary string).
    Footnotes whose content starts with "L " are legislação correlata: one
    norm per paragraph, usually with a link (*rels* = the footnotes' links).
    *private_fn_ids* contains the Word footnote IDs that had the "b " prefix.
    """
    w = NS["w"]
    rels = rels or {}
    footnotes: dict[int, list[FootnotePara]] = {}
    summaries: dict[int, str] = {}
    private_fn_ids: set[int] = set()
    legislacao: dict[int, list[FootnotePara]] = {}
    try:
        data = zf.read("word/footnotes.xml")
    except KeyError:
        return footnotes, summaries, private_fn_ids, legislacao

    root = ET.fromstring(data)
    for fn_el in root.findall(f"{{{w}}}footnote"):
        fn_id_str = fn_el.get(f"{{{w}}}id", "")
        fn_type = fn_el.get(f"{{{w}}}type", "")
        # Skip built-in separator/continuationSeparator footnotes
        if fn_type in ("separator", "continuationSeparator"):
            continue
        try:
            fn_id = int(fn_id_str)
        except ValueError:
            continue

        paras: list[FootnotePara] = []
        for p_el in fn_el.findall(f"{{{w}}}p"):
            runs: list[TextRun] = []
            for child in p_el:
                # runs, also inside links (as in the document's paragraphs)
                if child.tag == f"{{{w}}}hyperlink":
                    rid = child.get(f"{{{NS['r']}}}id", "")
                    url = rels[rid][0] if rid in rels else ""
                    anchor = child.get(f"{{{w}}}anchor", "")
                    r_els, link = child.findall(f"{{{w}}}r"), (url or None, anchor or None)
                elif child.tag == f"{{{w}}}r":
                    r_els, link = [child], (None, None)
                else:
                    continue
                for r_el in r_els:
                    # Skip footnoteRef marker run (just the superscript number)
                    if r_el.find(f"{{{w}}}footnoteRef") is not None:
                        continue
                    tr = _parse_run(r_el, w)
                    if tr.text:
                        tr.hyperlink_url, tr.hyperlink_anchor = link
                        runs.append(tr)
            # Detect paragraph indent via <w:ind w:left="...">
            indent = False
            ppr = p_el.find(f"{{{w}}}pPr")
            if ppr is not None:
                ind_el = ppr.find(f"{{{w}}}ind")
                if ind_el is not None and ind_el.get(f"{{{w}}}left", "0") != "0":
                    indent = True
            paras.append(FootnotePara(runs=runs, indent=indent))

        # Check first non-empty paragraph for special prefixes
        first_text = ""
        for p in paras:
            first_text = "".join(r.text for r in p.runs).strip()
            if first_text:
                break
        # Exclude build notes: "b " prefix (unless include_private)
        if not include_private and (first_text.lower() == "b" or first_text[:2].lower() == "b "):
            continue
        # When including private notes, strip the "b " prefix and track the ID
        if include_private and (first_text.lower() == "b" or first_text[:2].lower() == "b "):
            private_fn_ids.add(fn_id)
            # Remove "b " prefix from the first non-empty paragraph's first run
            for p in paras:
                txt = "".join(r.text for r in p.runs).strip()
                if txt:
                    # Strip "b " or "b" from the beginning of the first run
                    for r in p.runs:
                        stripped = r.text.lstrip()
                        if stripped.lower().startswith("b "):
                            # only the prefix: "b Nota B sobre" → "Nota B sobre"
                            r.text = r.text[:len(r.text) - len(stripped)] + stripped[2:]
                            break
                        elif stripped.lower() == "b":
                            r.text = ""
                            break
                    break
        # Summary notes: "s " prefix → extract as summary text
        if first_text[:2].lower() == "s ":
            summaries[fn_id] = first_text[2:].strip()
            continue
        # Legislação correlata: "L " prefix → one norm per non-empty paragraph
        if first_text[:2].lower() == "l ":
            _strip_prefix(paras)
            legislacao[fn_id] = [p for p in paras if "".join(r.text for r in p.runs).strip()]
            continue

        footnotes[fn_id] = paras
    return footnotes, summaries, private_fn_ids, legislacao


def _strip_prefix(paras: list[FootnotePara], n: int = 1) -> None:
    """Remove o prefixo (a letra "L") do primeiro parágrafo com texto, e os espaços em volta.

    O Word pode gravar a letra, o espaço e o nome da norma em runs diferentes (inclusive
    dentro do link): primeiro some a letra, depois só os espaços até o primeiro caractere.
    """
    for p in paras:
        if not "".join(r.text for r in p.runs).strip():
            continue
        tirados = 0
        for r in p.runs:
            if tirados < n:
                s = r.text.lstrip()
                take = min(n - tirados, len(s))
                r.text, tirados = s[take:], tirados + take
                if tirados < n:
                    continue
            r.text = r.text.lstrip()
            if r.text:
                break
        p.runs = [r for r in p.runs if r.text]
        return


from dataclasses import dataclass as _dc


@_dc
class _RawParagraph:
    text: str
    runs: list[TextRun]
    is_centered: bool
    has_strike: bool
    indent_left: int
    bookmark_name: str
    footnote_ids: list[int]  # IDs of footnotes referenced in this paragraph


def _parse_document_xml(
    zf: zipfile.ZipFile, rels: dict[str, tuple[str, str]]
) -> list[_RawParagraph]:
    """Parseia word/document.xml e retorna lista de parágrafos raw."""
    data = zf.read("word/document.xml")
    root = ET.fromstring(data)
    body = root.find(f"{{{NS['w']}}}body")
    if body is None:
        return []

    paragraphs: list[_RawParagraph] = []
    for p_el in body.findall(f"{{{NS['w']}}}p"):
        para = _parse_paragraph(p_el, rels)
        paragraphs.append(para)
    return paragraphs


def _parse_paragraph(
    p_el: ET.Element, rels: dict[str, tuple[str, str]]
) -> _RawParagraph:
    w = NS["w"]
    r_ns = NS["r"]

    # Paragraph properties
    ppr = p_el.find(f"{{{w}}}pPr")
    is_centered = False
    indent_left = 0
    if ppr is not None:
        jc = ppr.find(f"{{{w}}}jc")
        if jc is not None and jc.get(f"{{{w}}}val", "") == "center":
            is_centered = True
        ind = ppr.find(f"{{{w}}}ind")
        if ind is not None:
            left_val = ind.get(f"{{{w}}}left", "0")
            try:
                indent_left = int(left_val)
            except ValueError:
                pass

    # Bookmark name (first bookmark in paragraph)
    bookmark_name = ""
    bm = p_el.find(f"{{{w}}}bookmarkStart")
    if bm is not None:
        bookmark_name = bm.get(f"{{{w}}}name", "")

    # Collect runs (both direct w:r and inside w:hyperlink)
    runs: list[TextRun] = []
    has_strike = False
    footnote_ids: list[int] = []

    for child in p_el:
        tag = child.tag
        if tag == f"{{{w}}}r":
            # Check for footnoteReference inside this run
            fn_ref = child.find(f"{{{w}}}footnoteReference")
            if fn_ref is not None:
                fn_id_str = fn_ref.get(f"{{{w}}}id", "")
                try:
                    footnote_ids.append(int(fn_id_str))
                except ValueError:
                    pass
                # Don't skip — there might also be text in this run
            tr = _parse_run(child, w)
            if tr.text:
                runs.append(tr)
                if tr.strike:
                    has_strike = True
        elif tag == f"{{{w}}}hyperlink":
            # Get hyperlink target
            rid = child.get(f"{{{r_ns}}}id", "")
            anchor = child.get(f"{{{w}}}anchor", "")
            url = ""
            if rid and rid in rels:
                url = rels[rid][0]
            for r_el in child.findall(f"{{{w}}}r"):
                tr = _parse_run(r_el, w)
                if tr.text:
                    tr.hyperlink_url = url or None
                    tr.hyperlink_anchor = anchor or None
                    runs.append(tr)
                    if tr.strike:
                        has_strike = True

    full_text = "".join(r.text for r in runs).strip()

    all_strike = _is_predominantly_struck(runs)

    return _RawParagraph(
        text=full_text,
        runs=runs,
        is_centered=is_centered,
        has_strike=all_strike,
        indent_left=indent_left,
        bookmark_name=bookmark_name,
        footnote_ids=footnote_ids,
    )


def _is_predominantly_struck(runs: list[TextRun]) -> bool:
    """Diz se o parágrafo é uma redação tachada (antiga ou revogada).

    Critério 1: mais de 50% dos caracteres (sem espaços) tachados — o Word
    costuma deixar o identificador sem tachado.
    Critério 2: o corpo (o texto entre o identificador e as notas finais, como
    "(Revogado pela ...)" ou "(Vide ...)") pelo menos 75% tachado. As notas
    muitas vezes ficam sem tachado e, quando longas, superam um corpo todo
    tachado. A exigência maior preserva o dispositivo vigente com só um trecho
    tachado (ex.: parte declarada inconstitucional).
    """
    strike_chars = sum(len(r.text.strip()) for r in runs if r.strike)
    total_chars = sum(len(r.text.strip()) for r in runs)
    if total_chars > 0 and strike_chars > total_chars * 0.5:
        return True
    text = "".join(r.text for r in runs)
    mask = [r.strike for r in runs for _ in r.text]
    m_ident = RE_LEADING_IDENT.match(text)
    start = m_ident.end() if m_ident else 0
    tail = note_tail_spans(text)
    end = max(start, tail[0][0]) if tail else len(text)
    body = [s for c, s in zip(text[start:end], mask[start:end]) if not c.isspace()]
    return bool(body) and sum(body) >= len(body) * 0.75


def note_tail_spans(text: str) -> list[tuple[int, int]]:
    """Posições das notas no fim do dispositivo: "... (Redação dada ...) (Vide ...)."

    Só a cadeia final conta; um "(vide art. 5º)" no meio do texto é texto normativo.
    """
    spans: list[tuple[int, int]] = []
    end = len(text)
    while True:
        k = end
        while k > 0 and text[k - 1] in " \xa0\t.;,:":
            k -= 1
        if k == 0 or text[k - 1] != ")":
            break
        depth, j = 0, k - 1
        while j >= 0:
            if text[j] == ")":
                depth += 1
            elif text[j] == "(":
                depth -= 1
                if depth == 0:
                    break
            j -= 1
        if j < 0 or not RE_NOTE_START.match(text, j):
            break
        spans.append((j, k))
        end = j
    return spans[::-1]


def _parse_run(r_el: ET.Element, w: str) -> TextRun:
    """Parseia um <w:r> e retorna TextRun."""
    rpr = r_el.find(f"{{{w}}}rPr")
    bold = False
    italic = False
    strike = False
    if rpr is not None:
        if rpr.find(f"{{{w}}}b") is not None:
            bold = True
        if rpr.find(f"{{{w}}}i") is not None:
            italic = True
        if rpr.find(f"{{{w}}}strike") is not None:
            strike = True

    text_parts = []
    for t_el in r_el.findall(f"{{{w}}}t"):
        text_parts.append(t_el.text or "")
    # Also handle w:tab, w:br
    for tab_el in r_el.findall(f"{{{w}}}tab"):
        text_parts.append("\t")
    for br_el in r_el.findall(f"{{{w}}}br"):
        text_parts.append("\n")

    text = "".join(text_parts)

    return TextRun(text=text, bold=bold, italic=italic, strike=strike)


# ── Classificação de parágrafos ─────────────────────────────────────────

@_dc
class _ClassifiedParagraph:
    unit_type: UnitType
    identifier: str
    text: str
    runs: list[TextRun]
    is_centered: bool
    has_strike: bool
    indent_left: int
    bookmark_name: str
    art_number: str  # set only for ARTIGO
    footnote_ids: list[int]


def _classify_paragraphs(
    paragraphs: list[_RawParagraph],
) -> list[_ClassifiedParagraph]:
    result: list[_ClassifiedParagraph] = []
    for p in paragraphs:
        cp = _classify_one(p)
        result.append(cp)
    return result


def _classify_one(p: _RawParagraph) -> _ClassifiedParagraph:
    text = p.text.strip()
    art_number = ""

    if not text or text == "\xa0":
        ut = UnitType.EMPTY
        ident = ""
    elif p.is_centered:
        # Centered text → heading or subtitle
        if RE_TITULO.match(text):
            ut = UnitType.TITULO
            ident = text
        elif RE_CAPITULO.match(text):
            ut = UnitType.CAPITULO
            ident = text
        elif RE_SECAO.match(text):
            ut = UnitType.SECAO
            ident = text
        elif RE_SUBSECAO.match(text):
            ut = UnitType.SUBSECAO
            ident = text
        else:
            ut = UnitType.SUBTITLE
            ident = text
    else:
        # Body text
        m = RE_ARTIGO.match(text)
        if m:
            ut = UnitType.ARTIGO
            num_part = m.group(1)
            ordinal = m.group(2) or ""
            letter_with_dash = m.group(3)   # "A" from "-A"
            letter_no_dash = m.group(4)     # "A" from "ºA"
            letter_part = letter_with_dash or letter_no_dash or ""
            art_number = f"{num_part}-{letter_part}" if letter_part else num_part
            if letter_with_dash:
                ident = f"Art. {num_part}{ordinal}-{letter_with_dash}"
            elif letter_no_dash:
                ident = f"Art. {num_part}{ordinal}{letter_no_dash}"
            else:
                ident = f"Art. {num_part}{ordinal}"
        elif RE_PARAGRAFO_UNICO.match(text):
            ut = UnitType.PARAGRAFO_UNICO
            ident = "Parágrafo único"
        elif RE_PARAGRAFO_NUM.match(text):
            m2 = RE_PARAGRAFO_NUM.match(text)
            num = m2.group(1) if m2 else ""
            raw_suffix = m2.group(2) if m2 and m2.group(2) else ""
            # Normaliza: remove ponto antes de ordinal (§ 1.º → § 1º, § 10. → § 10º)
            # e converte degree sign ° (U+00B0) → ordinal º (U+00BA)
            suffix = raw_suffix.lstrip(".").replace("\u00b0", "\u00ba") or "º"
            letter = m2.group(3) if m2 and m2.group(3) else ""
            ut = UnitType.PARAGRAFO_NUM
            ident = f"§ {num}{suffix}" + (f"-{letter}" if letter else "")
        elif RE_INCISO.match(text):
            ut = UnitType.INCISO
            # Extract roman numeral
            m3 = re.match(r"^(l?[IVXLC]+)", text)
            raw = m3.group(1) if m3 else ""
            # Fix common typo: lowercase L at start = I
            if raw.startswith("l"):
                raw = "I" + raw[1:]
            ident = raw
        elif RE_ALINEA.match(text):
            ut = UnitType.ALINEA
            ident = text[0] + ")"
        elif RE_SUB_ALINEA.match(text) and p.indent_left >= 600:
            ut = UnitType.SUB_ALINEA
            m4 = re.match(r"^(\d+)\)", text)
            ident = m4.group(0) if m4 else text[:3]
        elif RE_ITEM_NUM.match(text):
            ut = UnitType.ITEM_NUM
            m5 = re.match(r"^(\d+)", text)
            ident = m5.group(1) if m5 else ""
        elif RE_SUB_ALINEA.match(text):
            # Numbered items like "1)" without extra indent → treat as ITEM_NUM
            ut = UnitType.ITEM_NUM
            m4 = re.match(r"^(\d+)\)", text)
            ident = m4.group(0) if m4 else text[:3]
        else:
            ut = UnitType.OTHER
            ident = ""

    return _ClassifiedParagraph(
        unit_type=ut,
        identifier=ident,
        text=text,
        runs=p.runs,
        is_centered=p.is_centered,
        has_strike=p.has_strike,
        indent_left=p.indent_left,
        bookmark_name=p.bookmark_name,
        art_number=art_number,
        footnote_ids=p.footnote_ids,
    )


# ── Construção do documento ─────────────────────────────────────────────

def _build_document(
    classified: list[_ClassifiedParagraph],
    footnotes_map: dict[int, list[FootnotePara]] | None = None,
    summaries_map: dict[int, str] | None = None,
    private_fn_ids: set[int] | None = None,
    legislacao_map: dict[int, list[FootnotePara]] | None = None,
) -> ParsedDocument:
    """Constrói ParsedDocument a partir dos parágrafos classificados."""
    legislacao_map = legislacao_map or {}

    def legislacao(fn_ids: list[int]) -> list[FootnotePara]:
        return [p for f in fn_ids for p in legislacao_map.get(f, [])]

    if footnotes_map is None:
        footnotes_map = {}
    if summaries_map is None:
        summaries_map = {}
    if private_fn_ids is None:
        private_fn_ids = set()
    footnote_counter = [0]  # mutable counter for global numbering
    private_counter = [0]   # mutable counter for private "b" notes (resets per article)

    doc = ParsedDocument()
    in_adt = False  # Ato das Disposições Transitórias
    current_article: ArticleBlock | None = None
    current_law_name: str = ""  # Set by NORMA: markers
    in_prec = False  # in the Precedentes Regimentais section
    prec_par = 0     # paragraph counter inside the current precedent (uids)
    uid_ctx: list[str] = ["", "", "", ""]  # [para, inciso, alinea, sub_alinea]
    seen_uids: set[str] = set()  # global dedup for collision detection

    # Section ID counters (globally unique)
    titulo_count = 0
    capitulo_count = 0
    secao_count = 0
    subsecao_count = 0
    norma_count = 0

    i = 0
    while i < len(classified):
        cp = classified[i]

        if cp.unit_type == UnitType.EMPTY:
            i += 1
            continue

        # Detect NORMA: marker (sets current law for subsequent articles)
        if cp.is_centered:
            norma_m = RE_NORMA.match(cp.text)
            if norma_m:
                current_law_name = norma_m.group(1).strip()
                in_adt = False  # Reset: ADT is per-law, not global
                in_prec = bool(RE_NORMA_PREC.match(current_law_name))
                if current_article:
                    doc.elements.append(current_article)
                    current_article = None
                norma_count += 1
                heading = SectionHeading(
                    level=UnitType.TITULO,
                    text=current_law_name,
                    data_section=f"norma{norma_count}",
                )
                doc.elements.append(heading)
                i += 1
                continue

        # Precedentes Regimentais: each title "PRECEDENTE REGIMENTAL Nº 2/2004" opens a
        # card; the paragraphs after it are its text, as written (no provisions or headings)
        if in_prec:
            m_prec = RE_PRECEDENTE.match(cp.text)
            if m_prec:
                if current_article:
                    doc.elements.append(current_article)
                private_counter[0] = 0
                art_num = prec_number(m_prec)
                uid = f"art{PREC}{art_num.replace('/', '-')}"
                seen_uids.add(uid)
                prec_par = 0
                current_article = ArticleBlock(
                    art_number=art_num,
                    summary=next((summaries_map[f] for f in cp.footnote_ids if f in summaries_map), ""),
                    law_name=current_law_name,
                    law_prefix=PREC,
                    source_url=next((r.hyperlink_url for r in cp.runs if r.hyperlink_url), ""),
                )
                current_article.caput = DocumentUnit(
                    unit_type=UnitType.ARTIGO,
                    identifier=f"Precedente Regimental {prec_label(art_num)}",
                    uid=uid,
                    runs=cp.runs,
                    footnotes=_build_footnotes(cp.footnote_ids, footnotes_map, footnote_counter, private_fn_ids, private_counter),
                    legislacao=legislacao(cp.footnote_ids),
                    source_index=i,
                )
            elif current_article is not None:
                prec_par += 1
                current_article.children.append(DocumentUnit(
                    unit_type=UnitType.OTHER,
                    identifier="",
                    uid=f"{current_article.caput.uid}_{prec_par}",
                    runs=cp.runs,
                    is_old_version=cp.has_strike,
                    footnotes=_build_footnotes(cp.footnote_ids, footnotes_map, footnote_counter, private_fn_ids, private_counter),
                    legislacao=legislacao(cp.footnote_ids),
                    source_index=i,
                ))
            i += 1
            continue

        # Detect ADT marker
        if cp.is_centered and RE_ADT_MARKER.search(cp.text):
            in_adt = True
            # Flush current article
            if current_article:
                doc.elements.append(current_article)
                current_article = None
            heading = SectionHeading(
                level=UnitType.TITULO,
                text="ATO DAS DISPOSIÇÕES TRANSITÓRIAS",
                data_section="adt",
            )
            doc.elements.append(heading)
            i += 1
            continue

        # Detect DGT marker (Disposições Gerais e Transitórias da Lei Orgânica)
        if cp.is_centered and RE_DGT_MARKER.search(cp.text):
            in_adt = True
            if current_article:
                doc.elements.append(current_article)
                current_article = None
            heading = SectionHeading(
                level=UnitType.TITULO,
                text="DISPOSIÇÕES GERAIS E TRANSITÓRIAS",
                data_section="dgt",
            )
            doc.elements.append(heading)
            i += 1
            continue

        # Headings (centered text)
        if cp.unit_type in (
            UnitType.TITULO, UnitType.CAPITULO, UnitType.SECAO,
            UnitType.SUBSECAO, UnitType.SUBTITLE,
        ):
            # Flush current article
            if current_article:
                doc.elements.append(current_article)
                current_article = None

            if cp.unit_type == UnitType.TITULO:
                titulo_count += 1
                section_id = f"tit{titulo_count}"
                # Check if next line is subtitle
                subtitle = ""
                if i + 1 < len(classified) and classified[i + 1].unit_type == UnitType.SUBTITLE:
                    subtitle = classified[i + 1].text
                    i += 1  # skip subtitle
                heading = SectionHeading(
                    level=UnitType.TITULO,
                    text=cp.text,
                    subtitle=subtitle,
                    data_section=section_id,
                )
                doc.elements.append(heading)

            elif cp.unit_type == UnitType.CAPITULO:
                capitulo_count += 1
                section_id = f"cap{capitulo_count}"
                # Check for combined heading (CAPÍTULO IV\nDAS MOÇÕES)
                subtitle = ""
                # Check if the text itself contains the subtitle
                lines = cp.text.split("\n")
                if len(lines) > 1:
                    subtitle = "\n".join(lines[1:]).strip()
                elif i + 1 < len(classified) and classified[i + 1].unit_type == UnitType.SUBTITLE:
                    subtitle = classified[i + 1].text
                    i += 1
                heading = SectionHeading(
                    level=UnitType.CAPITULO,
                    text=lines[0] if len(lines) > 1 else cp.text,
                    subtitle=subtitle,
                    data_section=section_id,
                )
                doc.elements.append(heading)

            elif cp.unit_type == UnitType.SECAO:
                secao_count += 1
                section_id = f"sec{secao_count}"
                subtitle = ""
                if i + 1 < len(classified) and classified[i + 1].unit_type == UnitType.SUBTITLE:
                    subtitle = classified[i + 1].text
                    i += 1
                heading = SectionHeading(
                    level=UnitType.SECAO,
                    text=cp.text,
                    subtitle=subtitle,
                    data_section=section_id,
                )
                doc.elements.append(heading)

            elif cp.unit_type == UnitType.SUBSECAO:
                subsecao_count += 1
                section_id = f"subsec{subsecao_count}"
                subtitle = ""
                if i + 1 < len(classified) and classified[i + 1].unit_type == UnitType.SUBTITLE:
                    subtitle = classified[i + 1].text
                    i += 1
                heading = SectionHeading(
                    level=UnitType.SUBSECAO,
                    text=cp.text,
                    subtitle=subtitle,
                    data_section=section_id,
                )
                doc.elements.append(heading)

            elif cp.unit_type == UnitType.SUBTITLE:
                # Standalone subtitle (no preceding heading consumed it)
                # Treat as implicit SEÇÃO
                secao_count += 1
                section_id = f"sec{secao_count}"
                heading = SectionHeading(
                    level=UnitType.SECAO,
                    text=cp.text,
                    data_section=section_id,
                )
                doc.elements.append(heading)

            i += 1
            continue

        # Article start
        if cp.unit_type == UnitType.ARTIGO:
            art_num = cp.art_number
            effective_num = f"ADT{art_num}" if in_adt else art_num
            uid_prefix = f"artADT{art_num}" if in_adt else f"art{art_num}"

            # Detect amendment / strikethrough
            amendment = _extract_amendment_note(cp.runs)

            caput = DocumentUnit(
                unit_type=UnitType.ARTIGO,
                identifier=cp.identifier,
                uid=uid_prefix,
                runs=cp.runs,
                is_revoked=_is_revoked_text(cp.text),
                is_old_version=cp.has_strike,
                amendment_note=amendment,
                footnotes=_build_footnotes(cp.footnote_ids, footnotes_map, footnote_counter, private_fn_ids, private_counter),
                legislacao=legislacao(cp.footnote_ids),
                source_index=i,
            )

            # Check if this is a duplicate of the current article
            # (multiple versions of the same article appear consecutively)
            if (
                current_article
                and current_article.art_number == effective_num
            ):
                # Merge: previous caput + children → all_versions
                if current_article.caput:
                    # stays as struck (or not) in the DOCX: resolve_amendments swaps
                    # a restored caput in force before a struck one
                    current_article.all_versions.append(current_article.caput)
                for child in current_article.children:
                    child.is_old_version = True
                    current_article.all_versions.append(child)
                current_article.children = []
                current_article.caput = caput
                # Atualiza síntese se o novo caput tiver uma nota "s "
                for fn_id in cp.footnote_ids:
                    if fn_id in summaries_map:
                        current_article.summary = summaries_map[fn_id]
                        break
            else:
                # Flush previous article and start new one
                if current_article:
                    doc.elements.append(current_article)

                # Reset private footnote counter for each new card
                private_counter[0] = 0

                # Extract summary from "s " footnotes on the caput
                summary = ""
                for fn_id in cp.footnote_ids:
                    if fn_id in summaries_map:
                        summary = summaries_map[fn_id]
                        break

                current_article = ArticleBlock(
                    art_number=effective_num,
                    is_adt=in_adt,
                    summary=summary,
                    law_name=current_law_name,
                )
                current_article.caput = caput

            # Reset hierarchical uid context for each new/merged article
            uid_ctx = ["", "", "", ""]
            seen_uids.add(uid_prefix)

            i += 1
            continue

        # Sub-dispositivos (belong to current article)
        if cp.unit_type in (
            UnitType.PARAGRAFO_UNICO, UnitType.PARAGRAFO_NUM,
            UnitType.INCISO, UnitType.ALINEA, UnitType.SUB_ALINEA,
            UnitType.ITEM_NUM, UnitType.OTHER,
        ):
            if current_article is None:
                # Orphan sub-device, skip
                i += 1
                continue

            art_num = current_article.art_number
            uid_prefix = f"art{art_num}" if not current_article.is_adt else f"artADT{art_num.replace('ADT', '')}"
            uid = _make_hierarchical_uid(uid_prefix, cp, uid_ctx)
            # Deduplicate: append counter if collision
            base_uid = uid
            n = 2
            while uid in seen_uids:
                uid = f"{base_uid}_{n}"
                n += 1
            seen_uids.add(uid)

            amendment = _extract_amendment_note(cp.runs)

            unit = DocumentUnit(
                unit_type=cp.unit_type,
                identifier=cp.identifier,
                uid=uid,
                runs=cp.runs,
                is_revoked=_is_revoked_text(cp.text),
                is_old_version=cp.has_strike,
                amendment_note=amendment,
                footnotes=_build_footnotes(cp.footnote_ids, footnotes_map, footnote_counter, private_fn_ids, private_counter),
                legislacao=legislacao(cp.footnote_ids),
                source_index=i,
            )

            # Always keep children in document order (old versions
            # are distinguished by is_old_version flag)
            current_article.children.append(unit)

            i += 1
            continue

        # Anything else
        i += 1

    # Flush last article
    if current_article:
        doc.elements.append(current_article)

    return doc


def _build_footnotes(
    fn_ids: list[int],
    fn_map: dict[int, list[FootnotePara]],
    counter: list[int],
    private_ids: set[int] | None = None,
    private_counter: list[int] | None = None,
) -> list[Footnote]:
    """Cria objetos Footnote a partir dos IDs referenciados no parágrafo."""
    if private_ids is None:
        private_ids = set()
    result: list[Footnote] = []
    for fn_id in fn_ids:
        if fn_id in fn_map:
            is_priv = fn_id in private_ids
            if is_priv and private_counter is not None:
                private_counter[0] += 1
                num = private_counter[0]
            else:
                counter[0] += 1
                num = counter[0]
            result.append(Footnote(
                number=num,
                paragraphs=fn_map[fn_id],
                is_private=is_priv,
            ))
    return result


def _uid_suffix(cp: _ClassifiedParagraph) -> str:
    """Retorna o sufixo de UID para o sub-dispositivo."""
    if cp.unit_type == UnitType.PARAGRAFO_UNICO:
        return "pu"
    elif cp.unit_type == UnitType.PARAGRAFO_NUM:
        m = RE_PARAGRAFO_NUM.match(cp.text)
        num = m.group(1) if m else "0"
        letter = m.group(3) if m and m.group(3) else ""
        return f"p{num}{letter}"
    elif cp.unit_type == UnitType.INCISO:
        m = re.match(r"^(l?[IVXLC]+)", cp.text)
        raw = m.group(1) if m else ""
        if raw.startswith("l"):
            raw = "I" + raw[1:]
        return raw
    elif cp.unit_type == UnitType.ALINEA:
        return cp.text[0]
    elif cp.unit_type == UnitType.SUB_ALINEA:
        m = re.match(r"^(\d+)\)", cp.text)
        num = m.group(1) if m else "0"
        return f"sub{num}"
    elif cp.unit_type == UnitType.ITEM_NUM:
        m = re.match(r"^(\d+)", cp.text)
        num = m.group(1) if m else "0"
        return f"item{num}"
    return ""


def _make_hierarchical_uid(
    art_prefix: str,
    cp: _ClassifiedParagraph,
    ctx: list[str],
) -> str:
    """Gera UID hierárquico para sub-dispositivos.

    ctx = [para_suffix, inciso_suffix, alinea_suffix, sub_alinea_suffix]
    É atualizado in-place conforme o nível do dispositivo.
    """
    suffix = _uid_suffix(cp)

    if cp.unit_type in (UnitType.PARAGRAFO_UNICO, UnitType.PARAGRAFO_NUM):
        ctx[0] = suffix
        ctx[1] = ctx[2] = ctx[3] = ""
    elif cp.unit_type == UnitType.INCISO:
        ctx[1] = suffix
        ctx[2] = ctx[3] = ""
    elif cp.unit_type == UnitType.ALINEA:
        ctx[2] = suffix
        ctx[3] = ""
    elif cp.unit_type == UnitType.SUB_ALINEA:
        ctx[3] = suffix
    elif cp.unit_type == UnitType.ITEM_NUM:
        # item appends to current context without resetting
        return art_prefix + ctx[0] + ctx[1] + ctx[2] + ctx[3] + suffix
    else:
        return art_prefix + suffix

    return art_prefix + ctx[0] + ctx[1] + ctx[2] + ctx[3]


def _extract_amendment_note(runs: list[TextRun]) -> str:
    """Extrai nota de emenda do texto dos runs."""
    full = "".join(r.text for r in runs)
    m = RE_AMENDMENT.search(full)
    if m:
        # Extract from the opening paren to the closing paren
        start = m.start()
        depth = 0
        for j in range(start, len(full)):
            if full[j] == "(":
                depth += 1
            elif full[j] == ")":
                depth -= 1
                if depth == 0:
                    return full[start : j + 1]
        return full[start:]
    return ""


def _is_revoked_text(text: str) -> bool:
    return bool(re.search(r"\(Revogad[oa]", text, re.IGNORECASE))
