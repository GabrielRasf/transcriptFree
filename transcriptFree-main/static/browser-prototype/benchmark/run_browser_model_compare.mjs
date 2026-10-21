/**
 * Comparação no Chromium (WASM) — mesmo áudio de qualidade + opcional 60s.
 * PCM via arquivo binário. Sem upload a STT externos.
 *
 * Uso: node run_browser_model_compare.mjs
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

function wavToPcm(wavPath, outPath) {
  const wav = new WaveFile(readFileSync(wavPath));
  wav.toBitDepth("32f");
  wav.toSampleRate(16000);
  let samples = wav.getSamples(false, Float32Array);
  if (Array.isArray(samples)) samples = samples[0];
  writeFileSync(outPath, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  return samples.length / 16000;
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

const html = `<!doctype html><meta charset="utf-8"><title>model-compare</title>
<script type="module">
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";
import {
  planWindows, mergeWindowResults, coverageStats,
  DEFAULT_CHUNK_S, DEFAULT_STRIDE_S, SAMPLE_RATE,
} from "./chunking.js";
env.allowLocalModels = false;

window.__run = async ({ pcmUrl, modelId, dtype }) => {
  const buf = await fetch(pcmUrl).then((r) => r.arrayBuffer());
  const samples = new Float32Array(buf);
  const durationSec = samples.length / SAMPLE_RATE;
  const tLoad0 = performance.now();
  const tr = await pipeline("automatic-speech-recognition", modelId, {
    dtype,
    device: "wasm",
  });
  const tLoad1 = performance.now();
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
    await new Promise((r) => setTimeout(r, 0));
  }
  const t1 = performance.now();
  const merged = mergeWindowResults(windowResults, durationSec, DEFAULT_STRIDE_S);
  const text = merged.map((c) => c.text).join(" ").replace(/\\s+/g, " ").trim();
  return {
    modelLoadMs: Math.round(tLoad1 - tLoad0),
    transcribeMs: Math.round(t1 - t0),
    wallMs: Math.round(t1 - tLoad0),
    durationSec,
    windowCount: windows.length,
    text,
    stats: coverageStats(merged, durationSec),
    lastTs: merged.length ? merged[merged.length - 1].timestamp : null,
    mem: performance.memory
      ? {
          usedJSHeapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
          totalJSHeapMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1),
          jsHeapLimitMB: +(performance.memory.jsHeapSizeLimit / 1048576).toFixed(1),
        }
      : null,
    webgpu: Boolean(navigator.gpu),
  };
};
window.__ready = true;
</script>`;

mkdirSync(PCM_DIR, { recursive: true });
const qualityWav = join(FIX, "ptbr_quality.wav");
const ref = readFileSync(join(FIX, "ptbr_quality.ref.txt"), "utf8").trim();
const qualityPcm = "quality.f32";
wavToPcm(qualityWav, join(PCM_DIR, qualityPcm));
let longPcm = null;
if (existsSync(join(FIX, "ptbr_60s.wav"))) {
  longPcm = "ptbr_60s.f32";
  wavToPcm(join(FIX, "ptbr_60s.wav"), join(PCM_DIR, longPcm));
}

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
const base = `http://127.0.0.1:${port}`;

const configs = [
  { label: "tiny_q8", modelId: "Xenova/whisper-tiny", dtype: "q8" },
  { label: "base_q8", modelId: "Xenova/whisper-base", dtype: "q8" },
];

const report = {
  when: new Date().toISOString(),
  browser: "Chromium Playwright headless",
  device: "wasm",
  transformers: "3.7.2",
  refText: ref,
  runs: [],
  networkNote: "POST de áudio /transcribe deve permanecer vazio",
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const posts = [];
page.on("request", (req) => {
  const n = req.postDataBuffer()?.length || 0;
  if (n > 0 || req.url().includes("/transcribe")) {
    posts.push({ method: req.method(), url: req.url(), post: n });
  }
});
await page.goto(`${base}/`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });

for (const cfg of configs) {
  // Página nova por modelo para reduzir contaminação de memória/cache de pipeline
  const p = await browser.newPage();
  await p.goto(`${base}/`);
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });

  console.log("Chrome quality", cfg.label);
  let quality;
  try {
    const out = await p.evaluate(
      async (args) => window.__run(args),
      { pcmUrl: `${base}/pcm/${qualityPcm}`, modelId: cfg.modelId, dtype: cfg.dtype }
    );
    quality = {
      ...out,
      wer: +wer(ref, out.text).toFixed(4),
      ok: true,
    };
  } catch (e) {
    quality = { ok: false, error: e?.message || String(e) };
  }

  let long60 = null;
  if (longPcm && quality.ok) {
    console.log("Chrome 60s", cfg.label);
    try {
      const out = await p.evaluate(
        async (args) => window.__run(args),
        { pcmUrl: `${base}/pcm/${longPcm}`, modelId: cfg.modelId, dtype: cfg.dtype }
      );
      long60 = {
        ...out,
        rtf: +(out.transcribeMs / 1000 / out.durationSec).toFixed(3),
        textPreview: out.text.slice(0, 160),
      };
    } catch (e) {
      long60 = { error: e?.message || String(e) };
    }
  }

  await p.close();
  report.runs.push({ ...cfg, quality, long60 });
  console.log(
    JSON.stringify({
      label: cfg.label,
      wer: quality.wer,
      qMs: quality.transcribeMs,
      lMs: long60?.transcribeMs,
      err: quality.error || long60?.error,
    })
  );
}

report.suspiciousPosts = posts.filter(
  (x) => x.url.includes("/transcribe") || (x.post > 10000 && !x.url.includes("/pcm/"))
);
writeFileSync(join(FIX, "model_compare_browser.json"), JSON.stringify(report, null, 2));
console.log("Wrote model_compare_browser.json");
await browser.close();
server.close();
process.exit(report.suspiciousPosts.length ? 2 : 0);
