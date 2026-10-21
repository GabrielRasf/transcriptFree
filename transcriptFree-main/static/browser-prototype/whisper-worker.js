/**
 * Web Worker — Transformers.js + Xenova/whisper-tiny (multilingual) com chunking.
 *
 * Biblioteca: @huggingface/transformers@3.7.2
 * Chunking: janelas 30 s / stride 5 s (API chunk_length_s / stride_length_s da lib,
 * implementada aqui por janela para progresso + cancelamento cooperativo).
 *
 * O áudio chega como Float32Array transferido; nunca é enviado por HTTP.
 */

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";
import {
  DEFAULT_CHUNK_S,
  DEFAULT_STRIDE_S,
  SAMPLE_RATE,
  planWindows,
  mergeWindowResults,
} from "./chunking.js";

const MODEL_ID = "Xenova/whisper-tiny";

/** @type {Awaited<ReturnType<typeof pipeline>> | null} */
let transcriber = null;
let currentDevice = "";
let cancelled = false;

// Padrão remoto (Hub). allowLocalModels=true sem pesos locais faz o
// Transformers.js pedir /models/... no mesmo origin; na Vercel o rewrite SPA
// devolve index.html (200) e quebra com "Unexpected token '<' ... JSON".
env.allowLocalModels = false;
env.useBrowserCache = true;

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === "cancel") {
      cancelled = true;
      self.postMessage({ type: "status", phase: "cancel", message: "Cancelamento solicitado…" });
      return;
    }
    if (msg.type === "load") {
      cancelled = false;
      await loadModel(msg);
      return;
    }
    if (msg.type === "transcribe") {
      cancelled = false;
      await runTranscribe(msg);
      return;
    }
    if (msg.type === "dispose") {
      cancelled = true;
      transcriber = null;
      currentDevice = "";
      self.postMessage({ type: "disposed" });
      return;
    }
  } catch (err) {
    const message = formatError(err);
    self.postMessage({ type: "error", message });
  }
};

function formatError(err) {
  const raw = err?.message || String(err);
  if (/out of memory|oom|allocation|Array buffer|memory/i.test(raw)) {
    return `Memória insuficiente para este áudio no navegador. Tente um arquivo menor ou feche outras abas. Detalhe: ${raw}`;
  }
  if (/Unexpected token\s+'<'|is not valid JSON|<!DOCTYPE/i.test(raw)) {
    return (
      "Falha ao carregar o modelo: foi recebida uma página HTML em vez do arquivo JSON/ONNX. " +
      "Isso costuma ocorrer se o site tentar servir /models/ sem os pesos locais (rewrite SPA). " +
      "O modo navegador deve baixar o modelo do Hugging Face Hub. Detalhe: " +
      raw
    );
  }
  return raw;
}

/**
 * @param {{ device?: string, localModelPath?: string, allowRemoteModels?: boolean }} opts
 */
async function loadModel(opts) {
  const device = opts.device === "webgpu" ? "webgpu" : "wasm";
  if (opts.localModelPath) {
    env.localModelPath = opts.localModelPath;
    env.allowLocalModels = true;
    // Só bloqueia o Hub se o chamador pedir explicitamente pesos locais exclusivos.
    env.allowRemoteModels = opts.allowRemoteModels !== true;
  } else {
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
  }

  if (transcriber && currentDevice === device) {
    self.postMessage({
      type: "ready",
      device: currentDevice,
      modelId: MODEL_ID,
      dtype: "q8",
    });
    return;
  }

  transcriber = null;
  currentDevice = device;

  self.postMessage({ type: "status", phase: "model", message: "Baixando / carregando modelo…" });

  const progress_callback = (prog) => {
    if (!prog || typeof prog !== "object") return;
    self.postMessage({
      type: "progress",
      phase: "model",
      progress: prog,
    });
  };

  try {
    transcriber = await pipeline("automatic-speech-recognition", MODEL_ID, {
      device,
      dtype: "q8",
      progress_callback,
    });
  } catch (err) {
    if (device !== "webgpu") throw err;
    self.postMessage({
      type: "status",
      phase: "model",
      message: "WebGPU falhou; tentando WASM…",
    });
    currentDevice = "wasm";
    transcriber = await pipeline("automatic-speech-recognition", MODEL_ID, {
      device: "wasm",
      dtype: "q8",
      progress_callback,
    });
  }

  self.postMessage({
    type: "ready",
    device: currentDevice,
    modelId: MODEL_ID,
    dtype: "q8",
  });
}

/**
 * @param {{ samples: Float32Array, samplingRate: number, fileLabel?: string, chunkSec?: number, strideSec?: number }} msg
 */
async function runTranscribe(msg) {
  if (!transcriber) {
    throw new Error("Modelo ainda não carregado.");
  }
  const samples = msg.samples;
  const samplingRate = msg.samplingRate || SAMPLE_RATE;
  const chunkSec = msg.chunkSec ?? DEFAULT_CHUNK_S;
  const strideSec = msg.strideSec ?? DEFAULT_STRIDE_S;
  const fileLabel = msg.fileLabel || "áudio";

  if (!(samples instanceof Float32Array) || samples.length === 0) {
    throw new Error("Áudio inválido ou vazio.");
  }
  if (samplingRate !== SAMPLE_RATE) {
    throw new Error(`Taxa de amostragem inválida: ${samplingRate} (esperado ${SAMPLE_RATE}).`);
  }

  const durationSec = samples.length / SAMPLE_RATE;
  const windows = planWindows(durationSec, chunkSec, strideSec);

  self.postMessage({
    type: "status",
    phase: "transcribe",
    message: `Transcrevendo ${fileLabel} (${windows.length} janela(s), ${chunkSec}s / stride ${strideSec}s)…`,
  });

  /** @type {{ window: object, chunks: object[] }[]} */
  const windowResults = [];

  try {
    for (let i = 0; i < windows.length; i++) {
      if (cancelled) {
        self.postMessage({ type: "cancelled", fileLabel });
        return;
      }

      const win = windows[i];
      const startSample = Math.floor(win.offsetSec * SAMPLE_RATE);
      const endSample = Math.min(samples.length, Math.ceil(win.endSec * SAMPLE_RATE));
      // Cópia curta da janela (≤30s) — libera após inferência
      const slice = samples.slice(startSample, endSample);

      self.postMessage({
        type: "progress",
        phase: "chunk",
        fileLabel,
        chunkIndex: i,
        chunkTotal: windows.length,
        offsetSec: win.offsetSec,
        endSec: win.endSec,
        message: `${fileLabel}: janela ${i + 1}/${windows.length} (${win.offsetSec.toFixed(0)}–${win.endSec.toFixed(0)} s)`,
      });

      let output;
      try {
        // Janela ≤ chunkSec: sem chunk_length_s aninhado (evita truncar de novo).
        // Para áudio curto (< chunk), uma única janela cobre o arquivo.
        output = await transcriber(slice, {
          return_timestamps: true,
          language: "portuguese",
          task: "transcribe",
        });
      } finally {
        // drop referência local ao slice
      }

      if (cancelled) {
        self.postMessage({ type: "cancelled", fileLabel });
        return;
      }

      const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
      windowResults.push({ window: win, chunks });
    }

    const merged = mergeWindowResults(windowResults, durationSec, strideSec);
    const text = merged.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();

    self.postMessage({
      type: "result",
      text,
      chunks: merged,
      device: currentDevice,
      modelId: MODEL_ID,
      dtype: "q8",
      durationSec,
      chunkSec,
      strideSec,
      windowCount: windows.length,
      fileLabel,
    });
  } finally {
    msg.samples = null;
  }
}
