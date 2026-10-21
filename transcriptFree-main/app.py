"""Transcriptor — MP3 para TXT com timestamps."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
import tempfile
import threading
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from constants import (
    ALLOWED_EXTENSIONS,
    MIME_TO_SUFFIX,
    max_upload_bytes,
    supported_formats_label,
    upload_too_large_detail as _upload_too_large_detail,
)
from render_frontend import render_index as _render_index

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("transcriptor")

# Único teto do arquivo de áudio. O corpo HTTP pode ser um pouco maior
# por causa do envelope multipart; o arquivo em si para neste valor.
MAX_UPLOAD_BYTES = max_upload_bytes()
MULTIPART_OVERHEAD_BYTES = 64 * 1024
READ_CHUNK_BYTES = 1024 * 1024
GENERIC_TRANSCRIBE_ERROR = (
    "Erro interno ao transcrever. Tente novamente ou consulte os logs do servidor."
)

_model = None
_transcribe_lock = threading.Lock()


def resource_dir() -> Path:
    """Pasta base: projeto em dev, ou _MEIPASS quando empacotado."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).parent


def upload_too_large_detail() -> str:
    return _upload_too_large_detail(MAX_UPLOAD_BYTES)


class LimitRequestBodyMiddleware:
    """Recusa POST cujo Content-Length já passa do teto, sem ler o corpo."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope.get("method", "").upper() == "POST":
            headers = {key.lower(): value for key, value in scope.get("headers", [])}
            raw_length = headers.get(b"content-length")
            announced = _parse_content_length(raw_length)
            if announced is not None and announced > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES:
                body = json.dumps(
                    {"detail": upload_too_large_detail()},
                    ensure_ascii=False,
                ).encode("utf-8")
                await send(
                    {
                        "type": "http.response.start",
                        "status": 413,
                        "headers": [
                            (b"content-type", b"application/json; charset=utf-8"),
                            (b"content-length", str(len(body)).encode("ascii")),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)


def _parse_content_length(raw: bytes | None) -> int | None:
    if not raw:
        return None
    try:
        size = int(raw)
    except ValueError:
        return None
    if size < 0:
        return None
    return size


def _cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "")
    return [part.strip() for part in raw.split(",") if part.strip()]


app = FastAPI(title="Transcriptor")
app.add_middleware(LimitRequestBodyMiddleware)

_origins = _cors_origins()
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["X-Filename", "Content-Disposition"],
    )

STATIC_DIR = resource_dir() / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Protótipo experimental (mesmo path relativo da Vercel em public/browser-prototype/)
_BROWSER_PROTO = STATIC_DIR / "browser-prototype"
if _BROWSER_PROTO.is_dir():
    app.mount(
        "/browser-prototype",
        StaticFiles(directory=_BROWSER_PROTO, html=True),
        name="browser_prototype",
    )


def get_model():
    """Carrega o modelo uma vez. A biblioteca só entra na primeira transcrição."""
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        _model = WhisperModel("base", device="cpu", compute_type="int8")
    return _model


def format_timestamp(seconds: float) -> str:
    """Formata segundos como M:SS ou H:MM:SS."""
    total = max(0, int(seconds))
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def segments_to_txt(segments: list) -> str:
    """Gera o texto no formato (início - fim) + parágrafo."""
    blocks: list[str] = []
    for seg in segments:
        start = format_timestamp(seg.start)
        end = format_timestamp(seg.end)
        text = (seg.text or "").strip()
        if not text:
            continue
        blocks.append(f"({start} - {end})\n{text}")
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def safe_stem(filename: str) -> str:
    stem = Path(filename).stem or "transcricao"
    stem = re.sub(r"[^\w\-]+", "_", stem, flags=re.UNICODE).strip("_")
    return stem or "transcricao"


def resolve_suffix(filename: str | None, content_type: str | None) -> str:
    """Define a extensão do temporário pelo nome ou, se não houver, pelo MIME."""
    suffix = Path(filename or "").suffix.lower()
    if suffix:
        if suffix in ALLOWED_EXTENSIONS:
            return suffix
        raise HTTPException(status_code=400, detail=_unsupported_detail(suffix))

    mime = (content_type or "").split(";")[0].strip().lower()
    mapped = MIME_TO_SUFFIX.get(mime)
    if mapped:
        return mapped
    raise HTTPException(
        status_code=400,
        detail=_unsupported_detail(mime or "desconhecido"),
    )


def _unsupported_detail(found: str) -> str:
    return f"Formato não suportado ({found}). Use: {supported_formats_label()}."


def render_index(
    *,
    api_base: str = "",
    require_remote_api: bool | None = None,
    static_deploy: bool = False,
    limit_bytes: int | None = None,
) -> str:
    """A página usa os formatos e o teto definidos neste módulo."""
    return _render_index(
        api_base=api_base,
        require_remote_api=require_remote_api,
        static_deploy=static_deploy,
        limit_bytes=MAX_UPLOAD_BYTES if limit_bytes is None else limit_bytes,
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    return HTMLResponse(render_index())


def transcribe_path(tmp_path: str) -> str:
    # O modelo não é seguro para chamadas paralelas; a fila preserva o resultado.
    with _transcribe_lock:
        model = get_model()
        segments_iter, _info = model.transcribe(
            tmp_path,
            language="pt",
            vad_filter=True,
            beam_size=5,
        )
        text = segments_to_txt(list(segments_iter))
    if not text.strip():
        raise HTTPException(
            status_code=422,
            detail="Não foi possível detectar fala no áudio.",
        )
    return text


async def persist_upload(upload: UploadFile, suffix: str) -> str:
    """Grava o upload em disco em pedaços e apaga o temporário se passar do teto."""
    total = 0
    handle = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp_path = Path(handle.name)
    try:
        while True:
            chunk = await upload.read(READ_CHUNK_BYTES)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail=upload_too_large_detail())
            handle.write(chunk)
        if total == 0:
            raise HTTPException(status_code=400, detail="Arquivo vazio.")
    except Exception:
        handle.close()
        tmp_path.unlink(missing_ok=True)
        raise
    handle.close()
    return str(tmp_path)


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)) -> PlainTextResponse:
    original_name = file.filename or ""
    logger.info(
        "Upload recebido: name=%r content_type=%r",
        original_name,
        file.content_type,
    )

    suffix = resolve_suffix(original_name, file.content_type)
    tmp_path = await persist_upload(file, suffix)
    try:
        text = await asyncio.to_thread(transcribe_path, tmp_path)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Falha na transcrição")
        raise HTTPException(
            status_code=500,
            detail=GENERIC_TRANSCRIBE_ERROR,
        ) from None
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    download_name = f"{safe_stem(original_name)}.txt"
    return PlainTextResponse(
        content=text,
        media_type="text/plain; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{download_name}"',
            "X-Filename": download_name,
        },
    )


if __name__ == "__main__":
    from run import main

    main()
