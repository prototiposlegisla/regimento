"""Grava em static/style.css, como PNG em data URI, as texturas desenhadas
nos SVGs desta pasta: o guilhoché das faixas (_guilhoche.svg → --guilhoche)
e os losangos que contam o nível (_losango-N.svg → o --los da regra com
--los-n: N). Edite o SVG e rode de novo:

    python static/img/_texturas.py

Por que PNG: um SVG de fundo é redesenhado a cada pintura (o guilhoché tem
centenas de pontos), e as faixas e os losangos custavam ~65 ms a cada
salto num celular lento (CPU 4×, medido em 01/11/2026); o PNG é decodificado
uma vez e só copiado. Rasterizados a 5× (guilhoché) e 8× (losangos), mais
do que a densidade de qualquer tela, e no tamanho da página.
"""
import base64
import io
import re
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

AQUI = Path(__file__).resolve().parent
CSS = AQUI.parent / "style.css"
GUILHOCHE_ESCALA = 5     # o ladrilho tem 64 × 57,6 px: 5× dá pixels inteiros
LOSANGO_ESCALA = 8       # 8 px de largura na página (vezes o zoom)


def rasterizar(pg, svg: str, w: int, h: int, modo: str) -> str:
    png = pg.evaluate("""async ([svg, w, h]) => {
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/png');
    }""", [svg, w, h])
    im = Image.open(io.BytesIO(base64.b64decode(png.split(",", 1)[1]))).convert(modo)
    out = io.BytesIO()
    im.save(out, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


css = CSS.read_text(encoding="utf-8")
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.set_content("<body></body>")
    # o guilhoché: cinzas (soft-light só olha a distância ao cinza médio)
    svg = (AQUI / "_guilhoche.svg").read_text(encoding="utf-8").strip()
    uri = rasterizar(pg, svg, round(64 * GUILHOCHE_ESCALA), round(57.6 * GUILHOCHE_ESCALA), "L")
    css, n = re.subn(r'(--guilhoche: url\(")[^"]*("\))', lambda m: m.group(1) + uri + m.group(2), css)
    assert n == 1, "--guilhoche"
    # os losangos: uma coluna de N, 8 × 10N, cor e transparência do SVG
    for k in range(1, 5):
        svg = (AQUI / f"_losango-{k}.svg").read_text(encoding="utf-8").strip()
        uri = rasterizar(pg, svg, 8 * LOSANGO_ESCALA, 10 * k * LOSANGO_ESCALA, "RGBA")
        css, n = re.subn(r'(--los-n: ' + str(k) + r';\n  --los: url\(")[^"]*("\))',
                         lambda m: m.group(1) + uri + m.group(2), css)
        assert n == 1, f"--los {k}"
    b.close()
CSS.write_text(css, encoding="utf-8", newline="\n")
print("style.css: --guilhoche e --los 1–4 em PNG")
