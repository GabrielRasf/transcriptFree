"""Testes da integração dual-mode na UI principal (sem inferência Whisper)."""

from __future__ import annotations

import json
import re
from pathlib import Path

from render_frontend import frontend_config, render_index

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "static" / "index.html"
PROTO = ROOT / "static" / "browser-prototype"


def test_frontend_config_local_defaults_to_python():
    cfg = frontend_config(static_deploy=False)
    assert cfg["pythonAvailable"] is True
    assert cfg["browserAvailable"] is True
    assert cfg["defaultMode"] == "python"
    assert cfg["browserAssetBase"] == "/browser-prototype"


def test_frontend_config_static_without_api_defaults_to_browser():
    cfg = frontend_config(api_base="", static_deploy=True)
    assert cfg["pythonAvailable"] is False
    assert cfg["defaultMode"] == "browser"
    assert cfg["requireRemoteApi"] is False


def test_frontend_config_static_with_api_defaults_to_python():
    cfg = frontend_config(api_base="https://api.example.com", static_deploy=True)
    assert cfg["pythonAvailable"] is True
    assert cfg["defaultMode"] == "python"
    assert cfg["apiBase"] == "https://api.example.com"
    assert cfg["requireRemoteApi"] is True


def test_home_html_has_mode_selector_and_cancel():
    html = INDEX.read_text(encoding="utf-8")
    assert 'name="transcribeMode"' in html
    assert 'id="modePython"' in html
    assert 'id="modeBrowser"' in html
    assert 'id="btnCancel"' in html
    assert 'type="module"' in html
    assert "/browser-prototype/browser-transcribe.js" in html
    assert "AbortController" in html
    assert "BROWSER_LARGE_FILE_BYTES" in html
    assert "precisão inferior" in html.lower() or "precisao inferior" in html.lower() or "inferior" in html


def test_browser_transcribe_module_no_upload():
    mod = (PROTO / "browser-transcribe.js").read_text(encoding="utf-8")
    assert "fetch(" not in mod
    assert "FormData" not in mod
    assert "IndexedDB" not in mod
    assert "localStorage" not in mod
    assert "whisper-worker.js" in mod
    assert "BrowserTranscribeSession" in mod


def test_render_index_embeds_dual_mode_config():
    html = render_index(static_deploy=True)
    assert "{{CONFIG_JSON}}" not in html
    m = re.search(r"window\.TRANSCRIPTOR_CONFIG = (\{.*?\});", html, re.S)
    assert m
    cfg = json.loads(m.group(1))
    assert cfg["defaultMode"] == "browser"
    assert cfg["pythonAvailable"] is False
    assert cfg["browserAssetBase"] == "/browser-prototype"

    html_api = render_index(api_base="https://x.example", static_deploy=True)
    m2 = re.search(r"window\.TRANSCRIPTOR_CONFIG = (\{.*?\});", html_api, re.S)
    cfg2 = json.loads(m2.group(1))
    assert cfg2["defaultMode"] == "python"
    assert cfg2["pythonAvailable"] is True
