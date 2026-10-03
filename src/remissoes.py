"""Remissões: as citações a outros dispositivos (explícitas) e os correlatos (implícitas).

Detecta, em cada dispositivo vigente, trechos como "artigo 369", "§ 1º do artigo
368", "incisos III, IV e V do artigo 18, da Lei Orgânica do Município" e os
resolve contra os dispositivos do próprio documento (Regimento Interno, Lei
Orgânica e CF arts. 29-31). O site usa o trecho como gatilho de uma prévia com a
redação vigente do alvo; nada é copiado para o DOCX.

Os alvos são endereçados por (norma, artigo, caminho), com o caminho no formato do
data-path do site ("§ 1º,II,a", "§ú"), nunca por UID, que muda com as emendas.
Ajustes manuais da detecção ficam em remissoes_excecoes.toml.

As implícitas (dispositivos de normas diferentes que tratam da mesma coisa sem se
citarem: mesma regra, detalhamento, fundamento ou divergência) vêm da planilha
remissoes.xlsx, revisada à mão; o site mostra um selo nos dois lados.

Os Precedentes Regimentais (norma PREC, artigo "número/ano") entram dos dois lados:
as citações a eles ("(Vide Precedente Regimental nº 02/2004)", também nas notas) e,
no texto deles, as citações aos dispositivos do Regimento, que é a norma padrão ali
("Dispositivos regimentais indicados: Artigos 13; 16; 157 a 162").
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .models import PREC, ArticleBlock, DocumentUnit, ParsedDocument, prec_label, unit_path

LAW_SHORT = {"Regimento Interno": "RI", "Lei Orgânica": "LOM", "Constituição Federal": "CF"}

# Status de um alvo. Os três primeiros viram gatilho no site.
RESOLVIDO = "resolvido"
REVOGADO = "revogado"            # alvo revogado (texto tachado com "Revogado", ou artigo revogado)
TACHADO = "tachado"              # alvo só existe tachado (ex.: suspenso por ADIN)
SUB_INEXISTENTE = "subdispositivo_inexistente"
ART_INEXISTENTE = "artigo_inexistente"
AMBIGUA = "ambigua"
NAO_RESOLVIDO = "nao_resolvido"
EXIBIVEIS = (RESOLVIDO, REVOGADO, TACHADO)


@dataclass
class Alvo:
    law: str     # "RI", "LOM", "CF", "PREC"
    art: str     # "369", "42", "ADT29", "2/2004" (precedente)
    path: str    # "" (artigo inteiro), "§ 7º", "II,a"
    status: str = RESOLVIDO

    @property
    def ref(self) -> str:
        """Endereço como no site: "369", "LOM:42,§ 7º"."""
        return (f"{self.law}:" if self.law != "RI" else "") + self.art + (f",{self.path}" if self.path else "")

    @property
    def rotulo(self) -> str:
        """Rótulo para leitura: "Art. 369", "LOM art. 42, § 7º", "Precedente nº 2/2004"."""
        if self.law == PREC:
            return f"Precedente {prec_label(self.art)}"
        a = f"art. {self.art[3:]} ADT" if self.art.startswith("ADT") else f"art. {self.art}"
        p = self.path.replace("§ú", "parágrafo único").replace(",", ", ")
        return (f"{self.law} " if self.law != "RI" else "") + a + (f", {p}" if p else "")


@dataclass
class Remissao:
    unit: DocumentUnit                 # dispositivo de origem
    origem: Alvo                       # endereço da origem
    start: int                         # trecho citado, em unit.full_text
    end: int
    classe: str                        # interna | cruzada | relativa | externa
    alvos: list[Alvo] = field(default_factory=list)
    url: Optional[str] = None          # link oficial que já estava no trecho, se havia
    mesmo_artigo: bool = False         # "§ 2º deste artigo": o alvo já está no card

    @property
    def trecho(self) -> str:
        return self.unit.full_text[self.start:self.end]

    @property
    def exibivel(self) -> bool:
        return (self.classe != "externa" and not self.mesmo_artigo
                and any(a.status in EXIBIVEIS for a in self.alvos))


# Tipos de remissão implícita: nome na planilha -> código no site
# correspondente: a regra equivalente para a União/Congresso Nacional (o paralelo federal), sem
# afirmar que ela se aplique ao Município ("simetria" = nome antigo, ainda aceito)
TIPOS = {"mesma regra": "eq", "detalha": "det", "fundamento": "fund", "diverge": "div",
         "correspondente": "sim", "simetria": "sim"}


@dataclass
class Implicita:
    """Correlato entre dispositivos de normas diferentes (linha da planilha remissoes.xlsx)."""
    id: str
    origem: Alvo
    destino: Alvo
    tipo: str                 # eq | det | fund | div (TIPOS)
    nota: str
    proposta: bool            # Status "proposto": ainda não revisada (só em build de teste)
    u_origem: DocumentUnit
    u_destino: DocumentUnit


@dataclass
class Resultado:
    remissoes: list[Remissao] = field(default_factory=list)
    avisos: list[tuple[str, str]] = field(default_factory=list)
    implicitas: list[Implicita] = field(default_factory=list)

    def implicitas_por_unidade(self) -> dict[int, list[tuple[Implicita, str]]]:
        """Correlatos por dispositivo, nos dois lados: id(unit) -> [(implícita, "src" | "tgt")]."""
        out: dict[int, list[tuple[Implicita, str]]] = defaultdict(list)
        for im in self.implicitas:
            out[id(im.u_origem)].append((im, "src"))
            out[id(im.u_destino)].append((im, "tgt"))
        return out

    def por_unidade(self) -> dict[int, list[Remissao]]:
        """Remissões exibíveis por dispositivo de origem (id do objeto)."""
        out: dict[int, list[Remissao]] = defaultdict(list)
        for r in self.remissoes:
            if r.exibivel:
                out[id(r.unit)].append(r)
        return out

    def citado_em(self) -> dict[tuple[str, str], list[Alvo]]:
        """Para cada artigo citado, as origens que o citam (sem repetir)."""
        out: dict[tuple[str, str], list[Alvo]] = defaultdict(list)
        for r in self.remissoes:
            if not r.exibivel:
                continue
            for a in r.alvos:
                if a.status in EXIBIVEIS and (a.law, a.art) != (r.origem.law, r.origem.art):
                    lst = out[(a.law, a.art)]
                    if r.origem.ref not in {o.ref for o in lst}:
                        lst.append(r.origem)
        return out


# ── texto de trabalho ─────────────────────────────────────────────────────

RE_NOTE_PAREN = re.compile(
    r"\((?:\s*)(Reda[çc][ãa]o|Inclu[íi]d|Inserid|Acrescentad|Renumerad|Revogad|Vide|vide|Alterad|"
    r"Suprimid|Com\s+reda|Regulamentad|Numera|Declarad|Promulgad|Em\s+vigor|Artigo\s+inclu|"
    r"Par[áa]grafo\s+inclu|Inciso\s+inclu|Texto|Ver\s|Nova\s+reda|Acrescid|Suspens|Efic[áa]cia|Adin|ADI\b|"
    r"Novamente|Restabelecid|Reestabelecid)",
)

RE_LEAD_ID = re.compile(
    r"^\s*(?:Art\.\s*\d+\s*[º°ª]?\s*(?:[-–]\s*[A-H]|[A-H])?\s*[-–—.]?"
    r"|§\s*\d+\s*\.?\s*[º°ª]?\s*(?:[-–]\s*[A-Z])?\s*[-–—.]?"
    r"|Par[áa]grafo\s+[úu]nico\s*[-–—.:]?"
    r"|l?[IVXLC]+\s*[-–—]"
    r"|[a-z]\s?\)"
    r"|\d+\)"
    r"|\d+\s*[-–—])"
)


def _working_text(unit: DocumentUnit) -> str:
    """Texto do dispositivo com o mesmo comprimento de full_text, sem o que não é citação:
    trechos tachados, notas de alteração ("(Redação dada...)", "(Vide...)") e o
    identificador inicial viram espaços."""
    parts = []
    for r in unit.runs:
        parts.append(" " * len(r.text) if r.strike else re.sub(r"[\xa0\t\n]", " ", r.text))
    text = "".join(parts)
    out = list(text)
    pos = 0
    while True:
        m = RE_NOTE_PAREN.search(text, pos)
        if not m:
            break
        depth, end = 0, len(text)
        for j in range(m.start(), len(text)):
            if text[j] == "(":
                depth += 1
            elif text[j] == ")":
                depth -= 1
                if depth == 0:
                    end = j + 1
                    break
        out[m.start():end] = " " * (end - m.start())
        pos = end
    text = "".join(out)
    lead = RE_LEAD_ID.match(text)
    if lead:
        text = " " * lead.end() + text[lead.end():]
    return text


# ── tokenização e agrupamento das citações ────────────────────────────────

TOKEN_RE = re.compile(
    r"(?P<PU>(?i:par[áa]grafo)\s+(?i:[úu]nico))"
    r"|(?P<CAPUT>[“\"'‘]?\b(?i:caput)\b[”\"'’]?)"
    r"|(?P<ART>\b(?i:(?:[dn][oa]s?)?art(?:igo)?s?)\b\.?|\b(?i:dispositivos?)(?=\s+\d))"
    r"|(?P<PAR>§§|§|\b(?i:par[áa]grafos?)\b)"
    r"|(?P<INC>\b(?i:incisos?)\b)"
    r"|(?P<ALI>\b(?i:al[íi]neas?)\b)"
    r"|(?P<ITEM>\b(?i:ite(?:m|ns))\b)"
    r"|(?P<NUM>\d+(?:\s?[º°ª]|\.\s?[º°ª])?(?:\s?[-–]\s?[A-Z](?![A-Za-zÀ-ÿ])|[A-Z](?![A-Za-zÀ-ÿ]))?(?![\d/%])(?!\.\d)"
    r"(?!\s?(?:%|por\s+cento)))"   # "50% (cinquenta por cento)" não é artigo
    r"|(?P<ROMAN>\b[IVXLC]+\b)"
    r"|(?P<QLETTER>[“\"'‘][a-z][”\"'’])"
    r"|(?P<WORD>[A-Za-zÀ-ÿ]+)"
    r"|(?P<COMMA>[,;])"
    r"|(?P<OTHER>\S)"
)

KEYWORDS = {"ART", "PAR", "PU", "INC", "ALI", "ITEM", "CAPUT"}
ASC_WORDS = {"do", "da", "dos", "das", "de", "no", "na", "nos", "nas", "ao", "aos", "à", "às", "pelo", "pela"}
FILLER_WORDS = {"e", "ou", "o", "os", "a", "as", "seu", "sua", "seus", "suas", "em", "respectivo", "respectivos",
                "mesmo", "todos", "bem", "como", "ainda", "também", "com"}
LEVEL = {"ART": 0, "PAR": 1, "PU": 1, "CAPUT": 1, "INC": 2, "ALI": 3, "ITEM": 4}
RELATIVE_WORDS = ("anterior", "seguinte", "precedente", "antecedente")


def _tokenize(text, prec=False):
    """prec: texto de precedente, que lista artigos com números soltos depois de ";" ou ":"
    ("Artigos 13; 16; 157 a 162; e 185") e chama a alínea de "letra"."""
    toks = []
    for m in TOKEN_RE.finditer(text):
        kind, val = m.lastgroup, m.group(0)
        if kind == "WORD" and len(val) == 1 and "a" <= val <= "z":
            kind = "LETTER" if val not in ("e", "o", "a") else "WORD"
        if prec and kind == "WORD" and val.lower() in ("letra", "letras"):
            kind = "ALI"
        if prec and kind == "WORD" and val.lower() == "único" and toks and toks[-1][1] == "§":
            toks[-1][:] = ["PU", toks[-1][1] + text[toks[-1][3]:m.end()], toks[-1][2], m.end()]   # "§ único"
            continue
        if prec and kind == "NUM" and toks:
            k = len(toks) - 1
            if toks[k][1] == "e" and k > 0:
                k -= 1
            if toks[k][1] in (";", ":"):
                toks.append(["ART", "", m.start(), m.start()])   # "artigo" implícito
        toks.append([kind, val, m.start(), m.end()])
    return toks


def _norm_num(v):
    """'4º-C' -> '4-C'; '4.º' -> '4'; '215' -> '215'."""
    v = v.replace(" ", "")
    m = re.match(r"(\d+)(?:\.?[º°ª])?(?:[-–]?([A-Z]))?$", v)
    if not m:
        return v
    return m.group(1) + (f"-{m.group(2)}" if m.group(2) else "")


def _roman_ok(v):
    return v != "" and re.fullmatch(r"M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})", v) is not None


def _roman_to_int(s):
    vals = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
    tot = 0
    for i, c in enumerate(s):
        v = vals[c]
        tot += -v if i + 1 < len(s) and vals[s[i + 1]] > v else v
    return tot


def _int_to_roman(n):
    out = ""
    for v, s in [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"),
                 (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]:
        while n >= v:
            out += s
            n -= v
    return out


def _parse_value_list(toks, i, vkind, stop_jump=False):
    """Lista de valores a partir de toks[i] (NUM/ROMAN/LETTER), com ',', 'e', 'ou' e 'a' (intervalo)."""
    vals, end, range_next = [], None, False

    def is_val(t):
        if vkind == "NUM":
            return t[0] == "NUM"
        if vkind == "ROMAN":
            return t[0] == "ROMAN" and _roman_ok(t[1])
        return t[0] in ("LETTER", "QLETTER")

    j = sep_pos = i
    while j < len(toks):
        t = toks[j]
        if not is_val(t):
            break
        v = re.sub(r"[“\"'‘”’]", "", t[1]) if vkind == "LETTER" else t[1]
        if vkind == "NUM" and vals and not range_next and stop_jump:
            pv = vals[-1][2] if isinstance(vals[-1], tuple) else vals[-1]
            a_, b_ = re.match(r"\d+", pv), re.match(r"\d+", v)
            if a_ and b_ and int(b_.group()) > int(a_.group()) + 5:
                j = sep_pos
                break
        if range_next and vals:
            vals.append(("RANGE", vals.pop(), v))
            range_next = False
        else:
            vals.append(v)
        end = t[3]
        j += 1
        if j < len(toks):
            t2 = toks[j]
            if t2[0] == "COMMA" or (t2[0] in ("WORD", "LETTER") and t2[1] in ("e", "ou", "a")):
                k = j + 1
                if k < len(toks) and is_val(toks[k]):
                    sep_pos = j
                    range_next = t2[1] == "a"
                    j = k
                    continue
        break
    return vals, j, end


def _expand(vals, vkind):
    out = []
    for v in vals:
        if isinstance(v, tuple) and v[0] == "RANGE":
            a, b = v[1], v[2]
            if vkind == "NUM":
                na, nb = re.match(r"\d+", a), re.match(r"\d+", b)
                if na and nb and int(na.group()) <= int(nb.group()) and int(nb.group()) - int(na.group()) < 60:
                    out.extend(str(x) for x in range(int(na.group()), int(nb.group()) + 1))
                else:
                    out.extend([a, b])
            elif vkind == "ROMAN":
                out.extend(_int_to_roman(x) for x in range(_roman_to_int(a), _roman_to_int(b) + 1))
            else:
                out.extend(chr(c) for c in range(ord(a), ord(b) + 1))
        else:
            out.append(v)
    return out


def _parse_group(toks, i):
    """Um grupo (palavra-chave + valores) em toks[i]: (grupo | None, próximo i)."""
    t = toks[i]
    k = t[0]
    g = {"kind": k, "start": t[2], "end": t[3], "vals": [], "special": None}
    j = i + 1
    nxt = toks[j] if j < len(toks) else None

    def relative_word():
        return nxt and nxt[0] == "WORD" and nxt[1].lower() in RELATIVE_WORDS

    if k == "PU":
        g["vals"] = ["pu"]
        return g, j
    if k == "CAPUT":
        g["vals"] = ["caput"]
        return g, j
    if k in ("ART", "ITEM"):
        if nxt and nxt[0] == "NUM":
            g["vals"], j2, g["end"] = _parse_value_list(toks, j, "NUM")
            return g, j2
        if k == "ART" and relative_word():
            g["special"], g["end"] = nxt[1].lower(), nxt[3]
            return g, j + 1
        return None, i + 1
    if k == "PAR":
        if nxt and nxt[0] == "NUM":
            g["vals"], j2, g["end"] = _parse_value_list(toks, j, "NUM", stop_jump=True)
            return g, j2
        if relative_word():
            g["special"], g["end"] = nxt[1].lower(), nxt[3]
            return g, j + 1
        if t[1].lower().startswith(("parágrafos", "paragrafos")) or t[1] == "§§":
            g["special"] = "todos"
            return g, j
        return None, i + 1
    if k == "INC":
        if nxt and nxt[0] == "ROMAN" and _roman_ok(nxt[1]):
            g["vals"], j2, g["end"] = _parse_value_list(toks, j, "ROMAN")
            return g, j2
        if relative_word():
            g["special"], g["end"] = nxt[1].lower(), nxt[3]
            return g, j + 1
        if t[1].lower() == "incisos":
            g["special"] = "todos"
            return g, j
        return None, i + 1
    if k == "ALI":
        if nxt and nxt[0] in ("LETTER", "QLETTER"):
            g["vals"], j2, g["end"] = _parse_value_list(toks, j, "LETTER")
            return g, j2
        if nxt and nxt[0] == "WORD" and nxt[1] in ("a", "e", "o"):  # "alínea a do inciso"
            nn = toks[j + 1] if j + 1 < len(toks) else None
            if nn and (nn[0] == "COMMA" or (nn[0] == "WORD" and nn[1].lower() in ASC_WORDS)):
                g["vals"], g["end"] = [nxt[1]], nxt[3]
                return g, j + 1
        if relative_word():
            g["special"], g["end"] = nxt[1].lower(), nxt[3]
            return g, j + 1
        return None, i + 1
    return None, i + 1


def _find_clusters(text, prec=False):
    """Citações: cada uma é uma lista de (grupo, palavras de ligação antes dele).

    prec: cada trecho entre ";" é uma citação (as listas de dispositivos dos precedentes).
    """
    toks = _tokenize(text, prec)
    clusters = []
    i = 0
    while i < len(toks):
        if toks[i][0] not in KEYWORDS:
            i += 1
            continue
        g, j = _parse_group(toks, i)
        if g is None:
            i = j
            continue
        cl = [(g, [])]
        while True:
            k, links = j, []
            while k < len(toks) and (
                toks[k][0] == "COMMA"
                or (toks[k][0] in ("WORD", "LETTER") and toks[k][1].lower() in ASC_WORDS | FILLER_WORDS)
            ):
                links.append(toks[k][1].lower())
                k += 1
                if len(links) > 4 or (prec and links[-1] == ";"):
                    break
            if prec and ";" in links:
                break
            # romano solto depois de vírgula = inciso ("artigo 93, III")
            if k < len(toks) and toks[k][0] == "ROMAN" and _roman_ok(toks[k][1]) and links and links[0] == ",":
                vals, j2, end = _parse_value_list(toks, k, "ROMAN")
                cl.append(({"kind": "INC", "start": toks[k][2], "end": end, "vals": vals, "special": None}, links))
                j = j2
                continue
            # número solto numa citação de artigos = outro artigo ("arts. 37, XI, 39, § 4º")
            if (k < len(toks) and toks[k][0] == "NUM" and links and links[-1] in (",", "e")
                    and any(gg["kind"] == "ART" for gg, _ in cl) and cl[-1][0]["kind"] != "ART"):
                vals, j2, end = _parse_value_list(toks, k, "NUM")
                cl.append(({"kind": "ART", "start": toks[k][2], "end": end, "vals": vals, "special": None}, links))
                j = j2
                continue
            if k < len(toks) and toks[k][0] == "ART":
                mpre = re.match(r"(?i)([dn][oa]s?)art", toks[k][1])
                if mpre:
                    links.append(mpre.group(1).lower())
            if k < len(toks) and toks[k][0] in KEYWORDS:
                g2, j2 = _parse_group(toks, k)
                if g2 is not None:
                    cl.append((g2, links))
                    j = j2
                    continue
            break
        clusters.append(cl)
        i = j
    return clusters


def _is_asc(links):
    return any(w in ASC_WORDS for w in links) and not any(w in ("e", "ou") for w in links)


def _group_vals(g):
    if g["special"] in RELATIVE_WORDS:
        return [g["special"]]
    if g["special"] == "todos":
        return ["*"]
    vtype = {"PAR": "NUM", "ITEM": "NUM", "INC": "ROMAN", "ALI": "LETTER"}.get(g["kind"])
    return _expand(g["vals"], vtype) if vtype else g["vals"]


def _build_refs(cluster):
    """Citação → referências (dicts com art, path, special)."""
    refs, pending, last = [], [], []
    anchor = prev = None
    for idx, (g, links) in enumerate(cluster):
        lvl = LEVEL[g["kind"]]
        asc = prev is not None and _is_asc(links) and LEVEL[prev["kind"]] > lvl
        nxt = cluster[idx + 1] if idx + 1 < len(cluster) else None
        if g["kind"] == "ART":
            vals = _expand(g["vals"], "NUM") if g["vals"] else [None]
            new = [{"art": _norm_num(v) if v else None, "path": {}, "special": None if v else g["special"]}
                   for v in vals]
            if asc and pending:
                for p in pending:
                    p["art"], p["special"] = new[0]["art"], new[0]["special"]
                    refs.append(p)
                pending = []
                refs.extend(new[1:])
                anchor = new[-1] if len(new) > 1 else dict(new[0], cited=False)
                last = []
            else:
                refs.extend(new)
                anchor = new[-1]
                last = new
            prev = g
            continue
        vals = _group_vals(g)
        if asc and last and prev["kind"] != "ART":
            for b in last:
                b["path"][g["kind"]] = vals[0]
            prev = g
            continue
        next_is_parent = nxt is not None and _is_asc(nxt[1]) and LEVEL[nxt[0]["kind"]] < lvl
        if anchor is not None and not _is_asc(links) and not next_is_parent:
            if vals == ["*"]:
                prev = g
                continue
            base = {k: v for k, v in anchor["path"].items() if LEVEL[k] < lvl}
            created = []
            for v in vals:
                r = {"art": anchor["art"], "path": dict(base), "special": anchor.get("special")}
                r["path"][g["kind"]] = v
                created.append(r)
            if all(LEVEL[k] < lvl for k in anchor["path"]) and "e" not in links and anchor in refs:
                refs.remove(anchor)
            refs.extend(created)
            anchor = created[-1]
            last = created
            prev = g
            continue
        blocks_desc = (next_is_parent and last and
                       LEVEL[nxt[0]["kind"]] >= max((LEVEL[k] for k in last[-1]["path"]), default=0))
        if (anchor is None and pending and last and not _is_asc(links) and not blocks_desc
                and all(LEVEL[k] < lvl for k in last[-1]["path"]) and vals != ["*"]):
            base_r = last[-1]
            created = []
            for v in vals:
                r = {"art": None, "path": dict(base_r["path"]), "special": None}
                r["path"][g["kind"]] = v
                created.append(r)
            if "e" not in links and base_r in pending:
                pending.remove(base_r)
            pending.extend(created)
            last = created
            prev = g
            continue
        new = [{"art": None, "path": {g["kind"]: v}, "special": None} for v in vals]
        pending.extend(new)
        last = new
        prev = g
    for p in pending:
        p["relative"] = True
        refs.append(p)
    return refs


# ── a que norma a citação se refere ────────────────────────────────────────

_QUALIFIERS = [
    ("LOMADT", r"(?:desta|da)\s+Emenda\s+[àa]\s+Lei\s+Org[âa]nica"),
    ("EXT", r"(?:da|desta)\s+(?:Emenda\s+(?:[àa]\s+)?Constitui[çc][ãa]o(?:\s+Federal)?|Emenda\s+Constitucional|EC)"
            r"\s*(?:n[º°.]?\s*)?\d+"),
    ("EXT", r"das\s+suas\s+Disposi[çc][õo]es\s+Transit[óo]rias"),
    ("EXT", r"(?:da|na)\s+Constitui[çc][ãa]o\s+(?:Estadual|do\s+Estado)"),
    ("CF", r"(?:da|desta|na)\s+Constitui[çc][ãa]o(?:\s+(?:Federal|da\s+Rep[úu]blica))?(?!\s+Estadual)"),
    ("EXT", r"da\s+Resolu[çc][ãa]o\s*(?:n[º°a.]?\s*)?\d+"),
    ("EXT", r"da\s+Lei\s+(?:Federal\s+|Complementar\s+|Municipal\s+|Estadual\s+)?(?:n[º°.]?\s*)?[\d.]+"),
    ("EXT", r"do\s+Decreto(?:-Lei)?\s+(?:Federal\s+)?(?:n[º°.]?\s*)?[\d.]+"),
    ("RI", r"(?:deste|do|neste|no)\s+Regimento(?:\s+Interno)?"),
    ("LOM", r"(?:da|desta|d\.sta|de\.ta|d\.\s?sta|nesta|na|dessa)\s+(?:citada\s+|referida\s+|mesma\s+)?"
            r"Lei(?:\s+Org[âa]nica)?(?:\s+do\s+Munic[íi]pio)?"),
    ("REL_ART", r"(?:deste|neste|do\s+presente|desse|nesse)\s+artigo"),
    ("EXT", r"do\s+(?:referido|citado|mesmo|aludido)\s+artigo"),
]
_QUALIFIERS = [(k, re.compile(p, re.I)) for k, p in _QUALIFIERS]
# Só nos precedentes: o Regimento citado pela resolução que o aprovou, o ADT dele e a "LOM"
_QUALIFIERS_PREC = [(k, re.compile(p, re.I)) for k, p in [
    ("RI", r"(?:da|na)\s+Resolu[çc][ãa]o\s*(?:n[º°.]?\s*)?2,?\s+de\s+26\s+de\s+abril\s+de\s+1991"),
    ("RIADT", r"(?:do|no|ao)\s+Ato\s+das\s+Disposi[çc][õo]es\s+Transit[óo]rias"),
    ("LOM", r"(?:da|na)\s+LOM\b"),
]]


def _find_qualifier(text, pos, prec=False):
    """Qualificador logo depois de pos (aceita vírgula, 'todos', 'ambos')."""
    m = re.match(r"[\s,]*(?:(?:todos|ambos|todas)\s+)?", text[pos:])
    p = pos + m.end()
    for k, rx in (_QUALIFIERS_PREC + _QUALIFIERS if prec else _QUALIFIERS):
        mm = rx.match(text, p)
        if mm:
            return k, mm.end()
    return None, pos


def _path_key(path: dict) -> Optional[str]:
    """Caminho da referência no formato do data-path; None = artigo inteiro."""
    parts = []
    if "PAR" in path:
        v = path["PAR"]
        if v == "*" or v in RELATIVE_WORDS:
            return None
        m = re.match(r"(\d+)(?:\.?\s?[º°ª])?(?:\s?[-–]\s?([A-H]))?", v)
        parts.append(f"§ {m.group(1)}º" + (f"-{m.group(2)}" if m.group(2) else "") if m else v)
    if "PU" in path:
        parts.append("§ú")
    if "INC" in path:
        if path["INC"] in ("*",) + RELATIVE_WORDS:
            return ",".join(parts)
        parts.append(path["INC"])
    if "ALI" in path:
        if path["ALI"] in RELATIVE_WORDS:
            return ",".join(parts)
        parts.append(path["ALI"])
    if "ITEM" in path:
        n = re.match(r"\d+", path["ITEM"])
        parts.append(n.group() if n else path["ITEM"])
    return ",".join(parts)


# ── índice dos dispositivos ───────────────────────────────────────────────

def law_of(art: ArticleBlock) -> str:
    return art.law_prefix or LAW_SHORT.get(art.law_name, "RI")


class _Corpus:
    def __init__(self, doc: ParsedDocument):
        self.arts: dict[tuple[str, str], ArticleBlock] = {}
        self.vig: dict[tuple[str, str, str], DocumentUnit] = {}
        self.old: dict[tuple[str, str, str], DocumentUnit] = {}
        self.order: dict[str, list[str]] = defaultdict(list)          # norma -> artigos em ordem
        self.units: dict[tuple[str, str], list[tuple[DocumentUnit, str]]] = defaultdict(list)
        for art in doc.elements:
            if not isinstance(art, ArticleBlock):
                continue
            law = law_of(art)
            self.arts[(law, art.art_number)] = art
            self.order[law].append(art.art_number)
            if art.caput:
                self.vig[(law, art.art_number, "")] = art.caput
                self.units[(law, art.art_number)].append((art.caput, ""))
            ctx, all_ctx = ["", "", "", ""], ["", "", "", ""]
            for c in art.children:
                if law == PREC:
                    # texto corrido, sem dispositivos: entra na detecção, sem endereço próprio
                    if not c.is_old_version:
                        self.units[(law, art.art_number)].append((c, ""))
                    continue
                all_path = unit_path(c, all_ctx)
                if c.is_old_version:
                    if all_path:
                        self.old[(law, art.art_number, all_path)] = c
                    continue
                path = unit_path(c, ctx)
                if path:
                    self.vig.setdefault((law, art.art_number, path), c)
                    self.units[(law, art.art_number)].append((c, path))

    def resolve(self, law: str, art: str, path: Optional[str]) -> Alvo:
        a = self.arts.get((law, art))
        if a is None:
            return Alvo(law, art, path or "", ART_INEXISTENTE)
        key = path or ""
        if not key:
            return Alvo(law, art, "", REVOGADO if a.is_revoked else RESOLVIDO)
        u = self.vig.get((law, art, key))
        if u is not None:
            return Alvo(law, art, key, REVOGADO if (u.is_revoked or a.is_revoked) else RESOLVIDO)
        o = self.old.get((law, art, key))
        if o is not None:
            return Alvo(law, art, key, REVOGADO if (o.is_revoked or a.is_revoked) else TACHADO)
        return Alvo(law, art, key, SUB_INEXISTENTE)


# ── detecção ──────────────────────────────────────────────────────────────

def _link_in(unit: DocumentUnit, start: int, end: int) -> Optional[str]:
    """Primeiro link (com âncora) dos runs que cobrem o trecho."""
    pos = 0
    for r in unit.runs:
        r_end = pos + len(r.text)
        if r_end > start and pos < end and r.hyperlink_url:
            return r.link_url
        pos = r_end
    return None


def _link_norma(url: Optional[str]) -> Optional[str]:
    """Norma do documento para onde aponta o link que já está na citação."""
    if not url:
        return None
    if re.search(r"[?&]ID=168(?:&|#|$)", url) or re.search(r"TIPO=RESCMSP&NUMERO=2&ANO=1991", url):
        return "RI"
    if re.search(r"[?&]ID=68(?:&|#|$)", url) or "TIPO=LOM" in url:
        return "LOM"
    if re.search(r"planalto\.gov\.br/ccivil_03/constituicao/constituicao", url, re.I):
        return "CF"
    return "OUTRA"


# Citação de precedente regimental: "Precedente Regimental nº 02/2004", "nº 01 de 2015",
# "nº 02, de 24 de junho de 2020", "02/19", "No 1/2001", "sem número, de 1997", "Precedente Nº 03/04"
RE_CIT_PREC = re.compile(
    r"\b(?:Precedente|Procedente)\s+(?:Regimental\s+)?(?:n\s*[º°o.]\s*)?"
    r"(?:(?P<n>\d{1,3})\s*(?:/\s*(?P<a1>\d{4}|\d{2})(?!\d)"
    r"|,?\s+de\s+(?:\d{1,2}\s+de\s+[a-zç]+\s+de\s+)?(?P<a2>\d{4}))"
    r"|sem\s+n[úu]mero,?\s+de\s+(?P<a3>\d{4}))",
    re.IGNORECASE,
)


def _detect_precedentes(corpus: _Corpus, art: ArticleBlock, unit: DocumentUnit, path: str) -> list[Remissao]:
    """Citações de precedentes regimentais, inclusive nas notas ("(Vide Precedente Regimental nº 02/2004)")."""
    law = law_of(art)
    origem = Alvo(law, art.art_number, path)
    text = "".join(" " * len(r.text) if r.strike else r.text for r in unit.runs)
    found: list[Remissao] = []
    for m in RE_CIT_PREC.finditer(text):
        ano = m.group("a1") or m.group("a2") or m.group("a3")
        if len(ano) == 2:
            ano = str((2000 if int(ano) < 50 else 1900) + int(ano))
        num = str(int(m.group("n"))) if m.group("n") else "0"
        alvo = corpus.resolve(PREC, f"{num}/{ano}", "")
        found.append(Remissao(unit=unit, origem=origem, start=m.start(), end=m.end(),
                              classe="interna" if law == PREC else "cruzada", alvos=[alvo],
                              url=_link_in(unit, m.start(), m.end()),
                              mesmo_artigo=(law, art.art_number) == (PREC, alvo.art)))
    return found


def _detect_unit(corpus: _Corpus, art: ArticleBlock, unit: DocumentUnit, path: str) -> list[Remissao]:
    law = law_of(art)
    origem = Alvo(law, art.art_number, path)
    work = _working_text(unit)
    in_adt = art.art_number.startswith("ADT")
    prec = law == PREC   # no precedente, "artigo 13" é do Regimento
    found: list[Remissao] = []

    clusters = []
    for cl in _find_clusters(work, prec):
        cl_start = cl[0][0]["start"]
        glued = re.match(r"(?i)[dn][oa]s?(?=art)", work[cl_start:cl_start + 8])
        if glued:
            cl_start += glued.end()
        cl_end = max(g["end"] for g, _ in cl)
        qkind, qend = _find_qualifier(work, cl_end, prec)
        todos = bool(qkind) and bool(re.match(r"[\s,]*(?:todos|todas|ambos)\s", work[cl_end:]))
        clusters.append([cl, cl_start, cl_end, qkind, qend, todos, False])
    # "artigo 7º, incisos ..., bem como ... artigos 40 e 41, todos da Constituição": herda o qualificador
    for ci, c in enumerate(clusters):
        if c[5]:
            for p in reversed(clusters[:ci]):
                if re.search(r";|\.\s+[A-ZÀ-Ú][a-zà-ú]", work[p[2]:c[1]]):
                    break
                if p[3] is None:
                    p[3], p[6] = c[3], True

    for cl, cl_start, cl_end, qkind, qend, _todos, herdado in clusters:
        end = qend if (qkind and not herdado) else cl_end
        rem = Remissao(unit=unit, origem=origem, start=cl_start, end=end, classe="interna",
                       url=_link_in(unit, cl_start, end))
        if _link_norma(rem.url) == "OUTRA":
            # o link já posto no DOCX diz que é outra norma (ex.: LOM DGT 26-31 → EC 103/2019)
            rem.classe = "externa"
            found.append(rem)
            continue
        for r in _build_refs(cl):
            special = r.get("special")
            rpath = r["path"]
            target_art = r["art"]
            if target_art is None and special is None and qkind not in (None, "REL_ART", "RI", "LOM", "CF", "LOMADT",
                                                                        "RIADT"):
                rem.classe = "externa"          # "inciso II do referido artigo" (de outra norma)
                continue
            if target_art is None and special is None:
                # relativa, no próprio artigo: "§ 2º deste artigo", "inciso I"
                rem.classe = "relativa"
                rem.mesmo_artigo = True
                alvo = _resolve_relative(corpus, law, art.art_number, unit, rpath)
                if qkind not in (None, "REL_ART"):
                    alvo.status = AMBIGUA       # "§ 2º da Lei Orgânica", sem o artigo
                rem.alvos.append(alvo)
                continue
            if special in RELATIVE_WORDS:
                if prec:
                    continue                    # "artigo anterior" do próprio precedente (itens)
                # "artigo anterior" / "artigo seguinte"
                rem.classe = "relativa"
                order = corpus.order[law]
                i = order.index(art.art_number)
                j = i - 1 if special in ("anterior", "precedente", "antecedente") else i + 1
                if 0 <= j < len(order):
                    rem.alvos.append(corpus.resolve(law, order[j], _path_key(rpath)))
                else:
                    rem.alvos.append(Alvo(law, "?", "", NAO_RESOLVIDO))
                continue
            if qkind in (None, "REL_ART"):
                target_law = "RI" if prec else law
            elif qkind in ("RI", "LOM", "CF"):
                target_law = qkind
            elif qkind == "RIADT":
                # "Artigos 183-A e 4D do Ato das Disposições Transitórias": o do ADT, se existe
                target_law = "RI"
                if not target_art.startswith("ADT") and ("RI", "ADT" + target_art) in corpus.arts:
                    target_art = "ADT" + target_art
            elif qkind == "LOMADT":
                target_law = "LOM"
                target_art = target_art if target_art.startswith("ADT") else "ADT" + target_art
            else:
                rem.classe = "externa"
                continue
            if target_law != law:
                rem.classe = "cruzada"
            status_extra = None
            if in_adt and qkind is None and not target_art.startswith("ADT"):
                main_exists = (target_law, target_art) in corpus.arts
                adt_exists = (target_law, "ADT" + target_art) in corpus.arts
                if main_exists and adt_exists:
                    status_extra = AMBIGUA
                elif adt_exists:
                    target_art = "ADT" + target_art
            if target_law == "CF" and (target_law, target_art) not in corpus.arts:
                rem.classe = "externa"          # CF fora do recorte (arts. 29-31)
                continue
            alvo = corpus.resolve(target_law, target_art, _path_key(rpath))
            if status_extra:
                alvo.status = status_extra
            rem.alvos.append(alvo)
        if rem.alvos or rem.classe == "externa":
            found.append(rem)
    return found


def _resolve_relative(corpus: _Corpus, law: str, art: str, unit: DocumentUnit, rpath: dict) -> Alvo:
    special = [k for k, v in rpath.items() if v in RELATIVE_WORDS]
    if not special:
        if rpath.get("PAR") == "*" or rpath.get("INC") == "*":
            return corpus.resolve(law, art, "")
        return corpus.resolve(law, art, _path_key(rpath))
    kind = special[0]
    lst = corpus.units[(law, art)]
    idx = next((i for i, (u, _) in enumerate(lst) if u is unit), None)
    want = {"PAR": ("PARAGRAFO_NUM", "PARAGRAFO_UNICO"), "INC": ("INCISO",), "ALI": ("ALINEA",)}.get(kind, ())
    if idx is not None:
        rng = range(idx - 1, -1, -1) if rpath[kind] in ("anterior", "precedente", "antecedente") \
            else range(idx + 1, len(lst))
        for i in rng:
            u, p = lst[i]
            if u.unit_type.value in want:
                below = [rpath[k] for k in ("INC", "ALI", "ITEM")
                         if k in rpath and LEVEL[k] > LEVEL[kind] and rpath[k] not in RELATIVE_WORDS + ("*",)]
                return corpus.resolve(law, art, ",".join([p] + below))
    return Alvo(law, art, "", NAO_RESOLVIDO)


# ── ajustes manuais (remissoes_excecoes.toml) ─────────────────────────────

def carregar_excecoes(path: str | Path) -> dict:
    p = Path(path)
    if not p.exists():
        return {}
    try:
        import tomllib
    except ModuleNotFoundError:  # pragma: no cover
        import tomli as tomllib  # type: ignore[no-redef]
    with open(p, "rb") as f:
        return tomllib.load(f)


def _parse_ref(ref: str) -> tuple[str, str, str]:
    """"369" / "LOM:42,§ 7º" / "LOM:ADT29,III" → (norma, artigo, caminho).

    Aceita variações digitadas à mão: "LOM: 26, p.ú.", "§1", "§ 2", "a)", "RI:369".
    """
    law = "RI"
    m = re.match(r"^\s*([A-Za-z]{2,})\s*:\s*(.+)$", ref.strip())
    if m:
        law, ref = m.group(1).upper(), m.group(2)
    parts = [p.strip() for p in ref.split(",")]
    art = re.sub(r"\s+", "", parts[0]).replace("º", "").replace("°", "").upper()
    segs = []
    for p in parts[1:]:
        low = p.lower().replace(" ", "")
        if low in ("pu", "p.u.", "p.ú.", "§ú", "§u", "parágrafoúnico", "paragrafounico"):
            segs.append("§ú")
            continue
        mp = re.match(r"^§\s*(\d+)\s*[º°o]?(?:\s*-\s*([A-H]))?$", p, re.I)
        if mp:
            segs.append(f"§ {mp.group(1)}º" + (f"-{mp.group(2).upper()}" if mp.group(2) else ""))
            continue
        if re.fullmatch(r"[a-z]\)", p):
            p = p[0]
        segs.append(p)
    return law, art, ",".join(segs)


def _norm_space(s: str) -> str:
    return re.sub(r"[\s\xa0]+", " ", s)


def _aplicar_excecoes(corpus: _Corpus, res: Resultado, exc: dict) -> None:
    by_origin: dict[tuple[str, str, str], DocumentUnit] = {}
    for (law, art, path), u in corpus.vig.items():
        by_origin[(law, art, path)] = u

    def localizar(item, tipo):
        key = _parse_ref(item.get("origem", ""))
        if key[0] == PREC and not key[2]:
            # precedente: o trecho é procurado em todos os parágrafos dele
            cands = [u for u, _ in corpus.units.get((key[0], key[1]), [])]
        else:
            cands = [by_origin[key]] if key in by_origin else []
        trecho = item.get("trecho", "")
        if not cands:
            res.avisos.append((f"Exceção ({tipo}) com origem inexistente: {item.get('origem')!r}", "remissoes_excecoes.toml"))
            return None, None, None
        rx = r"[\s\xa0]+".join(map(re.escape, trecho.split()))
        for unit in cands:
            # also in the notes, where the citations to precedents are ("(Vide Precedente ...)")
            for text in (_working_text(unit), "".join(" " * len(r.text) if r.strike else r.text for r in unit.runs)):
                m = re.search(rx, text) if trecho.strip() else None
                if m is not None:
                    return key, unit, (m.start(), m.end())
        res.avisos.append((f"Exceção ({tipo}): trecho {trecho!r} não encontrado em {item.get('origem')}",
                           "remissoes_excecoes.toml"))
        return None, None, None

    for item in exc.get("ignorar", []):
        key, unit, span = localizar(item, "ignorar")
        if unit is None:
            continue
        res.remissoes = [r for r in res.remissoes
                         if not (r.unit is unit and r.start < span[1] and span[0] < r.end)]
    for item in exc.get("definir", []):
        key, unit, span = localizar(item, "definir")
        if unit is None:
            continue
        res.remissoes = [r for r in res.remissoes
                         if not (r.unit is unit and r.start < span[1] and span[0] < r.end)]
        alvos = [corpus.resolve(*_parse_ref(a)) for a in item.get("alvos", [])]
        origem = Alvo(*key)
        classe = "interna" if all(a.law == origem.law for a in alvos) else "cruzada"
        res.remissoes.append(Remissao(unit=unit, origem=origem, start=span[0], end=span[1], classe=classe,
                                      alvos=alvos, url=_link_in(unit, *span)))


# ── entrada ───────────────────────────────────────────────────────────────

def detectar(doc: ParsedDocument, excecoes: Optional[dict] = None, implicitas: Optional[list[dict]] = None,
             *, privadas: bool = False, propostas: bool = False) -> Resultado:
    """Detecta e resolve as remissões do documento (depois de resolve_amendments e dos
    prefixos de norma).

    implicitas: linhas da planilha (carregar_implicitas). Entram as de Status "aprovado";
    as "proposto" só com propostas=True (build de teste, para revisar); as de
    Visibilidade "privado" só com privadas=True (versão privada).
    """
    corpus = _Corpus(doc)
    res = Resultado()
    for (law, art_number), units in corpus.units.items():
        art = corpus.arts[(law, art_number)]
        if art.is_revoked:
            continue
        for unit, path in units:
            if unit.is_old_version or unit.is_revoked:
                continue
            res.remissoes.extend(_detect_unit(corpus, art, unit, path))
            res.remissoes.extend(_detect_precedentes(corpus, art, unit, path))
    if excecoes:
        _aplicar_excecoes(corpus, res, excecoes)
    res.remissoes.sort(key=lambda r: (corpus.order[r.origem.law].index(r.origem.art)
                                      if r.origem.art in corpus.order[r.origem.law] else 0, r.start))
    for r in res.remissoes:
        if r.classe == "externa" or r.mesmo_artigo:
            continue
        for a in r.alvos:
            if a.status not in EXIBIVEIS:
                status = "precedente inexistente" if a.law == PREC else a.status.replace("_", " ")
                res.avisos.append((
                    f"Remissão não resolvida ({status}): \"{_norm_space(r.trecho).strip()}\" "
                    f"→ {a.rotulo}",
                    r.origem.rotulo,
                ))
    if implicitas:
        _resolver_implicitas(corpus, res, implicitas, privadas=privadas, propostas=propostas)
    return res


# ── implícitas (remissoes.xlsx) ───────────────────────────────────────────

COLUNAS = ("ID", "Origem", "Destino", "Tipo", "Nota", "Status", "Visibilidade")


def carregar_implicitas(path: str | Path) -> list[dict]:
    """Linhas da aba "Remissões" da planilha (ou da primeira aba), como dicts pelas colunas COLUNAS.

    Cada dict tem também "linha" (número da linha no Excel). Planilha ausente: [].
    """
    p = Path(path)
    if not p.exists():
        return []
    import openpyxl

    wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
    try:
        ws = wb["Remissões"] if "Remissões" in wb.sheetnames else wb.worksheets[0]
        rows = ws.iter_rows(values_only=True)
        header = [str(c or "").strip().lower() for c in next(rows, ())]
        idx = {c: header.index(c.lower()) for c in COLUNAS if c.lower() in header}
        out = []
        for n, row in enumerate(rows, start=2):
            item = {c: str(row[i]).strip() if i < len(row) and row[i] is not None else "" for c, i in idx.items()}
            if item.get("Origem") or item.get("Destino"):
                item["linha"] = n
                out.append(item)
        return out
    finally:
        wb.close()


def _resolver_implicitas(corpus: _Corpus, res: Resultado, linhas: list[dict], *,
                         privadas: bool, propostas: bool) -> None:
    explicit = {(id(r.unit), a.ref) for r in res.remissoes if r.exibivel for a in r.alvos}
    vistos = set()
    for item in linhas:
        status = item.get("Status", "").strip().lower()
        if status in ("rejeitado", "rejeitada"):
            continue
        if status not in ("aprovado", "aprovada", "proposto", "proposta"):
            res.avisos.append((f"Status desconhecido {item.get('Status')!r} (use aprovado, proposto ou rejeitado)",
                               f"remissoes.xlsx, linha {item['linha']}"))
            continue
        proposta = status.startswith("propost")
        if proposta and not propostas:
            continue
        if item.get("Visibilidade", "").strip().lower().startswith("priv") and not privadas:
            continue
        ctx = f"remissoes.xlsx, linha {item['linha']}"
        tipo = TIPOS.get(item.get("Tipo", "").strip().lower())
        if tipo is None:
            res.avisos.append((f"Tipo desconhecido {item.get('Tipo')!r} "
                               f"(use: {', '.join(t for t in TIPOS if t != 'simetria')})", ctx))
            continue
        if tipo == "div" and not item.get("Nota", "").strip():
            res.avisos.append(("Divergência sem nota (a nota é obrigatória)", ctx))
            continue
        lados = []
        for col in ("Origem", "Destino"):
            law, art, path = _parse_ref(item.get(col, ""))
            u = corpus.vig.get((law, art, path))
            a = corpus.arts.get((law, art))
            if u is None or a is None or a.is_revoked or u.is_old_version or u.is_revoked:
                res.avisos.append((f"{col} {item.get(col)!r} não existe no documento (ou não está em vigor)", ctx))
                break
            lados.append((Alvo(law, art, path), u))
        if len(lados) < 2:
            continue
        (o, uo), (d, ud) = lados
        if (o.ref, d.ref) in vistos:
            res.avisos.append((f"Par repetido: {o.ref} → {d.ref}", ctx))
            continue
        vistos.add((o.ref, d.ref))
        if (id(uo), d.ref) in explicit:
            res.avisos.append((f"O texto de {o.rotulo} já cita {d.rotulo} (remissão explícita)", ctx))
        res.implicitas.append(Implicita(id=item.get("ID", ""), origem=o, destino=d, tipo=tipo,
                                        nota=item.get("Nota", "").strip(), proposta=proposta,
                                        u_origem=uo, u_destino=ud))


# ── o que mudou desde o último build ──────────────────────────────────────

def _snapshot(res: Resultado) -> list[str]:
    return sorted({
        f"{r.origem.rotulo}: \"{_norm_space(r.trecho).strip()}\" → "
        + "; ".join(a.rotulo for a in r.alvos if a.status in EXIBIVEIS)
        for r in res.remissoes if r.exibivel
    })


def mudancas_desde_ultimo_build(res: Resultado, path: str | Path, limite: int = 15,
                                gravar: bool = True) -> list[str]:
    """Compara as remissões com as do build anterior (gravadas em path) e, com gravar, grava as atuais.

    Devolve linhas para o console: o resumo e as remissões novas ou que sumiram, que
    vale conferir depois de editar o DOCX.
    """
    import json

    p = Path(path)
    atual = _snapshot(res)
    try:
        anterior = json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
    except (OSError, ValueError):
        anterior = None
    if gravar:
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(atual, ensure_ascii=False, indent=0), encoding="utf-8")
        except OSError:
            pass
    if anterior is None:
        return []
    novas = [x for x in atual if x not in set(anterior)]
    sumiram = [x for x in anterior if x not in set(atual)]
    if not novas and not sumiram:
        return ["remissões iguais às do build anterior"]
    out = [f"remissões desde o build anterior: {len(novas)} nova(s), {len(sumiram)} saíram"]
    out += [f"+ {x}" for x in novas[:limite]] + ([f"  (... mais {len(novas) - limite})"] if len(novas) > limite else [])
    out += [f"- {x}" for x in sumiram[:limite]] + ([f"  (... mais {len(sumiram) - limite})"] if len(sumiram) > limite else [])
    return out
