"""Testes da junção temporal / janelas (sem inferência Whisper)."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js não disponível")
def test_plan_windows_last_partial_and_pcm():
    script = r"""
import {
  planWindows, pcmBytesMono16k, mergeWindowResults, coverageStats,
  dedupeTemporalOverlaps, auditMergedChunks, findCoverageGaps,
  DEFAULT_CHUNK_S, DEFAULT_STRIDE_S,
} from './static/browser-prototype/chunking.js';

const w60 = planWindows(60, 30, 5);
const w45 = planWindows(45, 30, 5);
const last = w60[w60.length - 1];

// Simula duas janelas com overlap textual+temporal na fronteira
const merged = mergeWindowResults([
  {
    window: { offsetSec: 0, endSec: 30, isFirst: true, isLast: false },
    chunks: [
      { timestamp: [0, 5], text: 'inicio' },
      { timestamp: [24, 29], text: 'na fronteira um' },
    ],
  },
  {
    window: { offsetSec: 20, endSec: 50, isFirst: false, isLast: false },
    chunks: [
      { timestamp: [0, 4], text: 'na fronteira um' }, // abs 20-24 — zona stride esq.
      { timestamp: [5, 10], text: 'miolo confiavel' }, // abs 25-30
      { timestamp: [22, 28], text: 'fim' },
    ],
  },
  {
    window: { offsetSec: 40, endSec: 50, isFirst: false, isLast: true },
    chunks: [
      { timestamp: [0, 3], text: 'eco' },
      { timestamp: [8, 10], text: 'ultimo pedaco' },
    ],
  },
], 50, 5);

const stats = coverageStats(merged, 50);
const deduped = dedupeTemporalOverlaps([
  { timestamp: [10, 14], text: 'ola mundo' },
  { timestamp: [10.2, 13.5], text: 'ola mundo' },
  { timestamp: [20, 22], text: 'depois' },
]);
const issues = auditMergedChunks([
  { timestamp: [0, 2], text: 'a' },
  { timestamp: [1.2, 3], text: 'b' },
]);
const gaps = findCoverageGaps([{ timestamp: [0, 5], text: 'a' }], 20, 2);

process.stdout.write(JSON.stringify({
  defaults: [DEFAULT_CHUNK_S, DEFAULT_STRIDE_S],
  n60: w60.length,
  firstJump: w60[1].offsetSec,
  lastPartial: last.endSec - last.offsetSec < 30 || last.isLast,
  lastEnd: last.endSec,
  n45: w45.length,
  last45: w45[w45.length - 1],
  pcm30min: pcmBytesMono16k(30 * 60),
  mergedTexts: merged.map(c => c.text),
  mergedStarts: merged.map(c => c.timestamp[0]),
  stats,
  dedupeLen: deduped.length,
  dedupeTexts: deduped.map(c => c.text),
  issuesTypes: issues.map(i => i.type),
  gaps,
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
    assert data["defaults"] == [30, 5]
    assert data["firstJump"] == 20
    assert data["lastEnd"] == 60
    assert data["lastPartial"] is True
    # 45s: última janela cobre o restante
    assert data["last45"]["endSec"] == 45
    assert data["last45"]["isLast"] is True
    assert data["pcm30min"] == 30 * 60 * 16000 * 4
    # "na fronteira um" da 2ª janela (offset 0-4) cai no stride esquerdo → descartado
    assert "miolo confiavel" in data["mergedTexts"]
    assert "ultimo pedaco" in data["mergedTexts"]
    assert data["mergedStarts"] == sorted(data["mergedStarts"])
    assert data["stats"]["ordered"] is True
    assert data["dedupeLen"] == 2
    assert data["dedupeTexts"] == ["ola mundo", "depois"]
    assert "overlap_or_out_of_order" in data["issuesTypes"]
    assert data["gaps"]


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js não disponível")
def test_timestamps_do_not_restart_after_shift_merge():
    script = r"""
import { mergeWindowResults, coverageStats } from './static/browser-prototype/chunking.js';
const merged = mergeWindowResults([
  {
    window: { offsetSec: 0, endSec: 30, isFirst: true, isLast: false },
    chunks: [{ timestamp: [1, 3], text: 'a' }, { timestamp: [10, 12], text: 'b' }],
  },
  {
    window: { offsetSec: 20, endSec: 50, isFirst: false, isLast: true },
    chunks: [{ timestamp: [6, 8], text: 'c' }, { timestamp: [25, 28], text: 'd' }],
  },
], 50, 5);
const starts = merged.map(c => c.timestamp[0]);
const stats = coverageStats(merged, 50);
process.stdout.write(JSON.stringify({ starts, stats, texts: merged.map(c => c.text) }));
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
    assert data["starts"] == sorted(data["starts"])
    # Após shift, 'c' em offset 20+6=26 (zona confiável), não reinicia em 0
    assert min(data["starts"]) >= 0
    assert any(s >= 20 for s in data["starts"])
    assert data["stats"]["withinDuration"] is True
