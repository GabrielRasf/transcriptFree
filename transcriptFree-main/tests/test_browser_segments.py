"""Testes do protótipo browser sem executar Transformers.js / Whisper."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SEGMENTS = ROOT / "static" / "browser-prototype" / "segments.js"
PROTO = ROOT / "static" / "browser-prototype"


def test_browser_prototype_files_exist():
    for name in (
        "index.html",
        "app.js",
        "whisper-worker.js",
        "browser-transcribe.js",
        "chunking.js",
        "segments.js",
        "PRIVACY.md",
        "models/README.md",
    ):
        assert (PROTO / name).is_file(), name


def test_worker_does_not_post_audio_over_http():
    worker = (PROTO / "whisper-worker.js").read_text(encoding="utf-8")
    app = (PROTO / "app.js").read_text(encoding="utf-8")
    chunking = (PROTO / "chunking.js").read_text(encoding="utf-8")
    assert "Xenova/whisper-tiny" in worker
    assert "return_timestamps" in worker
    assert "language" in worker and "portuguese" in worker
    assert "planWindows" in worker and "mergeWindowResults" in worker
    assert "DEFAULT_CHUNK_S" in chunking and "30" in chunking
    assert "DEFAULT_STRIDE_S" in chunking
    assert "cancel" in worker
    assert "/transcribe" not in worker
    assert 'fetch(apiUrl("/transcribe")' not in app
    assert "IndexedDB" not in app
    assert "localStorage" not in app
    assert "multiple" in (PROTO / "index.html").read_text(encoding="utf-8")


def test_prepare_vercel_copies_prototype_without_api_url(tmp_path, monkeypatch):
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "prepare_vercel",
        ROOT / "scripts" / "prepare_vercel.py",
    )
    prepare = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    # Carrega com ROOT real no path (constants / render_frontend)
    monkeypatch.syspath_prepend(str(ROOT))
    spec.loader.exec_module(prepare)

    monkeypatch.delenv("TRANSCRIPTOR_API_URL", raising=False)
    monkeypatch.setattr(prepare, "ROOT", tmp_path)
    static = tmp_path / "static"
    static.mkdir()
    shutil.copytree(
        PROTO,
        static / "browser-prototype",
        ignore=shutil.ignore_patterns("node_modules", "fixtures"),
    )
    # render_frontend continua lendo o template real; só a cópia do protótipo usa tmp
    prepare.main()
    out = tmp_path / "public" / "browser-prototype" / "index.html"
    assert out.is_file()
    assert (tmp_path / "public" / "browser-prototype" / "whisper-worker.js").is_file()
    home = (tmp_path / "public" / "index.html").read_text(encoding="utf-8")
    assert '"requireRemoteApi": false' in home
    assert '"pythonAvailable": false' in home
    assert '"defaultMode": "browser"' in home
    assert "/browser-prototype/" in home
    assert (tmp_path / "public" / "browser-prototype" / "browser-transcribe.js").is_file()


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js não disponível")
def test_segments_js_matches_python_format():
    script = r"""
import { formatTimestamp, chunksToTxt, safeStem } from './static/browser-prototype/segments.js';
const cases = {
  ts: [formatTimestamp(0), formatTimestamp(3.9), formatTimestamp(65), formatTimestamp(3661)],
  txt: chunksToTxt([
    { timestamp: [1, 2], text: ' oi ' },
    { timestamp: [3, 4], text: '' },
    { timestamp: [65, 70], text: 'tchau' },
  ]),
  stem: safeStem('aula final!.mp3'),
};
process.stdout.write(JSON.stringify(cases));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    data = json.loads(proc.stdout)
    assert data["ts"] == ["0:00", "0:03", "1:05", "1:01:01"]
    assert data["txt"] == "(0:01 - 0:02)\noi\n\n(1:05 - 1:10)\ntchau\n"
    assert data["stem"] == "aula_final"
