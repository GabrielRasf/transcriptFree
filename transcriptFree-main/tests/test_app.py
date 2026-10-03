"""Testes sem carregar o modelo Whisper."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app as app_module

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def client():
    with TestClient(app_module.app) as test_client:
        yield test_client


@pytest.fixture
def tracked_temps(monkeypatch):
    created: list[Path] = []
    original = app_module.tempfile.NamedTemporaryFile

    def track(*args, **kwargs):
        handle = original(*args, **kwargs)
        created.append(Path(handle.name))
        return handle

    monkeypatch.setattr(app_module.tempfile, "NamedTemporaryFile", track)
    return created


class _Segment:
    def __init__(self, start: float, end: float, text: str | None):
        self.start = start
        self.end = end
        self.text = text


def test_format_timestamp_edges():
    assert app_module.format_timestamp(0) == "0:00"
    assert app_module.format_timestamp(3.9) == "0:03"
    assert app_module.format_timestamp(65) == "1:05"
    assert app_module.format_timestamp(3600) == "1:00:00"
    assert app_module.format_timestamp(3661) == "1:01:01"
    assert app_module.format_timestamp(-4) == "0:00"


def test_safe_stem_cleans_names():
    assert app_module.safe_stem("aula.mp3") == "aula"
    assert app_module.safe_stem("aula final!.mp3") == "aula_final"
    assert app_module.safe_stem("my-file_01.ogg") == "my-file_01"
    assert app_module.safe_stem("lição.mp3") == "lição"
    assert app_module.safe_stem("a/b/c.wav") == "c"
    assert app_module.safe_stem("!!!.mp3") == "transcricao"
    assert app_module.safe_stem("") == "transcricao"


def test_segments_to_txt_skips_blank_and_joins_blocks():
    assert app_module.segments_to_txt([]) == ""
    assert app_module.segments_to_txt([_Segment(0, 1, "  ")]) == ""
    text = app_module.segments_to_txt(
        [
            _Segment(1, 2, " oi "),
            _Segment(3, 4, ""),
            _Segment(65, 70, "tchau"),
        ]
    )
    assert text == "(0:01 - 0:02)\noi\n\n(1:05 - 1:10)\ntchau\n"


def test_resolve_suffix_accepts_known_extension_and_mime():
    assert app_module.resolve_suffix("Voz.MP3", "application/octet-stream") == ".mp3"
    assert app_module.resolve_suffix("a.wav", "audio/mpeg") == ".wav"
    assert app_module.resolve_suffix("sem-extensao", "audio/mpeg") == ".mp3"
    assert app_module.resolve_suffix(None, "audio/wav; charset=utf-8") == ".wav"
    assert app_module.resolve_suffix("clip.wma", None) == ".wma"


def test_resolve_suffix_rejects_unknown_and_extensionless_without_mime():
    with pytest.raises(HTTPException) as missing:
        app_module.resolve_suffix("sem-extensao", None)
    assert missing.value.status_code == 400

    with pytest.raises(HTTPException) as unknown_mime:
        app_module.resolve_suffix("sem-extensao", "audio/x-unknown")
    assert unknown_mime.value.status_code == 400
    assert "audio/x-unknown" in unknown_mime.value.detail

    with pytest.raises(HTTPException) as bad_suffix:
        app_module.resolve_suffix("arquivo.txt", "audio/mpeg")
    assert bad_suffix.value.status_code == 400
    assert "txt" in bad_suffix.value.detail


def test_no_speech_returns_422_without_loading_whisper(monkeypatch):
    class FakeModel:
        def transcribe(self, *_args, **_kwargs):
            return [_Segment(0, 1, "   ")], None

    monkeypatch.setattr(app_module, "get_model", lambda: FakeModel())
    with pytest.raises(HTTPException) as exc:
        app_module.transcribe_path("nao-aberto")
    assert exc.value.status_code == 422


def test_index_uses_backend_extensions_limit_and_live_status(client):
    page = client.get("/")
    assert page.status_code == 200
    html = page.text
    for token in (
        "{{ACCEPT_EXTENSIONS}}",
        "{{FORMAT_HINT}}",
        "{{MAX_UPLOAD_BYTES}}",
        "{{MAX_UPLOAD_MESSAGE}}",
    ):
        assert token not in html
    accept = html.split('accept="', 1)[1].split('"', 1)[0]
    assert accept.split(",") == list(app_module.ALLOWED_EXTENSIONS)
    assert "audio/*" not in accept
    for ext in app_module.ALLOWED_EXTENSIONS:
        assert ext.lstrip(".") in html
    assert f'data-max-upload-bytes="{app_module.MAX_UPLOAD_BYTES}"' in html
    assert "200 MB" in html
    assert 'aria-live="polite"' in html
    assert 'role="status"' in html


def test_zip_marks_filenames_as_utf8():
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    assert html.count("u16(ZIP_UTF8)") == 2
    assert "0x800" in html


def test_empty_file_returns_400(client, tracked_temps):
    response = client.post(
        "/transcribe",
        files={"file": ("voz.mp3", b"", "audio/mpeg")},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Arquivo vazio."
    assert tracked_temps
    assert all(not path.exists() for path in tracked_temps)


def test_invalid_format_returns_400(client, monkeypatch):
    def explode(_path):
        raise AssertionError("não deveria transcrever")

    monkeypatch.setattr(app_module, "transcribe_path", explode)
    response = client.post(
        "/transcribe",
        files={"file": ("notas.txt", b"abc", "text/plain")},
    )
    assert response.status_code == 400
    assert "Formato não suportado" in response.json()["detail"]


def test_extensionless_file_without_known_mime_returns_400(client, monkeypatch):
    def explode(_path):
        raise AssertionError("não deveria transcrever")

    monkeypatch.setattr(app_module, "transcribe_path", explode)
    response = client.post(
        "/transcribe",
        files={"file": ("semextensao", b"abc", "application/octet-stream")},
    )
    assert response.status_code == 400
    assert "Formato não suportado" in response.json()["detail"]


def test_oversized_upload_returns_413_and_deletes_temp(client, monkeypatch, tracked_temps):
    monkeypatch.setattr(app_module, "MAX_UPLOAD_BYTES", 4)
    response = client.post(
        "/transcribe",
        files={"file": ("voz.mp3", b"0123456789", "audio/mpeg")},
    )
    assert response.status_code == 413
    assert response.json()["detail"].startswith("Arquivo muito grande.")
    assert tracked_temps
    assert all(not path.exists() for path in tracked_temps)


def test_middleware_rejects_announced_body_without_reading_it():
    called = False

    async def inner(_scope, _receive, _send):
        nonlocal called
        called = True

    middleware = app_module.LimitRequestBodyMiddleware(inner)
    sent = []
    announced = app_module.MAX_UPLOAD_BYTES + app_module.MULTIPART_OVERHEAD_BYTES + 1

    async def receive():
        raise AssertionError("o corpo não deveria ser lido")

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "method": "POST",
        "headers": [(b"content-length", str(announced).encode("ascii"))],
    }
    asyncio.run(middleware(scope, receive, send))
    assert called is False
    assert sent[0]["status"] == 413
    detail = json.loads(sent[1]["body"])["detail"]
    assert detail == "Arquivo muito grande. O limite é 200 MB por arquivo."


def test_internal_error_is_logged_and_hidden(client, monkeypatch, caplog, tracked_temps):
    marker = r"biblioteca-secreta D:\modelos\interno.bin"

    def explode(_path):
        raise RuntimeError(marker)

    monkeypatch.setattr(app_module, "transcribe_path", explode)
    with caplog.at_level(logging.ERROR, logger="transcriptor"):
        response = client.post(
            "/transcribe",
            files={"file": ("voz.mp3", b"abc", "audio/mpeg")},
        )
    assert response.status_code == 500
    assert response.json()["detail"] == app_module.GENERIC_TRANSCRIBE_ERROR
    assert marker not in response.text
    assert "Traceback" not in response.text
    assert "faster_whisper" not in response.text
    assert marker in caplog.text
    assert tracked_temps
    assert all(not path.exists() for path in tracked_temps)


def test_mocked_transcription_returns_text(client, monkeypatch, tracked_temps):
    monkeypatch.setattr(app_module, "transcribe_path", lambda _path: "olá\n")
    response = client.post(
        "/transcribe",
        files={"file": ("aula.mp3", b"abc", "audio/mpeg")},
    )
    assert response.status_code == 200
    assert response.text == "olá\n"
    assert response.headers["x-filename"] == "aula.txt"
    assert tracked_temps
    assert all(not path.exists() for path in tracked_temps)


def test_gitignore_covers_allowed_audio_extensions():
    ignored = (ROOT / ".gitignore").read_text(encoding="utf-8")
    for ext in app_module.ALLOWED_EXTENSIONS:
        assert f"*{ext}" in ignored


def test_readme_documents_limit_and_formats():
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "200 MB" in readme
    for ext in app_module.ALLOWED_EXTENSIONS:
        assert f"`{ext}`" in readme


def test_ci_runs_pytest_and_compile():
    workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert "python -m pytest" in workflow
    assert "py_compile" in workflow
    assert "requirements.txt" in workflow


def test_runtime_requirements_pin_requests_for_faster_whisper():
    runtime = (ROOT / "requirements.txt").read_text(encoding="utf-8")
    assert "requests==2.32.4" in runtime
    dev = (ROOT / "requirements-dev.txt").read_text(encoding="utf-8")
    assert "pyinstaller==6.22.3" in dev
    assert "pytest==9.1.1" in dev
    assert "httpx==0.28.1" in dev


def test_build_script_does_not_pause():
    lines = [
        line.strip().lower()
        for line in (ROOT / "build.bat").read_text(encoding="utf-8").splitlines()
    ]
    assert "pause" not in lines


def test_server_stays_on_localhost_without_open_cors():
    run_py = (ROOT / "run.py").read_text(encoding="utf-8")
    app_py = (ROOT / "app.py").read_text(encoding="utf-8")
    assert 'host="127.0.0.1"' in run_py
    assert "0.0.0.0" not in run_py
    assert "0.0.0.0" not in app_py
    assert "CORSMiddleware" not in app_py


def test_upload_limit_message_uses_the_single_constant():
    assert app_module.upload_too_large_detail() == (
        "Arquivo muito grande. O limite é 200 MB por arquivo."
    )
