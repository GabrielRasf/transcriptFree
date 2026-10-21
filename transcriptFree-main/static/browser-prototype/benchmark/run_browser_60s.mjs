/**
 * Medição única no Chromium: 60s com chunk_length_s (página isolada, não usa app.js).
 * Requer: fixtures/ptbr_60s.wav, npm i playwright (ou reuse tmp_browser_proto_test).
 */
import { createServer } from "http";
import { readFileSync, existsSync, writeFileSync, statSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, "fixtures");
const wavPath = join(FIX, "ptbr_60s.wav");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = await import(
    pathToFileURL(
      join(__dirname, "../../../tmp_browser_proto_test/node_modules/playwright/index.mjs")
    ).href
  ));
}

const html = `<!doctype html><meta charset="utf-8"><title>bench60</title>
<script type="module">
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";
env.allowLocalModels = false;
window.__run = async (samples) => {
  const t0 = performance.now();
  const tLoad0 = performance.now();
  const tr = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", {
    dtype: "q8",
    device: "wasm",
  });
  const tLoad1 = performance.now();
  const t1 = performance.now();
  const out = await tr(samples, {
    return_timestamps: true,
    language: "portuguese",
    task: "transcribe",
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  const t2 = performance.now();
  return {
    modelLoadMs: Math.round(tLoad1 - tLoad0),
    transcribeMs: Math.round(t2 - t1),
    wallMs: Math.round(t2 - t0),
    text: (out.text || "").trim().slice(0, 200),
    chunks: (out.chunks || []).length,
    lastTs: out.chunks?.length ? out.chunks[out.chunks.length - 1].timestamp : null,
    mem: performance.memory ? {
      usedJSHeapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
      totalJSHeapMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1),
      jsHeapLimitMB: +(performance.memory.jsHeapSizeLimit / 1048576).toFixed(1),
    } : null,
  };
};
window.__ready = true;
</script>`;

if (!existsSync(wavPath)) {
  console.error("Missing", wavPath);
  process.exit(1);
}

const server = createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const network = [];
page.on("request", (req) => {
  network.push({ method: req.method(), url: req.url(), post: req.postDataBuffer()?.length || 0 });
});
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });

// Decode wav in Node → pass Float32Array to page (same rate as fixtures)
import wavefile from "wavefile";
const { WaveFile } = wavefile;
const wav = new WaveFile(readFileSync(wavPath));
wav.toBitDepth("32f");
wav.toSampleRate(16000);
let samples = wav.getSamples(false, Float32Array);
if (Array.isArray(samples)) samples = samples[0];

const result = await page.evaluate(async (arr) => {
  const samples = new Float32Array(arr);
  return window.__run(samples);
}, Array.from(samples));

const suspicious = network.filter((n) => n.post > 10000 || n.url.includes("/transcribe"));
const out = {
  ...result,
  durationSec: samples.length / 16000,
  mp3Bytes: existsSync(join(FIX, "ptbr_60s.mp3"))
    ? statSync(join(FIX, "ptbr_60s.mp3")).size
    : null,
  browser: "Chromium Playwright headless",
  device: "wasm",
  modelId: "Xenova/whisper-tiny",
  dtype: "q8",
  suspiciousPosts: suspicious,
  requestCount: network.length,
};
writeFileSync(join(FIX, "browser_60s_results.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
process.exit(suspicious.length ? 2 : 0);
