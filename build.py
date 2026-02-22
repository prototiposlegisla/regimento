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
            "docx": "Formatação do DOCX",
            "formato": "Formato da planilha",
            "ref_cruzada": "Referências cruzadas (XLSX → DOCX)",
            "vide": "Vides apontando para assuntos inexistentes",
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
    print(f"      → {len(headings)} headings, {len(articles)} artigos")

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

    # ── 3. Parse XLSX ──────────────────────────────────────────────────
    print("[3/8] Parseando XLSX...")
    from src.parse_xlsx import parse_xlsx, parse_law_mapping

    xlsx_path = Path(args.xlsx)
    law_mapping: dict[str, str] = {}
    subject_index = None
    if xlsx_path.exists():
        try:
            law_mapping = parse_law_mapping(xlsx_path)
            if law_mapping:
                print(f"      → {len(law_mapping)} normas mapeadas")

            from src.validate_xlsx import validate_xlsx as _validate_xlsx_fmt
            _fmt_errs = _validate_xlsx_fmt(xlsx_path, law_mapping)
            for _e in _fmt_errs:
                report.add("formato", "aviso", _e.strip())

            # Artigos letrados do DOCX (ex: "212-A") para expansão correta de ranges
            import re as _re
            known_lettered: set[str] = {
                el.art_number for el in doc.elements
                if hasattr(el, "art_number") and _re.search(r"-[A-Za-z]", el.art_number)
            }
            subject_index = parse_xlsx(xlsx_path, known_lettered=known_lettered)
            subject_list = subject_index.to_list()
            print(f"      → {len(subject_list)} assuntos")
        except PermissionError:
            print("      ⚠ Não foi possível abrir remissivo.xlsx (arquivo em uso pelo Excel?)")
            print("        Feche a planilha e rode o build novamente.")
            print("        Continuando sem índice remissivo...")
            subject_list = []
    else:
        print("      → XLSX não encontrado, índice remissivo vazio")
        subject_list = []

    # Cross-reference: articles in XLSX but not in DOCX
    if subject_list:
        docx_arts: set[str] = set()
        for el in doc.elements:
            if hasattr(el, "art_number"):
                prefix = law_mapping.get(getattr(el, "law_name", None) or "", "")
                docx_arts.add(f"{prefix}:{el.art_number}" if prefix else el.art_number)
                # ADT articles: also register without ADT prefix (4-A, 4-B, etc.)
                if el.art_number.startswith("ADT"):
                    docx_arts.add(el.art_number[3:])
                # Lettered articles from other laws: also register plain art_number
                # so range-expanded refs (e.g. 39-88 → 55-A) can match
                if prefix:
                    docx_arts.add(el.art_number)

        seen_refs: set[str] = set()
        for entry in subject_index.entries:
            for ref in entry.refs:
                key = f"{ref.law_prefix}:{ref.art}" if ref.law_prefix else ref.art
                if key not in docx_arts and key not in seen_refs:
                    seen_refs.add(key)
                    art_label = f"Art. {ref.law_prefix}:{ref.art}" if ref.law_prefix else f"Art. {ref.art}"
                    ctx = entry.subject
                    if entry.sub_subject:
                        ctx += f" > {entry.sub_subject}"
                    report.add("ref_cruzada", "erro", art_label, f"assunto: {ctx}")

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

    # Apply law prefixes to articles based on law_name ↔ mapping
    if law_mapping:
        from src.models import ArticleBlock as _AB
        for el in doc.elements:
            if isinstance(el, _AB) and el.law_name and el.law_name in law_mapping:
                el.law_prefix = law_mapping[el.law_name]
                lp = el.law_prefix
                if el.caput:
                    el.caput.uid = el.caput.uid.replace("art", f"art{lp}", 1)
                for child in el.children:
                    child.uid = child.uid.replace("art", f"art{lp}", 1)
                for v in el.all_versions:
                    v.uid = v.uid.replace("art", f"art{lp}", 1)

    # ── 4. Parse referencias DOCX ────────────────────────────────────
    print("[4/8] Parseando referências...")
    from src.parse_referencias import parse_referencias

    ref_path = Path(args.referencias)
    if ref_path.exists():
        referencias_data = parse_referencias(ref_path)
        entry_count = sum(
            len(e["entries"]) for cat in referencias_data for e in cat["groups"]
        )
        print(f"      → {len(referencias_data)} categorias, {entry_count} entradas")
    else:
        print("      → DOCX de referências não encontrado, aba vazia")
        referencias_data = []

    # ── 5. Parse informacoes DOCX ─────────────────────────────────────
    print("[5/8] Parseando informações...")
    from src.parse_informacoes import parse_informacoes

    info_path = Path(args.informacoes)
    if info_path.exists():
        info_html = parse_informacoes(info_path)
        print(f"      → {len(info_html)} caracteres de HTML")
    else:
        print("      → DOCX de informações não encontrado, aba vazia")
        info_html = ""

    # ── 6. Build systematic index ──────────────────────────────────────
    print("[6/8] Gerando índice sistemático...")
    from src.build_index import build_systematic_index

    systematic_index = build_systematic_index(doc)
    print(f"      → {len(systematic_index)} nós raiz")

    # ── 7. Render HTML cards ───────────────────────────────────────────
    print("[7/8] Renderizando cards HTML...")
    from src.render_html import render_cards

    cards_html = render_cards(doc)
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
        summaries_map=summaries_map,
        info_html=info_html,
        base_dir=BASE_DIR,
        output_path=output_path,
    )

    elapsed = time.time() - t0
    size_kb = output_path.stat().st_size / 1024
    print(f"\n✓ {label} pronto em {elapsed:.1f}s → {output_path} ({size_kb:.0f} KB)")

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
    label: str,
) -> None:
    """Gera 3 arquivos Markdown no diretório de saída."""

    t0 = time.time()
    print(f"\n{'═' * 60}")
    print(f"  Build: {label}")
    print(f"{'═' * 60}")

    if not output_dir.exists():
        print(f"  ⚠ Diretório não encontrado: {output_dir}")
        print(f"    Verifique se o Google Drive está montado.")
        return

    # ── 1. Parse DOCX (sempre com notas privadas) ─────────────────
    print("[1/5] Parseando DOCX...")
    from src.parse_docx import parse_docx

    doc = parse_docx(args.docx, include_private=True)
    articles = [e for e in doc.elements if hasattr(e, "art_number")]
    print(f"      → {len(articles)} artigos")

    # ── 2. Resolve amendments ─────────────────────────────────────
    print("[2/5] Resolvendo emendas...")
    from src.resolve_amendments import resolve_amendments

    doc = resolve_amendments(doc)

    # ── 3. Parse XLSX ─────────────────────────────────────────────
    print("[3/5] Parseando XLSX...")
    from src.parse_xlsx import parse_xlsx, parse_law_mapping
    import re as _re

    xlsx_path = Path(args.xlsx)
    law_mapping: dict[str, str] = {}
    subject_list: list[dict] = []
    if xlsx_path.exists():
        try:
            law_mapping = parse_law_mapping(xlsx_path)
            known_lettered: set[str] = {
                el.art_number for el in doc.elements
                if hasattr(el, "art_number") and _re.search(r"-[A-Za-z]", el.art_number)
            }
            subject_index = parse_xlsx(xlsx_path, known_lettered=known_lettered)
            subject_list = subject_index.to_list()
            print(f"      → {len(subject_list)} assuntos")
        except PermissionError:
            print("      ⚠ Não foi possível abrir remissivo.xlsx")
    else:
        print("      → XLSX não encontrado")

    # Apply law prefixes
    if law_mapping:
        from src.models import ArticleBlock as _AB

        for el in doc.elements:
            if isinstance(el, _AB) and el.law_name and el.law_name in law_mapping:
                el.law_prefix = law_mapping[el.law_name]

    # ── 4. Parse referências ──────────────────────────────────────
    print("[4/5] Parseando referências...")
    from src.parse_referencias import parse_referencias

    ref_path = Path(args.referencias)
    referencias_data: list[dict] = []
    if ref_path.exists():
        referencias_data = parse_referencias(ref_path)
        print(f"      → {len(referencias_data)} categorias")
    else:
        print("      → DOCX de referências não encontrado")

    # ── 5. Render Markdown ────────────────────────────────────────
    print("[5/5] Renderizando Markdown...")
    from src.render_markdown import MarkdownRenderer

    renderer = MarkdownRenderer()

    regimento_md = renderer.render_document(doc)
    (output_dir / "regimento.md").write_text(regimento_md, encoding="utf-8")
    print(f"      → regimento.md ({len(regimento_md) / 1024:.0f} KB)")

    if subject_list:
        indice_md = renderer.render_subject_index(subject_list)
        (output_dir / "indice-remissivo.md").write_text(indice_md, encoding="utf-8")
        print(f"      → indice-remissivo.md ({len(indice_md) / 1024:.0f} KB)")

    if referencias_data:
        refs_md = renderer.render_referencias(referencias_data)
        (output_dir / "referencias.md").write_text(refs_md, encoding="utf-8")
        print(f"      → referencias.md ({len(refs_md) / 1024:.0f} KB)")

    elapsed = time.time() - t0
    print(f"\n✓ {label} pronto em {elapsed:.1f}s → {output_dir}")


def _auto_commit_and_push() -> None:
    """Faz git add + commit + push de docs/index.html."""
    public_html = BASE_DIR / "docs" / "index.html"
    if not public_html.exists():
        return

    # Check if there are changes to commit
    result = subprocess.run(
        ["git", "diff", "--quiet", "docs/index.html"],
        cwd=BASE_DIR,
        capture_output=True,
    )
    if result.returncode == 0:
        # Also check if file is untracked
        result2 = subprocess.run(
            ["git", "ls-files", "--error-unmatch", "docs/index.html"],
            cwd=BASE_DIR,
            capture_output=True,
        )
        if result2.returncode == 0:
            print("\n⊘ docs/index.html sem alterações — nada a commitar")
            return

    print("\n── Git ──")
    subprocess.run(["git", "add", "docs/index.html"], cwd=BASE_DIR, check=True)
    print("  git add docs/index.html")

    timestamp = time.strftime("%Y-%m-%d %H:%M")
    msg = f"build: atualiza regimento ({timestamp})"
    subprocess.run(["git", "commit", "-m", msg], cwd=BASE_DIR, check=True)
    print(f"  git commit -m \"{msg}\"")

    subprocess.run(["git", "push"], cwd=BASE_DIR, check=True)
    print("  git push ✓")


def main() -> int:
    config = _load_config()
    sources = config.get("sources", {})
    output_cfg = config.get("output", {})

    # Defaults: config.local.toml → fallback local
    default_docx = sources.get("docx", str(BASE_DIR / "regimentoInterno.docx"))
    default_xlsx = sources.get("xlsx", str(BASE_DIR / "remissivo.xlsx"))
    default_refs = sources.get("referencias", str(BASE_DIR / "referencias.docx"))
    default_info = sources.get("informacoes", str(BASE_DIR / "informacoes.docx"))
    default_private = output_cfg.get("private", "")
    default_gdrive = output_cfg.get("gdrive", "")

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
        "--referencias", default=default_refs,
        help="Caminho do DOCX de referências",
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
        help="Pula a geração de Markdown para Google Drive",
    )
    parser.add_argument(
        "--only-markdown", action="store_true",
        help="Gera apenas os arquivos Markdown (pula HTML)",
    )
    parser.add_argument(
        "--strict", action="store_true",
        help="Trata avisos como erros (exit code 1 se houver qualquer problema)",
    )
    args = parser.parse_args()

    if args.only_public and args.only_private:
        parser.error("--only-public e --only-private são mutuamente exclusivos")
    if args.skip_markdown and args.only_markdown:
        parser.error("--skip-markdown e --only-markdown são mutuamente exclusivos")

    build_public = not args.only_private and not args.only_markdown
    build_private = not args.only_public and bool(default_private) and not args.only_markdown
    build_markdown = not args.skip_markdown and bool(default_gdrive)

    if not build_public and not build_private and not build_markdown:
        print("Nada a fazer. Configure [output] em config.local.toml.")
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
            output_dir=Path(default_gdrive),
            label="Markdown para Google Drive",
        )

    elapsed_total = time.time() - t_total
    print(f"\n{'═' * 60}")
    print(f"  Total: {elapsed_total:.1f}s")
    print(f"{'═' * 60}")

    # Commit/push only when explicitly requested
    if args.push and build_public:
        _auto_commit_and_push()

    # Exit code based on validation results
    total_errors = sum(len(r.errors) for r in all_reports)
    total_warnings = sum(len(r.warnings) for r in all_reports)
    if total_errors or (args.strict and total_warnings):
        return 1
    return 0


if __name__ == "__main__":
    code = main()
    input("\nPressione Enter para fechar...")
    sys.exit(code)
