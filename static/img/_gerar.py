"""Gera as imagens de compartilhamento a partir das fontes nesta pasta:
compartilhar.png (1200×630, a prévia do link no WhatsApp e afins, de
_compartilhar.html) e icone-180.png (o ícone na tela inicial do celular,
de icone.svg). O build copia os .png e .svg para img/ ao lado da página.
O favicon da página é o icone.svg em data URI, copiado à mão para o
<link rel="icon"> de templates/base.html.

    python static/img/_gerar.py
"""
import re
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

AQUI = Path(__file__).resolve().parent
# the ribbons' guilloché (a data URI and its size), the same as the page's
CSS = (AQUI.parent / "style.css").read_text(encoding="utf-8")
GUILHOCHE = re.search(r"--guilhoche:\s*(url\(.+?\)[^;]*);", CSS).group(1)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1200, "height": 630})
    pg.goto((AQUI / "_compartilhar.html").as_uri())
    pg.evaluate("g => document.documentElement.style.setProperty('--guilhoche', g)", GUILHOCHE)
    pg.evaluate("document.fonts.ready")
    pg.wait_for_timeout(300)
    pg.screenshot(path=str(AQUI / "compartilhar.png"))
    # 256 colors: 260 → 95 KB, the same to the eye (WhatsApp skips a preview
    # image much over 300 KB)
    png = Image.open(AQUI / "compartilhar.png").convert("RGB")
    png.quantize(256, method=Image.Quantize.MEDIANCUT).save(AQUI / "compartilhar.png", optimize=True)
    # the icon on a phone's home screen: the sheet on the page's blue-grey,
    # square (the phone rounds the corners)
    svg = (AQUI / "icone.svg").read_text(encoding="utf-8")
    pg = b.new_page(viewport={"width": 180, "height": 180})
    pg.set_content('<style>*{margin:0}body{background:radial-gradient(ellipse at 50% 40%,#eef1f5,#d9dee7);'
                   'width:180px;height:180px;display:grid;place-items:center}'
                   'svg{display:block;width:136px;height:136px;margin-top:-4px}</style>' + svg)
    pg.screenshot(path=str(AQUI / "icone-180.png"))
    b.close()
print("compartilhar.png, icone-180.png")
