"""Links de ação que passam a abrir o processo (src/links.py)."""

import pytest

from src.links import ESAJ, STF, corrigir, valido

pytestmark = pytest.mark.unit


def stf(classe, numero):
    return STF.format(classe=classe, numero=numero)


class TestCorrigir:
    def test_pagina_inicial_do_stf_com_adi(self):
        assert corrigir("https://portal.stf.jus.br/", "ADI n° 6517") == stf("ADI", "6517")
        assert corrigir("http://portal.stf.jus.br/", "ADI n° 4.776") == stf("ADI", "4776")

    def test_suspensao_de_liminar(self):
        assert corrigir("https://portal.stf.jus.br/", "SL n° 1305") == stf("SL", "1305")

    def test_portal_antigo_do_stf_pela_consulta(self):
        url = ("http://www.stf.jus.br/portal/peticaoInicial/verPeticaoInicial.asp"
               "?base=ADIN&s1=4307&processo=4307")
        assert corrigir(url, "(Vide ADIN 4307)") == stf("ADI", "4307")
        url = ("http://www.stf.jus.br/portal/peticaoInicial/verPeticaoInicial.asp"
               "?base=ADPF&documento=&s1=672&numProcesso=672")
        assert corrigir(url, "(Vide ADPF 672)") == stf("ADPF", "672")

    def test_endereco_quebrado_da_ce_180(self):
        url = "http://- Inciso VII declarado inconstitucional, em controle concentrado, pelo STF"
        assert corrigir(url, "ADI n° 6602") == stf("ADI", "6602")

    def test_pagina_inicial_do_tjsp_com_numero_unificado(self):
        esperado = ESAJ.format(ano="2044985-25.2020", foro="0000", numero="2044985-25.2020.8.26.0000")
        assert corrigir("https://www.tjsp.jus.br/", "ADI n° 2044985-25.2020.8.26.0000") == esperado

    def test_link_que_ja_leva_ao_processo_fica(self):
        url = "https://esaj.tjsp.jus.br/cposg/show.do?processo.codigo=RI008G5OU0000"
        assert corrigir(url, "ADIN n° 2347876-04.2024.8.26.000") == url
        url = "https://portal.stf.jus.br/processos/detalhe.asp?incidente=11299"
        assert corrigir(url, "ADI n° 1021") == url

    def test_pagina_inicial_sem_acao_no_texto_fica(self):
        assert corrigir("https://portal.stf.jus.br/", "Supremo Tribunal Federal") == "https://portal.stf.jus.br/"

    def test_outros_links_ficam(self):
        url = "https://www.planalto.gov.br/ccivil_03/constituicao/Emendas/Emc/emc19.htm#art2"
        assert corrigir(url, "(Redação dada pela Emenda Constitucional nº 19, de 1998)") == url
        assert corrigir("", "ADI n° 1") == ""


class TestValido:
    @pytest.mark.parametrize("url", [
        "https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm",
        "http://app-plpconsulta-prd.azurewebsites.net/Forms/MostrarArquivo?TIPO=LOM&NUMERO=0&ANO=1990",
        "mailto:alguem@exemplo.com",
    ])
    def test_validos(self, url):
        assert valido(url)

    @pytest.mark.parametrize("url", [
        "http://- Inciso VII declarado inconstitucional",
        "http://localhost/",
        "www.planalto.gov.br/ccivil_03",
        "https://www.planalto.gov.br/a b",
    ])
    def test_invalidos(self, url):
        assert not valido(url)
