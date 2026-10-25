"""Montagem do HTML final a partir do template + CSS + JS + dados."""

from __future__ import annotations

import json
import shutil
from pathlib import Path


def assemble(
    cards_html: str,
    systematic_index: list[dict],
    subject_index: list[dict],
    referencias_index: list[dict],
    consulta_index: list[dict],
    summaries_map: dict[str, str],
    info_html: str,
    base_dir: Path,
    output_path: Path,
    correlato_notas: list[str] = (),
) -> None:
    """Monta o dist/index.html final (self-contained, exceto as fontes em fonts/)."""
    template_path = base_dir / "templates" / "base.html"
    css_path = base_dir / "static" / "style.css"
    js_path = base_dir / "static" / "app.js"

    template = template_path.read_text(encoding="utf-8")
    css = css_path.read_text(encoding="utf-8")
    js = js_path.read_text(encoding="utf-8")

    # Inject data into JS placeholders, without indentation (the page is not read by hand;
    # intermediate/ keeps the indented JSON for debugging)
    def dumps(data) -> str:
        return json.dumps(data, ensure_ascii=False, separators=(",", ":"))

    js = js.replace("/*__SYSTEMATIC_INDEX__*/[]", dumps(systematic_index))
    js = js.replace("/*__SUBJECT_INDEX__*/[]", dumps(subject_index))
    js = js.replace("/*__REFERENCIAS_INDEX__*/[]", dumps(referencias_index))
    js = js.replace("/*__CONSULTA_INDEX__*/[]", dumps(consulta_index))
    js = js.replace("/*__SUMMARIES_MAP__*/{}", dumps(summaries_map))
    js = js.replace("/*__CORRELATO_NOTAS__*/[]", dumps(list(correlato_notas)))

    info_json = json.dumps(info_html, ensure_ascii=False)
    js = js.replace("/*__INFO_HTML__*/\"\"", info_json)

    # Assemble final HTML
    final = template.replace("{{CSS}}", css)
    final = final.replace("{{CARDS}}", cards_html)
    final = final.replace("{{JS}}", js)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(final, encoding="utf-8")

    # The web fonts go next to the page (style.css loads them from fonts/);
    # without them it falls back to Georgia and the system sans
    fonts_src = base_dir / "static" / "fonts"
    if fonts_src.is_dir():
        fonts_dst = output_path.parent / "fonts"
        fonts_dst.mkdir(exist_ok=True)
        for f in fonts_src.iterdir():
            if f.is_file():
                shutil.copyfile(f, fonts_dst / f.name)
