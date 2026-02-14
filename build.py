#!/usr/bin/env python3
"""Build pipeline: DOCX + XLSX → dist/index.html."""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
from pathlib import Path

# Fix Windows console encoding
if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, encoding="utf-8", errors="replace"
    )

BASE_DIR = Path(__file__).parent


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Gera dist/index.html a partir de regimentoInterno.docx e remissivo.xlsx"
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Salva JSONs intermediários em intermediate/",
    )
    parser.add_argument(
        "--docx",
        default=str(BASE_DIR / "regimentoInterno.docx"),
        help="Caminho do DOCX (padrão: regimentoInterno.docx)",
    )
    parser.add_argument(
        "--xlsx",
        default=str(BASE_DIR / "remissivo.xlsx"),
        help="Caminho do XLSX (padrão: remissivo.xlsx)",
    )
    parser.add_argument(
        "--output",
        default=str(BASE_DIR / "docs" / "index.html"),
        help="Caminho de saída (padrão: docs/index.html)",
    )
    args = parser.parse_args()

    t0 = time.time()

    # ── 1. Parse DOCX ──────────────────────────────────────────────────
    print("[1/6] Parseando DOCX...")
    from src.parse_docx import parse_docx

    doc = parse_docx(args.docx)

    # Count elements
    headings = [e for e in doc.elements if hasattr(e, "level")]
    articles = [e for e in doc.elements if hasattr(e, "art_number")]
    print(f"      → {len(headings)} headings, {len(articles)} artigos")

    # ── 2. Resolve amendments ──────────────────────────────────────────
    print("[2/6] Resolvendo emendas...")
    from src.resolve_amendments import resolve_amendments

    doc = resolve_amendments(doc)

    version_count = sum(
        len(a.all_versions)  # type: ignore
        + sum(1 for c in a.children if c.is_old_version)  # type: ignore
        for a in articles
    )
    print(f"      → {version_count} versões anteriores detectadas")

    # ── 3. Parse XLSX ──────────────────────────────────────────────────
    print("[3/6] Parseando XLSX...")
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

    # Apply law prefixes to articles based on law_name ↔ mapping
    if law_mapping:
        from src.models import ArticleBlock as _AB
        for el in doc.elements:
            if isinstance(el, _AB) and el.law_name and el.law_name in law_mapping:
                el.law_prefix = law_mapping[el.law_name]
                # Prefix uids with law abbreviation to avoid collisions
                lp = el.law_prefix
                if el.caput:
                    el.caput.uid = el.caput.uid.replace("art", f"art{lp}", 1)
                for child in el.children:
                    child.uid = child.uid.replace("art", f"art{lp}", 1)
                for v in el.all_versions:
                    v.uid = v.uid.replace("art", f"art{lp}", 1)

    # ── 4. Build systematic index ──────────────────────────────────────
    print("[4/6] Gerando índice sistemático...")
    from src.build_index import build_systematic_index

    systematic_index = build_systematic_index(doc)
    print(f"      → {len(systematic_index)} nós raiz")

    # ── 5. Render HTML cards ───────────────────────────────────────────
    print("[5/6] Renderizando cards HTML...")
    from src.render_html import render_cards

    cards_html = render_cards(doc)
    print(f"      → {len(cards_html)} caracteres de HTML")

    # ── 6. Assemble ────────────────────────────────────────────────────
    print("[6/6] Montando dist/index.html...")
    from src.assemble import assemble

    output_path = Path(args.output)
    assemble(
        cards_html=cards_html,
        systematic_index=systematic_index,
        subject_index=subject_list,
        base_dir=BASE_DIR,
        output_path=output_path,
    )

    elapsed = time.time() - t0
    size_kb = output_path.stat().st_size / 1024
    print(f"\n✓ Build completo em {elapsed:.1f}s")
    print(f"  Saída: {output_path} ({size_kb:.0f} KB)")

    # ── Debug output ───────────────────────────────────────────────────
    if args.debug:
        print("\nSalvando JSONs de debug...")
        debug_dir = BASE_DIR / "intermediate"
        debug_dir.mkdir(exist_ok=True)

        # Parsed document
        doc_json = doc.to_dict()
        (debug_dir / "parsed_document.json").write_text(
            json.dumps(doc_json, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  → {debug_dir / 'parsed_document.json'}")

        # Systematic index
        (debug_dir / "systematic_index.json").write_text(
            json.dumps(systematic_index, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  → {debug_dir / 'systematic_index.json'}")

        # Subject index
        (debug_dir / "subject_index.json").write_text(
            json.dumps(subject_list, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  → {debug_dir / 'subject_index.json'}")


if __name__ == "__main__":
    main()
