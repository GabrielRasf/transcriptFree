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


def test_whisper_worker_defaults_to_remote_hub_not_local_models_path():
    """Evita GET /models/... no mesmo origin (HTML SPA → erro JSON no Hub loader)."""
    worker = (PROTO / "whisper-worker.js").read_text(encoding="utf-8")
    assert "env.allowLocalModels = false" in worker
    assert "env.allowLocalModels = true" in worker  # só no ramo localModelPath
    # O true deve aparecer depois do gate localModelPath, não como default global isolado.
    false_at = worker.index("env.allowLocalModels = false")
    true_at = worker.index("env.allowLocalModels = true")
    assert false_at < true_at
    assert "opts.localModelPath" in worker
    assert "purgeInvalidTransformersCache" in worker
    assert "assertHubConfigJson" in worker
    assert "huggingface.co/" in worker
    assert "transformers-cache" in worker or "transformers" in worker


def test_home_python_errors_detect_html_and_include_http_status():
    html = INDEX.read_text(encoding="utf-8")
    assert "describeHttpFailure" in html
    assert "looksLikeHtmlDocument" in html
    assert "Resposta HTML inesperada" in html
    assert "HTTP ${status}" in html or "HTTP ${" in html
    assert "TRANSCRIPTOR_API_URL" in html
    # Modo browser não usa fetch/FormData na home para o motor (só Python).
    assert "BrowserTranscribeSession" in html
    assert 'mode === "browser"' in html or "mode === 'browser'" in html


def test_vercel_json_has_no_spa_catchall_rewrite():
    """Catch-all SPA mascara 404 de /models/ e de assets ausentes com index.html."""
    candidates = [
        ROOT / "vercel.json",
        ROOT.parent / "vercel.json",
    ]
    found = [p for p in candidates if p.is_file()]
    assert found, "vercel.json não encontrado"
    for path in found:
        data = json.loads(path.read_text(encoding="utf-8"))
        for rule in data.get("rewrites") or []:
            src = str(rule.get("source") or "")
            dest = str(rule.get("destination") or "")
            assert not (src in {"/(.*)", "/:path*", "/(.*)*"} and dest.endswith("index.html")), (
                f"{path}: rewrite SPA perigoso {rule}"
            )


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
