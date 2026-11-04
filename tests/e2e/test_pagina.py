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


def _lista(pg, termo) -> str:
    """O texto da lista de resultados da busca por `termo`."""
    pg.locator("#search-input").fill(termo)
    pg.locator("#search-input").press("Enter")
    pg.wait_for_timeout(700)
    return pg.locator("#results-list").text_content()


def test_entre_aspas_conta_so_a_palavra_inteira(abrir):
    pg = abrir()
    sem_aspas = _lista(pg, "residência")
    assert "Art. 3 —" in sem_aspas      # só "presidência"
    com_aspas = _lista(pg, '"residência"')
    assert "Art. 126 —" in com_aspas and "Art. 67 —" in com_aspas
    assert "Art. 3 —" not in com_aspas
    assert "Art. 149 —" not in com_aspas     # LOM 149: só "residencial"
    # o destaque acompanha: nenhuma marca em presidência
    marcas = pg.evaluate("""() => { const s = new Set();
      for (const h of CSS.highlights.values()) for (const r of h)
        s.add(r.startContainer.data.slice(r.startOffset, r.endOffset).toLowerCase());
      return [...s]; }""")
    assert marcas == ["residência"]


def test_entre_aspas_um_numero_nao_casa_com_outro(abrir):
    pg = abrir()
    lista = _lista(pg, '"art. 4"')
    assert "Art. 4 —" in lista          # Art. 4°: o sinal depois do número não faz dele outro
    assert "Art. 43 —" not in lista


def test_entre_aspas_vale_tambem_nos_indices(abrir):
    pg = abrir()
    entradas = lambda lista: int(re.search(r"Índice remissivo · (\d+)", lista, re.I).group(1))
    com_aspas = _lista(pg, '"residência"')
    assert "Residência no Município" in com_aspas
    assert entradas(com_aspas) < entradas(_lista(pg, "residência"))


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
    pg.wait_for_function("!window.earlyIndex")
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
    # a busca filtra os cards: espera o filtro, e marca-se o 1º que sobrou (antes, uma corrida)
    pg.wait_for_function(r"/\d+ \/ \d+/.test(document.getElementById('search-counter').textContent)")
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
    uid = pg.evaluate("document.querySelector('.card-artigo:not(.filtered-out) .unit-id').dataset.uid")
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


def test_copiar_marcados_na_ordem_hierarquica(abrir):
    """CF, CE, LOM, RI e precedentes, de cima para baixo na hierarquia, qualquer que seja a
    ordem da página."""
    pg = abrir(permissions=["clipboard-read", "clipboard-write"])
    uids = pg.evaluate("""() => ['RI', 'LOM', 'CE', 'CF', 'PREC'].map(law => document.querySelector(
      law === 'RI' ? '.card-artigo:not([data-law]) .unit-id' : `.card-artigo[data-law="${law}"] .unit-id`
    ).dataset.uid)""")
    pg.evaluate("uids => localStorage.setItem('regimento-markers-v2', JSON.stringify("
                "uids.map(uid => ({ uid, colorIdx: 0 }))))", uids)
    pg.reload()
    pg.wait_for_function("!window.earlyIndex")
    pg.click("#marker-copy-btn")
    pg.wait_for_function("document.getElementById('marker-copy-btn').classList.contains('copied')")
    texto = pg.evaluate("navigator.clipboard.readText()")
    nomes = ["Constituição Federal", "Constituição do Estado", "Lei Orgânica", "Regimento Interno",
             "Precedente Regimental"]
    frase = texto.splitlines()[0]
    assert [frase.index(n) for n in nomes] == sorted(frase.index(n) for n in nomes), frase
    normas = ["Constituição Federal", "Constituição do Estado de São Paulo",
              "Lei Orgânica do Município", "Regimento Interno"]
    assert [linha for linha in texto.splitlines() if linha in normas] == normas, texto


def _marcados(pg) -> list[str]:
    return pg.evaluate("JSON.parse(localStorage.getItem('regimento-markers-v2') || '[]').map(m => m.uid)")


def _com_marcados(pg, n: int = 4) -> list[str]:
    """O caput dos n primeiros artigos do RI marcado, cada um numa cor."""
    uids = pg.evaluate("n => [...document.querySelectorAll('.card-artigo:not([data-law])')].slice(0, n)"
                       ".map(c => c.querySelector('.unit-id').dataset.uid)", n)
    pg.evaluate("uids => localStorage.setItem('regimento-markers-v2', JSON.stringify("
                "uids.map((uid, colorIdx) => ({ uid, colorIdx }))))", uids)
    pg.reload()
    pg.wait_for_function("!window.earlyIndex")
    assert pg.locator("#marker-nav .marker-btn").count() == n
    return uids


def _centro(pg, seletor: str) -> tuple[float, float]:
    r = pg.locator(seletor).first.bounding_box()
    return r["x"] + r["width"] / 2, r["y"] + r["height"] / 2


def _fita(i: int) -> str:
    return f"#marker-nav .marker-btn >> nth={i}"


def _arrasta_com_o_mouse(pg, de: str, para: str) -> None:
    x0, y0 = _centro(pg, de)
    x1, y1 = _centro(pg, para)
    pg.mouse.move(x0, y0)
    pg.mouse.down()
    pg.mouse.move(x1, y1, steps=10)
    pg.mouse.up()


class _Dedo:
    """Toque de verdade (CDP): passa pelos gestos do Chrome, então o preventDefault e a rolagem contam."""

    def __init__(self, pg):
        self.pg = pg
        self.cdp = pg.context.new_cdp_session(pg)

    def _toque(self, tipo: str, pontos: list) -> None:
        self.cdp.send("Input.dispatchTouchEvent", {"type": tipo, "touchPoints": [{"x": x, "y": y} for x, y in pontos]})

    def baixa(self, x: float, y: float) -> None:
        self._toque("touchStart", [(x, y)])

    def move(self, x0: float, y0: float, x1: float, y1: float, passos: int = 12) -> None:
        for i in range(1, passos + 1):
            self._toque("touchMove", [(x0 + (x1 - x0) * i / passos, y0 + (y1 - y0) * i / passos)])
            self.pg.wait_for_timeout(16)

    def sobe(self) -> None:
        self._toque("touchEnd", [])


def _celular(abrir):
    return abrir(largura=384, altura=780, has_touch=True, is_mobile=True)


def test_arrastar_a_fita_com_o_mouse_muda_a_ordem_e_fica_salvo(abrir):
    pg = abrir()
    a, b, c, d = _com_marcados(pg)
    _arrasta_com_o_mouse(pg, _fita(0), _fita(2))
    fitas = "[...document.querySelectorAll('.marker-btn')].map(e => e.dataset.uid)"
    assert _marcados(pg) == [b, c, a, d]
    assert pg.evaluate(fitas) == [b, c, a, d]
    pg.reload()
    pg.wait_for_function("!window.earlyIndex")
    assert pg.evaluate(fitas) == [b, c, a, d]


def test_soltar_no_x_remove_so_aquela_e_desfazer_a_devolve_no_lugar(abrir):
    pg = abrir()
    a, b, c, d = _com_marcados(pg)
    _arrasta_com_o_mouse(pg, _fita(1), "#marker-clear-all")
    assert _marcados(pg) == [a, c, d]
    assert "removido" in pg.inner_text("#marker-undo")
    pg.click("#marker-undo button")
    assert _marcados(pg) == [a, b, c, d]
    assert pg.evaluate("JSON.parse(localStorage.getItem('regimento-markers-v2'))[1].colorIdx") == 1
    assert not pg.locator("#marker-undo").is_visible()


def test_apagar_todos_e_desmarcar_no_texto_tambem_se_desfazem(abrir):
    pg = abrir()
    uids = _com_marcados(pg)
    pg.click("#marker-clear-all")
    assert _marcados(pg) == []
    assert "4 marcadores removidos" in pg.inner_text("#marker-undo")
    pg.click("#marker-undo button")
    assert _marcados(pg) == uids
    alvo = pg.locator(f'.unit-id[data-uid="{uids[1]}"]')
    alvo.scroll_into_view_if_needed()
    alvo.click()
    assert uids[1] not in _marcados(pg)
    pg.click("#marker-undo button")
    assert _marcados(pg) == uids


def test_marcar_de_novo_tira_o_desfazer_para_nao_voltar_a_uma_lista_velha(abrir):
    pg = abrir()
    uids = _com_marcados(pg)
    pg.click("#marker-clear-all")
    assert pg.locator("#marker-undo").is_visible()
    alvo = pg.locator(f'.unit-id[data-uid="{uids[0]}"]')
    alvo.scroll_into_view_if_needed()
    alvo.click()
    assert not pg.locator("#marker-undo").is_visible()


def test_desfazer_devolve_marcados_a_barra_de_busca(abrir):
    pg = abrir()
    _com_marcados(pg, 2)
    pg.click("#marker-filter-btn")
    assert pg.locator("#search-chip").is_visible()
    pg.click("#marker-clear-all")
    assert not pg.locator("#search-chip").is_visible()
    pg.click("#marker-undo button")
    assert pg.locator("#search-chip").is_visible()


def test_com_o_dedo_segurar_e_arrastar_reordena_sem_rolar(abrir):
    pg = _celular(abrir)
    a, b, c, d = _com_marcados(pg)
    dedo = _Dedo(pg)
    pg.evaluate("scrollTo(0, 3000)")
    pg.wait_for_timeout(300)
    rolagem = pg.evaluate("scrollY")
    x, y = _centro(pg, _fita(0))
    _, y2 = _centro(pg, _fita(2))
    dedo.baixa(x, y)
    pg.wait_for_timeout(500)
    assert pg.locator(_fita(0)).evaluate("e => e.classList.contains('lifted')")
    dedo.move(x, y, x, y2)
    dedo.sobe()
    pg.wait_for_timeout(200)
    assert _marcados(pg) == [b, c, a, d]
    assert pg.evaluate("scrollY") == rolagem


def test_com_o_dedo_segurar_e_soltar_parado_nao_muda_nada(abrir):
    pg = _celular(abrir)
    uids = _com_marcados(pg)
    dedo = _Dedo(pg)
    x, y = _centro(pg, _fita(0))
    dedo.baixa(x, y)
    pg.wait_for_timeout(700)
    assert pg.locator("#marker-tooltip").is_visible()
    dedo.sobe()
    pg.wait_for_timeout(300)
    assert _marcados(pg) == uids
    assert not pg.locator("#marker-tooltip").is_visible()


def test_com_o_dedo_sem_segurar_a_fita_rola_a_pagina(abrir):
    pg = _celular(abrir)
    uids = _com_marcados(pg)
    dedo = _Dedo(pg)
    pg.evaluate("scrollTo(0, 3000)")
    pg.wait_for_timeout(300)
    rolagem = pg.evaluate("scrollY")
    x, y = _centro(pg, _fita(1))
    dedo.baixa(x, y)
    dedo.move(x, y, x, y - 250)
    dedo.sobe()
    pg.wait_for_timeout(800)
    assert pg.evaluate("scrollY") != rolagem
    assert _marcados(pg) == uids


def test_com_o_dedo_o_toque_curto_ainda_leva_ao_dispositivo(abrir):
    pg = _celular(abrir)
    _com_marcados(pg)
    dedo = _Dedo(pg)
    pg.evaluate("scrollTo(0, 30000)")
    pg.wait_for_timeout(300)
    rolagem = pg.evaluate("scrollY")
    x, y = _centro(pg, _fita(0))
    dedo.baixa(x, y)
    pg.wait_for_timeout(40)
    dedo.sobe()
    pg.wait_for_timeout(800)
    assert pg.evaluate("scrollY") < rolagem


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


def test_contagens_da_faixa_escritas_no_build_batem_com_a_tabela(abrir):
    """A linha da faixa vem pronta no HTML (render_html.py); a tabela, o script monta com a mesma conta."""
    pg = abrir()
    soma = pg.locator(".card-artigo .idx-sum").first
    soma.scroll_into_view_if_needed()
    soma.click()
    pg.wait_for_selector(".idx-row", state="attached")
    erradas = pg.evaluate("""() => [...document.querySelectorAll('.idx-backlinks')].filter(b => {
        const [assuntos, entradas] = b.querySelector('.idx-sum').dataset.label.match(/[0-9]+/g).map(Number);
        return b.querySelectorAll(':scope > .idx-row').length !== assuntos
          || b.querySelectorAll('.idx-back').length !== entradas;
      }).map(b => b.parentNode.dataset.art + ' ' + b.querySelector('.idx-sum').dataset.label)""")
    assert pg.locator(".idx-backlinks").count() > 500
    assert erradas == []


def test_metadados_de_compartilhamento(abrir, site):
    pg = abrir()
    assert pg.get_attribute('meta[property="og:image"]', "content").endswith("/img/compartilhar.png")
    base = site.rsplit("/", 1)[0]
    for nome in ("img/compartilhar.png", "img/icone-180.png"):
        r = pg.request.get(f"{base}/{nome}")
        assert r.status == 200 and r.headers["content-type"] == "image/png", nome


def test_clique_num_artigo_no_modo_compacto_sai_dele_com_o_artigo_na_linha_de_leitura(abrir):
    pg = abrir()
    pg.click("#btn-compact")
    pg.mouse.wheel(0, 3000)
    pg.wait_for_timeout(300)
    # um artigo na metade de baixo da tela, longe da linha de leitura
    alvo = pg.evaluate("""() => {
      const h = innerHeight;
      const c = [...document.querySelectorAll('#cards-container .card-artigo')].find(c => {
        const r = c.getBoundingClientRect(); return r.top > h * .6 && r.bottom < h * .9; });
      c.querySelector('.art-summary').click();
      return [c.dataset.law || 'RI', c.dataset.art];
    }""")
    assert "compact" not in pg.get_attribute("#cards-container", "class")
    assert selecionado(pg) == tuple(alvo)
    topo = pg.evaluate("document.querySelector('.card.selected').getBoundingClientRect().top")
    assert abs(topo - 860 * .25) < 2


def test_clique_no_numero_do_artigo_no_modo_compacto_marca_sem_sair(abrir):
    pg = abrir()
    pg.click("#btn-compact")
    pg.locator("#cards-container .card-artigo .art-compact-label").nth(3).click()
    assert "compact" in pg.get_attribute("#cards-container", "class")
