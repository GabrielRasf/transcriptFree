"""Ponto de entrada do Transcriptor (dev e .exe)."""

from __future__ import annotations

import socket
import threading
import time
import webbrowser

import uvicorn

from app import app


def find_free_port(preferred: int = 8000) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])


def open_browser(url: str) -> None:
    time.sleep(0.8)
    webbrowser.open(url)


def main() -> None:
    port = find_free_port(8000)
    url = f"http://127.0.0.1:{port}"
    print(f"Transcriptor rodando em {url}")
    print("Feche esta janela para encerrar.")

    threading.Thread(target=open_browser, args=(url,), daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
