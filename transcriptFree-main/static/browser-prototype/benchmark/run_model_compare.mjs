/**
 * Comparação isolada de modelos (Node/WASM) no mesmo áudio de referência.
 * Não altera o protótipo. Não envia áudio a APIs de STT.
 *
 * Uso: node run_model_compare.mjs
 */
import { pipeline, env } from "@huggingface/transformers";
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import wavefile from "wavefile";
import {
  planWindows,
  mergeWindowResults,
  coverageStats,
  DEFAULT_CHUNK_S,
  DEFAULT_STRIDE_S,
  SAMPLE_RATE,
} from "../chunking.js";

const { WaveFile } = wavefile;
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, "fixtures");
env.allowLocalModels = false;

function loadWav(path) {
  const wav = new WaveFile(readFileSync(path));
  wav.toBitDepth("32f");
  wav.toSampleRate(SAMPLE_RATE);
  let samples = wav.getSamples(false, Float32Array);
  if (Array.isArray(samples)) samples = samples[0];
  return samples;
}

function normalizeWords(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function wer(ref, hyp) {
  const r = normalizeWords(ref);
  const h = normalizeWords(hyp);
  if (!r.length) return h.length ? 1 : 0;
  const dp = Array.from({ length: r.length + 1 }, () => Array(h.length + 1).fill(0));
  for (let i = 0; i <= r.length; i++) dp[i][0] = i;
  for (let j = 0; j <= h.length; j++) dp[0][j] = j;
  for (let i = 1; i <= r.length; i++) {
    for (let j = 1; j <= h.length; j++) {
      const c = r[i - 1] === h[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + c);
    }
  }
  return dp[r.length][h.length] / r.length;
}

async function transcribeChunked(tr, samples) {
  const durationSec = samples.length / SAMPLE_RATE;
  const windows = planWindows(durationSec, DEFAULT_CHUNK_S, DEFAULT_STRIDE_S);
  const windowResults = [];
  const t0 = performance.now();
  for (const win of windows) {
    const a = Math.floor(win.offsetSec * SAMPLE_RATE);
    const b = Math.min(samples.length, Math.ceil(win.endSec * SAMPLE_RATE));
    const out = await tr(samples.slice(a, b), {
      return_timestamps: true,
      language: "portuguese",
      task: "transcribe",
    });
    windowResults.push({ window: win, chunks: out.chunks || [] });
  }
  const t1 = performance.now();
  const merged = mergeWindowResults(windowResults, durationSec, DEFAULT_STRIDE_S);
  return {
    text: merged.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim(),
    chunks: merged,
    durationSec,
    windowCount: windows.length,
    transcribeMs: Math.round(t1 - t0),
    stats: coverageStats(merged, durationSec),
  };
}

const configs = [
  { id: "Xenova/whisper-tiny", dtype: "q8", label: "tiny_q8" },
  { id: "Xenova/whisper-tiny", dtype: "q4", label: "tiny_q4" },
  { id: "Xenova/whisper-base", dtype: "q8", label: "base_q8" },
];

const qualityWav = join(FIX, "ptbr_quality.wav");
const qualityRef = join(FIX, "ptbr_quality.ref.txt");
const longWav = join(FIX, "ptbr_60s.wav");
if (!existsSync(qualityWav) || !existsSync(qualityRef)) {
  console.error("Gere fixtures (generate_fixtures.py)");
  process.exit(1);
}

const ref = readFileSync(qualityRef, "utf8").trim();
const qualitySamples = loadWav(qualityWav);
const longSamples = existsSync(longWav) ? loadWav(longWav) : null;

const report = {
  when: new Date().toISOString(),
  runtime: "node",
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  transformers: "3.7.2",
  device: "cpu/wasm",
  chunking: { chunkSec: DEFAULT_CHUNK_S, strideSec: DEFAULT_STRIDE_S },
  werNormalization:
    "lower + NFD strip accents + remove punctuation + whitespace split (mesmo método do harness)",
  referenceAudio: {
    file: "ptbr_quality.wav",
    durationSec: qualitySamples.length / SAMPLE_RATE,
    mp3Bytes: existsSync(join(FIX, "ptbr_quality.mp3"))
      ? statSync(join(FIX, "ptbr_quality.mp3")).size
      : null,
    refText: ref,
  },
  runs: [],
};

for (const cfg of configs) {
  console.log("Loading", cfg.label, cfg.id, cfg.dtype);
  const mem0 = process.memoryUsage();
  const tLoad0 = performance.now();
  let tr;
  let error = null;
  try {
    tr = await pipeline("automatic-speech-recognition", cfg.id, {
      dtype: cfg.dtype,
      device: "cpu",
    });
  } catch (e) {
    error = e?.message || String(e);
  }
  const tLoad1 = performance.now();
  const mem1 = process.memoryUsage();

  const row = {
    label: cfg.label,
    modelId: cfg.id,
    dtype: cfg.dtype,
    modelLoadMs: Math.round(tLoad1 - tLoad0),
    rssAfterLoadMB: +((mem1.rss - mem0.rss) / 1048576).toFixed(1),
    heapAfterLoadMB: +(mem1.heapUsed / 1048576).toFixed(1),
    error,
    quality: null,
    long60: null,
  };

  if (!error) {
    const q = await transcribeChunked(tr, qualitySamples);
    row.quality = {
      wer: +wer(ref, q.text).toFixed(4),
      hyp: q.text,
      transcribeMs: q.transcribeMs,
      stats: q.stats,
      windowCount: q.windowCount,
    };
    console.log(cfg.label, "quality WER", row.quality.wer, "ms", q.transcribeMs);

    if (longSamples) {
      const l = await transcribeChunked(tr, longSamples);
      row.long60 = {
        durationSec: l.durationSec,
        transcribeMs: l.transcribeMs,
        rtf: +(l.transcribeMs / 1000 / l.durationSec).toFixed(3),
        stats: l.stats,
        windowCount: l.windowCount,
        textPreview: l.text.slice(0, 160),
      };
      console.log(cfg.label, "60s ms", l.transcribeMs, "ratio", l.stats.ratio);
    }
  } else {
    console.log(cfg.label, "ERROR", error);
  }

  // Liberar para próximo modelo
  tr = null;
  if (global.gc) global.gc();
  report.runs.push(row);
}

writeFileSync(join(FIX, "model_compare_node.json"), JSON.stringify(report, null, 2));
console.log("Wrote model_compare_node.json");
