"""Teste de snapshot: compara resumo estrutural com golden file."""

from __future__ import annotations

import json

import pytest

from src.models import ArticleBlock
from tests.conftest import load_golden, save_golden

pytestmark = pytest.mark.snapshot

SNAPSHOT_NAME = "structure"


def _build_summary(resolved_doc) -> dict:
    """Gera resumo estrutural compacto do documento."""
    articles = []
    for el in resolved_doc.elements:
        if not isinstance(el, ArticleBlock):
            continue
        uids = []
        if el.caput:
            uids.append(el.caput.uid)
        for child in el.children:
            uids.append(child.uid)

        entry = {
            "art_number": el.art_number,
            "is_adt": el.is_adt,
            "uids": uids,
            "children_count": len(el.children),
            "versions_count": len(el.all_versions),
        }
        if el.is_revoked:
            entry["is_revoked"] = True
        if el.summary:
            entry["has_summary"] = True
        articles.append(entry)

    return {
        "total_articles": len(articles),
        "articles": articles,
    }


class TestSnapshot:
    def test_structural_snapshot(self, resolved_doc, update_snapshots):
        summary = _build_summary(resolved_doc)
        golden = load_golden(SNAPSHOT_NAME)

        if golden is None or update_snapshots:
            path = save_golden(SNAPSHOT_NAME, summary)
            if golden is None:
                pytest.skip(f"Golden file criado em {path}. Re-rode o teste.")
            # update_snapshots=True: salva e passa
            return

        # Compara
        assert summary["total_articles"] == golden["total_articles"], (
            f"Total de artigos mudou: {golden['total_articles']} → {summary['total_articles']}"
        )

        golden_arts = {a["art_number"]: a for a in golden["articles"]}
        summary_arts = {a["art_number"]: a for a in summary["articles"]}

        # Artigos adicionados ou removidos
        added = set(summary_arts) - set(golden_arts)
        removed = set(golden_arts) - set(summary_arts)
        assert not added, f"Artigos novos inesperados: {added}"
        assert not removed, f"Artigos removidos inesperados: {removed}"

        # Compara cada artigo
        diffs = []
        for art_num, s_art in summary_arts.items():
            g_art = golden_arts[art_num]
            if s_art != g_art:
                diffs.append({
                    "art_number": art_num,
                    "expected": g_art,
                    "actual": s_art,
                })

        if diffs:
            diff_summary = json.dumps(diffs[:10], ensure_ascii=False, indent=2)
            pytest.fail(
                f"{len(diffs)} artigo(s) diferem do snapshot.\n"
                f"Rode `pytest -m snapshot --update-snapshots` para atualizar.\n"
                f"Primeiras diferenças:\n{diff_summary}"
            )
