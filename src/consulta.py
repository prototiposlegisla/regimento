"""Consulta rápida: prazos, quóruns, tempos, datas e hipóteses de FontesAtual/consulta-rapida.yaml.

O mesmo arquivo alimenta a folha impressa (Cheatsheet, Typst) e, aqui, a aba Referências e o topo
da busca universal. Cada entrada leva o artigo de onde veio num texto curto ("103 I o · 368",
"LOM 138 §6º"), que é convertido em ligações aos dispositivos e conferido com o texto do DOCX.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from .remissoes import ART_INEXISTENTE, REVOGADO, SUB_INEXISTENTE, TACHADO, _Corpus

# Seções do yaml, na ordem do site: (chave, título, tipo, campo do valor, do rótulo, da observação,
# palavras que a busca encontra sem estarem escritas: "prazo vista" acha o pedido de vista)
SECOES_VALOR = [
    ("prazos", "Prazos", "prazo", "evento", "obs", "prazo prazos"),
    ("quoruns", "Quóruns", "n", "nome", "def", "quórum quóruns quorum maioria votos"),
    ("quorum_materia", "Quórum por matéria", "quorum", "materia", None,
     "quórum quóruns quorum maioria votos votação aprovação"),
    ("subscricao", "Subscrição", "frac", "o_que", None, "subscrição assinaturas quórum quorum vereadores"),
    ("tempos", "Tempos", "t", "o_que", None, "tempo tempos duração minutos fala palavra"),
    ("datas", "Datas", "d", "o_que", None, "data datas quando calendário prazo"),
    ("numeros", "Números e composição", "valor", "o_que", None, "número números quantos composição membros"),
]
# Listas de frases, cada uma com o artigo entre parênteses no fim
LISTAS = [
    ("aparte_cabe", "Cabe aparte", "aparte apartes"),
    ("aparte_naocabe", "Não cabe aparte", "aparte apartes"),
    ("audiencias", "Audiência pública obrigatória", "audiência audiências pública obrigatória"),
]
# O que do valor tem de estar no texto dos artigos citados: os números (prazos, tempos, datas,
# composição) ou só as frações e "absoluta" (quóruns, cujo número é a conta sobre 55)
CONFERE_NUMERO = {"prazos", "tempos", "datas", "numeros"}
CONFERE_QUORUM = {"quoruns", "quorum_materia", "subscricao"}
SEM_DESTAQUE = {"datas"}   # '15 dez' fica inteiro

FRACOES = {"1/2": ("metade",), "1/3": ("um terco", "terca parte"), "2/3": ("dois tercos",),
           "3/5": ("tres quintos",), "1/4": ("um quarto", "quarta parte"), "1/5": ("um quinto", "quinta parte"),
           "1/10": ("um decimo", "decima parte"), "1/20": ("um vinte avos", "vigesima parte")}

UNIDADES = {"d": "dias", "h": "horas"}

_ROMANO = re.compile(r"^[IVXL]+$")
_LEI = {"RI": "RI", "LOM": "LOM", "LO": "LOM", "CF": "CF"}


# ── artigos ─────────────────────────────────────────────────────────────

def parse_arts(texto: str) -> list[tuple[str, str, str]]:
    """'103 I o · 368' → [(RI, 103, 'I,o'), (RI, 368, '')].

    Separadores: '·' e ';' entre referências, cada uma do RI salvo prefixo ('LOM 22 · 117' = LOM 22 e
    RI 117); ',' e '/' entre artigos da mesma norma ('LOM 48, 62 · RI 28'). Intervalo de artigos
    ('10–11', '32–34') vira cada artigo; de dispositivos ('§1º-§2º', 'II-IV', 'g-h'), o primeiro.
    Para no que não reconhece ('mín. 2').
    """
    refs: list[tuple[str, str, str]] = []
    texto = re.sub(r"\(revog[^)]*\)", "", texto)
    texto = re.sub(r"(§\s*\d+º?)\s*[-–]\s*§?\s*\d+º?", r"\1", texto)   # '§1º-§2º' → '§1º'
    # precedente regimental, 'PREC 2/2001': a barra não separa; a norma não passa adiante
    texto = re.sub(r"PREC\.?\s*(\d+)\s*/\s*(\d{4})", r"PREC \1_\2", texto, flags=re.I)
    grupos = [(i == 0, g) for seg in re.split(r"\s*[·;]\s*", texto)
              for i, g in enumerate(re.split(r"\s*[,/]\s*", seg))]
    lei = "RI"
    for novo, grupo in grupos:
        if novo:
            lei = "RI"
        mp = re.fullmatch(r"PREC (\d+)_(\d{4})", grupo.strip(), re.I)
        if mp:
            refs.append(("PREC", f"{int(mp.group(1))}/{mp.group(2)}", ""))
            continue
        toks = grupo.replace("§", " § ").replace(":", " ").split()
        if toks and toks[0].upper() in _LEI:
            lei = _LEI[toks.pop(0).upper()]
        adt = bool(toks) and toks[0].upper() == "ADT"
        if adt:
            toks.pop(0)
        if not toks:
            continue
        m = re.fullmatch(r"(\d+)[º°]?(?:-?([A-Z]))?(?:[–-](\d+)[º°]?)?", toks[0])
        if not m:
            continue
        toks.pop(0)
        base = "ADT" if adt else ""
        if m.group(3) and not m.group(2) and 0 < int(m.group(3)) - int(m.group(1)) <= 5:
            refs += [(lei, base + str(n), "") for n in range(int(m.group(1)), int(m.group(3)) + 1)]
            continue
        art = base + m.group(1) + (f"-{m.group(2)}" if m.group(2) else "")
        par = inc = ali = ""
        i = 0
        while i < len(toks):
            t = toks[i]
            if t == "§" and i + 1 < len(toks):
                i += 1
                v = toks[i].split("-")[0]
                if re.fullmatch(r"[úu]n(ico)?\.?", v):
                    par = "§ú"
                elif re.fullmatch(r"\d+[º°]?", v):
                    par = f"§ {v.rstrip('º°')}º"
                else:
                    break
            elif _ROMANO.match(t.split("-")[0].split("–")[0]):
                inc = re.split(r"[-–]", t)[0]
            elif re.fullmatch(r"[a-z](?:[-–][a-z])?", t):
                ali = t[0]
            elif t.lower() == "caput":
                pass
            else:
                break
            i += 1
        refs.append((lei, art, ",".join(p for p in (par, inc, ali) if p)))
    return refs


def _ref_label(lei: str, art: str, path: str) -> str:
    if lei == "PREC":
        return f"Precedente nº {art}"
    rot = art[3:] + " ADT" if art.startswith("ADT") else art
    p = path.replace("§ú", "parágrafo único").replace(",", ", ")
    return (f"{lei} " if lei != "RI" else "") + f"art. {rot}" + (f", {p}" if p else "")


# ── o número em destaque ────────────────────────────────────────────────

def destaque(valor: str) -> tuple[str, str]:
    """O que vai grande e o que vai embaixo: 'absoluta (28)' → ('28', 'absoluta'); '15 d' → ('15', 'dias');
    '5% eleitorado' → ('5%', 'eleitorado'); 'maioria dos membros' → ('maioria', 'dos membros')."""
    valor = valor.strip()
    nums = re.findall(r"\((\d+)\)", valor)
    if nums:
        return " + ".join(nums), re.sub(r"\s+", " ", re.sub(r"\s*\(\d+\)", "", valor)).strip()
    m = re.fullmatch(r"(maioria)\s+(.+)", valor) or re.fullmatch(r"(\d+(?:,\d+)?%)\s*(.*)", valor)
    if m:
        return m.group(1), m.group(2)
    m = re.fullmatch(r"((?:[<>≥≤]\s*)?\d[\d\s/–+:,-]*\d|(?:[<>≥≤]\s*)?\d)(?:\s+(\D.*))?", valor)
    if not m:
        return valor, ""
    n, resto = m.group(1), m.group(2) or ""
    resto = re.sub(r"\b(d|h)\b", lambda x: UNIDADES[x.group(1)], resto)
    if n == "1":
        resto = re.sub(r"^dias\b", "dia", resto)
        resto = re.sub(r"^horas\b", "hora", resto)
    return n, resto


# ── conferência do número com o texto ───────────────────────────────────

_U = ["zero", "um", "dois", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze",
      "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
_D = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
_C = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos",
      "oitocentos", "novecentos"]


def extenso(n: int) -> set[str]:
    """Formas por extenso de 0–999, masculina e feminina ('duas horas', 'catorze')."""
    if n < 20:
        s = _U[n]
    elif n < 100:
        s = _D[n // 10] + (f" e {_U[n % 10]}" if n % 10 else "")
    elif n == 100:
        s = "cem"
    else:
        resto = n % 100
        s = _C[n // 100] + (" e " + (_U[resto] if resto < 20 else _D[resto // 10]
                                      + (f" e {_U[resto % 10]}" if resto % 10 else "")) if resto else "")
    formas = {s, s.replace("quatorze", "catorze")}
    fem = {re.sub(r"\bum$", "uma", re.sub(r"\bdois$", "duas", re.sub(r"entos\b", "entas", f))) for f in formas}
    return formas | fem


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    return re.sub(r"\s+", " ", "".join(c for c in s if unicodedata.category(c) != "Mn"))


def numero_no_texto(n: int, texto: str) -> bool:
    if re.search(rf"(?<![\d.,])0*{n}(?![\d])", texto):   # "05 dias"
        return True
    return any(re.search(rf"\b{f}\b", texto) for f in extenso(n))


# ── montagem ────────────────────────────────────────────────────────────

def carregar(path: str | Path) -> dict:
    import yaml
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _refs_json(texto: str) -> list[dict]:
    out = []
    for lei, art, path in parse_arts(texto or ""):
        r = {"law": lei, "art": art, "label": _ref_label(lei, art, path)}
        if path:
            r["path"] = path
        out.append(r)
    return out


def _artigo_ao_fim(frase: str) -> tuple[str, str]:
    """'Grande Expediente (160)' → ('Grande Expediente', '160')."""
    m = re.search(r"\s*\(([^()]*\d[^()]*)\)\s*$", frase)
    return (frase[:m.start()].strip(), m.group(1)) if m else (frase.strip(), "")


def montar(dados: dict) -> list[dict]:
    """As seções do yaml no formato do site: [{key, title, kind, terms, items}].

    kind "valor": cada item {v, u, label, obs?, art, refs, cf?, terms?}; kind "ficha": {label, text?,
    obs?, list?, steps?, art, refs, cf?}. O que não está no yaml fica fora.
    """
    secoes: list[dict] = []
    for key, title, campo_v, campo_l, campo_o, termos in SECOES_VALOR:
        items = []
        for e in dados.get(key) or []:
            bruto = str(e.get(campo_v, ""))
            v, u = (bruto, "") if key in SEM_DESTAQUE else destaque(bruto)
            item = {"v": str(e.get("destaque", v)), "u": str(e.get("unidade", u)),
                    "label": str(e.get(campo_l, "")), "art": str(e.get("art", "")),
                    "refs": _refs_json(str(e.get("art", ""))),
                    # 'contado: true': o número sai de contar uma lista, não está escrito no texto
                    "_bruto": "" if e.get("contado") else bruto}
            if campo_o and e.get(campo_o):
                item["obs"] = str(e[campo_o])
            if e.get("cf"):
                item["cf"] = True
            if e.get("termos"):
                item["terms"] = str(e["termos"])
            items.append(item)
        if items:
            secoes.append({"key": key, "title": title, "kind": "valor", "terms": termos, "items": items})

    fichas = []
    for e in dados.get("hipoteses") or []:
        item = {"label": e.get("titulo", ""), "text": e.get("chip", ""), "art": str(e.get("art", "")),
                "refs": _refs_json(str(e.get("art", "")))}
        if e.get("nota"):
            item["obs"] = e["nota"]
        if e.get("cf"):
            item["cf"] = True
        if e.get("termos"):
            item["terms"] = str(e["termos"])
        fichas.append(item)
    for key, title, termos in LISTAS:
        frases = dados.get(key) or []
        if not frases:
            continue
        lista = []
        for frase in frases:
            texto, art = _artigo_ao_fim(str(frase))
            lista.append({"text": texto, "art": art, "refs": _refs_json(art)})
        fichas.append({"label": title, "list": lista, "art": "", "refs": [], "terms": termos})
    if fichas:
        secoes.append({"key": "hipoteses", "title": "Hipóteses", "kind": "ficha",
                       "terms": "quando casos hipótese hipóteses cabe", "items": fichas})

    ritos = []
    for e in dados.get("ritos") or []:
        ritos.append({"label": e.get("titulo", ""), "steps": [str(p) for p in e.get("passos") or []],
                      "art": str(e.get("art", "")), "refs": _refs_json(str(e.get("art", "")))})
    retirada = dados.get("retirada_proposicao") or []
    if retirada:
        vias = {"pedir": "basta pedir", "presidente": "Presidente defere", "maioria": "maioria dos membros",
                "plenario": "Plenário delibera"}
        lista = []
        for fase in retirada:
            for caso in fase.get("casos") or []:
                lista.append({"text": f"{fase.get('fase', '')}: {caso.get('cond', '')}",
                              "tag": vias.get(caso.get("via"), caso.get("via", "")), "art": str(fase.get("art", "")),
                              "refs": _refs_json(str(fase.get("art", "")))})
        ritos.append({"label": "Retirada de proposição", "list": lista, "art": "274 · 177",
                      "refs": _refs_json("274 · 177"), "terms": "retirar retirada proposição projeto"})
    if ritos:
        secoes.append({"key": "ritos", "title": "Ritos", "kind": "ficha",
                       "terms": "rito ritos tramitação procedimento passos", "items": ritos})
    return secoes


def _todas_refs(item: dict):
    yield item, item.get("art", ""), item["refs"]
    for sub in item.get("list") or []:
        yield sub, sub.get("art", ""), sub["refs"]


def conferir(secoes: list[dict], doc, avisos: list) -> None:
    """Cada artigo citado tem de existir; o dispositivo, também, e vigente (salvo '(revog.)' no art).
    O valor tem de aparecer no texto dos artigos citados: os números (prazos, tempos, datas,
    composição), por algarismo ou por extenso; nos quóruns, o nome da maioria ou a fração.
    Em avisos, (severidade, mensagem, contexto)."""
    corpus = _Corpus(doc)
    for sec in secoes:
        for item in sec["items"]:
            ctx = f"{sec['title']}: " + (f"{item['v']} — " if "v" in item else "") + item["label"]
            for parte, art_txt, refs in _todas_refs(item):
                sub_ctx = ctx if parte is item else f"{ctx} › {parte['text']}"
                if art_txt and art_txt != "—" and not refs:
                    avisos.append(("aviso", f"artigo não reconhecido: «{art_txt}»", sub_ctx))
                for r in refs:
                    alvo = corpus.resolve(r["law"], r["art"], r.get("path", ""))
                    if alvo.status == ART_INEXISTENTE:
                        avisos.append(("erro", f"{r['label']} — artigo inexistente", sub_ctx))
                    elif alvo.status == SUB_INEXISTENTE:
                        avisos.append(("aviso", f"{r['label']} — dispositivo inexistente", sub_ctx))
                    elif alvo.status in (REVOGADO, TACHADO) and "revog" not in art_txt:
                        avisos.append(("aviso", f"{r['label']} — revogado (marque \"(revog.)\" se é de propósito)",
                                       sub_ctx))
            if not item["refs"] or sec["key"] not in CONFERE_NUMERO | CONFERE_QUORUM:
                continue
            texto = " ".join(_norm(u.full_text) for r in item["refs"]
                             for u, _ in corpus.units.get((r["law"], r["art"]), []))
            arts = ", ".join(dict.fromkeys(r["label"].split(",")[0] for r in item["refs"]))
            bruto = item.get("_bruto", "")
            if sec["key"] in CONFERE_QUORUM:
                bruto += " " + item.get("obs", "")
            # o nome da maioria ("especial") basta; sem nome, a fração ("1/3", "um terço", "terça parte")
            nomes = [w for w in ("absoluta", "simples", "especial", "qualificada") if w in _norm(bruto)]
            fracoes = re.findall(r"\d+/\d+", bruto)
            tem_fracao = [f for f in fracoes if f in texto or any(x in texto for x in FRACOES.get(f, ()))]
            # a LOM escreve "3/5 dos membros" onde o RI diz "maioria especial": um ou outro basta
            faltam = [] if nomes and tem_fracao else [f"maioria {w}" for w in nomes if f"maioria {w}" not in texto]
            if not nomes:
                faltam += [f for f in fracoes if f not in tem_fracao]
            if sec["key"] not in CONFERE_QUORUM:
                sem_fracao = re.sub(r"\d+/\d+", " ", bruto)
                faltam += [str(n) for n in dict.fromkeys(int(x) for x in re.findall(r"\d+", sem_fracao))
                           if not numero_no_texto(n, texto)]
            for f in faltam:
                avisos.append(("aviso", f"«{f}» não aparece no texto ({arts})", ctx))


def para_o_site(secoes: list[dict]) -> list[dict]:
    """Sem os campos que só servem à conferência."""
    for sec in secoes:
        for item in sec["items"]:
            item.pop("_bruto", None)
    return secoes
