"""Renderiza static/index.html com placeholders preenchidos (sem FastAPI)."""

from __future__ import annotations

import html
import json
from pathlib import Path

from constants import (
    ALLOWED_EXTENSIONS,
    max_upload_bytes,
    supported_formats_label,
    upload_too_large_detail,
)

STATIC_DIR = Path(__file__).resolve().parent / "static"


def frontend_config(*, api_base: str = "", require_remote_api: bool = False) -> dict:
    return {
        "apiBase": api_base.rstrip("/"),
        "requireRemoteApi": require_remote_api,
    }


def render_index(
    *,
    api_base: str = "",
    require_remote_api: bool = False,
    limit_bytes: int | None = None,
) -> str:
    limit = max_upload_bytes() if limit_bytes is None else limit_bytes
    page = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    config_json = json.dumps(
        frontend_config(api_base=api_base, require_remote_api=require_remote_api),
        ensure_ascii=False,
    )
    replacements = {
        "{{ACCEPT_EXTENSIONS}}": ",".join(ALLOWED_EXTENSIONS),
        "{{FORMAT_HINT}}": supported_formats_label(),
        "{{MAX_UPLOAD_BYTES}}": str(limit),
        "{{MAX_UPLOAD_MESSAGE}}": html.escape(
            upload_too_large_detail(limit), quote=True
        ),
        "{{CONFIG_JSON}}": config_json,
    }
    for token, value in replacements.items():
        page = page.replace(token, value)
    return page
