"""Testes de integração: parseia DOCX real e valida invariantes."""

from __future__ import annotations

from collections import Counter

import pytest

from src.models import ArticleBlock, SectionHeading

pytestmark = pytest.mark.integration


# ── Contagens ───────────────────────────────────────────────────────────

class TestArticleCounts:
    def test_total_artigos_regulares(self, resolved_doc):
        """720 artigos regulares (Regimento + Lei Orgânica + 79 da CF), fora os precedentes."""
        arts = [e for e in resolved_doc.elements
                if isinstance(e, ArticleBlock) and not e.is_adt and e.law_prefix != "PREC"]
        assert len(arts) == 720

    def test_artigos_por_lei(self, resolved_doc):
        """Distribuição por lei: RI=397, LO=244, CF=79 (os artigos relevantes para o RI e a LOM)."""
        arts = [e for e in resolved_doc.elements if isinstance(e, ArticleBlock) and not e.is_adt]
        by_law = Counter(a.law_name for a in arts)
        assert by_law["Regimento Interno"] == 397
        assert by_law["Lei Orgânica"] == 244
        assert by_law["Constituição Federal"] == 79

    def test_artigos_letrados(self, resolved_doc):
        """9 artigos letrados: RI 183-A e 212-A; LOM 55-A, 69-A, 101-A, 149-A, 229-A e 229-B; CF 29-A."""
        lettered = {
            (e.law_name, e.art_number) for e in resolved_doc.elements
            if isinstance(e, ArticleBlock) and not e.is_adt and "-" in e.art_number
        }
        expected = {("Regimento Interno", n) for n in ("183-A", "212-A")}
        expected |= {("Lei Orgânica", n) for n in ("55-A", "69-A", "101-A", "149-A", "229-A", "229-B")}
        expected |= {("Constituição Federal", "29-A")}
        assert lettered == expected

    def test_artigos_adt(self, resolved_doc):
        """53 artigos de disposições transitórias: 14 do ADT do RI e 39 das DGT da LOM."""
        adts = [e for e in resolved_doc.elements if isinstance(e, ArticleBlock) and e.is_adt]
        assert Counter(a.law_name for a in adts) == {"Regimento Interno": 14, "Lei Orgânica": 39}

    def test_artigos_com_versoes(self, resolved_doc):
        """66 artigos com múltiplas versões do caput."""
        versioned = [
            e for e in resolved_doc.elements
            if isinstance(e, ArticleBlock) and len(e.all_versions) > 0
        ]
        assert len(versioned) == 66


# ── Dispositivos conferidos na Fase 0 ───────────────────────────────────

def _art(doc, law, number):
    return next(e for e in doc.elements
                if isinstance(e, ArticleBlock) and e.law_name == law and e.art_number == number)


def _vigentes(art, ident):
    return [c for c in art.children if c.identifier == ident and not c.is_old_version]


class TestDispositivosConferidos:
    def test_ri_47_primeiro_xi_revogado(self, resolved_doc):
        """O XI da Comissão da Criança e do Adolescente (revogado) está tachado; só um XI vigente."""
        xis = _vigentes(_art(resolved_doc, "Regimento Interno", "47"), "XI")
        assert len(xis) == 1 and "Meio Ambiente" in xis[0].full_text

    def test_ri_283_um_inciso_iv(self, resolved_doc):
        """O 2º IV (cópia do art. 284, IV, revogado, colada por erro no PLP) foi suprimido."""
        (iv,) = _vigentes(_art(resolved_doc, "Regimento Interno", "283"), "IV")
        assert "Pequeno Expediente" in iv.full_text

    def test_lom_42_paragrafo_1_e_1a(self, resolved_doc):
        art = _art(resolved_doc, "Lei Orgânica", "42")
        assert len(_vigentes(art, "§ 1º")) == 1
        (p1a,) = _vigentes(art, "§ 1º-A")
        assert p1a.uid == "art42p1A"

    def test_lom_88_redacao_da_elo_36_vigente(self, resolved_doc):
        """A redação da ELO 39/2015 foi anulada por ADIN (tachada); vale a da ELO 36/2013."""
        art = _art(resolved_doc, "Lei Orgânica", "88")
        for ident in ("§ 1º", "I", "II"):
            (vig,) = _vigentes(art, ident)
            assert "39" not in vig.amendment_note
        assert all("pelo menos" in c.full_text for c in _vigentes(art, "I") + _vigentes(art, "II"))

    def test_lom_35_incisos_revogados(self, resolved_doc):
        art = _art(resolved_doc, "Lei Orgânica", "35")
        assert not _vigentes(art, "I") and not _vigentes(art, "II")

    def test_lom_51_revogado(self, resolved_doc):
        assert _art(resolved_doc, "Lei Orgânica", "51").is_revoked


# ── Integridade estrutural ──────────────────────────────────────────────

class TestStructuralIntegrity:
    def test_todo_artigo_tem_caput(self, resolved_doc):
        for el in resolved_doc.elements:
            if isinstance(el, ArticleBlock):
                assert el.caput is not None, f"Art. {el.art_number} sem caput"

    def test_uids_unicos_por_lei(self, resolved_doc):
        """UIDs (caput + children) são únicos dentro de cada law_name."""
        by_law: dict[str, set[str]] = {}
        for el in resolved_doc.elements:
            if not isinstance(el, ArticleBlock):
                continue
            law = el.law_name
            seen = by_law.setdefault(law, set())
            if el.caput:
                uid = el.caput.uid
                assert uid not in seen, f"UID duplicado em '{law}': {uid}"
                seen.add(uid)
            for child in el.children:
                uid = child.uid
                assert uid not in seen, f"UID duplicado em '{law}': {uid}"
                seen.add(uid)

    def test_art_numbers_unicos_por_lei(self, resolved_doc):
        """Cada art_number aparece uma só vez dentro de cada law_name."""
        by_law: dict[str, list[str]] = {}
        for e in resolved_doc.elements:
            if isinstance(e, ArticleBlock):
                by_law.setdefault(e.law_name, []).append(e.art_number)
        for law, nums in by_law.items():
            assert len(nums) == len(set(nums)), (
                f"art_numbers duplicados em '{law}': "
                f"{[n for n in nums if nums.count(n) > 1]}"
            )

    def test_adt_tem_prefixo(self, resolved_doc):
        for el in resolved_doc.elements:
            if isinstance(el, ArticleBlock) and el.is_adt:
                assert el.art_number.startswith("ADT"), f"ADT sem prefixo: {el.art_number}"


# ── Serialização ────────────────────────────────────────────────────────

class TestSerialization:
    def test_to_dict_sem_erro(self, resolved_doc):
        d = resolved_doc.to_dict()
        assert "elements" in d
        assert len(d["elements"]) > 0


# ── Hyperlinks (tolerância ±5%) ─────────────────────────────────────────

class TestHyperlinks:
    def test_hyperlinks_externos(self, resolved_doc):
        """~2093 hyperlinks externos (tolerância 5%)."""
        count = 0
        for el in resolved_doc.elements:
            if not isinstance(el, ArticleBlock):
                continue
            for unit in _all_units(el):
                for run in unit.runs:
                    if run.hyperlink_url:
                        count += 1
        assert count == pytest.approx(2093, rel=0.05), f"Hyperlinks externos: {count}"

    def test_anchors_internos(self, resolved_doc):
        """~526 links com âncora (#art369 etc.; tolerância 5%)."""
        count = 0
        for el in resolved_doc.elements:
            if not isinstance(el, ArticleBlock):
                continue
            for unit in _all_units(el):
                for run in unit.runs:
                    if run.hyperlink_anchor:
                        count += 1
        assert count == pytest.approx(526, rel=0.05), f"Âncoras internas: {count}"


def _all_units(art: ArticleBlock):
    """Itera por todas as DocumentUnits de um ArticleBlock."""
    if art.caput:
        yield art.caput
    yield from art.children
    yield from art.all_versions


# ── Remissões explícitas ────────────────────────────────────────────────

class TestRemissoes:
    @pytest.fixture(scope="class")
    def remissoes(self, resolved_doc):
        from pathlib import Path
        from src.remissoes import carregar_excecoes, detectar
        root = Path(__file__).resolve().parent.parent
        return detectar(resolved_doc, carregar_excecoes(root / "remissoes_excecoes.toml"))

    def _alvos(self, remissoes, origem):
        return [a.ref for r in remissoes.remissoes if r.origem.ref == origem and r.exibivel for a in r.alvos]

    def test_quantidade(self, remissoes):
        """~247 citações entre artigos viram gatilho (tolerância 10%), fora as dos precedentes e a eles.

        Com os artigos da CF na página, as citações a eles na LOM e no RI também viram gatilho."""
        prec = lambda r: r.origem.law == "PREC" or any(a.law == "PREC" for a in r.alvos)
        n = sum(1 for r in remissoes.remissoes if r.exibivel and not prec(r))
        assert n == pytest.approx(247, rel=0.10), n
        n_prec = sum(1 for r in remissoes.remissoes if r.exibivel and prec(r))
        assert n_prec == pytest.approx(137, rel=0.10), n_prec

    def test_sem_avisos(self, remissoes):
        assert remissoes.avisos == []

    def test_exemplo_do_usuario(self, remissoes):
        """RI art. 18, VI cita o art. 369."""
        assert self._alvos(remissoes, "18,VI") == ["369"]

    def test_cruzada_ri_lom(self, remissoes):
        assert self._alvos(remissoes, "13,I,d") == ["LOM:18,III", "LOM:18,IV", "LOM:18,V"]

    def test_excecoes_aplicadas(self, remissoes):
        assert self._alvos(remissoes, "262") == ["261,§ 2º"]
        assert "LOM:ADT26" in self._alvos(remissoes, "LOM:ADT29")

    def test_dgt_que_citam_a_ec_103_sao_externas(self, remissoes):
        assert self._alvos(remissoes, "LOM:ADT26,I") == []

    def test_render_real_preserva_texto_e_links(self, resolved_doc, remissoes):
        """Com e sem os gatilhos: mesmo texto, nenhum link dentro de link, os mesmos links oficiais."""
        import re as _re
        from html.parser import HTMLParser
        from src.render_html import HTMLRenderer

        com = HTMLRenderer(remissoes).render(resolved_doc)
        sem = HTMLRenderer().render(resolved_doc)

        class Texto(HTMLParser):
            def __init__(self):
                super().__init__()
                self.parts, self.hrefs, self.depth, self.nested = [], [], 0, 0

            def handle_starttag(self, tag, attrs):
                a = dict(attrs)
                if tag == "a":
                    self.nested += self.depth > 0
                    self.depth += 1
                    self.hrefs.append(a.get("href"))

            def handle_endtag(self, tag):
                if tag == "a":
                    self.depth -= 1

            def handle_data(self, data):
                self.parts.append(data)

        pc, ps = Texto(), Texto()
        pc.feed(com)
        ps.feed(sem)
        assert pc.nested == 0
        # (o "Citado em:" só acrescenta espaços: os rótulos são CSS)
        assert _re.sub(r"\s+", " ", "".join(pc.parts)) == _re.sub(r"\s+", " ", "".join(ps.parts))
        n_gatilhos = com.count('class="rem rem-exp"')
        assert n_gatilhos == sum(1 for r in remissoes.remissoes if r.exibivel)
        # by provision: no official link lost (the trigger keeps the original links inside)
        from collections import Counter
        pat = _re.compile(r'<p[ >].*?</p>', _re.S)
        hrefs = lambda p: Counter(_re.findall(r'<a href="([^"]+)"', p))
        perdidos = [(h, n) for p_sem, p_com in zip(pat.findall(sem), pat.findall(com))
                    for h, n in (hrefs(p_sem) - hrefs(p_com)).items()]
        assert not perdidos, perdidos[:5]

    def test_dgt_que_citam_a_ec_103_existem_como_externas(self, remissoes):
        ext = [r for r in remissoes.remissoes if r.origem.ref == "LOM:ADT26,I"]
        assert ext and all(r.classe == "externa" for r in ext)


# ── Precedentes Regimentais ─────────────────────────────────────────────

class TestPrecedentes:
    ORDEM = ["2/1993", "4/1993", "0/1997", "1/2001", "2/2001", "1/2002", "2/2002", "1/2004", "2/2004",
             "3/2004", "1/2007", "1/2015", "1/2019", "2/2019", "1/2020", "2/2020", "1/2021", "2/2021",
             "3/2021", "1/2026"]

    @pytest.fixture(scope="class")
    def precs(self, resolved_doc):
        return [e for e in resolved_doc.elements if isinstance(e, ArticleBlock) and e.law_prefix == "PREC"]

    def test_todos_em_ordem_cronologica(self, precs):
        assert [p.art_number for p in precs] == self.ORDEM

    def test_sintese_texto_e_fonte(self, precs):
        assert all(p.summary and p.children for p in precs)
        assert [p.art_number for p in precs if not p.source_url] == ["1/2026"]   # ainda fora do SAGAL

    def test_vides_do_regimento_resolvem(self, resolved_doc):
        from src.remissoes import detectar
        res = detectar(resolved_doc)
        vides = [r for r in res.remissoes if r.origem.law != "PREC" and any(a.law == "PREC" for a in r.alvos)]
        assert len(vides) == 55 and all(r.exibivel for r in vides)
        cit = res.citado_em()
        for art in ("294", "295", "296"):     # o 1/2026 aparece nos três artigos que indica
            assert "PREC:1/2026" in [o.ref for o in cit[("RI", art)]]

    def test_redacoes_dadas_por_outro_precedente(self, precs):
        """Compilados como no PLP: 1/2015 itens 6 e 13 (pelo 1/2019) e 2/2020 item 6 (pelo 3/2021)."""
        by = {p.art_number: p for p in precs}
        olds = {k: [c.full_text[:3] for c in by[k].children if c.is_old_version] for k in ("1/2015", "2/2020")}
        assert olds == {"1/2015": ["6) ", "13)"], "2/2020": ["6 -"]}
        notas = {k: sum("(Redação dada pelo Precedente Regimental nº " + n in c.full_text for c in by[k].children)
                 for k, n in (("1/2015", "1/2019)"), ("2/2020", "3/2021)"))}
        assert notas == {"1/2015": 2, "2/2020": 2}


# ── Legislação correlata (notas "L") ────────────────────────────────────

class TestLegislacaoCorrelata:
    def test_notas_l_com_link(self, resolved_doc):
        units = [u for e in resolved_doc.elements if isinstance(e, ArticleBlock)
                 for u in [e.caput, *e.children] if u and u.legislacao]
        normas = [p for u in units for p in u.legislacao]
        assert len(units) == pytest.approx(247, rel=0.10) and len(normas) == pytest.approx(399, rel=0.10)
        assert all(any(r.hyperlink_url for r in p.runs) for p in normas)
        # a do exemplo do usuário
        a105 = next(e for e in resolved_doc.elements if isinstance(e, ArticleBlock)
                    and e.law_name == "Regimento Interno" and e.art_number == "105")
        xxx = next(c for c in a105.children if c.identifier == "XXX" and not c.is_old_version)
        assert any("14.454" in "".join(r.text for r in p.runs) for p in xxx.legislacao)
