"""Fixtures compartilhadas para os testes do parser DOCX."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Garante que o diretório raiz do projeto esteja no sys.path
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.models import TextRun, UnitType
from src.parse_docx import _RawParagraph, _ClassifiedParagraph

SNAPSHOTS_DIR = Path(__file__).resolve().parent / "snapshots"


# ── CLI flag ────────────────────────────────────────────────────────────

def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--update-snapshots",
        action="store_true",
        default=False,
        help="Regenera os golden files de snapshot.",
    )


@pytest.fixture(scope="session")
def update_snapshots(request: pytest.FixtureRequest) -> bool:
    return bool(request.config.getoption("--update-snapshots"))


# ── Factories ───────────────────────────────────────────────────────────

@pytest.fixture
def make_raw():
    """Factory para _RawParagraph com defaults sensatos."""

    def _factory(
        text: str,
        *,
        is_centered: bool = False,
        has_strike: bool = False,
        indent_left: int = 0,
        bookmark_name: str = "",
        footnote_ids: list[int] | None = None,
        runs: list[TextRun] | None = None,
        bold: bool = False,
        italic: bool = False,
        strike: bool = False,
    ) -> _RawParagraph:
        if runs is None:
            runs = [TextRun(text=text, bold=bold, italic=italic, strike=strike)]
        return _RawParagraph(
            text=text,
            runs=runs,
            is_centered=is_centered,
            has_strike=has_strike,
            indent_left=indent_left,
            bookmark_name=bookmark_name,
            footnote_ids=footnote_ids or [],
        )

    return _factory


@pytest.fixture
def make_classified():
    """Factory para _ClassifiedParagraph com defaults sensatos."""

    def _factory(
        unit_type: UnitType,
        text: str,
        *,
        identifier: str = "",
        art_number: str = "",
        is_centered: bool = False,
        has_strike: bool = False,
        indent_left: int = 0,
        bookmark_name: str = "",
        footnote_ids: list[int] | None = None,
        runs: list[TextRun] | None = None,
    ) -> _ClassifiedParagraph:
        if runs is None:
            runs = [TextRun(text=text)]
        return _ClassifiedParagraph(
            unit_type=unit_type,
            identifier=identifier,
            text=text,
            runs=runs,
            is_centered=is_centered,
            has_strike=has_strike,
            indent_left=indent_left,
            bookmark_name=bookmark_name,
            art_number=art_number,
            footnote_ids=footnote_ids or [],
        )

    return _factory


# ── DOCX real (integration / snapshot) ──────────────────────────────────

def _load_config_toml() -> dict:
    """Lê config.local.toml usando tomllib (3.11+) ou fallback regex."""
    cfg_path = ROOT / "config.local.toml"
    if not cfg_path.exists():
        return {}
    text = cfg_path.read_text(encoding="utf-8")
    try:
        import tomllib
        return tomllib.loads(text)
    except ImportError:
        pass
    # Fallback simples: extrai docx = "..."
    import re
    m = re.search(r'docx\s*=\s*"([^"]+)"', text)
    if m:
        return {"sources": {"docx": m.group(1)}}
    return {}


@pytest.fixture(scope="session")
def docx_path() -> Path:
    """Caminho para o DOCX real; skip se indisponível."""
    cfg = _load_config_toml()
    raw = cfg.get("sources", {}).get("docx", "")
    if not raw:
        pytest.skip("config.local.toml não define sources.docx")
    p = Path(raw)
    if not p.exists():
        pytest.skip(f"DOCX não encontrado: {p}")
    return p


@pytest.fixture(scope="session")
def parsed_doc(docx_path: Path):
    """ParsedDocument obtido do DOCX real (cacheado por sessão)."""
    from src.parse_docx import parse_docx
    return parse_docx(docx_path)


@pytest.fixture(scope="session")
def resolved_doc(parsed_doc):
    """ParsedDocument com emendas resolvidas (cacheado por sessão)."""
    import copy
    from src.resolve_amendments import resolve_amendments
    doc = copy.deepcopy(parsed_doc)
    return resolve_amendments(doc)


# ── Helpers de snapshot ─────────────────────────────────────────────────

def load_golden(name: str) -> dict | None:
    """Carrega golden file JSON; retorna None se não existir."""
    p = SNAPSHOTS_DIR / f"{name}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def save_golden(name: str, data: dict) -> Path:
    """Salva golden file JSON."""
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    p = SNAPSHOTS_DIR / f"{name}.json"
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return p
