/**
 * Benchmark Chromium — mesma lógica do Worker (chunking.js + janelas 30/5).
 * PCM é servido como binário float32 (evita OOM do Array.from no evaluate).
 *
 * Uso: node run_browser_chunk_bench.mjs
 *      node run_browser_chunk_bench.mjs --only=60,300
 */
import { createServer } from "http";
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import wavefile from "wavefile";

const { WaveFile } = wavefile;
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, "fixtures");
const PROTO = join(__dirname, "..");
const PCM_DIR = join(FIX, "_pcm");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = await import(
    pathToFileURL(join(__dirname, "../../../tmp_browser_proto_test/node_modules/playwright/index.mjs")).href
  ));
}

function parseOnly() {
  const arg = process.argv.find((a) => a.startsWith("--only="));
  if (!arg) return [60, 300, 600];
  return arg
    .slice(7)
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Boolean);
}

function wavToPcmFile(wavPath, outPath) {
  const wav = new WaveFile(readFileSync(wavPath));
  wav.toBitDepth("32f");
  wav.toSampleRate(16000);
  let samples = wav.getSamples(false, Float32Array);
  if (Array.isArray(samples)) samples = samples[0];
  writeFileSync(outPath, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  return samples.length / 16000;
}

const html = `<!doctype html><meta charset="utf-8"><title>chunk-bench</title>
<script type="module">
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";
import {
  planWindows, mergeWindowResults, coverageStats,
  DEFAULT_CHUNK_S, DEFAULT_STRIDE_S, SAMPLE_RATE,
} from "./chunking.js";
env.allowLocalModels = false;

window.__runFile = async (pcmUrl) => {
  const buf = await fetch(pcmUrl).then((r) => {
    if (!r.ok) throw new Error("fetch pcm " + r.status);
    return r.arrayBuffer();
  });
  const samples = new Float32Array(buf);
  const durationSec = samples.length / SAMPLE_RATE;
  const tLoad0 = performance.now();
  const tr = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", {
    dtype: "q8",
    device: "wasm",
  });
  const tLoad1 = performance.now();
  const windows = planWindows(durationSec, DEFAULT_CHUNK_S, DEFAULT_STRIDE_S);
  const windowResults = [];
  const t0 = performance.now();
  for (let i = 0; i < windows.length; i++) {
    const win = windows[i];
    const a = Math.floor(win.offsetSec * SAMPLE_RATE);
    const b = Math.min(samples.length, Math.ceil(win.endSec * SAMPLE_RATE));
    const slice = samples.slice(a, b);
    const out = await tr(slice, {
      return_timestamps: true,
      language: "portuguese",
      task: "transcribe",
    });
    windowResults.push({ window: win, chunks: out.chunks || [] });
    await new Promise((r) => setTimeout(r, 0));
  }
  const t1 = performance.now();
  const merged = mergeWindowResults(windowResults, durationSec, DEFAULT_STRIDE_S);
  const stats = coverageStats(merged, durationSec);
  return {
    modelLoadMs: Math.round(tLoad1 - tLoad0),
    transcribeMs: Math.round(t1 - t0),
    wallMs: Math.round(t1 - tLoad0),
    windowCount: windows.length,
    segmentCount: merged.length,
    durationSec,
    stats,
    lastTs: merged.length ? merged[merged.length - 1].timestamp : null,
    textPreview: merged.map((c) => c.text).join(" ").slice(0, 180),
    mem: performance.memory
      ? {
          usedJSHeapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
          totalJSHeapMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1),
          jsHeapLimitMB: +(performance.memory.jsHeapSizeLimit / 1048576).toFixed(1),
        }
      : null,
  };
};
window.__ready = true;
</script>`;

mkdirSync(PCM_DIR, { recursive: true });

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  if (url.pathname === "/chunking.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    res.end(readFileSync(join(PROTO, "chunking.js")));
    return;
  }
  if (url.pathname.startsWith("/pcm/")) {
    const name = url.pathname.slice("/pcm/".length);
    const file = join(PCM_DIR, name);
    if (!file.startsWith(PCM_DIR) || !existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(readFileSync(file));
    return;
  }
  res.writeHead(404);
  res.end();
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();
const targets = parseOnly();
const results = {
  when: new Date().toISOString(),
  browser: "Chromium Playwright headless",
  device: "wasm",
  modelId: "Xenova/whisper-tiny",
  dtype: "q8",
  chunkSec: 30,
  strideSec: 5,
  memoryNote:
    "performance.memory = heap JS; não mede RSS/WASM nativo do processo Chrome. Metodologia complementar: Gerenciador de Tarefas durante run manual.",
  runs: [],
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const network = [];
page.on("request", (req) => {
  network.push({
    method: req.method(),
    url: req.url(),
    post: req.postDataBuffer()?.length || 0,
  });
});

await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });

for (const sec of targets) {
  const wav = join(FIX, `ptbr_${sec}s.wav`);
  const mp3 = join(FIX, `ptbr_${sec}s.mp3`);
  if (!existsSync(wav)) {
    results.runs.push({ label: `${sec}s`, error: "fixture ausente", pending: true });
    continue;
  }
  const pcmName = `ptbr_${sec}s.f32`;
  const pcmPath = join(PCM_DIR, pcmName);
  const durationSec = wavToPcmFile(wav, pcmPath);
  console.log("Running", sec, "s…");
  let row;
  try {
    const out = await page.evaluate(
      async (pcmUrl) => window.__runFile(pcmUrl),
      `http://127.0.0.1:${port}/pcm/${pcmName}`
    );
    const ok = out.stats?.ratio >= 0.9 && out.stats?.ordered && out.stats?.withinDuration;
    row = {
      label: `${sec}s`,
      durationSec: out.durationSec ?? durationSec,
      mp3Bytes: existsSync(mp3) ? statSync(mp3).size : null,
      pcmBytes: statSync(pcmPath).size,
      ...out,
      ok,
      error: null,
    };
  } catch (e) {
    row = {
      label: `${sec}s`,
      durationSec,
      mp3Bytes: existsSync(mp3) ? statSync(mp3).size : null,
      error: e?.message || String(e),
      ok: false,
    };
  }
  results.runs.push(row);
  console.log(
    JSON.stringify({
      label: row.label,
      ok: row.ok,
      transcribeMs: row.transcribeMs,
      lastTs: row.lastTs,
      mem: row.mem,
      error: row.error,
    })
  );
}

const suspicious = network.filter(
  (n) =>
    (n.post > 10000 && !n.url.includes("/pcm/")) ||
    n.url.includes("/transcribe")
);
results.suspiciousAudioPosts = suspicious;
results.requestSample = network
  .filter((n) => !n.url.includes("/pcm/"))
  .slice(0, 30)
  .map((n) => `${n.method} ${n.url.slice(0, 110)}`);

writeFileSync(join(FIX, "browser_chunk_bench.json"), JSON.stringify(results, null, 2));
console.log("Wrote browser_chunk_bench.json");
await browser.close();
server.close();
const failed = results.runs.some((r) => r.ok === false && !r.pending);
process.exit(failed || suspicious.length ? 2 : 0);
