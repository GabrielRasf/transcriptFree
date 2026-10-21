"""Constantes compartilhadas (sem dependências de terceiros)."""

from __future__ import annotations

import os

# Ordem estável: a interface e o .gitignore seguem esta lista.
ALLOWED_EXTENSIONS = (
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
)

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

DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024 * 1024


def max_upload_bytes() -> int:
    """Teto do arquivo. Opcional: MAX_UPLOAD_MB no ambiente."""
    raw = os.environ.get("MAX_UPLOAD_MB", "").strip()
    if not raw:
        return DEFAULT_MAX_UPLOAD_BYTES
    megabytes = int(raw)
    if megabytes < 1:
        raise ValueError("MAX_UPLOAD_MB deve ser >= 1")
    return megabytes * 1024 * 1024


def supported_formats_label() -> str:
    return ", ".join(ext.lstrip(".") for ext in ALLOWED_EXTENSIONS)


def upload_too_large_detail(limit_bytes: int | None = None) -> str:
    limit = DEFAULT_MAX_UPLOAD_BYTES if limit_bytes is None else limit_bytes
    megabytes = limit // (1024 * 1024)
    if megabytes >= 1:
        return f"Arquivo muito grande. O limite é {megabytes} MB por arquivo."
    return f"Arquivo muito grande. O limite é {limit} bytes por arquivo."
