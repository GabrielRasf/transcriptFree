#!/usr/bin/env python3
"""Gera public/ com a UI estática para a Vercel.

Inclui:
- index.html principal (fluxo API opcional via TRANSCRIPTOR_API_URL)
- protótipo experimental em browser-prototype/ (não exige TRANSCRIPTOR_API_URL)

A Vercel NÃO executa Faster Whisper. O protótipo no navegador usa Transformers.js.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from constants import max_upload_bytes  # noqa: E402
from render_frontend import render_index  # noqa: E402


def _copy_browser_prototype(out_dir: Path) -> None:
    src = ROOT / "static" / "browser-prototype"
    dst = out_dir / "browser-prototype"
    if not src.is_dir():
        print("AVISO: static/browser-prototype/ ausente.", file=sys.stderr)
        return
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(
        src,
        dst,
        ignore=shutil.ignore_patterns(
            "*.onnx",
            "*.onnx_data",
            "*.bin",
            "*.safetensors",
            "__pycache__",
            "node_modules",
            "fixtures",
            "package-lock.json",
        ),
    )
    print(f"Protótipo browser copiado para {dst.relative_to(ROOT)}")


def main() -> None:
    api_url = os.environ.get("TRANSCRIPTOR_API_URL", "").strip().rstrip("/")
    out_dir = ROOT / "public"
    out_dir.mkdir(parents=True, exist_ok=True)

    # static_deploy=True: sem API → default navegador; com API → default Python/API.
    html = render_index(
        api_base=api_url,
        static_deploy=True,
        limit_bytes=max_upload_bytes(),
    )
    (out_dir / "index.html").write_text(html, encoding="utf-8")
    _copy_browser_prototype(out_dir)

    if not api_url:
        print(
            "AVISO: TRANSCRIPTOR_API_URL vazia — modo Python/API indisponível. "
            "A home usa o modo navegador (Whisper tiny) por padrão.",
            file=sys.stderr,
        )
    else:
        print(f"UI principal: API {api_url} (default Python) + modo navegador")


if __name__ == "__main__":
    main()
