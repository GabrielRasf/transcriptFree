"""Transcriptor — MP3 para TXT com timestamps."""

from __future__ import annotations

import logging
import re
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("transcriptor")


def resource_dir() -> Path:
    """Pasta base: projeto em dev, ou _MEIPASS quando empacotado."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).parent


app = FastAPI(title="Transcriptor")

STATIC_DIR = resource_dir() / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

ALLOWED_EXTENSIONS = {
    ".mp3",
    ".mpeg",
    ".mpga",
    ".wav",
    ".m4a",
    ".aac",
    ".ogg",
    ".oga",
    ".opus",
    ".flac",
    ".webm",
    ".mp4",
    ".wma",
}

MIME_TO_SUFFIX = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/aac": ".aac",
    "audio/ogg": ".ogg",
    "audio/opus": ".opus",
    "audio/flac": ".flac",
    "audio/webm": ".webm",
    "video/webm": ".webm",
    "video/mp4": ".mp4",
}

# Carrega o modelo uma vez (base = bom equilíbrio velocidade/qualidade)
_model: WhisperModel | None = None


def get_model() -> WhisperModel:
    global _model
    if _model is None:
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
    """Define a extensão do arquivo temporário a partir do nome ou MIME."""
    suffix = Path(filename or "").suffix.lower()
    if suffix in ALLOWED_EXTENSIONS:
        return suffix

    mime = (content_type or "").split(";")[0].strip().lower()
    if mime in MIME_TO_SUFFIX:
        return MIME_TO_SUFFIX[mime]
    if mime.startswith("audio/"):
        return ".mp3"

    # Sem extensão clara: deixa o decoder detectar pelo conteúdo
    if not suffix:
        return ".mp3"

    raise HTTPException(
        status_code=400,
        detail=(
            f"Formato não suportado ({suffix or mime or 'desconhecido'}). "
            f"Use áudio como mp3, wav, m4a, ogg, flac…"
        ),
    )


@app.get("/", response_class=HTMLResponse)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


def transcribe_path(tmp_path: str) -> str:
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


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)) -> PlainTextResponse:
    filename = file.filename or "audio.mp3"
    logger.info("Upload recebido: name=%r content_type=%r", filename, file.content_type)

    suffix = resolve_suffix(filename, file.content_type)
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Arquivo vazio.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        text = transcribe_path(tmp_path)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("Falha na transcrição")
        raise HTTPException(
            status_code=500,
            detail=f"Erro na transcrição: {exc}",
        ) from exc
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    download_name = f"{safe_stem(filename)}.txt"
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
