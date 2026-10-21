#!/usr/bin/env python3
"""Compara Faster Whisper (fluxo principal) com saída do protótipo Node, se existir.

Uso:
  .venv\\Scripts\\python.exe static/browser-prototype/benchmark/compare_fw.py
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

FIX = Path(__file__).resolve().parent / "fixtures"


def normalize(text: str) -> list[str]:
    t = text.lower()
    t = re.sub(r"[^\w\s]", " ", t, flags=re.UNICODE)
    return [w for w in t.split() if w]


def wer(ref: str, hyp: str) -> float:
    r = normalize(ref)
    h = normalize(hyp)
    if not r:
        return 0.0 if not h else 1.0
    # Levenshtein por palavra
    dp = [[0] * (len(h) + 1) for _ in range(len(r) + 1)]
    for i in range(len(r) + 1):
        dp[i][0] = i
    for j in range(len(h) + 1):
        dp[0][j] = j
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            cost = 0 if r[i - 1] == h[j - 1] else 1
            dp[i][j] = min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost,
            )
    return dp[-1][-1] / len(r)


def main() -> None:
    from faster_whisper import WhisperModel

    quality = FIX / "ptbr_quality.mp3"
    ref_path = FIX / "ptbr_quality.ref.txt"
    if not quality.exists() or not ref_path.exists():
        raise SystemExit("Gere fixtures antes (generate_fixtures.py).")

    ref = ref_path.read_text(encoding="utf-8").strip()
    print("Loading Faster Whisper base int8…")
    t0 = time.perf_counter()
    model = WhisperModel("base", device="cpu", compute_type="int8")
    t_load = time.perf_counter() - t0

    t1 = time.perf_counter()
    segments, info = model.transcribe(str(quality), language="pt", beam_size=1)
    segs = list(segments)
    t_tr = time.perf_counter() - t1
    hyp = " ".join(s.text.strip() for s in segs).strip()
    fw_wer = wer(ref, hyp)

    node_hyp = ""
    node_label = ""
    node_path = FIX / "node_bench_results.json"
    if node_path.exists():
        data = json.loads(node_path.read_text(encoding="utf-8"))
        for prefer in ("quality_chunk30_s5", "quality_no_chunk"):
            for run in data.get("runs", []):
                if run.get("label") != prefer:
                    continue
                node_hyp = (run.get("textFull") or run.get("textPreview") or "").strip()
                if node_hyp:
                    node_label = prefer
                    break
            if node_hyp:
                break

    tiny_wer = wer(ref, node_hyp) if node_hyp else None

    report = {
        "ref": ref,
        "faster_whisper": {
            "model": "base",
            "compute_type": "int8",
            "load_s": round(t_load, 3),
            "transcribe_s": round(t_tr, 3),
            "language": info.language,
            "hyp": hyp,
            "wer_vs_ref": round(fw_wer, 4),
            "segments": [
                {"start": s.start, "end": s.end, "text": s.text.strip()} for s in segs
            ],
        },
        "browser_tiny_from_node_bench": {
            "label": node_label,
            "hyp": node_hyp,
            "wer_vs_ref": None if tiny_wer is None else round(tiny_wer, 4),
            "note": (
                "Mesmo motor/modelo do protótipo (Xenova/whisper-tiny q8 via "
                "@huggingface/transformers@3.7.2 em Node/WASM). Não é o Web Worker "
                "do Chromium; WER usa texto completo quando disponível."
            ),
        },
    }
    out = FIX / "quality_compare.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
