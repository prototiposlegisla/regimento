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
_LEI = {"RI": "RI", "LOM": "LOM", "LO": "LOM", "CE": "CE", "CF": "CF"}


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


# ── ordem das entradas ──────────────────────────────────────────────────
# Prazos e tempos do mais curto ao mais longo; quóruns e subscrição do menor ao maior; datas pelo
# calendário; números e composição pelo artigo. No empate, o artigo (RI, LOM, CE, CF, precedentes).
# Vale no site, na busca (empate de relevância) e na folha impressa, que lê o yaml na ordem do arquivo:
# por isso o yaml é gravado em ordem (ordenar_yaml) e o build avisa quando não está.

_ORDEM_NORMA = {"RI": 0, "LOM": 1, "CE": 2, "CF": 3, "PREC": 4}
_MINUTOS = [(r"min", 1), (r"h", 60), (r"d", 1440), (r"mes(?:es)?", 43_200), (r"anos?", 525_600)]
_MESES = {m: i for i, m in enumerate(("jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out",
                                      "nov", "dez"), 1)}


def _romano(s: str) -> int:
    v = {"I": 1, "V": 5, "X": 10, "L": 50}
    n = [v[c] for c in s if c in v]
    return sum(-x if i + 1 < len(n) and x < n[i + 1] else x for i, x in enumerate(n))


def _chave_artigo(art: str) -> tuple:
    """'103 I o · 368' → a posição do primeiro dispositivo citado: norma, artigo, parágrafo, inciso, alínea."""
    refs = parse_arts(art or "")
    if not refs:
        return (9,)
    lei, num, path = refs[0]
    if lei == "PREC":
        n, ano = num.split("/")
        return (_ORDEM_NORMA[lei], int(ano), int(n))
    m = re.fullmatch(r"(ADT)?(\d+)(?:-([A-Z]))?", num)
    artigo = (bool(m[1]), int(m[2]), m[3] or "") if m else (True, 9999, num)
    par = inc = ali = 0
    for p in path.split(","):
        if p == "§ú":
            par = 1
        elif p.startswith("§"):
            par = int(re.sub(r"\D", "", p))
        elif _ROMANO.match(p):
            inc = _romano(p)
        elif p:
            ali = ord(p)
    return (_ORDEM_NORMA.get(lei, 5), *artigo, par, inc, ali)


def _chave_duracao(valor: str) -> tuple:
    """'48 h' antes de '3 d'; no mesmo tempo, a unidade menor primeiro ('48 h' antes de '2 d', '90 d' antes de
    '3 meses'), '15 d' antes de '15 d úteis', e esse antes de '> 15 d'; pelo primeiro número ('10 / 15 d',
    '2 d úteis / 30 d'). O que não é duração vai no fim: o que se conta em sessões ou do 1º dia útil, pelo
    número; depois o que se repete ('1x/semana', 'quinzenal'), pelo período."""
    s = _norm(valor)
    periodo = next((p for w, p in (("semana", 7), ("quinzenal", 15), ("mensal", 30), ("anual", 365)) if w in s), 0)
    if periodo:
        return (2, periodo, 0, 0)
    m = re.match(r"\s*([<>≥≤])?\s*(\d+)\s*(?:h\s*(\d+))?", s)
    if not m or "sess" in s or re.match(r"\s*\d+\s*[ºª°]", s):
        n = re.search(r"\d+", s)
        return (1, int(n[0]) if n else 0, 0, 0)
    if m[3]:   # '1h45'
        return (0, int(m[2]) * 60 + int(m[3]), 60, 0)
    resto = s[m.end():]
    for unid, fator in _MINUTOS:
        u = re.search(rf"\b{unid}\b(\s+ute?is|\s+util)?", resto)
        if u and not re.search(r"\b(min|h|d|mes(?:es)?|anos?)\b", resto[:u.start()]):
            return (0, int(m[2]) * fator, fator, 2 if m[1] else 1 if u[1] else 0)
    return (1, int(m[2]), 0, 0)


def _chave_quorum(valor: str) -> tuple:
    """Do menor ao maior pela conta sobre 55 ('absoluta (28)', '1/3 (19)'); a maioria simples e a dos votantes
    antes de todos; os de colegiado ('maioria dos membros' da Mesa ou da Comissão) e os do eleitorado no fim."""
    s = _norm(valor)
    if "eleitorado" in s:
        p = re.search(r"\d+(?:,\d+)?", s)
        return (2, float(p[0].replace(",", ".")) if p else 0)
    n = re.search(r"\((\d+)\)", s)
    if n:
        return (0, int(n[1]))
    if re.search(r"simples|presentes|votantes", s):
        return (0, 0)
    if re.search(r"membros|mesa", s):
        return (1, 0)
    if re.fullmatch(r"\d+", s.strip()):
        return (0, int(s))
    if "absoluta" in s:
        return (0, 28)
    f = re.search(r"(\d+)/(\d+)", s)
    return (0, 55 * int(f[1]) / int(f[2])) if f else (3, 0)


def _chave_data(valor: str) -> tuple:
    """Pelo calendário, do 1º de janeiro a 31 de dezembro; depois o que se repete: na semana ('ter · qua · qui'),
    no mês ('dia 20', '1ª ter do mês'), no bimestre."""
    s = _norm(valor)
    meses = "|".join(_MESES)
    m = re.search(rf"(\d+)\s*[ºª°]?\s*({meses})\b", s)
    if m:
        return (0, _MESES[m[2]], int(m[1]))
    if re.search(r"\bdia \d+|do mes", s):
        d = re.search(r"\d+", s)
        dia = int(d[0]) if "dia" in s else (int(d[0]) - 1) * 7 + 1
        return (1, 1, dia)
    if "bimestre" in s:
        return (1, 2, 0)
    m = re.search(rf"\b({meses})\b", s)
    if m:
        return (0, _MESES[m[1]], 0)
    return (1, 0, 0)


# seção do yaml → (campo do valor, chave do valor); None: só o artigo
ORDEM = {
    "prazos": ("prazo", _chave_duracao),
    "tempos": ("t", _chave_duracao),
    "quoruns": ("n", _chave_quorum),
    "quorum_materia": ("quorum", _chave_quorum),
    "subscricao": ("frac", _chave_quorum),
    "datas": ("d", _chave_data),
    "numeros": ("valor", None),
}


def ordenar(dados: dict) -> dict:
    """As seções de ORDEM em ordem (cópia rasa de dados; as outras seções como estão)."""
    novo = dict(dados)
    for key, (campo, chave) in ORDEM.items():
        if isinstance(dados.get(key), list):
            novo[key] = sorted(dados[key], key=lambda e: ((chave(str(e.get(campo, ""))) if chave else ()),
                                                          _chave_artigo(str(e.get("art", "")))))
    return novo


def ordenar_yaml(texto: str) -> str:
    """O texto do consulta-rapida.yaml com as entradas de cada seção de ORDEM em ordem, linha a linha (cada entrada
    leva as suas linhas; o resto do arquivo fica como está). Recusa seção com comentário no meio, que não saberia
    a que entrada pertence."""
    import yaml
    linhas = texto.split("\n")
    for key in ORDEM:
        ini = next((i for i, l in enumerate(linhas) if re.match(rf"^{key}:\s*$", l)), None)
        if ini is None:
            continue
        fim = ini + 1
        while fim < len(linhas) and not re.match(r"^[A-Za-z_]\w*:", linhas[fim]):
            fim += 1
        while fim > ini + 1 and (not linhas[fim - 1].strip() or linhas[fim - 1].lstrip().startswith("#")):
            fim -= 1
        corpo = linhas[ini + 1:fim]
        if any(l.lstrip().startswith("#") for l in corpo):
            raise ValueError(f"{key}: comentário entre as entradas; ordene à mão")
        inicios = [i for i, l in enumerate(corpo) if re.match(r"^ *- ", l)]
        if not inicios or inicios[0] != 0:
            continue
        blocos = [corpo[a:b] for a, b in zip(inicios, inicios[1:] + [len(corpo)])]
        itens = [yaml.safe_load("\n".join(b))[0] for b in blocos]
        pos = {id(e): n for n, e in enumerate(ordenar({key: itens})[key])}
        ordem = sorted(range(len(itens)), key=lambda i: pos[id(itens[i])])
        linhas[ini + 1:fim] = [l for i in ordem for l in blocos[i]]
    novo = "\n".join(linhas)
    if yaml.safe_load(novo) != ordenar(yaml.safe_load(texto)):
        raise ValueError("o yaml reordenado não bate com a ordem esperada: nada mudou")
    return novo


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
    obs?, list?, steps?, art, refs, cf?}. A seção "temas" vem primeiro. O que não está no yaml fica fora.
    As entradas de valor saem em ordem (ORDEM), esteja o yaml em ordem ou não.
    """
    dados = ordenar(dados)
    secoes: list[dict] = []
    # temas: tudo de um assunto numa ficha só (o Grande Expediente: duração, tempo por orador, aparte...),
    # cada fato com o artigo entre parênteses, como nas listas de apartes
    temas = []
    for e in dados.get("temas") or []:
        lista = []
        for frase in e.get("itens") or []:
            texto, art = _artigo_ao_fim(str(frase))
            lista.append({"text": texto, "art": art, "refs": _refs_json(art)})
        item = {"label": e.get("titulo", ""), "list": lista, "art": "", "refs": []}
        if e.get("termos"):
            item["terms"] = str(e["termos"])
        if e.get("grupo"):
            item["group"] = str(e["grupo"])   # subtítulo na aba Referências ("Fases da sessão", "Listas de hipóteses")
        temas.append(item)
    if temas:
        secoes.append({"key": "temas", "title": "Por tema", "kind": "ficha", "terms": "tema resumo regras", "items": temas})
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
        if sec["key"] == "temas":
            # os grupos da aba Referências têm de vir juntos: um grupo que volta mais adiante repetiria o subtítulo
            vistos, antes = set(), None
            for item in sec["items"]:
                g = item.get("group")
                if g and g != antes and g in vistos:
                    avisos.append(("aviso", f"grupo «{g}» fora de sequência", f"{sec['title']}: {item['label']}"))
                vistos.add(g)
                antes = g
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
            if sec["key"] == "temas":
                # cada fato do tema: os números e as frações têm de estar no texto do artigo citado na linha
                for sub in item.get("list") or []:
                    if not sub["art"]:
                        avisos.append(("aviso", "fato sem o artigo entre parênteses no fim", f"{ctx} › {sub['text']}"))
                        continue
                    texto = " ".join(_norm(u.full_text) for r in sub["refs"]
                                     for u, _ in corpus.units.get((r["law"], r["art"]), []))
                    if not texto:
                        continue
                    frase = re.sub(r"⚠.*", "", sub["text"])   # o aviso cita outro dispositivo
                    # a conta sobre 55 ("1/3 (19)", "(≥ 23)") e os ordinais ("1ª sessão") não estão escritos no texto
                    frase = re.sub(r"\(\s*[≥≤]?\s*\d+\s*\)|\b\d+\s*[ºª°]", " ", frase)
                    faltam = [f for f in re.findall(r"\d+/\d+", frase)
                              if f not in texto and not any(x in texto for x in FRACOES.get(f, ()))]
                    for x in dict.fromkeys(re.findall(r"\d{1,3}(?:\.\d{3})+|\d+", re.sub(r"\d+/\d+", " ", frase))):
                        n = int(x.replace(".", ""))
                        # milhar e ano só por algarismo ("1.500 eleitores", "2025"); o resto também por extenso
                        if not (x in texto if n >= 1000 else numero_no_texto(n, texto)):
                            faltam.append(x)
                    for f in faltam:
                        avisos.append(("aviso", f"«{f}» não aparece no texto ({sub['art']})", f"{ctx} › {sub['text']}"))
                continue
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


def main(argv: list[str] | None = None) -> int:
    """python -m src.consulta --ordenar [consulta-rapida.yaml]: grava o yaml com as entradas em ordem (backup
    .antes-ordem.yaml em varredura/backups, se houver, ou ao lado). Sem arquivo, o da config.local.toml (o do build)."""
    import argparse
    p = argparse.ArgumentParser(prog="python -m src.consulta")
    p.add_argument("--ordenar", action="store_true", help="grava o yaml com as entradas em ordem")
    p.add_argument("arquivo", nargs="?")
    args = p.parse_args(argv)
    if not args.ordenar:
        p.print_help()
        return 1
    if args.arquivo:
        path = Path(args.arquivo)
    else:
        import build
        fontes = build._load_config().get("sources", {})
        path = Path(fontes.get("consulta") or Path(fontes.get("docx", "")).parent / "consulta-rapida.yaml")
    bruto = path.read_bytes()
    nl = "\r\n" if b"\r\n" in bruto else "\n"
    texto = bruto.decode("utf-8").replace("\r\n", "\n")
    novo = ordenar_yaml(texto)
    if novo == texto:
        print(f"{path}: já em ordem")
        return 0
    pasta = path.parent / "varredura" / "backups"
    backup = (pasta if pasta.is_dir() else path.parent) / f"{path.stem}.antes-ordem{path.suffix}"
    backup.write_bytes(bruto)
    with open(path, "w", encoding="utf-8", newline=nl) as f:
        f.write(novo)
    print(f"{path}: entradas em ordem (backup: {backup})")
    return 0


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
