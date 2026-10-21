#!/usr/bin/env python3
"""Faster Whisper base no mesmo áudio/ref, com normalização alinhada ao harness JS."""

from __future__ import annotations

import json
import re
import time
import unicodedata
from pathlib import Path

FIX = Path(__file__).resolve().parent / "fixtures"


def normalize_words(text: str) -> list[str]:
    t = unicodedata.normalize("NFD", text.lower())
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn")
    t = re.sub(r"[^\w\s]", " ", t, flags=re.UNICODE)
    return [w for w in t.split() if w]


def wer(ref: str, hyp: str) -> float:
    r = normalize_words(ref)
    h = normalize_words(hyp)
    if not r:
        return 0.0 if not h else 1.0
    dp = [[0] * (len(h) + 1) for _ in range(len(r) + 1)]
    for i in range(len(r) + 1):
        dp[i][0] = i
    for j in range(len(h) + 1):
        dp[0][j] = j
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            cost = 0 if r[i - 1] == h[j - 1] else 1
            dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    return dp[-1][-1] / len(r)


def main() -> None:
    from faster_whisper import WhisperModel

    quality = FIX / "ptbr_quality.mp3"
    ref = (FIX / "ptbr_quality.ref.txt").read_text(encoding="utf-8").strip()
    t0 = time.perf_counter()
    model = WhisperModel("base", device="cpu", compute_type="int8")
    t_load = time.perf_counter() - t0
    t1 = time.perf_counter()
    segs, info = model.transcribe(str(quality), language="pt", beam_size=1)
    segs = list(segs)
    t_tr = time.perf_counter() - t1
    hyp = " ".join(s.text.strip() for s in segs).strip()
    out = {
        "engine": "faster-whisper",
        "model": "base",
        "compute_type": "int8",
        "device": "cpu",
        "load_s": round(t_load, 3),
        "transcribe_s": round(t_tr, 3),
        "language": info.language,
        "hyp": hyp,
        "wer": round(wer(ref, hyp), 4),
        "ref": ref,
        "note": "Mesmo áudio/ref e normalização (lower+NFD+strip punct) do harness JS.",
    }
    path = FIX / "faster_whisper_same_wer.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
