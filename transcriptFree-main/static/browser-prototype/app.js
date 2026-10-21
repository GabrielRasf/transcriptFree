/**
 * UI do protótipo experimental — não altera o fluxo principal em static/index.html.
 * Chunking 30s/stride 5s no Web Worker (ver whisper-worker.js + chunking.js).
 */

import { chunksToTxt, safeStem } from "./segments.js";
import { coverageStats } from "./chunking.js";

const MODEL_ID = "Xenova/whisper-tiny";
const SAMPLE_RATE = 16000;

const fileInput = document.getElementById("audio");
const btnTranscribe = document.getElementById("btnTranscribe");
const btnCancel = document.getElementById("btnCancel");
const btnDownload = document.getElementById("btnDownload");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const output = document.getElementById("output");
const preview = document.getElementById("preview");

/** @type {File[]} */
let selectedFiles = [];
/** @type {string} */
let resultText = "";
/** @type {Worker | null} */
let worker = null;
/** @type {((msg: object) => void) | null} */
let pendingReady = null;
/** @type {boolean} */
let busy = false;
/** @type {boolean} */
let cancelRequested = false;
/** @type {number | null} */
let startedAt = null;

function setStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = "status" + (type ? ` ${type}` : "");
}

function setMeta(msg) {
  metaEl.textContent = msg || "";
}

async function canUseWebGpu() {
  if (!navigator.gpu?.requestAdapter) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

function createWorker() {
  disposeWorker(false);
  worker = new Worker(new URL("./whisper-worker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = onWorkerMessage;
  worker.onerror = (ev) => {
    busy = false;
    btnTranscribe.disabled = !selectedFiles.length;
    btnCancel.disabled = true;
    pendingReady = null;
    setStatus(`Erro no Worker: ${ev.message || "falha desconhecida"}`, "error");
  };
}

function disposeWorker(hard = true) {
  pendingReady = null;
  if (worker) {
    if (hard) {
      try {
        worker.postMessage({ type: "cancel" });
      } catch {
        /* ignore */
      }
      worker.terminate();
    }
    worker = null;
  }
}

/**
 * @param {File} file
 * @returns {Promise<Float32Array>}
 */
async function decodeToMono16k(file) {
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (err) {
    throw new Error(`Falha ao ler o arquivo (${file.name}): ${err?.message || err}`);
  }
  const ctx = new AudioContext();
  try {
    let decoded;
    try {
      decoded = await ctx.decodeAudioData(buffer.slice(0));
    } catch (err) {
      throw new Error(
        `Não foi possível decodificar "${file.name}". Use MP3/WAV/M4A compatível com o navegador. (${err?.message || err})`
      );
    }
    const ch0 = decoded.getChannelData(0);
    let mono;
    if (decoded.numberOfChannels > 1) {
      mono = new Float32Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) {
        let sum = 0;
        for (let c = 0; c < decoded.numberOfChannels; c++) {
          sum += decoded.getChannelData(c)[i];
        }
        mono[i] = sum / decoded.numberOfChannels;
      }
    } else {
      mono = ch0;
    }
    if (decoded.sampleRate === SAMPLE_RATE) {
      return mono.slice(0);
    }
    const ratio = decoded.sampleRate / SAMPLE_RATE;
    const newLen = Math.max(1, Math.round(mono.length / ratio));
    const out = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      out[i] = mono[Math.min(mono.length - 1, Math.floor(i * ratio))];
    }
    return out;
  } finally {
    await ctx.close();
  }
}

function onWorkerMessage(ev) {
  const msg = ev.data || {};

  if (pendingReady) {
    if (msg.type === "ready" || msg.type === "error") {
      const done = pendingReady;
      pendingReady = null;
      done(msg);
    }
  }

  if (msg.type === "status") {
    setStatus(msg.message || msg.phase, "");
    return;
  }
  if (msg.type === "progress") {
    if (msg.phase === "chunk") {
      setStatus(msg.message || `Janela ${(msg.chunkIndex || 0) + 1}/${msg.chunkTotal || "?"}`, "");
      return;
    }
    const p = msg.progress;
    if (p?.status === "progress" && p.file) {
      const pct = typeof p.progress === "number" ? ` ${Math.round(p.progress)}%` : "";
      setStatus(`Modelo: ${p.file}${pct}`, "");
    }
    return;
  }
  if (msg.type === "ready") {
    setMeta(`Modelo ${msg.modelId} · dtype q8 · device ${msg.device} · chunk 30s / stride 5s`);
    return;
  }
  if (msg.type === "cancelled") {
    setStatus("Processamento cancelado.", "error");
    return;
  }
  if (msg.type === "error") {
    // Erros de um arquivo são tratados no loop; aqui cobre falhas fora do await dedicado.
    setStatus(msg.message || "Erro na transcrição.", "error");
  }
}

function waitForReady() {
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(new Error("Worker não iniciado."));
      return;
    }
    pendingReady = (msg) => {
      if (msg.type === "ready") resolve(msg);
      else reject(new Error(msg.message || "Falha ao carregar modelo."));
    };
  });
}

/**
 * @param {object} payload
 * @returns {Promise<object>}
 */
function waitForTranscribeResult(payload) {
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(new Error("Worker não iniciado."));
      return;
    }
    const cleanup = () => {
      clearInterval(poll);
      worker?.removeEventListener("message", onMsg);
    };
    const onMsg = (ev) => {
      const msg = ev.data || {};
      if (msg.type === "progress" || msg.type === "status") {
        onWorkerMessage(ev);
        return;
      }
      if (msg.type === "result" || msg.type === "cancelled" || msg.type === "error") {
        cleanup();
        resolve(msg);
      }
    };
    const poll = setInterval(() => {
      if (cancelRequested || !worker) {
        cleanup();
        resolve({ type: "cancelled" });
      }
    }, 120);
    worker.addEventListener("message", onMsg);
    try {
      const buf = payload.samples.buffer;
      worker.postMessage(payload, [buf]);
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

fileInput.addEventListener("change", () => {
  selectedFiles = Array.from(fileInput.files || []);
  resultText = "";
  output.textContent = "";
  preview.hidden = true;
  btnDownload.disabled = true;
  btnTranscribe.disabled = !selectedFiles.length || busy;
  if (selectedFiles.length === 1) {
    setStatus(`Arquivo: ${selectedFiles[0].name}. Clique em Transcrever (navegador).`);
  } else if (selectedFiles.length > 1) {
    setStatus(`${selectedFiles.length} arquivos selecionados. Serão processados em sequência.`);
  }
});

btnCancel.addEventListener("click", () => {
  if (!busy) return;
  cancelRequested = true;
  try {
    worker?.postMessage({ type: "cancel" });
  } catch {
    /* ignore */
  }
  // Garante UI livre mesmo se o WASM estiver bloqueado no meio da janela
  disposeWorker(true);
  busy = false;
  btnTranscribe.disabled = !selectedFiles.length;
  btnCancel.disabled = true;
  setStatus("Processamento cancelado. Worker encerrado.", "error");
});

btnDownload.addEventListener("click", () => {
  if (!resultText.trim()) return;
  const base =
    selectedFiles.length === 1
      ? safeStem(selectedFiles[0].name)
      : "transcricao_lote";
  const name = `${base}.txt`;
  const blob = new Blob([resultText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
});

btnTranscribe.addEventListener("click", async () => {
  if (!selectedFiles.length || busy) return;
  busy = true;
  cancelRequested = false;
  btnTranscribe.disabled = true;
  btnCancel.disabled = false;
  btnDownload.disabled = true;
  preview.hidden = true;
  resultText = "";
  output.textContent = "";
  startedAt = performance.now();

  /** @type {string[]} */
  const parts = [];
  /** @type {string[]} */
  const errors = [];

  try {
    createWorker();
    const useGpu = await canUseWebGpu();
    const device = useGpu ? "webgpu" : "wasm";
    worker.postMessage({ type: "load", device, allowRemoteModels: true });
    await waitForReady();

    for (let fi = 0; fi < selectedFiles.length; fi++) {
      if (cancelRequested) break;
      const file = selectedFiles[fi];
      const label = `[${fi + 1}/${selectedFiles.length}] ${file.name}`;
      setStatus(`Decodificando ${label}…`);

      let samples = null;
      try {
        samples = await decodeToMono16k(file);
      } catch (err) {
        errors.push(`${file.name}: ${err?.message || err}`);
        setStatus(errors[errors.length - 1], "error");
        continue; // próximo arquivo
      }

      if (cancelRequested) {
        samples = null;
        break;
      }

      const durationSec = samples.length / SAMPLE_RATE;
      setMeta(
        `${label} · PCM ${SAMPLE_RATE} Hz · ${durationSec.toFixed(1)} s · chunk 30/5 · sem envio`
      );

      const msg = await waitForTranscribeResult({
        type: "transcribe",
        samples,
        samplingRate: SAMPLE_RATE,
        fileLabel: label,
      });
      samples = null;

      if (msg.type === "cancelled" || cancelRequested) {
        setStatus("Processamento cancelado.", "error");
        break;
      }
      if (msg.type === "error") {
        errors.push(`${file.name}: ${msg.message || "erro"}`);
        setStatus(errors[errors.length - 1], "error");
        continue;
      }

      const chunks = msg.chunks || [];
      const stats = coverageStats(chunks, msg.durationSec || durationSec);
      const txt = chunksToTxt(chunks);
      const body =
        txt ||
        ((msg.text || "").trim() ? `${msg.text.trim()}\n` : "");
      if (!body.trim()) {
        errors.push(`${file.name}: nenhuma fala detectada.`);
        continue;
      }

      const header =
        selectedFiles.length > 1
          ? `=== ${file.name} · ${durationSec.toFixed(1)}s · cob. ${(stats.ratio * 100).toFixed(0)}% ===\n\n`
          : "";
      parts.push(header + body);
      setStatus(
        `Concluído ${label} · janelas ${msg.windowCount || "?"} · fim ts ${stats.lastEnd.toFixed(1)}s`,
        "ok"
      );
    }

    resultText = parts.join("\n");
    if (resultText.trim()) {
      output.textContent = resultText;
      preview.hidden = false;
      btnDownload.disabled = false;
      const elapsed =
        startedAt != null ? `${((performance.now() - startedAt) / 1000).toFixed(1)} s` : "?";
      const errNote = errors.length ? ` · ${errors.length} arquivo(s) com erro` : "";
      setStatus(
        cancelRequested
          ? "Cancelado (resultados parciais disponíveis se houver)."
          : `Transcrição concluída (somente neste dispositivo).${errNote}`,
        cancelRequested ? "error" : "ok"
      );
      setMeta(
        `${MODEL_ID} · q8 · chunk 30/5 · ${selectedFiles.length} arquivo(s) · wall ${elapsed}`
      );
    } else if (!cancelRequested) {
      setStatus(
        errors.length
          ? `Nenhum resultado. Erros: ${errors.join(" | ")}`
          : "Nenhuma fala detectada.",
        "error"
      );
    }
  } catch (err) {
    disposeWorker(true);
    setStatus(err?.message || String(err), "error");
  } finally {
    busy = false;
    btnTranscribe.disabled = !selectedFiles.length;
    btnCancel.disabled = true;
  }
});

// Aceitar vários arquivos no input
fileInput.setAttribute("multiple", "multiple");

setStatus(
  "Protótipo experimental com chunking (30s / stride 5s). O áudio permanece no navegador."
);
canUseWebGpu().then((ok) => {
  setMeta(
    `Modelo previsto: ${MODEL_ID} (q8) · WebGPU: ${ok ? "disponível" : "não (WASM)"} · chunk 30/5`
  );
});
