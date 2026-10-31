"""Endereço do processo para os links do DOCX que citam uma ação e não levam a ela.

Os textos copiados da ALESP e do Planalto citam a ação ("ADI n° 6517", "(Vide ADIN 3133)",
"SL n° 1305", "ADI n° 2044985-25.2020.8.26.0000") com um link para a página inicial do tribunal,
para o portal antigo do STF (verPeticaoInicial.asp, que hoje dá 404) ou, na CE 180, com um
endereço quebrado ("http://- Inciso VII declarado..."). Nesses casos o link passa a abrir o
processo: no STF pela classe e o número; no TJSP pela busca do e-SAJ pelo número unificado. O texto
não muda (é link, não texto: ver "texto fiel à fonte"), e os outros links ficam como estão.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

STF = "https://portal.stf.jus.br/processos/listarProcessos.asp?classe={classe}&numeroProcesso={numero}"
ESAJ = ("https://esaj.tjsp.jus.br/cposg/search.do?conversationId=&paginaConsulta=0&cbPesquisa=NUMPROC"
        "&numeroDigitoAnoUnificado={ano}&foroNumeroUnificado={foro}&dePesquisaNuUnificado={numero}"
        "&dePesquisaNuUnificado=UNIFICADO&dePesquisa=&tipoNuProcesso=UNIFICADO")

# página inicial de um tribunal: o link não leva à ação citada
_INICIAL = re.compile(r"https?://(?:www\.|portal\.)?(?:stf|tjsp)\.jus\.br/?", re.I)
# portal antigo do STF: verPeticaoInicial.asp?base=ADI&s1=3133&processo=3133
_STF_ANTIGO = re.compile(r"https?://(?:www\.)?stf\.jus\.br/portal/peticaoInicial/", re.I)
# número unificado de processo do TJSP: 2044985-25.2020.8.26.0000
_CNJ_TJSP = re.compile(r"\b(\d{7}-\d{2}\.\d{4})\.8\.26\.(\d{4})\b")
# ação do STF no texto do link: "ADI n° 4.776", "(Vide ADIN 3133)", "SL n° 1305", "(Vide ADPF 672)"
_ACAO_STF = re.compile(r"\b(ADIN|ADI|ADPF|ADC|ADO|SL|SS|STA|Rcl|ARE|RE)\s*(?:n\s*[º°o.]\s*)?(\d+(?:\.\d{3})*)\b",
                       re.I)
_CLASSE = {"ADIN": "ADI", "RCL": "Rcl"}


def valido(url: str) -> bool:
    """Endereço que um navegador abre: http(s) com domínio, sem espaço (ou mailto:)."""
    if url.startswith("mailto:"):
        return True
    host = urlparse(url).hostname or ""
    return url.startswith(("http://", "https://")) and "." in host and not re.search(r"\s", url)


def _stf(classe: str, numero: str) -> str:
    classe = classe.upper()
    return STF.format(classe=_CLASSE.get(classe, classe), numero=numero.replace(".", ""))


def corrigir(url: str, texto: str) -> str:
    """O endereço do processo citado em texto, se url não leva a ele; senão, url."""
    if not url:
        return url
    antigo = _STF_ANTIGO.match(url)
    if antigo:
        q = parse_qs(urlparse(url).query)
        classe = (q.get("base") or [""])[0]
        numero = next((q[k][0] for k in ("processo", "numProcesso", "s1") if q.get(k, [""])[0].isdigit()), "")
        if classe.isalpha() and numero:
            return _stf(classe, numero)
    if antigo or _INICIAL.fullmatch(url) or not valido(url):
        m = _CNJ_TJSP.search(texto)
        if m:
            return ESAJ.format(ano=m.group(1), foro=m.group(2), numero=m.group(0))
        m = _ACAO_STF.search(texto)
        if m:
            return _stf(m.group(1), m.group(2))
    return url
