"""Montagem do HTML final a partir do template + CSS + JS + dados."""

from __future__ import annotations

import json
from pathlib import Path


def assemble(
    cards_html: str,
    systematic_index: list[dict],
    subject_index: list[dict],
    base_dir: Path,
    output_path: Path,
) -> None:
    """Monta o dist/index.html final (self-contained)."""
    template_path = base_dir / "templates" / "base.html"
    css_path = base_dir / "static" / "style.css"
    js_path = base_dir / "static" / "app.js"

    template = template_path.read_text(encoding="utf-8")
    css = css_path.read_text(encoding="utf-8")
    js = js_path.read_text(encoding="utf-8")

    # Inject data into JS placeholders
    sys_json = json.dumps(systematic_index, ensure_ascii=False, indent=2)
    subj_json = json.dumps(subject_index, ensure_ascii=False, indent=2)

    js = js.replace("/*__SYSTEMATIC_INDEX__*/[]", sys_json)
    js = js.replace("/*__SUBJECT_INDEX__*/[]", subj_json)

    # Assemble final HTML
    final = template.replace("{{CSS}}", css)
    final = final.replace("{{CARDS}}", cards_html)
    final = final.replace("{{JS}}", js)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(final, encoding="utf-8")
