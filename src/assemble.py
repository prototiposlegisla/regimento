"""Montagem do HTML final a partir do template + CSS + JS + dados."""

from __future__ import annotations

import json
import re
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
    # The script in parts, one per section (static/js/NN-name.js), joined in
    # their numbers' order into the one script of the page
    js_parts = sorted((base_dir / "static" / "js").glob("*.js"))

    template = template_path.read_text(encoding="utf-8")
    css = css_path.read_text(encoding="utf-8")
    assert js_parts, "static/js/ sem os arquivos do script"
    js = "".join(p.read_text(encoding="utf-8") for p in js_parts)

    # Inject data into JS placeholders, without indentation (the page is not read by hand;
    # intermediate/ keeps the indented JSON for debugging)
    def dumps(data) -> str:
        return json.dumps(data, ensure_ascii=False, separators=(",", ":"))

    # Data written into the script itself: "</" and "<!--" escaped as in the JSON
    # blocks below (a "</script>" in a summary would end the script), and each
    # placeholder must be there (a renamed one would leave its data out silently)
    def inject(js: str, placeholder: str, data) -> str:
        assert placeholder in js, f"marcador {placeholder} não está em static/js/"
        return js.replace(placeholder, dumps(data).replace("</", "<\\/").replace("<!--", "\\u003C!--"))

    js = inject(js, "/*__SYSTEMATIC_INDEX__*/[]", systematic_index)
    js = inject(js, "/*__SUMMARIES_MAP__*/{}", summaries_map)

    # The big data as JSON blocks the script reads when needed (pageData in
    # static/js): parsing JSON is much faster than parsing it as script literals.
    # "</" and "<!--" escaped, so nothing in the data ends its block early.
    # All after the script, so on a slow network the page answers before they
    # arrive (−2 s on a slow 4G, 01/11/2026; the remissivo since 02/11, −0.6 s:
    # the cards' index bands come written as their line, render_html.py): the
    # script waits for them where it needs them (lateDataReady in static/js)
    late_blocks = {
        "data-subject-index": subject_index,
        "data-referencias-index": referencias_index,
        "data-consulta-index": consulta_index,
        "data-correlato-notas": list(correlato_notas),
    }
    def json_block(block_id: str, data) -> str:
        text = dumps(data).replace("</", "<\\/").replace("<!--", "\\u003C!--")
        return f'<script type="application/json" id="{block_id}">{text}</script>'

    late_data_html = "\n".join(json_block(block_id, data) for block_id, data in late_blocks.items())

    js = inject(js, "/*__INFO_HTML__*/\"\"", info_html)

    # Minified (after the data went in: its placeholders are comments), for
    # a slow network: ~0.2 s less on a slow 4G (01/11/2026)
    js, css = minify(js, css)

    # Assemble final HTML
    final = template.replace("{{CSS}}", css)
    final = final.replace("{{CARDS}}", cards_html)
    final = final.replace("{{LATE_DATA}}", late_data_html)
    final = final.replace("{{JS}}", js)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(final, encoding="utf-8")

    # The web fonts go next to the page (style.css loads them from fonts/);
    # without them it falls back to Georgia and the system sans. Cut to the
    # characters this page has (web_fonts)
    fonts_src = base_dir / "static" / "fonts"
    if fonts_src.is_dir():
        fonts_dst = output_path.parent / "fonts"
        fonts_dst.mkdir(exist_ok=True)
        for f in fonts_src.iterdir():
            if f.is_file() and f.suffix != ".woff2":
                shutil.copyfile(f, fonts_dst / f.name)   # (the licenses)
        web_fonts(sorted(fonts_src.glob("*.woff2")), fonts_dst, page_characters(final))

    # ...and the images of a shared link (og:image) and of the phone's home
    # screen; the sources they come from (_*) stay behind
    img_src = base_dir / "static" / "img"
    if img_src.is_dir():
        img_dst = output_path.parent / "img"
        img_dst.mkdir(exist_ok=True)
        for f in img_src.iterdir():
            if f.is_file() and f.suffix in (".png", ".svg") and not f.name.startswith("_"):
                shutil.copyfile(f, img_dst / f.name)


def minify(js: str, css: str) -> tuple[str, str]:
    """The script and the styles without comments and spaces. Without rjsmin/rcssmin, as they are."""
    try:
        import rcssmin
        import rjsmin
    except ImportError:
        print("  ⚠ rjsmin/rcssmin ausentes (pip install rjsmin rcssmin): script e estilos sem minificar")
        return js, css
    return rjsmin.jsmin(js), rcssmin.cssmin(css)


# ===== Web fonts cut to the page's characters =====
# Each font came with the ~230 characters of Google Fonts' "latin" subset; the
# page uses ~170. Kept: every character in the page (its text, data, script and
# styles, escapes decoded), plus a margin for what a reader may type in the
# search (ASCII, Portuguese's letters; another one typed there just shows in
# the reserve font). Every glyph kept is the
# same, with its OpenType features and hinting: the page is identical pixel by
# pixel (01/11/2026), its fonts 306 → ~230 KB (a slow 4G: the page answers
# ~0.4 s sooner, the fonts arrive ~0.5 s sooner). A character not kept would
# only fall back to the next font of its family's stack.
FONT_MARGIN = (
    "".join(map(chr, range(0x20, 0x7F)))
    + "ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüçºª°§¶–—‘’“”•…"
)
# Fonts whose license (SIL OFL) reserves their name: a modified version (a cut
# one) can't present itself under it, so their names inside the file are
# changed (the copyright and license notices stay; the page's CSS calls them by
# its own family names, which aren't the file's)
RESERVED_NAMES = {"Merriweather": "Regimento"}
_FONT_NAME_IDS = {1, 3, 4, 6, 16, 17, 18, 20, 21, 22, 25}


def page_characters(page: str) -> str:
    """Every character a page may show: its text and the escapes in its CSS (\\261E) and script (\\u00a0)."""
    import html

    chars = set(html.unescape(page)) | set(FONT_MARGIN)
    for code in re.findall(r"\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\([0-9a-fA-F]{1,6})", page):
        n = int(next(c for c in code if c), 16)
        if 0x20 <= n <= 0x10FFFF and not 0xD800 <= n <= 0xDFFF:
            chars.add(chr(n))
    return "".join(sorted(chars))


def web_fonts(sources: list[Path], dst: Path, characters: str) -> None:
    """Each font of sources, cut to characters, into dst (same name). Without fontTools, copied whole."""
    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
    except ImportError:
        print("  ⚠ fontTools ausente (pip install 'fonttools[woff]'): fontes copiadas inteiras")
        for f in sources:
            shutil.copyfile(f, dst / f.name)
        return
    for f in sources:
        font = TTFont(f)
        options = subset.Options()
        # all of it, for the glyphs kept: features, hinting, names, tables
        options.layout_features = ["*"]
        options.name_IDs = ["*"]
        options.name_languages = ["*"]
        options.name_legacy = True
        options.hinting = True
        options.legacy_kern = True
        options.glyph_names = True
        options.notdef_outline = True
        options.drop_tables = []
        options.flavor = "woff2"
        subsetter = subset.Subsetter(options)
        subsetter.populate(text=characters)
        subsetter.subset(font)
        for record in font["name"].names:
            if record.nameID in _FONT_NAME_IDS or record.nameID >= 256:
                text = record.toUnicode()
                for reserved, own in RESERVED_NAMES.items():
                    text = text.replace(reserved, own)
                record.string = text
        font.flavor = "woff2"
        font.save(dst / f.name)
