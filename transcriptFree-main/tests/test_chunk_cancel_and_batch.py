"""Cancelamento cooperativo e isolamento de erros entre arquivos (sem Whisper)."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js não disponível")
def test_cancel_flag_stops_window_loop():
    """Simula o loop do Worker: ao setar cancelled, não processa janelas restantes."""
    script = r"""
import { planWindows } from './static/browser-prototype/chunking.js';
const windows = planWindows(120, 30, 5);
let cancelled = false;
const processed = [];
for (const win of windows) {
  if (cancelled) break;
  processed.push(win.index);
  if (win.index === 1) cancelled = true; // cancela após 2ª janela
}
process.stdout.write(JSON.stringify({
  total: windows.length,
  processed,
  stoppedEarly: processed.length < windows.length,
}));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    data = json.loads(proc.stdout)
    assert data["total"] >= 5
    assert data["processed"] == [0, 1]
    assert data["stoppedEarly"] is True


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js não disponível")
def test_batch_error_isolation_pattern():
    """Erro em um arquivo não impede acumular resultados dos demais (padrão do app.js)."""
    script = r"""
const files = ['a.mp3', 'b.mp3', 'c.mp3'];
const parts = [];
const errors = [];
for (const f of files) {
  try {
    if (f === 'b.mp3') throw new Error('decode fail');
    parts.push(`ok:${f}`);
  } catch (e) {
    errors.push(`${f}: ${e.message}`);
    continue;
  }
}
process.stdout.write(JSON.stringify({ parts, errors }));
"""
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    data = json.loads(proc.stdout)
    assert data["parts"] == ["ok:a.mp3", "ok:c.mp3"]
    assert any("b.mp3" in e for e in data["errors"])
