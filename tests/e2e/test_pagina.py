"""O comportamento da página no navegador: busca, painel, Voltar, marcadores,
armazenamento recusado ou estragado, faixas do índice e metadados."""

from __future__ import annotations

import re

import pytest

pytestmark = pytest.mark.e2e


def contador(pg) -> str:
    return pg.locator("#search-counter").inner_text().strip()


def selecionado(pg) -> tuple[str, str]:
    """(norma, artigo) do card selecionado."""
    return tuple(pg.evaluate(
        "() => { const c = document.querySelector('.card.selected');"
        " return c ? [c.dataset.law || 'RI', c.dataset.art] : ['', '']; }"))


def test_enter_logo_depois_de_digitar_vai_ao_primeiro_resultado(abrir):
    pg = abrir()
    pg.locator("#search-input").press_sequentially("nominal")
    pg.keyboard.press("Enter")
    pg.wait_for_function("document.querySelector('#search-counter').textContent.includes('/')")
    assert contador(pg).startswith("1 / ")
    pg.keyboard.press("Enter")
    assert contador(pg).startswith("2 / ")


@pytest.mark.parametrize("atalho, esperado", [("r43", ("RI", "43")), ("l43", ("LOM", "43"))])
def test_atalho_vai_ao_artigo(abrir, atalho, esperado):
    pg = abrir()
    pg.locator("#search-input").press_sequentially(atalho)
    pg.wait_for_function("art => { const c = document.querySelector('.card.selected');"
                         " return c && c.dataset.art === art; }", arg=esperado[1])
    assert selecionado(pg) == esperado


def test_busca_sem_resultado_nao_quebra(abrir):
    pg = abrir()
    pg.locator("#search-input").press_sequentially("xyzwqk")
    pg.wait_for_timeout(700)
    assert not re.match(r"\d+ / ", contador(pg))


def test_esc_fecha_o_painel_antes_de_limpar_a_busca(abrir):
    pg = abrir()
    pg.locator("#search-input").fill("quórum")
    pg.click("#btn-index")
    assert "open" in pg.get_attribute("#index-panel", "class")
    pg.keyboard.press("Escape")
    assert "open" not in (pg.get_attribute("#index-panel", "class") or "")
    assert pg.input_value("#search-input") == "quórum"
    assert pg.evaluate("document.activeElement.id") == "btn-index"
    pg.keyboard.press("Escape")
    assert pg.input_value("#search-input") == ""


_FOCA_A_ABA = ("() => { const b = document.querySelector('.index-tab'); b.focus();"
               " return document.activeElement === b; }")


def test_painel_fechado_nao_recebe_foco(abrir):
    pg = abrir()
    assert pg.evaluate(_FOCA_A_ABA) is False
    pg.click("#btn-index")
    assert pg.evaluate(_FOCA_A_ABA) is True
    assert pg.get_attribute("#btn-index", "aria-expanded") == "true"
    pg.click("#index-close")
    pg.wait_for_function("document.getElementById('index-panel').classList.contains('shut')")
    assert pg.evaluate(_FOCA_A_ABA) is False


def test_x_fecha_o_painel(abrir):
    pg = abrir()
    pg.click("#btn-index")
    pg.click("#index-close")
    assert "open" not in (pg.get_attribute("#index-panel", "class") or "")


def _aberto(pg) -> bool:
    return "open" in (pg.get_attribute("#index-panel", "class") or "")


@pytest.mark.parametrize("largura", [320, 360, 375, 412])
def test_no_celular_o_x_cabe_no_painel(abrir, largura):
    pg = abrir(largura=largura, altura=667, is_mobile=True, has_touch=True)
    pg.click("#btn-index")
    for aba in ("systematic", "subject", "references"):
        pg.click(f'.index-tab[data-tab="{aba}"]')
        pg.wait_for_timeout(450)    # a largura do painel muda com a aba
        sobra, cortadas = pg.evaluate("""() => {
          const x = document.getElementById('index-close').getBoundingClientRect();
          const p = document.getElementById('index-panel').getBoundingClientRect();
          const cortadas = [...document.querySelectorAll('.index-tab')]
            .filter(t => t.scrollWidth > t.clientWidth).map(t => t.textContent);
          return [p.right - x.right, cortadas];
        }""")
        assert sobra >= 0, (aba, sobra)
        if largura >= 360:
            assert not cortadas, (aba, cortadas)
    pg.tap("#index-close")
    assert not _aberto(pg)


def test_aba_responde_ao_toque_antes_de_desenhar_a_lista(abrir):
    pg = abrir()
    pg.click("#btn-index")
    for aba, marca in (("references", ".q-grid"), ("subject", ".subj-entry"), ("systematic", ".sys-tit")):
        logo = pg.evaluate("""aba => {
          document.querySelector(`.index-tab[data-tab="${aba}"]`).click();
          return [document.querySelector('.index-tab.active').dataset.tab,
                  document.getElementById('index-panel').classList.contains('loading')];
        }""", aba)
        assert logo == [aba, True]
        pg.wait_for_function("!document.getElementById('index-panel').classList.contains('loading')")
        assert pg.locator(f"#index-content {marca}").count() > 0, aba


def test_aba_de_informacoes_mostra_a_versao(abrir):
    pg = abrir()
    pg.click("#btn-index")
    pg.click("#btn-info-tab")
    assert re.match(r"Versão de \d\d/\d\d/\d{4}, \d\d:\d\d", pg.locator(".info-versao").inner_text())


def test_outras_abas_so_se_preparam_depois_de_fechar_o_painel(abrir):
    """Não logo depois da carga, quando o primeiro toque no ☰ esperaria por elas."""
    pg = abrir()
    pg.wait_for_timeout(1500)
    assert pg.evaluate("document.getElementById('index-content').dataset.of") is None
    pg.click("#btn-index")
    pg.wait_for_selector("#index-content .sys-tit")
    pg.click("#index-close")
    pg.wait_for_function("document.getElementById('index-content').dataset.of === 'subject'")
    assert pg.evaluate("document.getElementById('index-panel').classList.contains('shut')")


def test_medir_mostra_a_primeira_abertura_na_aba_de_informacoes(abrir, site):
    pg = abrir()
    pg.goto(site + "?medir", wait_until="load")
    pg.wait_for_selector(".idx-sum", state="attached")
    pg.click("#btn-index")
    pg.wait_for_selector("#index-content .sys-tit")
    pg.wait_for_timeout(100)
    pg.click("#btn-info-tab")
    texto = pg.locator(".info-medida").inner_text()
    assert re.match(r"Primeira abertura do índice: toque aos [\d,]+ s .*painel na tela [\d,]+ s depois; lista [\d,]+ s depois", texto), texto


def test_o_que_flutua_fica_fora_dos_filhos_do_body(abrir):
    """Mostrado ou escondido direto no <body>, faria o navegador reenviar a árvore de acessibilidade
    da página inteira (~1 s num PC) sempre que há um serviço de acessibilidade ligado."""
    pg = abrir(permissions=["clipboard-read", "clipboard-write"])
    pg.click("#btn-index")
    pg.click("#index-close")
    pg.locator("#search-input").fill("quórum")
    _marcar_o_primeiro(pg)
    pg.click("#marker-copy-btn")
    filhos = pg.evaluate("[...document.body.children].filter(e => e.tagName !== 'SCRIPT').map(e => e.id)")
    assert filhos == ["header", "breadcrumb-bar", "reading-line", "cards-container", "layers"], filhos


def test_toque_num_botao_nao_lhe_da_o_foco(abrir):
    """Num Android, o 1º foco da página num botão a travava 2,5 s (medido com ?medir&sem=foco)."""
    pg = abrir(largura=412, altura=915, is_mobile=True, has_touch=True)
    pg.tap("#btn-index")
    pg.wait_for_selector("#index-content .sys-tit")
    assert pg.evaluate("document.activeElement.tagName") == "BODY"
    pg.tap("#index-close")
    # o campo em que se digita perde o foco, como antes (o teclado fecha)
    pg.tap("#search-input")
    pg.keyboard.type("quórum")
    pg.wait_for_function(r"/\d+ \/ \d+/.test(document.getElementById('search-counter').textContent)")
    pg.tap("#search-next")
    assert pg.evaluate("document.activeElement.tagName") == "BODY"


def test_clique_do_mouse_num_botao_ainda_lhe_da_o_foco(abrir):
    pg = abrir()
    pg.click("#btn-compact")
    assert pg.evaluate("document.activeElement.id") == "btn-compact"


def test_deslizar_para_a_esquerda_fecha_o_painel(abrir):
    pg = abrir(largura=412, altura=915, is_mobile=True, has_touch=True)
    pg.click("#btn-index")
    gesto = """([x0, x1, y]) => {
      const p = document.getElementById('index-content');
      const toque = x => new Touch({ identifier: 1, target: p, clientX: x, clientY: y });
      p.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [toque(x0)], changedTouches: [toque(x0)] }));
      p.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [toque(x1)] }));
    }"""
    pg.evaluate(gesto, [300, 260, 400])     # curto: fica
    assert _aberto(pg)
    pg.evaluate(gesto, [300, 120, 400])
    assert not _aberto(pg)


def test_voltar_fecha_o_painel(abrir):
    pg = abrir()
    pg.click("#btn-index")
    assert "open" in pg.get_attribute("#index-panel", "class")
    pg.go_back()
    pg.wait_for_function("!document.getElementById('index-panel').classList.contains('open')")


def _marcar_o_primeiro(pg) -> str:
    uid = pg.evaluate("document.querySelector('.card-artigo .unit-id').dataset.uid")
    alvo = pg.locator(f'.unit-id[data-uid="{uid}"]')
    alvo.scroll_into_view_if_needed()
    alvo.click()
    pg.wait_for_selector("#marker-nav .marker-btn")
    return uid


def test_marcar_e_copiar(abrir):
    pg = abrir(permissions=["clipboard-read", "clipboard-write"])
    uid = _marcar_o_primeiro(pg)
    assert uid in pg.evaluate("localStorage.getItem('regimento-markers-v2')")
    pg.click("#marker-copy-btn")
    pg.wait_for_function("document.getElementById('marker-copy-btn').classList.contains('copied')")
    assert pg.evaluate("navigator.clipboard.readText()").startswith("conforme disposto no art. ")


def test_marcar_com_o_armazenamento_recusado(abrir):
    """Navegador que recusa gravar (cota, modo privado, política): marca só nesta visita."""
    pg = abrir(antes="Storage.prototype.setItem = function () {"
                     " throw new DOMException('cota', 'QuotaExceededError'); };")
    _marcar_o_primeiro(pg)
    assert pg.locator("#marker-nav .marker-btn").count() == 1


def test_dados_salvos_estragados_nao_travam_a_carga(abrir):
    antes = """
      localStorage.setItem('regimento-zoom', 'abc');
      localStorage.setItem('regimento-markers-v2', JSON.stringify(
        [5, null, {uid: 'x"]', colorIdx: 0}, {uid: 'art1', colorIdx: 99}, {uid: 'art1', colorIdx: 0}]));
    """
    pg = abrir(antes=antes)
    zoom = pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--zoom-scale').trim()")
    assert zoom == "1"
    assert pg.locator("#marker-nav .marker-btn").count() == 1   # só o {uid: 'art1', colorIdx: 0}


def test_o_que_se_digitou_antes_do_script_e_buscado(abrir):
    """Rede lenta: a barra aparece segundos antes do script rodar."""
    antes = """
      new MutationObserver((_, obs) => {
        const i = document.getElementById('search-input');
        if (i) { i.value = 'nominal'; obs.disconnect(); }
      }).observe(document, { childList: true, subtree: true });"""
    pg = abrir(antes=antes)
    pg.wait_for_function(r"/\d+ \/ \d+/.test(document.getElementById('search-counter').textContent)")


def test_toque_no_indice_antes_do_script_abre_o_painel(abrir):
    """Rede lenta: o ☰ aparece segundos antes do script; o toque responde e é guardado."""
    antes = """
      new MutationObserver((_, obs) => {
        if (!window.earlyIndex) return;
        const b = document.getElementById('btn-index');
        b.click();
        window.marcado = b.classList.contains('pending');
        obs.disconnect();
      }).observe(document, { childList: true, subtree: true });"""
    pg = abrir(antes=antes)
    pg.wait_for_function("document.getElementById('index-panel').classList.contains('open')")
    assert pg.evaluate("window.marcado") is True
    assert pg.evaluate("document.getElementById('btn-index').classList.contains('pending')") is False
    pg.wait_for_selector("#index-content .sys-tit")


def test_faixas_do_indice_so_quando_abertas(abrir):
    pg = abrir()
    assert pg.locator(".idx-row").count() == 0
    soma = pg.locator(".card-artigo .idx-sum").first
    soma.scroll_into_view_if_needed()
    soma.click()
    assert pg.locator(".idx-row").count() > 0
    assert pg.locator(".idx-back").count() > 0
    # a escolha é lembrada: na volta, as faixas já vêm abertas
    pg.reload(wait_until="load")
    pg.wait_for_selector(".idx-row", state="attached")
    assert pg.evaluate("document.getElementById('cards-container').classList.contains('idx-open')")


def test_metadados_de_compartilhamento(abrir, site):
    pg = abrir()
    assert pg.get_attribute('meta[property="og:image"]', "content").endswith("/img/compartilhar.png")
    base = site.rsplit("/", 1)[0]
    for nome in ("img/compartilhar.png", "img/icone-180.png"):
        r = pg.request.get(f"{base}/{nome}")
        assert r.status == 200 and r.headers["content-type"] == "image/png", nome
