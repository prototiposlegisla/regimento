#!/usr/bin/env python3
"""Build pipeline: DOCX + XLSX → index.html (public + private versions)."""

from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

# Fix Windows console encoding
if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, encoding="utf-8", errors="replace"
    )

BASE_DIR = Path(__file__).parent

# Números repetidos que o próprio texto normativo tem (não é redação antiga sem tachar):
# (norma, artigo, caminho do dispositivo). As alíneas dentro dos itens da CE 175, § 1º, que estavam aqui,
# ganharam caminho próprio no unit_path ("§ 1º,2,a", "§ 1º,3,a")
KNOWN_DUPLICATES: set[tuple[str, str, str]] = set()

# Erros de digitação que estão também no texto oficial (PLP) e ficam como estão, por decisão do usuário
# (25/10/2026); lista completa em FontesAtual/"Erros no texto das normas.md". (norma, artigo, trecho)
KNOWN_TEXT_ERRORS: set[tuple[str, str, str]] = {
    ("Lei Orgânica", "32", "Regimento ;"),
    ("Lei Orgânica", "59", "dispos.o"),
    ("Lei Orgânica", "83", "previs.o"),
    ("Lei Orgânica", "200", "dispo.to .a"),
    ("Lei Orgânica", "200", "ser. complementado"),
    ("Lei Orgânica", "200", "estabelecid. .o"),
    ("Lei Orgânica", "221", ".s.rtigos"),
    ("Regimento Interno", "156", "160 ,§ 6°"),
    ("Constituição Estadual", "74", "Estado , o Defensor"),   # espaço antes do trecho tachado (ADI 6517), como na ALESP
}


# ── Validation report ────────────────────────────────────────────────────

@dataclass
class ValidationIssue:
    category: str   # "formato", "ref_cruzada", "vide"
    severity: str   # "erro", "aviso"
    message: str
    context: str = ""


@dataclass
class ValidationReport:
    issues: list[ValidationIssue] = field(default_factory=list)

    def add(self, category: str, severity: str, message: str, context: str = "") -> None:
        self.issues.append(ValidationIssue(category, severity, message, context))

    @property
    def errors(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity == "erro"]

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity == "aviso"]

    def print_report(self) -> None:
        if not self.issues:
            print("\n✓ Validação: nenhum problema encontrado")
            return

        by_cat: dict[str, list[ValidationIssue]] = {}
        for issue in self.issues:
            by_cat.setdefault(issue.category, []).append(issue)

        cat_labels = {
            "fontes": "Fontes do build (arquivo ausente ou ilegível)",
            "docx": "Formatação do DOCX",
            "links":"Links do DOCX com endereço inválido (corrija o hyperlink no Word)",
            "texto": "Texto dos dispositivos (caractere perdido)",
            "legislacao": "Legislação correlata (a mesma norma com nomes diferentes)",
            "formato": "Formato da planilha",
            "ref_cruzada": "Referências cruzadas (XLSX → DOCX)",
            "propostas": "Propostas do índice remissivo (aba Propostas)",
            "vide": "Vides apontando para assuntos inexistentes",
            "espelhos": "Entradas espelhadas com dispositivos diferentes (A — B × B — A)",
            "duplicatas": "O mesmo tema detalhado em duas entradas (um tema, uma casa)",
            "indice_vazio": "Subassuntos do índice sem dispositivo nem vide",
            "remissoes": "Remissões entre artigos (citações não resolvidas)",
            "consulta": "Consulta rápida (consulta-rapida.yaml)",
        }

        print(f"\n{'─' * 60}")
        print(f"  Relatório de validação")
        print(f"{'─' * 60}")

        for cat, items in by_cat.items():
            label = cat_labels.get(cat, cat)
            errs = sum(1 for i in items if i.severity == "erro")
            warns = sum(1 for i in items if i.severity == "aviso")
            parts = []
            if errs:
                parts.append(f"{errs} erro(s)")
            if warns:
                parts.append(f"{warns} aviso(s)")
            print(f"\n  [{label}] — {', '.join(parts)}")
            for item in items:
                icon = "✗" if item.severity == "erro" else "·"
                line = f"    {icon} {item.message}"
                if item.context:
                    line += f"  ({item.context})"
                print(line)

        n_err = len(self.errors)
        n_warn = len(self.warnings)
        parts = []
        if n_err:
            parts.append(f"{n_err} erro(s)")
        if n_warn:
            parts.append(f"{n_warn} aviso(s)")
        print(f"\n  Total: {', '.join(parts)}")
        print(f"{'─' * 60}")

    def to_json(self) -> list[dict]:
        return [
            {
                "category": i.category,
                "severity": i.severity,
                "message": i.message,
                **({"context": i.context} if i.context else {}),
            }
            for i in self.issues
        ]


def _siglas() -> dict[str, str]:
    """Sigla de cada norma do DOCX nos artigos e nos uids (o RI fica sem sigla). Vem do código, não da
    aba "Normas" do remissivo.xlsx: sem a planilha (ausente, aberta no Excel) o site saía sem LOM, CE e
    CF ("LOM 5" deixava de existir) e o build não acusava erro."""
    from src.remissoes import LAW_SHORT
    return {nome: sigla for nome, sigla in LAW_SHORT.items() if sigla != "RI"}


def _aplicar_siglas(doc, *, uids: bool) -> None:
    """Põe a sigla da norma nos artigos de LOM, CE e CF (e, com uids, nos uids dos dispositivos)."""
    from src.models import ArticleBlock
    siglas = _siglas()
    for el in doc.elements:
        if isinstance(el, ArticleBlock) and el.law_name in siglas and not el.law_prefix:
            el.law_prefix = lp = siglas[el.law_name]
            if not uids:
                continue
            if el.caput:
                el.caput.uid = el.caput.uid.replace("art", f"art{lp}", 1)
            for child in el.children:
                child.uid = child.uid.replace("art", f"art{lp}", 1)
            for v in el.all_versions:
                v.uid = v.uid.replace("art", f"art{lp}", 1)


def _load_config() -> dict:
    """Lê config.local.toml (se existir) e retorna dict com paths."""
    config_path = BASE_DIR / "config.local.toml"
    if not config_path.exists():
        return {}
    try:
        import tomllib
    except ModuleNotFoundError:
        import tomli as tomllib  # type: ignore[no-redef]
    with open(config_path, "rb") as f:
        return tomllib.load(f)


def _carregar_indice(args: argparse.Namespace, doc, report: ValidationReport):
    """Índice remissivo da planilha, com as propostas e a conferência dos dispositivos.

    Retorna (SubjectIndex ou None, {nome da norma: prefixo}). Os problemas vão para report:
    formato da planilha, propostas que não se aplicam e referências a artigo inexistente
    (erro) ou a dispositivo inexistente, revogado ou só tachado (aviso).
    """
    import re as _re
    from src.parse_xlsx import (aplicar_propostas, carregar_excecoes_indice, carregar_propostas, duplicatas,
                                 espelhos, espelhos_declarados, parse_law_mapping, parse_xlsx,
                                 resolver_vides_em_cadeia, vides_com_nome_exato)
    from src.remissoes import ART_INEXISTENTE, REVOGADO, SUB_INEXISTENTE, TACHADO, _Corpus

    xlsx_path = Path(args.xlsx)
    if not xlsx_path.exists():
        print("      → XLSX não encontrado, índice remissivo vazio")
        report.add("fontes", "erro", "remissivo.xlsx não encontrado: o site sairia sem índice remissivo", str(xlsx_path))
        return None, {}
    try:
        law_mapping = parse_law_mapping(xlsx_path)
        if law_mapping:
            print(f"      → {len(law_mapping)} normas mapeadas")
        # a sigla de cada norma vem do código (_siglas); a aba Normas só confere
        siglas = _siglas()
        for nome, sigla in law_mapping.items():
            if siglas.get(nome, sigla) != sigla:
                report.add("formato", "aviso", f"aba Normas: {nome} = {sigla}, mas o build usa {siglas[nome]}")

        from src.validate_xlsx import validate_xlsx as _validate_xlsx_fmt
        for _e in _validate_xlsx_fmt(xlsx_path, {**law_mapping, **siglas}):
            report.add("formato", "aviso", _e.strip())

        # Artigos letrados do DOCX (ex: "212-A"), por norma, para expansão correta de ranges
        known_lettered: dict[str, set[str]] = {}
        for el in doc.elements:
            if hasattr(el, "art_number") and _re.search(r"-[A-Za-z]", el.art_number):
                prefix = el.law_prefix or siglas.get(getattr(el, "law_name", None) or "", "")
                known_lettered.setdefault(prefix, set()).add(el.art_number)
        subject_index = parse_xlsx(xlsx_path, known_lettered=known_lettered)

        propostas = carregar_propostas(xlsx_path)
        if propostas:
            n, n_prop, avisos = aplicar_propostas(subject_index, propostas, known_lettered=known_lettered,
                                                  incluir_propostas=args.com_propostas)
            print(f"      → {n} propostas aplicadas" + (f" ({n_prop} com Status proposto)" if n_prop else ""))
            for message, context in avisos:
                report.add("propostas", "aviso", message, context)
        resolver_vides_em_cadeia(subject_index)
        vides_com_nome_exato(subject_index)
    except PermissionError:
        print("      ⚠ Não foi possível abrir remissivo.xlsx (arquivo em uso pelo Excel?)")
        print("        Feche a planilha e rode o build novamente.")
        print("        Continuando sem índice remissivo...")
        report.add("fontes", "erro", "remissivo.xlsx não abriu (em uso pelo Excel?): o site sairia sem índice "
                                     "remissivo", str(xlsx_path))
        return None, {}

    # Normalizar refs de ADT letrados: "4-C" → "ADT4-C"
    # Apenas artigos com sufixo de letra (ex: 4-C, 4-F) pois números puros
    # (ex: 4, 15) podem ser artigos regulares do Regimento.
    known_adt_lettered: set[str] = {
        el.art_number[3:] for el in doc.elements
        if hasattr(el, "art_number") and el.art_number.startswith("ADT")
        and _re.search(r"-[A-Za-z]", el.art_number)
    }
    if known_adt_lettered:
        for entry in subject_index.entries:
            for ref in entry.refs:
                if not ref.law_prefix and not ref.art.startswith("ADT") and ref.art in known_adt_lettered:
                    ref.art = f"ADT{ref.art}"

    # Cada referência confere com o DOCX no nível do dispositivo. Dispositivo revogado fica no
    # índice (a regra que deixou de existir ainda explica práticas e textos antigos), com a dica
    # "revogado"; quem o cita sem marcar — "(revogado)", "(declarado inconstitucional)" — é avisado,
    # para decidir se há substituto. Do intervalo, o revogado entra marcado, sem aviso.
    corpus = _Corpus(doc)
    marcado = _re.compile(r"revogad|inconstitucional|ADIN|reda[çc][ãa]o anterior", _re.I)
    for entry in subject_index.entries:
        ctx = entry.subject + (f" > {entry.sub_subject}" if entry.sub_subject else "")
        mantidas = []
        for ref in entry.refs:
            path = "" if ref.detail.strip().lower() == "caput" else ref.detail
            alvo = corpus.resolve(ref.law_prefix or "RI", ref.art, path)
            if ref.from_range and alvo.status == ART_INEXISTENTE:
                continue
            mantidas.append(ref)
            if ref.law_prefix == "CF":
                report.add("ref_cruzada", "aviso", f"{alvo.ref} — artigo da CF (o índice não cita a CF)",
                           f"assunto: {ctx}")
            if alvo.status == ART_INEXISTENTE:
                label = f"Art. {ref.law_prefix}:{ref.art}" if ref.law_prefix else f"Art. {ref.art}"
                report.add("ref_cruzada", "erro", label, f"assunto: {ctx}")
            elif alvo.status == SUB_INEXISTENTE:
                report.add("ref_cruzada", "aviso", f"{alvo.ref} — dispositivo inexistente", f"assunto: {ctx}")
            elif alvo.status in (REVOGADO, TACHADO):
                if not marcado.search(ref.hint):
                    if not ref.from_range:
                        report.add("ref_cruzada", "aviso",
                                   f"{alvo.ref} — revogado (se fica de propósito, marque \"(revogado)\" na planilha; "
                                   f"senão, troque pelo substituto)", f"assunto: {ctx}")
                    a = corpus.arts.get((ref.law_prefix or "RI", ref.art))
                    resto = ref.hint or (a.summary if a is not None else "")
                    ref.hint = "revogado" + (f" — {resto}" if resto else "")
        entry.refs = mantidas
        # subassunto sem dispositivo nem vide: o leitor vê a linha e não tem para onde ir
        if entry.sub_subject and not entry.refs and not entry.vides:
            report.add("indice_vazio", "aviso", entry.display_name(), "sem dispositivo nem vide")

    # "LEI — Promulgação" e "PROMULGAÇÃO — De Lei" são a mesma entrada vista de dois lados
    excecoes = carregar_excecoes_indice(BASE_DIR / "indice_excecoes.toml")
    nomes = {" ".join(e.display_name().split()).lower() for e in subject_index.entries}
    for tipo, grupos in excecoes.items():
        for g in grupos:
            for n in g["entradas"]:
                if " ".join(n.split()).lower() not in nomes:
                    report.add("duplicatas", "aviso", f"{n} — não está no índice", f"indice_excecoes.toml, [[{tipo}]]")
    for a, b in espelhos(subject_index) + espelhos_declarados(subject_index,
                                                              [g["entradas"] for g in excecoes["espelho"]]):
        for x, y in ((a, b), (b, a)):
            falta = sorted(x["refs"] - y["refs"])
            if falta:
                labels = ", ".join((f"{p}:" if p else "") + art + (f",{d}" if d else "") for p, art, d in falta)
                report.add("espelhos", "aviso", f"{labels} — só em {x['nome']}", f"espelho: {y['nome']}")

    # um tema, uma casa: o mesmo tema detalhado em dois lugares acaba com listas divergentes
    for menor, maior, comum in duplicatas(subject_index, [g["entradas"] for gs in excecoes.values() for g in gs]):
        quanto = "a mesma lista" if menor["refs"] == maior["refs"] else f"{comum} de {len(menor['refs'])} em comum"
        report.add("duplicatas", "aviso", f"{menor['nome']} × {maior['nome']} ({quanto})",
                   "centralize numa e deixe vide na outra, ou declare em indice_excecoes.toml")

    print(f"      → {len({e.subject for e in subject_index.entries})} assuntos")
    return subject_index, law_mapping


def _carregar_consulta(args: argparse.Namespace, doc, report: ValidationReport) -> list[dict]:
    """Seções da consulta rápida (src/consulta.py), com os artigos e os valores conferidos com o DOCX."""
    from src import consulta

    path = Path(args.consulta)
    if not path.exists():
        print("      → consulta-rapida.yaml não encontrado, consulta rápida vazia")
        report.add("fontes", "erro", "consulta-rapida.yaml não encontrado: o site sairia sem a consulta rápida",
                   str(path))
        return []
    try:
        dados = consulta.carregar(path)
        secoes = consulta.montar(dados)
    except Exception as e:  # yaml malformado: o build segue, com o erro no relatório
        report.add("consulta", "erro", f"não foi possível ler o arquivo: {e}", str(path))
        return []
    avisos: list = []
    # o site sai sempre em ordem; a folha impressa, na ordem do arquivo
    fora = [k for k in consulta.ORDEM if dados.get(k) != consulta.ordenar(dados).get(k)]
    if fora:
        avisos.append(("aviso", f"entradas fora de ordem em {', '.join(fora)} (a folha impressa sai na ordem do "
                                f"arquivo): python -m src.consulta --ordenar", str(path)))
    consulta.conferir(secoes, doc, avisos)
    for severity, message, context in avisos:
        report.add("consulta", severity, message, context)
    print(f"      → consulta rápida: {sum(len(s['items']) for s in secoes)} entradas em {len(secoes)} seções")
    return consulta.para_o_site(secoes)


def _conferir_links(doc, report: ValidationReport) -> None:
    """Links do DOCX: os de ação que o parser fez abrir o processo (src/links.py) e os que nenhum
    navegador abre (sem domínio, com espaço: "http://- Inciso VII declarado...")."""
    from src.links import valido

    if doc.links_corrigidos:
        print(f"      → {len(doc.links_corrigidos)} links de ação passam a abrir o processo (STF, TJSP)")

    def units(us):
        for u in us:
            yield u
            yield from units(u.children)

    vistos: set[tuple[str, str, str]] = set()
    for el in doc.elements:
        if not hasattr(el, "art_number"):
            continue
        for u in units(([el.caput] if el.caput else []) + list(el.children) + list(el.all_versions)):
            paras = [fn_p for fn in u.footnotes for fn_p in fn.paragraphs] + list(u.legislacao)
            for r in list(u.runs) + [r for p in paras for r in p.runs]:
                url = r.hyperlink_url
                if url and not valido(url) and (el.law_name, el.art_number, url) not in vistos:
                    vistos.add((el.law_name, el.art_number, url))
                    report.add("links", "aviso", f"«{r.text.strip()[:40]}» → {url[:70]}",
                               f"{el.law_name or 'Regimento Interno'}, Art. {el.art_number}")


def _build_once(
    *,
    args: argparse.Namespace,
    include_private: bool,
    output_path: Path,
    label: str,
) -> ValidationReport:
    """Executa o pipeline completo uma vez e salva em output_path."""

    t0 = time.time()
    report = ValidationReport()
    print(f"\n{'═' * 60}")
    print(f"  Build: {label}")
    print(f"{'═' * 60}")

    # ── 1. Parse DOCX ──────────────────────────────────────────────────
    print("[1/8] Parseando DOCX...")
    from src.parse_docx import parse_docx

    try:
        doc = parse_docx(args.docx, include_private=include_private)
    except PermissionError:
        print(f"\n⚠  Não foi possível abrir o DOCX: {args.docx}")
        print("   O arquivo pode estar aberto no Word. Feche-o e tente novamente.")
        input("\nPressione Enter para fechar...")
        sys.exit(1)

    headings = [e for e in doc.elements if hasattr(e, "level")]
    articles = [e for e in doc.elements if hasattr(e, "art_number")]
    n_prec = sum(1 for e in articles if e.law_prefix == "PREC")
    print(f"      → {len(headings)} headings, {len(articles) - n_prec} artigos"
          + (f", {n_prec} precedentes regimentais" if n_prec else ""))
    _conferir_links(doc, report)

    # ── 1b. Validação do DOCX ─────────────────────────────────────────
    from validate import get_paragraphs as _get_paras, run_checks as _run_checks, CODE_LABELS

    _raw_paras = _get_paras(args.docx)
    _docx_issues = _run_checks(_raw_paras)
    if _docx_issues:
        for iss in _docx_issues:
            report.add("docx", "aviso", f"[{iss['code']}] {iss['desc']}", iss["context"])
        print(f"      → {len(_docx_issues)} aviso(s) de formatação no DOCX")
    else:
        print(f"      → DOCX sem problemas de formatação")

    # ── 2. Resolve amendments ──────────────────────────────────────────
    print("[2/8] Resolvendo emendas...")
    from src.resolve_amendments import resolve_amendments

    doc = resolve_amendments(doc)

    version_count = sum(
        len(a.all_versions)  # type: ignore
        + sum(1 for c in a.children if c.is_old_version)  # type: ignore
        for a in articles
    )
    print(f"      → {version_count} versões anteriores detectadas")

    # Dispositivo repetido sem tachado; nota de rodapé presa a redação tachada
    from src.resolve_amendments import structure_warnings
    for message, context in structure_warnings(doc, KNOWN_DUPLICATES):
        report.add("docx", "aviso", message, context)
    from src.resolve_amendments import text_warnings
    for message, context in text_warnings(doc, KNOWN_TEXT_ERRORS):
        report.add("texto", "aviso", message, context)

    # ── 3. Parse XLSX ──────────────────────────────────────────────────
    print("[3/8] Parseando XLSX...")
    subject_index, law_mapping = _carregar_indice(args, doc, report)
    subject_list = subject_index.to_list() if subject_index else []

    # Cross-reference: vides pointing to non-existent index entries
    if subject_list:
        known_subjects: set[str] = set()
        for entry in subject_index.entries:
            known_subjects.add(entry.subject.lower())
            if entry.sub_subject:
                known_subjects.add(f"{entry.subject} — {entry.sub_subject}".lower())

        seen_vides: set[str] = set()
        for entry in subject_index.entries:
            for v in entry.vides:
                v_key = v.replace("|", " — ").lower()
                if v_key not in known_subjects and v_key not in seen_vides:
                    seen_vides.add(v_key)
                    ctx = entry.subject
                    if entry.sub_subject:
                        ctx += f" > {entry.sub_subject}"
                    report.add("vide", "aviso", f"\"{v}\"", f"assunto: {ctx}")

    # Sigla da norma nos artigos e nos uids (LOM, CE, CF)
    _aplicar_siglas(doc, uids=True)

    # Forma certa dos erros do texto oficial, para a busca achar o dispositivo pela palavra certa (o81); depois dos prefixos, que separam o RI 32 da LOM 32
    from src.resolve_amendments import formas_de_busca
    import tomllib
    arq_erros = BASE_DIR / "erros_texto_busca.toml"
    erros = tomllib.loads(arq_erros.read_text(encoding="utf-8")).get("erro", []) if arq_erros.exists() else []
    busca_erros, avisos_busca = formas_de_busca(doc, erros)
    for message, context in avisos_busca:
        report.add("texto", "aviso", message, context)

    # Remissões explícitas: citações a outros artigos ("artigo 369"), com prévia no site
    from src.remissoes import detectar, carregar_excecoes, carregar_implicitas, mudancas_desde_ultimo_build
    if not Path(args.remissoes).exists():
        report.add("fontes", "erro", "remissoes.xlsx não encontrado: o site sairia sem os correlatos entre normas",
                   str(args.remissoes))
    remissoes = detectar(doc, carregar_excecoes(BASE_DIR / "remissoes_excecoes.toml"),
                         carregar_implicitas(args.remissoes),
                         privadas=include_private, propostas=args.com_propostas)
    n_rem = sum(1 for r in remissoes.remissoes if r.exibivel)
    n_imp = len(remissoes.implicitas)
    n_prop = sum(1 for im in remissoes.implicitas if im.proposta)
    print(f"      → {n_rem} remissões entre artigos, {n_imp} correlatos entre normas"
          + (f" ({n_prop} ainda propostos)" if n_prop else ""))
    for message, context in remissoes.avisos:
        report.add("remissoes", "aviso", message, context)

    # ── 4. Referências: consulta rápida (yaml) e legislação correlata ──
    print("[4/8] Montando referências...")
    consulta_data = _carregar_consulta(args, doc, report)

    # Legislação correlata (notas "L" do DOCX): uma categoria da aba Referências
    referencias_data: list[dict] = []
    from src.build_index import legislacao_index
    avisos_leg: list = []
    leg = legislacao_index(doc, avisos_leg)
    for message, context in avisos_leg:
        report.add("legislacao", "aviso", message, context)
    if leg:
        referencias_data.append(leg)
        print(f"      → legislação correlata: {len(leg['groups'])} normas, "
              f"{sum(1 for g in leg['groups'] for e in g['entries'] if e.get('art_ref'))} ligações a dispositivos")

    # ── 5. Parse informacoes DOCX ─────────────────────────────────────
    print("[5/8] Parseando informações...")
    from src.parse_informacoes import parse_informacoes

    info_path = Path(args.informacoes)
    if info_path.exists():
        info_html = parse_informacoes(info_path)
        print(f"      → {len(info_html)} caracteres de HTML")
    else:
        print("      → DOCX de informações não encontrado, aba vazia")
        report.add("fontes", "aviso", "informacoes.docx não encontrado: a aba de informações sai sem o seu texto",
                   str(info_path))
        info_html = ""
    # e a parte escrita pelo build: até onde vai cada norma, atalhos da busca, marcadores (src/ajuda.py)
    from src.ajuda import html_da_ajuda
    info_html = "\n".join(p for p in (info_html, html_da_ajuda(doc)) if p)

    # ── 6. Build systematic index ──────────────────────────────────────
    print("[6/8] Gerando índice sistemático...")
    from src.build_index import build_systematic_index

    systematic_index = build_systematic_index(doc)
    print(f"      → {len(systematic_index)} nós raiz")

    # ── 7. Render HTML cards ───────────────────────────────────────────
    print("[7/8] Renderizando cards HTML...")
    from src.render_html import render_cards

    # Pares CF × CE de texto igual: os dois correlatos do mesmo dispositivo saem num selo só (o49)
    arq_cf_ce = BASE_DIR / "remissoes_cf_ce.toml"
    cf_ce = set()
    if arq_cf_ce.exists():
        from src.remissoes import _parse_ref
        for par in tomllib.loads(arq_cf_ce.read_text(encoding="utf-8")).get("igual", []):
            norm = lambda r: (lambda law, art, path: (f"{law}:" if law != "RI" else "") + art + (f",{path}" if path else ""))(*_parse_ref(r))
            cf_ce.add((norm(par["cf"]), norm(par["ce"])))
    cards_html, correlato_notas = render_cards(doc, remissoes, busca_erros, cf_ce)
    print(f"      → {len(cards_html)} caracteres de HTML")

    # ── 8. Assemble ────────────────────────────────────────────────────
    print("[8/8] Montando HTML final...")
    from src.assemble import assemble

    # Build summaries map: {art_number: summary} for fallback hints
    summaries_map: dict[str, str] = {}
    for el in doc.elements:
        if hasattr(el, "art_number") and hasattr(el, "summary") and el.summary:
            key = el.art_number
            if hasattr(el, "law_prefix") and el.law_prefix:
                key = el.law_prefix + ":" + key
            summaries_map[key] = el.summary

    output_path.parent.mkdir(parents=True, exist_ok=True)
    assemble(
        cards_html=cards_html,
        systematic_index=systematic_index,
        subject_index=subject_list,
        referencias_index=referencias_data,
        consulta_index=consulta_data,
        summaries_map=summaries_map,
        correlato_notas=correlato_notas,
        info_html=info_html,
        base_dir=BASE_DIR,
        output_path=output_path,
    )

    elapsed = time.time() - t0
    size_kb = output_path.stat().st_size / 1024
    print(f"\n✓ {label} pronto em {elapsed:.1f}s → {output_path} ({size_kb:.0f} KB)")

    if not include_private:
        # Remissões that changed since the last published build (docs/index.html is the
        # reference; a test build only compares)
        publicado = output_path.resolve() == (BASE_DIR / "docs" / "index.html").resolve()
        for line in mudancas_desde_ultimo_build(remissoes, BASE_DIR / "intermediate" / "remissoes.json",
                                                gravar=publicado):
            print(f"  {line}")

    # ── Validation report ────────────────────────────────────────────
    report.print_report()

    # ── Debug output ───────────────────────────────────────────────────
    if args.debug:
        print("\nSalvando JSONs de debug...")
        debug_dir = BASE_DIR / "intermediate"
        debug_dir.mkdir(exist_ok=True)

        doc_json = doc.to_dict()
        (debug_dir / "parsed_document.json").write_text(
            json.dumps(doc_json, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  → {debug_dir / 'parsed_document.json'}")

        (debug_dir / "systematic_index.json").write_text(
            json.dumps(systematic_index, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  → {debug_dir / 'systematic_index.json'}")

        (debug_dir / "subject_index.json").write_text(
            json.dumps(subject_list, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  → {debug_dir / 'subject_index.json'}")

        (debug_dir / "referencias_index.json").write_text(
            json.dumps(referencias_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  → {debug_dir / 'referencias_index.json'}")

        (debug_dir / "consulta_index.json").write_text(
            json.dumps(consulta_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  → {debug_dir / 'consulta_index.json'}")

        if report.issues:
            (debug_dir / "validation_report.json").write_text(
                json.dumps(report.to_json(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"  → {debug_dir / 'validation_report.json'}")

    return report


def _build_markdown(
    *,
    args: argparse.Namespace,
    output_dir: Path,
    include_private: bool,
    label: str,
) -> None:
    """Gera 3 arquivos Markdown no diretório de saída."""

    t0 = time.time()
    print(f"\n{'═' * 60}")
    print(f"  Build: {label}")
    print(f"{'═' * 60}")

    if not output_dir.exists():
        print(f"  ⚠ Diretório não encontrado: {output_dir}")
        return

    # ── 1. Parse DOCX (sempre com notas privadas) ─────────────────
    print("[1/5] Parseando DOCX...")
    from src.parse_docx import parse_docx

    doc = parse_docx(args.docx, include_private=include_private)
    articles = [e for e in doc.elements if hasattr(e, "art_number")]
    print(f"      → {len(articles)} artigos")

    # ── 2. Resolve amendments ─────────────────────────────────────
    print("[2/5] Resolvendo emendas...")
    from src.resolve_amendments import resolve_amendments

    doc = resolve_amendments(doc)

    # ── 3. Parse XLSX ─────────────────────────────────────────────
    print("[3/5] Parseando XLSX...")
    subject_index, law_mapping = _carregar_indice(args, doc, ValidationReport())
    subject_list = subject_index.to_list() if subject_index else []

    # Sigla da norma nos artigos (o Markdown não usa uids)
    _aplicar_siglas(doc, uids=False)

    # ── 4. Consulta rápida ────────────────────────────────────────
    print("[4/5] Montando a consulta rápida...")
    consulta_data = _carregar_consulta(args, doc, ValidationReport())

    # ── 5. Render Markdown ────────────────────────────────────────
    print("[5/5] Renderizando Markdown...")
    from src.render_markdown import MarkdownRenderer

    from src.remissoes import detectar, carregar_excecoes, carregar_implicitas
    renderer = MarkdownRenderer(detectar(doc, carregar_excecoes(BASE_DIR / "remissoes_excecoes.toml"),
                                         carregar_implicitas(args.remissoes), privadas=include_private))

    regimento_md = renderer.render_document(doc)
    (output_dir / "regimento.md").write_text(regimento_md, encoding="utf-8")
    print(f"      → regimento.md ({len(regimento_md) / 1024:.0f} KB)")

    if subject_list:
        indice_md = renderer.render_subject_index(subject_list)
        (output_dir / "indice-remissivo.md").write_text(indice_md, encoding="utf-8")
        print(f"      → indice-remissivo.md ({len(indice_md) / 1024:.0f} KB)")

    if consulta_data:
        refs_md = renderer.render_consulta(consulta_data)
        (output_dir / "referencias.md").write_text(refs_md, encoding="utf-8")
        print(f"      → referencias.md ({len(refs_md) / 1024:.0f} KB)")

    elapsed = time.time() - t0
    print(f"\n✓ {label} pronto em {elapsed:.1f}s → {output_dir}")


def _build_canonico(args: argparse.Namespace) -> None:
    """Grava canonico/, o texto que os outros projetos leem (ver src/canonico.py)."""
    from src import canonico

    print(f"\n{'═' * 60}")
    print("  Build: texto canônico para os outros projetos (canonico/)")
    print(f"{'═' * 60}")
    for line in canonico.gerar(Path(args.docx), Path(args.remissoes), indice_xlsx=Path(args.xlsx)):
        print(f"      {line}")


# O código que entra na página: publicar com mudança não commitada nele põe no ar um código que não
# está no histórico (as memórias registram três contornos à mão, trocando o app.js pelo do HEAD)
CODIGO_DA_PAGINA = ["build.py", "validate.py", "src", "static", "templates", "*.toml"]
# O que o --push commita: a página e as fontes e imagens copiadas ao lado dela
SAIDA_PUBLICADA = ["docs/index.html", "docs/fonts", "docs/img"]


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=BASE_DIR, capture_output=True, text=True, encoding="utf-8")


def _pode_publicar() -> str:
    """Antes do build com --push: "" se dá para publicar; senão, o motivo. Código da página sem
    mudança fora do histórico e testes passando."""
    r = _git("status", "--porcelain", "--", *CODIGO_DA_PAGINA)
    if r.returncode != 0:
        return f"o git status falhou: {r.stderr.strip()}"
    if r.stdout.strip():
        return ("há mudança não commitada no código da página (ela iria ao ar sem estar no histórico):\n"
                + r.stdout.rstrip() + "\n  Commite essas mudanças (ou guarde com git stash) e rode de novo.")
    print("\n── Testes ──")
    if subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider"], cwd=BASE_DIR).returncode:
        return "os testes falharam (veja acima)"
    return ""


def _auto_commit_and_push() -> bool:
    """Commit + push só de docs/ (a página e as fontes). Falso se não publicou por um problema."""
    public_html = BASE_DIR / "docs" / "index.html"
    if not public_html.exists():
        return False
    if not _git("status", "--porcelain", "--", *SAIDA_PUBLICADA).stdout.strip():
        print("\n⊘ docs/ sem alterações — nada a commitar")
        return True

    # Página bem menor que a publicada: quase sempre uma fonte que faltou (sem correlatos, sem consulta)
    r = _git("cat-file", "-s", "HEAD:docs/index.html")
    if r.returncode == 0:
        antes, agora = int(r.stdout), public_html.stat().st_size
        if agora < antes * 0.9:
            print(f"\n✗ Não publicado: a página encolheu {100 - round(100 * agora / antes)}% "
                  f"({antes // 1024} → {agora // 1024} KB). Confira as fontes; se for isso mesmo, "
                  f"commite docs/ à mão.")
            return False

    print("\n── Git ──")
    timestamp = time.strftime("%Y-%m-%d %H:%M")
    msg = f"build: atualiza regimento ({timestamp})"
    subprocess.run(["git", "add", "--", *SAIDA_PUBLICADA], cwd=BASE_DIR, check=True)
    # com os caminhos, o commit leva só docs/, mesmo que haja outra coisa no stage
    subprocess.run(["git", "commit", "-m", msg, "--", *SAIDA_PUBLICADA], cwd=BASE_DIR, check=True)
    print(f"  git commit -m \"{msg}\" -- docs/")
    subprocess.run(["git", "push"], cwd=BASE_DIR, check=True)
    print("  git push ✓")
    return True


def main() -> int:
    config = _load_config()
    sources = config.get("sources", {})
    output_cfg = config.get("output", {})

    # Defaults: config.local.toml → fallback local
    default_docx = sources.get("docx", str(BASE_DIR / "regimentoInterno.docx"))
    default_xlsx = sources.get("xlsx", str(BASE_DIR / "remissivo.xlsx"))
    default_info = sources.get("informacoes", str(BASE_DIR / "informacoes.docx"))
    # Remissões implícitas (correlatos entre normas): ao lado do DOCX, salvo indicação
    default_remissoes = sources.get("remissoes", str(Path(default_docx).parent / "remissoes.xlsx"))
    # Consulta rápida (prazos, quóruns...), o mesmo yaml da folha impressa: idem
    default_consulta = sources.get("consulta", str(Path(default_docx).parent / "consulta-rapida.yaml"))
    default_private = output_cfg.get("private", "")
    default_chatbot = output_cfg.get("chatbot", "")

    parser = argparse.ArgumentParser(
        description="Gera index.html (versão pública e/ou privada) a partir do DOCX e XLSX"
    )
    parser.add_argument(
        "--debug", action="store_true",
        help="Salva JSONs intermediários em intermediate/",
    )
    parser.add_argument(
        "--docx", default=default_docx,
        help="Caminho do DOCX",
    )
    parser.add_argument(
        "--xlsx", default=default_xlsx,
        help="Caminho do XLSX",
    )
    parser.add_argument(
        "--consulta", default=default_consulta,
        help="Arquivo da consulta rápida (consulta-rapida.yaml)",
    )
    parser.add_argument(
        "--informacoes", default=default_info,
        help="Caminho do DOCX de informações",
    )
    parser.add_argument(
        "--output", default=str(BASE_DIR / "docs" / "index.html"),
        help="Caminho de saída da versão pública (padrão: docs/index.html)",
    )
    parser.add_argument(
        "--push", action="store_true",
        help="Faz git add + commit + push de docs/index.html após o build",
    )
    parser.add_argument(
        "--only-public", action="store_true",
        help="Gera apenas a versão pública",
    )
    parser.add_argument(
        "--only-private", action="store_true",
        help="Gera apenas a versão privada",
    )
    parser.add_argument(
        "--skip-markdown", action="store_true",
        help="Pula a geração de Markdown para chatbot",
    )
    parser.add_argument(
        "--only-markdown", action="store_true",
        help="Gera apenas os arquivos Markdown (pula HTML)",
    )
    parser.add_argument(
        "--strict", action="store_true",
        help="Trata avisos como erros (exit code 1 se houver qualquer problema)",
    )
    parser.add_argument(
        "--remissoes", default=default_remissoes,
        help="Planilha das remissões implícitas (remissoes.xlsx)",
    )
    parser.add_argument(
        "--com-propostas", action="store_true",
        help="Mostra também os correlatos e as propostas do índice remissivo com Status 'proposto' "
             "(para revisar no build de teste)",
    )
    args = parser.parse_args()

    if args.only_public and args.only_private:
        parser.error("--only-public e --only-private são mutuamente exclusivos")
    if args.skip_markdown and args.only_markdown:
        parser.error("--skip-markdown e --only-markdown são mutuamente exclusivos")

    build_public = not args.only_private and not args.only_markdown
    build_private = not args.only_public and bool(default_private) and not args.only_markdown
    build_markdown = not args.skip_markdown and bool(default_chatbot)

    if not build_public and not build_private and not build_markdown:
        print("Nada a fazer. Configure [output] em config.local.toml.")
        return 1

    if args.push and build_public:
        motivo = _pode_publicar()
        if motivo:
            print(f"\n✗ Não publicado: {motivo}")
            return 1

    t_total = time.time()
    all_reports: list[ValidationReport] = []

    if build_public:
        r = _build_once(
            args=args,
            include_private=False,
            output_path=Path(args.output),
            label="Versão pública (sem notas privadas)",
        )
        all_reports.append(r)
        _build_canonico(args)

    if build_private:
        r = _build_once(
            args=args,
            include_private=True,
            output_path=Path(default_private),
            label="Versão privada (com notas privadas)",
        )
        all_reports.append(r)

    if build_markdown:
        _build_markdown(
            args=args,
            output_dir=Path(default_chatbot),
            include_private=True,
            label="Markdown B para chatbot (com notas privadas)",
        )

    elapsed_total = time.time() - t_total
    print(f"\n{'═' * 60}")
    print(f"  Total: {elapsed_total:.1f}s")
    print(f"{'═' * 60}")

    # Exit code based on validation results
    total_errors = sum(len(r.errors) for r in all_reports)
    total_warnings = sum(len(r.warnings) for r in all_reports)

    # Commit/push only when explicitly requested, and only without errors
    if args.push and build_public:
        if total_errors:
            print(f"\n✗ Não publicado: o build tem {total_errors} erro(s) — veja o relatório acima.")
            return 1
        if not _auto_commit_and_push():
            return 1

    if total_errors or (args.strict and total_warnings):
        return 1
    return 0


if __name__ == "__main__":
    code = main()
    input("\nPressione Enter para fechar...")
    sys.exit(code)
