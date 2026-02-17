#!/usr/bin/env python3
"""Build pipeline: DOCX + XLSX → index.html (public + private versions)."""

from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import time
from pathlib import Path

# Fix Windows console encoding
if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, encoding="utf-8", errors="replace"
    )

BASE_DIR = Path(__file__).parent


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
) -> None:
    """Executa o pipeline completo uma vez e salva em output_path."""

    t0 = time.time()
    print(f"\n{'═' * 60}")
    print(f"  Build: {label}")
    print(f"{'═' * 60}")

    # ── 1. Parse DOCX ──────────────────────────────────────────────────
    print("[1/7] Parseando DOCX...")
    from src.parse_docx import parse_docx

    doc = parse_docx(args.docx, include_private=include_private)

    headings = [e for e in doc.elements if hasattr(e, "level")]
    articles = [e for e in doc.elements if hasattr(e, "art_number")]
    print(f"      → {len(headings)} headings, {len(articles)} artigos")

    # ── 2. Resolve amendments ──────────────────────────────────────────
    print("[2/7] Resolvendo emendas...")
    from src.resolve_amendments import resolve_amendments

    doc = resolve_amendments(doc)

    version_count = sum(
        len(a.all_versions)  # type: ignore
        + sum(1 for c in a.children if c.is_old_version)  # type: ignore
        for a in articles
    )
    print(f"      → {version_count} versões anteriores detectadas")

    # ── 3. Parse XLSX ──────────────────────────────────────────────────
    print("[3/7] Parseando XLSX...")
    from src.parse_xlsx import parse_xlsx, parse_law_mapping

    xlsx_path = Path(args.xlsx)
    law_mapping: dict[str, str] = {}
    if xlsx_path.exists():
        law_mapping = parse_law_mapping(xlsx_path)
        if law_mapping:
            print(f"      → {len(law_mapping)} normas mapeadas")
        subject_index = parse_xlsx(xlsx_path)
        subject_list = subject_index.to_list()
        print(f"      → {len(subject_list)} assuntos")
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

        missing: list[str] = []
        for entry in subject_index.entries:
            for ref in entry.refs:
                key = f"{ref.law_prefix}:{ref.art}" if ref.law_prefix else ref.art
                if key not in docx_arts:
                    label = f"Art. {ref.law_prefix}:{ref.art}" if ref.law_prefix else f"Art. {ref.art}"
                    ctx = entry.subject
                    if entry.sub_subject:
                        ctx += f" > {entry.sub_subject}"
                    missing.append(f"  {label}  (assunto: {ctx})")

        if missing:
            # Deduplicate preserving order
            seen: set[str] = set()
            unique: list[str] = []
            for m in missing:
                if m not in seen:
                    seen.add(m)
                    unique.append(m)
            print(f"\n⚠ {len(unique)} referência(s) na planilha não encontrada(s) no DOCX:")
            for m in unique:
                print(m)
            print()

    # Cross-reference: vides pointing to non-existent index entries
    if subject_list:
        known_subjects: set[str] = set()
        for entry in subject_index.entries:
            known_subjects.add(entry.subject.lower())
            if entry.sub_subject:
                known_subjects.add(f"{entry.subject} — {entry.sub_subject}".lower())

        bad_vides: list[str] = []
        for entry in subject_index.entries:
            for v in entry.vides:
                if v.lower() not in known_subjects:
                    ctx = entry.subject
                    if entry.sub_subject:
                        ctx += f" > {entry.sub_subject}"
                    bad_vides.append(f"  \"{v}\"  (assunto: {ctx})")

        if bad_vides:
            seen_v: set[str] = set()
            unique_v: list[str] = []
            for m in bad_vides:
                if m not in seen_v:
                    seen_v.add(m)
                    unique_v.append(m)
            print(f"\n⚠ {len(unique_v)} vide(s) referenciando assuntos inexistentes:")
            for m in unique_v:
                print(m)
            print()

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
    print("[4/7] Parseando referências...")
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

    # ── 5. Build systematic index ──────────────────────────────────────
    print("[5/7] Gerando índice sistemático...")
    from src.build_index import build_systematic_index

    systematic_index = build_systematic_index(doc)
    print(f"      → {len(systematic_index)} nós raiz")

    # ── 6. Render HTML cards ───────────────────────────────────────────
    print("[6/7] Renderizando cards HTML...")
    from src.render_html import render_cards

    cards_html = render_cards(doc)
    print(f"      → {len(cards_html)} caracteres de HTML")

    # ── 7. Assemble ────────────────────────────────────────────────────
    print("[7/7] Montando HTML final...")
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
        base_dir=BASE_DIR,
        output_path=output_path,
    )

    elapsed = time.time() - t0
    size_kb = output_path.stat().st_size / 1024
    print(f"\n✓ {label} pronto em {elapsed:.1f}s → {output_path} ({size_kb:.0f} KB)")

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


def main() -> None:
    config = _load_config()
    sources = config.get("sources", {})
    output_cfg = config.get("output", {})

    # Defaults: config.local.toml → fallback local
    default_docx = sources.get("docx", str(BASE_DIR / "regimentoInterno.docx"))
    default_xlsx = sources.get("xlsx", str(BASE_DIR / "remissivo.xlsx"))
    default_refs = sources.get("referencias", str(BASE_DIR / "referencias.docx"))
    default_private = output_cfg.get("private", "")

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
    args = parser.parse_args()

    if args.only_public and args.only_private:
        parser.error("--only-public e --only-private são mutuamente exclusivos")

    build_public = not args.only_private
    build_private = not args.only_public and bool(default_private)

    if not build_public and not build_private:
        print("Nada a fazer. Configure [output] private em config.local.toml ou use --only-public.")
        sys.exit(1)

    t_total = time.time()

    if build_public:
        _build_once(
            args=args,
            include_private=False,
            output_path=Path(args.output),
            label="Versão pública (sem notas privadas)",
        )

    if build_private:
        _build_once(
            args=args,
            include_private=True,
            output_path=Path(default_private),
            label="Versão privada (com notas privadas)",
        )

    elapsed_total = time.time() - t_total
    print(f"\n{'═' * 60}")
    print(f"  Total: {elapsed_total:.1f}s")
    print(f"{'═' * 60}")

    # Commit/push only when explicitly requested
    if args.push and build_public:
        _auto_commit_and_push()


if __name__ == "__main__":
    main()
    input("\nPressione Enter para fechar...")
