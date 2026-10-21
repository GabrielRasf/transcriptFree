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


def frontend_config(
    *,
    api_base: str = "",
    require_remote_api: bool | None = None,
    static_deploy: bool = False,
) -> dict:
    """Config injetada em window.TRANSCRIPTOR_CONFIG.

    - Local (static_deploy=False): Python disponível no mesmo origin.
    - Vercel sem API: só navegador; defaultMode=browser.
    - Vercel com API: Python/API + navegador; defaultMode=python.
    """
    api = api_base.rstrip("/")
    python_available = bool(api) or not static_deploy
    # Mantém compat: requireRemoteApi true quando há API remota configurada.
    if require_remote_api is None:
        require_remote_api = bool(api)
    return {
        "apiBase": api,
        "requireRemoteApi": bool(require_remote_api),
        "pythonAvailable": python_available,
        "browserAvailable": True,
        "browserAssetBase": "/browser-prototype",
        "defaultMode": "python" if python_available else "browser",
    }


def render_index(
    *,
    api_base: str = "",
    require_remote_api: bool | None = None,
    static_deploy: bool = False,
    limit_bytes: int | None = None,
) -> str:
    limit = max_upload_bytes() if limit_bytes is None else limit_bytes
    page = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    config_json = json.dumps(
        frontend_config(
            api_base=api_base,
            require_remote_api=require_remote_api,
            static_deploy=static_deploy,
        ),
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
