"""Gera as imagens de compartilhamento a partir das fontes nesta pasta:
compartilhar.png (1200×630, a prévia do link no WhatsApp e afins, de
_compartilhar.html) e icone-180.png (o ícone na tela inicial do celular,
de icone.svg). O build copia os .png e .svg para img/ ao lado da página.

    python static/img/_gerar.py
"""
from pathlib import Path

from playwright.sync_api import sync_playwright

AQUI = Path(__file__).resolve().parent

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1200, "height": 630})
    pg.goto((AQUI / "_compartilhar.html").as_uri())
    pg.evaluate("document.fonts.ready")
    pg.wait_for_timeout(300)
    pg.screenshot(path=str(AQUI / "compartilhar.png"))
    # the icon on a phone's home screen: square, no rounded corners (the phone rounds them)
    svg = (AQUI / "icone.svg").read_text(encoding="utf-8").replace(' rx="6"', "")
    pg = b.new_page(viewport={"width": 180, "height": 180})
    pg.set_content('<style>*{margin:0}svg{display:block;width:180px;height:180px}</style>' + svg)
    pg.screenshot(path=str(AQUI / "icone-180.png"))
    b.close()
print("compartilhar.png, icone-180.png")
