"""Testes de navegador da página montada (Playwright, Chromium).

Fora da suíte padrão (lentos, precisam de uma página gerada): rodar com

    pytest -m e2e                                    # a página em docs/index.html
    REGIMENTO_PAGINA=dist/teste/index.html pytest -m e2e

depois de um build e antes de publicar uma mudança de interface.
"""

from __future__ import annotations

import functools
import http.server
import os
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _pagina() -> Path:
    p = Path(os.environ.get("REGIMENTO_PAGINA", "docs/index.html"))
    return p if p.is_absolute() else ROOT / p


class _Quieto(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass


@pytest.fixture(scope="session")
def site():
    """A pasta da página servida por http (as fontes e imagens ao lado dela); a URL da página."""
    pagina = _pagina()
    if not pagina.exists():
        pytest.skip(f"página não encontrada: {pagina} (gere com python build.py)")
    handler = functools.partial(_Quieto, directory=str(pagina.parent))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}/{pagina.name}"
    srv.shutdown()


@pytest.fixture(scope="session")
def navegador():
    sync_api = pytest.importorskip("playwright.sync_api")
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


@pytest.fixture
def abrir(navegador, site):
    """abrir(antes=js, largura=, altura=, **contexto) → a página carregada e pronta, num perfil
    limpo (localStorage vazio). `antes` roda antes dos scripts da página. Erro de script
    falha o teste."""
    contextos = []
    erros: list[str] = []

    def _abrir(antes: str = "", largura: int = 1280, altura: int = 860, **ctx):
        c = navegador.new_context(viewport={"width": largura, "height": altura}, **ctx)
        contextos.append(c)
        if antes:
            c.add_init_script(antes)
        pg = c.new_page()
        pg.on("pageerror", lambda e: erros.append(str(e)))
        pg.goto(site, wait_until="load", timeout=60_000)
        pg.wait_for_selector(".idx-sum", state="attached", timeout=30_000)   # o init rodou
        return pg

    yield _abrir
    for c in contextos:
        c.close()
    assert not erros, erros
