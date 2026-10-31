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
    """Monta o dist/index.html final (self-contained, exceto as fontes em fonts/ e as imagens em img/)."""
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

    # Data written into the script itself: "</" and "<!--" escaped as in the JSON
    # blocks below (a "</script>" in a summary would end the script), and each
    # placeholder must be there (a renamed one would leave its data out silently)
    def inject(js: str, placeholder: str, data) -> str:
        assert placeholder in js, f"marcador {placeholder} não está em static/app.js"
        return js.replace(placeholder, dumps(data).replace("</", "<\\/").replace("<!--", "\\u003C!--"))

    js = inject(js, "/*__SYSTEMATIC_INDEX__*/[]", systematic_index)
    js = inject(js, "/*__SUMMARIES_MAP__*/{}", summaries_map)

    # The big data as JSON blocks the script reads when needed (pageData in
    # app.js): parsing JSON is much faster than parsing it as script literals.
    # "</" and "<!--" escaped, so nothing in the data ends its block early.
    blocks = {
        "data-subject-index": subject_index,
        "data-referencias-index": referencias_index,
        "data-consulta-index": consulta_index,
        "data-correlato-notas": list(correlato_notas),
    }
    def json_block(block_id: str, data) -> str:
        text = dumps(data).replace("</", "<\\/").replace("<!--", "\\u003C!--")
        return f'<script type="application/json" id="{block_id}">{text}</script>'

    data_html = "\n".join(json_block(block_id, data) for block_id, data in blocks.items())

    js = inject(js, "/*__INFO_HTML__*/\"\"", info_html)

    # Assemble final HTML
    final = template.replace("{{CSS}}", css)
    final = final.replace("{{CARDS}}", cards_html)
    final = final.replace("{{DATA}}", data_html)
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

    # ...and the images of a shared link (og:image) and of the phone's home
    # screen; the sources they come from (_*) stay behind
    img_src = base_dir / "static" / "img"
    if img_src.is_dir():
        img_dst = output_path.parent / "img"
        img_dst.mkdir(exist_ok=True)
        for f in img_src.iterdir():
            if f.is_file() and f.suffix in (".png", ".svg") and not f.name.startswith("_"):
                shutil.copyfile(f, img_dst / f.name)
