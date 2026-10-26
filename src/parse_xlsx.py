"""Parser de remissivo.xlsx → SubjectIndex + mapeamento de normas.

Abas da planilha:
  - a principal (a primeira que não é "Normas" nem "Propostas"): Assunto | SubAssunto |
    Dispositivos | Vides — o índice como está;
  - "Normas": Prefixo | Nome;
  - "Propostas" (opcional): mudanças a revisar, uma por linha (ver aplicar_propostas).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from pathlib import Path

from .models import SubjectEntry, SubjectIndex, SubjectRef

ABAS_AUXILIARES = ("Normas", "Propostas", "Como usar")

# Número de artigo na planilha: "175", "4-A", "ADT2", "2/2004" (precedente regimental)
ART_RE = re.compile(r"^(?:ADT)?\d+[-A-Za-z]*$|^\d+/\d{4}$")


def aba_principal(wb):
    """A aba do índice: a primeira que não é auxiliar (não depende da aba ativa)."""
    for name in wb.sheetnames:
        if name not in ABAS_AUXILIARES:
            return wb[name]
    return None


def parse_law_mapping(path: str | Path) -> dict[str, str]:
    """Lê aba 'Normas' do XLSX → {nome: prefixo}.

    A aba deve ter colunas: Prefixo | Nome.
    Retorna dict vazio se a aba não existir.
    """
    import openpyxl

    path = Path(path)
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    mapping: dict[str, str] = {}
    if "Normas" in wb.sheetnames:
        ws = wb["Normas"]
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not row or len(row) < 2:
                continue
            prefix = str(row[0] or "").strip()
            name = str(row[1] or "").strip()
            if prefix and name:
                mapping[name] = prefix
    wb.close()
    return mapping


def parse_xlsx(path: str | Path,
               known_lettered: dict[str, set[str]] | set[str] | None = None) -> SubjectIndex:
    """Parseia remissivo.xlsx e retorna SubjectIndex.

    known_lettered: artigos letrados conhecidos, para incluir em expansões de range —
    por prefixo de norma ({"": {"212-A"}, "LOM": {"55-A"}}; "" = Regimento), ou um
    conjunto só, que vale para todas.
    """
    import openpyxl

    path = Path(path)
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = aba_principal(wb)
    if ws is None:
        wb.close()
        return SubjectIndex(entries=[])

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

        refs = _parse_dispositivos(dispositivos_raw, known_lettered)
        vides = [v.strip() for v in vides_raw.split("\n") if v.strip()] if vides_raw else []

        entries.append(SubjectEntry(
            subject=assunto,
            sub_subject=sub_assunto,
            refs=refs,
            vides=vides,
        ))

    return SubjectIndex(entries=entries)


def _lettered_for(known_lettered: dict[str, set[str]] | set[str] | None, law_prefix: str) -> set[str]:
    if not known_lettered:
        return set()
    if isinstance(known_lettered, dict):
        return known_lettered.get(law_prefix, set())
    return known_lettered


def _parse_dispositivos(raw: str,
                        known_lettered: dict[str, set[str]] | set[str] | None = None) -> list[SubjectRef]:
    """Converte string de dispositivos em lista de SubjectRef.

    Formatos aceitos:
    - "211-275"       → range de artigos
    - "175,II"        → artigo + inciso
    - "176,§10"       → artigo + parágrafo
    - "176,PU"        → artigo + parágrafo único
    - "176"           → artigo só
    - "LO:23"         → artigo de outra lei (prefixo:artigo)
    - "LO:23,II"      → artigo de outra lei + detalhe
    - "PREC:2/2004"   → precedente regimental
    - Múltiplos separados por \\n
    """
    refs: list[SubjectRef] = []
    lines = raw.split("\n")

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Detect law prefix: "LO:23" or "LO:23,II"
        law_prefix = ""
        law_m = re.match(r"^([A-Z]{2,})\s*:\s*(.+)$", line)
        if law_m:
            law_prefix = law_m.group(1)
            line = law_m.group(2).strip()

        # Extract hint from parentheses at end of line: "13,I,b(propor privativamente)"
        hint = ""
        hint_m = re.search(r"\(([^)]+)\)\s*$", line)
        if hint_m:
            hint = hint_m.group(1).strip()
            line = line[:hint_m.start()].strip()

        # Range: "211-275"
        range_m = re.match(r"^(\d+)\s*[-–—]\s*(\d+)$", line)
        if range_m:
            start = int(range_m.group(1))
            end = int(range_m.group(2))
            lettered = sorted(_lettered_for(known_lettered, law_prefix))
            for n in range(start, end + 1):
                refs.append(SubjectRef(art=str(n), law_prefix=law_prefix, hint=hint, from_range=True))
                # Inclui artigos letrados (ex: "212-A") da mesma norma cujo número base está no range
                for art in lettered:
                    m = re.match(r"^(\d+)-[A-Za-z]", art)
                    if m and int(m.group(1)) == n:
                        refs.append(SubjectRef(art=art, law_prefix=law_prefix, hint=hint, from_range=True))
            continue

        # Single or with detail: "175,II" or "176,§10" or "176"
        parts = line.split(",", 1)
        art = parts[0].strip()

        if not ART_RE.match(art):
            # Not a valid article reference, skip
            continue

        if len(parts) == 1:
            refs.append(SubjectRef(art=art, law_prefix=law_prefix, hint=hint))
        else:
            detail_raw = parts[1].strip()
            detail = _normalize_detail(detail_raw)
            refs.append(SubjectRef(art=art, detail=detail, law_prefix=law_prefix, hint=hint))

    return refs


def _normalize_detail(raw: str) -> str:
    """Normaliza o detalhe para o caminho do dispositivo no site (data-path).

    "II" → "II"
    "§1" → "§ 1º"; "§10" → "§ 10º"; "§1-A" → "§ 1º-A"
    "PU" → "§ú"
    "p1" → "§ 1º"
    "§1,III" → "§ 1º,III"; "PU,II" → "§ú,II"
    """
    return ",".join(_normalize_part(p) for p in raw.strip().split(","))


def _normalize_part(raw: str) -> str:
    raw = raw.strip()

    if raw.upper() in ("PU", "§U") or raw == "§ú":
        return "§ú"

    # §N → § Nº (também "§ Nº", "§N-A")
    m = re.match(r"^[§Ss]\s*(\d+)\s*[º°]?\s*(?:-\s*([A-Za-z]))?$", raw)
    if m:
        return f"§ {m.group(1)}º" + (f"-{m.group(2).upper()}" if m.group(2) else "")

    # pN → § Nº
    m = re.match(r"^p(\d+)$", raw, re.IGNORECASE)
    if m:
        return f"§ {m.group(1)}º"

    # Alínea: "a)" → "a"
    m = re.match(r"^([a-z])\)$", raw)
    if m:
        return m.group(1)

    return raw


# ── Propostas ─────────────────────────────────────────────────────────────
#
# Aba "Propostas": uma mudança por linha, aplicada sobre a aba principal no build.
#   ID | Fase | Ação | Assunto | Subassunto | Dispositivo | Para | Motivo | Status | Nota
# Ações:
#   incluir       Dispositivo entra em Assunto/Subassunto (que é criado, se não existe)
#   excluir       Dispositivo sai de Assunto/Subassunto
#   trocar        Dispositivo vira Para
#   renomear      Assunto/Subassunto (ou o assunto inteiro, se Subassunto vazio) vira Para
#                 ("ASSUNTO|Subassunto" ou "ASSUNTO"); os vides que apontavam para o nome
#                 antigo acompanham
#   vide          Para ("ASSUNTO" ou "ASSUNTO|Subassunto") entra como vide
#   excluir vide  Para sai dos vides
# Status: aprovado (vale sempre), proposto (só com --com-propostas), rejeitado e
# aplicado (já levado à aba principal) não fazem nada.

COLUNAS_PROPOSTAS = ("ID", "Fase", "Ação", "Assunto", "Subassunto", "Dispositivo", "Para",
                     "Motivo", "Status", "Nota")
ACOES = ("incluir", "excluir", "trocar", "renomear", "vide", "excluir vide")
STATUS_PROPOSTAS = ("aprovado", "proposto", "rejeitado", "aplicado")


@dataclass
class Proposta:
    id: str
    acao: str
    assunto: str
    subassunto: str = ""
    dispositivo: str = ""
    para: str = ""
    status: str = "proposto"
    linha: int = 0

    @property
    def contexto(self) -> str:
        return f"Propostas, linha {self.linha}" + (f" ({self.id})" if self.id else "")


def carregar_propostas(path: str | Path) -> list[Proposta]:
    """Linhas da aba "Propostas" (vazia ou ausente: [])."""
    import openpyxl

    wb = openpyxl.load_workbook(Path(path), read_only=True, data_only=True)
    try:
        if "Propostas" not in wb.sheetnames:
            return []
        rows = wb["Propostas"].iter_rows(values_only=True)
        header = [str(c or "").strip().lower() for c in next(rows, ())]
        idx = {c: header.index(c.lower()) for c in COLUNAS_PROPOSTAS if c.lower() in header}

        def col(row, c):
            i = idx.get(c)
            return str(row[i]).strip() if i is not None and i < len(row) and row[i] is not None else ""

        out = []
        for n, row in enumerate(rows, start=2):
            if not col(row, "Assunto") and not col(row, "Ação"):
                continue
            out.append(Proposta(id=col(row, "ID"), acao=col(row, "Ação").lower(), assunto=col(row, "Assunto"),
                                subassunto=col(row, "Subassunto"), dispositivo=col(row, "Dispositivo"),
                                para=col(row, "Para"), status=col(row, "Status").lower(), linha=n))
        return out
    finally:
        wb.close()


def _chave(s: str) -> str:
    return " ".join(s.split()).lower()


def _ref_key(r: SubjectRef) -> tuple[str, str, str]:
    return (r.law_prefix, r.art, r.detail)


def aplicar_propostas(index: SubjectIndex, propostas: list[Proposta], *, incluir_propostas: bool = False,
                      known_lettered: dict[str, set[str]] | set[str] | None = None,
                      ) -> tuple[int, int, list[tuple[str, str]]]:
    """Aplica as propostas aprovadas (e as propostas, se incluir_propostas) sobre o índice.

    Retorna (aplicadas, das quais ainda propostas, avisos [(mensagem, contexto)]).
    Na prévia (incluir_propostas), a referência incluída por proposta leva o ID na dica.
    """
    avisos: list[tuple[str, str]] = []
    aplicadas = propostas_aplicadas = 0
    entries = index.entries
    esvaziadas: set[int] = set()

    def achar(assunto: str, sub: str) -> list[SubjectEntry]:
        a, s = _chave(assunto), _chave(sub)
        return [e for e in entries if _chave(e.subject) == a and _chave(e.sub_subject) == s]

    for p in propostas:
        if p.status in ("rejeitado", "rejeitada", "aplicado", "aplicada"):
            continue
        if p.status not in ("aprovado", "aprovada", "proposto", "proposta"):
            avisos.append((f"Status desconhecido {p.status!r} (use {', '.join(STATUS_PROPOSTAS)})", p.contexto))
            continue
        proposta = p.status.startswith("propost")
        if proposta and not incluir_propostas:
            continue
        if p.acao not in ACOES:
            avisos.append((f"Ação desconhecida {p.acao!r} (use {', '.join(ACOES)})", p.contexto))
            continue
        if not p.assunto:
            avisos.append(("Proposta sem assunto", p.contexto))
            continue

        alvo = achar(p.assunto, p.subassunto)
        nome = p.assunto + (f" > {p.subassunto}" if p.subassunto else "")
        ok = True

        if p.acao == "incluir":
            refs = _parse_dispositivos(p.dispositivo, known_lettered)
            if not refs:
                avisos.append((f"Dispositivo inválido {p.dispositivo!r}", p.contexto))
                continue
            if not alvo:
                entries.append(SubjectEntry(subject=p.assunto, sub_subject=p.subassunto))
                alvo = entries[-1:]
            existentes = {_ref_key(r) for r in alvo[0].refs}
            for r in refs:
                if _ref_key(r) in existentes:
                    continue   # já está (ex.: parte de uma divisão que o destino já tinha)
                if proposta:
                    r.proposta = p.id
                    r.hint = r.hint or (f"proposta {p.id}" if p.id else "proposta")
                alvo[0].refs.append(r)

        elif p.acao in ("excluir", "trocar"):
            refs = _parse_dispositivos(p.dispositivo, known_lettered)
            novos = _parse_dispositivos(p.para, known_lettered) if p.acao == "trocar" else []
            if not refs or (p.acao == "trocar" and not novos):
                avisos.append((f"Dispositivo inválido {p.dispositivo!r}"
                               + (f" ou {p.para!r}" if p.acao == "trocar" else ""), p.contexto))
                continue
            if not alvo:
                avisos.append((f"Assunto não encontrado: {nome}", p.contexto))
                continue
            tirar = {_ref_key(r) for r in refs}
            achados = False
            for e in alvo:
                # o que a entrada já tem (fora o que sai) não entra de novo pela troca
                ficam = {_ref_key(r) for r in e.refs if _ref_key(r) not in tirar}
                novas: list[SubjectRef] = []
                for r in e.refs:
                    if _ref_key(r) not in tirar:
                        novas.append(r)
                        continue
                    if p.acao == "trocar" and not achados:
                        for n in novos:
                            if _ref_key(n) in ficam:
                                continue
                            n = replace(n, hint=n.hint or r.hint)
                            if proposta:
                                n.proposta = p.id
                                n.hint = n.hint or (f"proposta {p.id}" if p.id else "proposta")
                            novas.append(n)
                    achados = True
                e.refs = novas
                if not e.refs and not e.vides:
                    esvaziadas.add(id(e))
            if not achados:
                avisos.append((f"{p.dispositivo!r} não está em {nome}", p.contexto))
                ok = False

        elif p.acao == "renomear":
            novo_assunto, _, novo_sub = p.para.partition("|")
            novo_assunto, novo_sub = novo_assunto.strip(), novo_sub.strip()
            if not novo_assunto:
                avisos.append(("Renomear sem o nome novo em Para", p.contexto))
                continue
            if p.subassunto:
                if not alvo:
                    avisos.append((f"Assunto não encontrado: {nome}", p.contexto))
                    continue
                destino = achar(novo_assunto, novo_sub)
                for e in alvo:
                    if destino:
                        # já existe: as referências e os vides passam para lá
                        destino[0].refs += [r for r in e.refs if _ref_key(r) not in {_ref_key(x) for x in destino[0].refs}]
                        destino[0].vides += [v for v in e.vides if v not in destino[0].vides]
                        e.refs, e.vides = [], []
                        esvaziadas.add(id(e))
                    else:
                        e.subject, e.sub_subject = novo_assunto, novo_sub
                antigo = f"{p.assunto}|{p.subassunto}"
            else:
                todos = [e for e in entries if _chave(e.subject) == _chave(p.assunto)]
                if not todos:
                    avisos.append((f"Assunto não encontrado: {p.assunto}", p.contexto))
                    continue
                for e in todos:
                    e.subject = novo_assunto
                    if novo_sub and not e.sub_subject:
                        e.sub_subject = novo_sub
                antigo = p.assunto
            # vides que apontavam para o nome antigo (e, no assunto inteiro, para os subassuntos dele)
            for e in entries:
                for i, v in enumerate(e.vides):
                    va, _, vs = v.partition("|")
                    if _chave(v) == _chave(antigo) or (not p.subassunto and _chave(va) == _chave(p.assunto)):
                        e.vides[i] = p.para if _chave(v) == _chave(antigo) else f"{novo_assunto}|{vs.strip()}"

        elif p.acao == "vide":
            if not p.para:
                avisos.append(("Vide sem o destino em Para", p.contexto))
                continue
            if not alvo:
                entries.append(SubjectEntry(subject=p.assunto, sub_subject=p.subassunto))
                alvo = entries[-1:]
            if any(_chave(v) == _chave(p.para) for v in alvo[0].vides):
                avisos.append((f"Vide {p.para!r} já está em {nome}", p.contexto))
                continue
            alvo[0].vides.append(p.para)

        elif p.acao == "excluir vide":
            achados = False
            for e in alvo:
                antes = len(e.vides)
                e.vides = [v for v in e.vides if _chave(v) != _chave(p.para)]
                achados = achados or len(e.vides) < antes
            if not achados:
                avisos.append((f"Vide {p.para!r} não está em {nome}", p.contexto))
                ok = False

        if ok:
            aplicadas += 1
            propostas_aplicadas += proposta

    # Entradas que as propostas esvaziaram (tudo excluído, ou fundidas noutra que já existia)
    index.entries = [e for e in entries if id(e) not in esvaziadas or e.refs or e.vides]
    return aplicadas, propostas_aplicadas, avisos


_PALAVRAS_VAZIAS = {"a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "na", "no",
                    "nas", "nos", "ao", "aos", "para", "por", "pela", "pelo"}


def _radical(w: str) -> str:
    """Singular grosseiro, sem acento: "sessões" → "sessao", "pareceres" → "parecer"."""
    import unicodedata
    w = "".join(c for c in unicodedata.normalize("NFD", w) if not unicodedata.combining(c))
    for fim, troca in (("oes", "ao"), ("aes", "ao"), ("ais", "al"), ("eis", "el")):
        if w.endswith(fim):
            return w[: -len(fim)] + troca
    if w.endswith("es") and len(w) > 4 and w[-3] in "rzs":
        return w[:-2]
    return w[:-1] if w.endswith("s") and len(w) > 3 else w


def _palavras(s: str) -> frozenset[str]:
    return frozenset(_radical(w) for w in re.findall(r"[^\W\d_]+", s.lower()) if w not in _PALAVRAS_VAZIAS)


def espelhos(index: SubjectIndex) -> list[list[dict]]:
    """Pares de entradas em que o assunto de uma é o subassunto da outra e vice-versa
    ("LEI — Promulgação" / "PROMULGAÇÃO — De Lei"): devem levar os mesmos dispositivos.

    Um lado que ficou só com o vide para o outro (um tema, uma casa) não é mais espelho.

    Retorna os pares [{nome, assunto, sub, refs: set[(prefixo, artigo, detalhe)]}, {...}].
    """
    por_chave: dict[tuple[frozenset, frozenset], dict] = {}
    for e in index.entries:
        if not e.sub_subject:
            continue
        chave = (_palavras(e.subject), _palavras(e.sub_subject))
        if not all(chave) or chave[0] == chave[1]:
            continue
        m = por_chave.setdefault(chave, {"nome": e.display_name(), "assunto": e.subject,
                                         "sub": e.sub_subject, "refs": set(), "vides": set()})
        m["refs"] |= {_ref_key(r) for r in e.refs}
        m["vides"] |= {_chave(v.replace("|", " — ")) for v in e.vides}

    def remete(x: dict, y: dict) -> bool:
        return not x["refs"] and _chave(y["nome"]) in x["vides"]

    return [[m, por_chave[(b, a)]] for (a, b), m in por_chave.items()
            if (b, a) in por_chave and m["nome"] < por_chave[(b, a)]["nome"]
            and not remete(m, por_chave[(b, a)]) and not remete(por_chave[(b, a)], m)]


def _entradas_por_nome(index: SubjectIndex) -> dict[str, dict]:
    """{nome em minúsculas: {nome, assunto, sub, refs}}; linhas repetidas de uma entrada se somam."""
    out: dict[str, dict] = {}
    for e in index.entries:
        m = out.setdefault(_chave(e.display_name()), {"nome": e.display_name(), "assunto": e.subject,
                                                       "sub": e.sub_subject, "refs": set()})
        m["refs"] |= {_ref_key(r) for r in e.refs}
    return out


def carregar_excecoes_indice(path: str | Path) -> dict[str, list[dict]]:
    """indice_excecoes.toml → {"espelho": [{entradas, motivo}], "distintos": [...]} (sem o arquivo: listas vazias)."""
    import tomllib

    path = Path(path)
    dados = tomllib.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return {tipo: [g for g in dados.get(tipo, []) if len(g.get("entradas", [])) >= 2]
            for tipo in ("espelho", "distintos")}


def espelhos_declarados(index: SubjectIndex, grupos: list[list[str]]) -> list[list[dict]]:
    """Os pares de cada grupo [[espelho]] de indice_excecoes.toml — o cruzamento de dois conceitos com
    nomes que espelhos() não reconhece ("AUDIÊNCIA PÚBLICA — Convocação pelas Comissões Permanentes" /
    "COMISSÕES PERMANENTES — Audiências Públicas"). Mesmo formato de espelhos(); nome que não está
    no índice fica de fora."""
    por_nome = _entradas_por_nome(index)
    pares = []
    for g in grupos:
        membros = [por_nome[_chave(n)] for n in g if _chave(n) in por_nome]
        pares += [[a, b] for i, a in enumerate(membros) for b in membros[i + 1:]]
    return pares


def duplicatas(index: SubjectIndex, aceitos: list[list[str]] = (), minimo: int = 3) -> list[tuple[dict, dict, int]]:
    """Entradas de assuntos diferentes que parecem o mesmo tema em duas casas ("um tema, uma casa": o tema
    fica detalhado numa entrada e as outras remetem com vide). Acusa dois casos, com ao menos `minimo`
    dispositivos na menor:
      - as mesmas listas;
      - ≥ 80% da menor na maior, com as palavras do nome de uma contidas nas da outra
        ("SESSÃO DA CÂMARA — Extraordinária" / "SESSÃO EXTRAORDINÁRIA").
    Ficam de fora os espelhos e os pares de um mesmo grupo de `aceitos` ([[espelho]] e [[distintos]]
    de indice_excecoes.toml). Retorna [(menor, maior, em comum)], no formato de espelhos().
    """
    por_nome = _entradas_por_nome(index)
    ja_vistos = {frozenset((a["nome"], b["nome"])) for a, b in espelhos(index)}
    grupo_de: dict[str, set[int]] = {}
    for i, g in enumerate(aceitos):
        for n in g:
            grupo_de.setdefault(_chave(n), set()).add(i)

    candidatas = [m for m in por_nome.values() if len(m["refs"]) >= minimo]
    por_ref: dict[tuple, list[dict]] = {}
    for m in candidatas:
        for r in m["refs"]:
            por_ref.setdefault(r, []).append(m)
    comum: dict[tuple[str, str], int] = {}
    for ms in por_ref.values():
        for i, a in enumerate(ms):
            for b in ms[i + 1:]:
                k = (a["nome"], b["nome"])
                comum[k] = comum.get(k, 0) + 1

    out = []
    for (na, nb), c in comum.items():
        a, b = por_nome[_chave(na)], por_nome[_chave(nb)]
        if a["assunto"] == b["assunto"] or frozenset((na, nb)) in ja_vistos \
                or grupo_de.get(_chave(na), set()) & grupo_de.get(_chave(nb), set()):
            continue
        menor, maior = sorted((a, b), key=lambda m: (len(m["refs"]), m["nome"]))
        pa, pb = (_palavras(m["assunto"]) | _palavras(m["sub"]) for m in (a, b))
        if a["refs"] == b["refs"] or (c >= 0.8 * len(menor["refs"]) and (pa <= pb or pb <= pa)):
            out.append((menor, maior, c))
    return sorted(out, key=lambda t: (t[0]["nome"], t[1]["nome"]))


def resolver_vides_em_cadeia(index: SubjectIndex) -> int:
    """Vide para um assunto que é só remissão (sem dispositivos nem subassuntos) passa a
    apontar direto para os destinos dele ("Homenagem → HONRARIA → TÍTULOS HONORÍFICOS").

    Retorna quantos vides foram reapontados.
    """
    so_vide: dict[str, list[str]] = {}
    com_conteudo: set[str] = set()
    for e in index.entries:
        if e.refs or e.sub_subject:
            com_conteudo.add(_chave(e.subject))
    for e in index.entries:
        a = _chave(e.subject)
        if a not in com_conteudo and not e.sub_subject and e.vides:
            so_vide.setdefault(a, []).extend(e.vides)
    n = 0
    for e in index.entries:
        novos: list[str] = []
        for v in e.vides:
            alvo, vistos = [v], set()
            while len(alvo) == 1 and "|" not in alvo[0] and _chave(alvo[0]) in so_vide \
                    and _chave(alvo[0]) not in vistos and _chave(alvo[0]) != _chave(e.subject):
                vistos.add(_chave(alvo[0]))
                alvo = so_vide[_chave(alvo[0])]
            if alvo != [v]:
                n += 1
            novos += [x for x in alvo if x not in novos and _chave(x) != _chave(e.subject)]
        e.vides = novos
    return n


def vides_com_nome_exato(index: SubjectIndex) -> int:
    """Cada vide passa a mostrar o assunto e o subassunto como estão escritos no destino
    ("SERVIDOR PÚBLICO|vantagens" → "SERVIDOR PÚBLICO|Vantagens"): o site acha o destino sem
    acento e sem caixa, mas mostrava a grafia do vide. Retorna quantos vides mudaram."""
    import unicodedata

    def k(s: str) -> str:
        s = unicodedata.normalize("NFD", _chave(s))
        return "".join(c for c in s if not unicodedata.combining(c))

    assuntos: dict[str, str] = {}
    subs: dict[tuple[str, str], str] = {}
    for e in index.entries:
        assuntos.setdefault(k(e.subject), e.subject)
        if e.sub_subject:
            subs.setdefault((k(e.subject), k(e.sub_subject)), e.sub_subject)
    n = 0
    for e in index.entries:
        novos = []
        for v in e.vides:
            a, _, s = v.partition("|")
            nome = assuntos.get(k(a), a.strip())
            if s.strip():
                nome += "|" + subs.get((k(a), k(s)), s.strip())
            n += nome != v
            novos.append(nome)
        e.vides = novos
    return n
