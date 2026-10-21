#!/usr/bin/env python3
"""Gera public/ com a UI estática para a Vercel.

A Vercel hospeda somente a interface. A API Whisper deve estar em outro host;
defina TRANSCRIPTOR_API_URL no build da Vercel.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from constants import max_upload_bytes  # noqa: E402
from render_frontend import render_index  # noqa: E402


def main() -> None:
    api_url = os.environ.get("TRANSCRIPTOR_API_URL", "").strip().rstrip("/")
    out_dir = ROOT / "public"
    out_dir.mkdir(parents=True, exist_ok=True)

    html = render_index(
        api_base=api_url,
        require_remote_api=True,
        limit_bytes=max_upload_bytes(),
    )
    (out_dir / "index.html").write_text(html, encoding="utf-8")

    if not api_url:
        print(
            "AVISO: TRANSCRIPTOR_API_URL não definida. "
            "A UI será publicada, mas a transcrição falhará até configurar a API.",
            file=sys.stderr,
        )
    else:
        print(f"UI gerada em public/ apontando para {api_url}")


if __name__ == "__main__":
    main()
