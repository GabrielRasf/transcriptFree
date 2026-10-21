"""Sobe a API em host/porta públicos (Railway, Render, Fly, VPS).

Não use este entrypoint para o .exe local — use run.py (127.0.0.1).

A Vercel NÃO executa este processo: o Whisper precisa de servidor persistente
com CPU/RAM suficientes e timeouts longos.
"""

from __future__ import annotations

import os

import uvicorn

from app import app


def main() -> None:
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    print(f"Transcriptor API em http://{host}:{port}")
    print("Healthcheck: GET /health")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
