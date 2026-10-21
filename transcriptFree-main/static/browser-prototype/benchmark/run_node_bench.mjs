/**
 * Benchmark Node (WASM/CPU) — isolado do fluxo FastAPI.
 *
 * Pré-requisitos:
 *   1) python generate_fixtures.py
 *   2) npm i @huggingface/transformers@3.7.2 wavefile  (nesta pasta ou use NODE_PATH)
 *
 * Uso (a partir de static/browser-prototype/benchmark):
 *   node run_node_bench.mjs
 *   node run_node_bench.mjs --only=60,300
 *
 * Não envia áudio a APIs de STT. Modelo pode baixar do Hub (pesos).
 */

import { pipeline, env } from "@huggingface/transformers";
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import wavefile from "wavefile";
const { WaveFile } = wavefile;
import { planWindows, pcmBytesMono16k, auditMergedChunks, findCoverageGaps } from "./chunking.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, "fixtures");
const MODEL_ID = "Xenova/whisper-tiny";
const DTYPE = "q8";

env.allowLocalModels = false;

function parseOnly() {
  const arg = process.argv.find((a) => a.startsWith("--only="));
  if (!arg) return null;
  return new Set(arg.slice(7).split(",").map((s) => Number(s.trim())));
}

function loadWav16k(path) {
  const wav = new WaveFile(readFileSync(path));
  wav.toBitDepth("32f");
  wav.toSampleRate(16000);
  let samples = wav.getSamples(false, Float32Array);
  if (Array.isArray(samples)) {
    const ch0 = samples[0];
    const out = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) {
      let s = 0;
      for (let c = 0; c < samples.length; c++) s += samples[c][i];
      out[i] = s / samples.length;
    }
    samples = out;
  }
  return samples;
}

function memSnap() {
  const m = process.memoryUsage();
  return {
    rssMB: +(m.rss / 1048576).toFixed(1),
    heapUsedMB: +(m.heapUsed / 1048576).toFixed(1),
    externalMB: +(m.external / 1048576).toFixed(1),
  };
}

async function main() {
  const only = parseOnly();
  const targets = [60, 300, 600].filter((s) => !only || only.has(s));
  const qualityWav = join(FIX, "ptbr_quality.wav");

  console.log("Loading model…", MODEL_ID, DTYPE);
  const tLoad0 = performance.now();
  const mem0 = memSnap();
  const transcriber = await pipeline("automatic-speech-recognition", MODEL_ID, {
    dtype: DTYPE,
    device: "cpu",
  });
  const tLoad1 = performance.now();
  const mem1 = memSnap();

  const results = {
    when: new Date().toISOString(),
    runtime: "node",
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    modelId: MODEL_ID,
    dtype: DTYPE,
    device: "cpu/wasm",
    modelLoadMs: Math.round(tLoad1 - tLoad0),
    memAfterModel: mem1,
    memBeforeModel: mem0,
    note:
      "Pico de memória do browser não é medido aqui. RSS/heap Node são aproximados (não incluem todo o WASM nativo com precisão).",
    runs: [],
  };

  async function runFile(label, wavPath, opts) {
    if (!existsSync(wavPath)) {
      console.warn("SKIP missing", wavPath);
      return;
    }
    const mp3Path = wavPath.replace(/\.wav$/, ".mp3");
    const samples = loadWav16k(wavPath);
    const durationSec = samples.length / 16000;
    const pcmB = pcmBytesMono16k(durationSec);
    global.gc?.();
    const memBefore = memSnap();
    const t0 = performance.now();
    let output;
    let error = null;
    try {
      output = await transcriber(samples, {
        return_timestamps: true,
        language: "portuguese",
        task: "transcribe",
        ...opts,
      });
    } catch (e) {
      error = e?.message || String(e);
    }
    const t1 = performance.now();
    const memAfter = memSnap();
    const chunks = output?.chunks || [];
    const issues = auditMergedChunks(chunks);
    const gaps = findCoverageGaps(chunks, durationSec, 2.0);
    const windows =
      opts.chunk_length_s > 0
        ? planWindows(durationSec, opts.chunk_length_s, opts.stride_length_s ?? opts.chunk_length_s / 6)
        : [];

    const row = {
      label,
      wav: wavPath,
      mp3Bytes: existsSync(mp3Path) ? statSync(mp3Path).size : null,
      durationSec: +durationSec.toFixed(3),
      pcmBytes: pcmB,
      pcmMB: +(pcmB / 1048576).toFixed(2),
      opts,
      plannedWindows: windows.length,
      transcribeMs: Math.round(t1 - t0),
      realtimeFactor: durationSec > 0 ? +((t1 - t0) / 1000 / durationSec).toFixed(3) : null,
      memBefore,
      memAfter,
      deltaHeapMB: +(memAfter.heapUsedMB - memBefore.heapUsedMB).toFixed(1),
      deltaRssMB: +(memAfter.rssMB - memBefore.rssMB).toFixed(1),
      chunkCount: chunks.length,
      textFull: (output?.text || "").trim(),
      textPreview: (output?.text || "").trim().slice(0, 180),
      lastTimestamp: chunks.length
        ? chunks[chunks.length - 1].timestamp
        : null,
      auditIssues: issues.slice(0, 20),
      coverageGaps: gaps.slice(0, 10),
      error,
    };
    results.runs.push(row);
    console.log(
      JSON.stringify({
        label,
        durationSec: row.durationSec,
        transcribeMs: row.transcribeMs,
        rtf: row.realtimeFactor,
        chunks: row.chunkCount,
        lastTs: row.lastTimestamp,
        error,
      })
    );
  }

  // Qualidade curta: com e sem chunking
  if (existsSync(qualityWav)) {
    await runFile("quality_no_chunk", qualityWav, {});
    await runFile("quality_chunk30_s5", qualityWav, {
      chunk_length_s: 30,
      stride_length_s: 5,
    });
  }

  for (const sec of targets) {
    const wav = join(FIX, `ptbr_${sec}s.wav`);
    // Demonstra truncamento sem chunking (só primeiros ~30s de conteúdo útil)
    if (sec <= 60) {
      await runFile(`${sec}s_no_chunk`, wav, {});
    }
    await runFile(`${sec}s_chunk30_s5`, wav, {
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    if (sec === 60) {
      await runFile(`${sec}s_chunk25_s5`, wav, {
        chunk_length_s: 25,
        stride_length_s: 5,
      });
    }
  }

  const outJson = join(FIX, "node_bench_results.json");
  writeFileSync(outJson, JSON.stringify(results, null, 2), "utf8");
  console.log("Wrote", outJson);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
