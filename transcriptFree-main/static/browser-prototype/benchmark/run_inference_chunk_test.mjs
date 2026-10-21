/**
 * Inferência real (Node/WASM) espelhando o Worker: janelas 30/5 + mergeWindowResults.
 * Valida áudio >45s sem truncamento. Não é simulação.
 *
 * Uso: node run_inference_chunk_test.mjs
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
  auditMergedChunks,
  DEFAULT_CHUNK_S,
  DEFAULT_STRIDE_S,
  SAMPLE_RATE,
} from "../chunking.js";

const { WaveFile } = wavefile;
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, "fixtures");
const wavPath = join(FIX, "ptbr_60s.wav");

env.allowLocalModels = false;

function loadWav(path) {
  const wav = new WaveFile(readFileSync(path));
  wav.toBitDepth("32f");
  wav.toSampleRate(SAMPLE_RATE);
  let samples = wav.getSamples(false, Float32Array);
  if (Array.isArray(samples)) samples = samples[0];
  return samples;
}

if (!existsSync(wavPath)) {
  console.error("Gere fixtures antes (generate_fixtures.py)");
  process.exit(1);
}

const samples = loadWav(wavPath);
const durationSec = samples.length / SAMPLE_RATE;
if (durationSec <= 45) {
  console.error("Fixture deve ter >45s, got", durationSec);
  process.exit(1);
}

const tLoad0 = performance.now();
const tr = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", {
  dtype: "q8",
  device: "cpu",
});
const tLoad1 = performance.now();

const windows = planWindows(durationSec, DEFAULT_CHUNK_S, DEFAULT_STRIDE_S);
const windowResults = [];
const t0 = performance.now();
for (const win of windows) {
  const a = Math.floor(win.offsetSec * SAMPLE_RATE);
  const b = Math.min(samples.length, Math.ceil(win.endSec * SAMPLE_RATE));
  const slice = samples.slice(a, b);
  const out = await tr(slice, {
    return_timestamps: true,
    language: "portuguese",
    task: "transcribe",
  });
  windowResults.push({ window: win, chunks: out.chunks || [] });
}
const t1 = performance.now();

const merged = mergeWindowResults(windowResults, durationSec, DEFAULT_STRIDE_S);
const stats = coverageStats(merged, durationSec);
const issues = auditMergedChunks(merged);

const report = {
  ok:
    stats.ratio >= 0.9 &&
    stats.ordered &&
    stats.withinDuration &&
    windows.length >= 2 &&
    windows[windows.length - 1].endSec === durationSec,
  durationSec,
  mp3Bytes: existsSync(join(FIX, "ptbr_60s.mp3"))
    ? statSync(join(FIX, "ptbr_60s.mp3")).size
    : null,
  modelLoadMs: Math.round(tLoad1 - tLoad0),
  transcribeMs: Math.round(t1 - t0),
  windowCount: windows.length,
  segmentCount: merged.length,
  stats,
  auditIssueCount: issues.length,
  textPreview: merged
    .map((c) => c.text)
    .join(" ")
    .slice(0, 220),
  lastTimestamp: merged.length ? merged[merged.length - 1].timestamp : null,
};

writeFileSync(join(FIX, "inference_chunk_test.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 2);
