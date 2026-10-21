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
const HUB_CONFIG_URL = `https://huggingface.co/${MODEL_ID}/resolve/main/config.json`;

/** @type {Awaited<ReturnType<typeof pipeline>> | null} */
let transcriber = null;
let currentDevice = "";
let cancelled = false;
/** Evita limpar o Cache API em todo reload do mesmo Worker. */
let didPurgeBadCache = false;

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

function looksLikeHtml(text) {
  const t = String(text || "").trim();
  return /^<!DOCTYPE\s+html/i.test(t) || /^<html[\s>]/i.test(t);
}

function formatError(err) {
  const raw = err?.message || String(err);
  if (/out of memory|oom|allocation|Array buffer|memory/i.test(raw)) {
    return `Memória insuficiente para este áudio no navegador. Tente um arquivo menor ou feche outras abas. Detalhe: ${raw}`;
  }
  if (/Unexpected token\s+'<'|is not valid JSON|<!DOCTYPE/i.test(raw)) {
    return (
      "Falha ao carregar o modelo: HTML no lugar de JSON/ONNX. " +
      "Causas comuns: (1) cache do navegador com página do site gravada como modelo; " +
      "(2) rede/proxy bloqueando huggingface.co. " +
      "Recarregue a página após o novo deploy; se persistir, limpe " +
      "Application → Cache storage → transformers-cache. Detalhe: " +
      raw
    );
  }
  return raw;
}

/**
 * Remove entradas inválidas (HTML SPA) e paths /models/ do Cache API do Transformers.js.
 * Deploys antigos com allowLocalModels=true cacheavam index.html como config.json.
 * @returns {Promise<number>} quantidade de entradas removidas
 */
async function purgeInvalidTransformersCache() {
  if (typeof caches === "undefined") return 0;
  let purged = 0;
  let names;
  try {
    names = await caches.keys();
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!/transformers/i.test(name)) continue;
    let cache;
    try {
      cache = await caches.open(name);
    } catch {
      continue;
    }
    let keys;
    try {
      keys = await cache.keys();
    } catch {
      continue;
    }
    for (const req of keys) {
      let drop = false;
      const rawUrl = typeof req.url === "string" ? req.url : "";
      try {
        const u = new URL(rawUrl, self.location?.href || "https://localhost/");
        if (u.pathname.startsWith("/models/")) drop = true;
      } catch {
        if (rawUrl.includes("/models/")) drop = true;
      }
      if (!drop) {
        try {
          const res = await cache.match(req);
          if (res) {
            const ct = (res.headers.get("content-type") || "").toLowerCase();
            if (ct.includes("text/html")) {
              drop = true;
            } else {
              const head = (await res.clone().text()).slice(0, 64);
              if (looksLikeHtml(head)) drop = true;
            }
          }
        } catch {
          /* ignore peek errors */
        }
      }
      if (drop) {
        try {
          if (await cache.delete(req)) purged += 1;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return purged;
}

/**
 * Confirma que o Hub devolve JSON real (não HTML de bloqueio/proxy).
 */
async function assertHubConfigJson() {
  let res;
  try {
    res = await fetch(HUB_CONFIG_URL, { method: "GET", cache: "no-store" });
  } catch (err) {
    throw new Error(
      `Não foi possível contactar o Hugging Face Hub (${HUB_CONFIG_URL}): ${err?.message || err}`
    );
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Hugging Face Hub respondeu HTTP ${res.status} para ${HUB_CONFIG_URL}`);
  }
  if (looksLikeHtml(text)) {
    throw new Error(
      `Hugging Face Hub devolveu HTML em vez de config.json (${HUB_CONFIG_URL}). ` +
        "Verifique rede, VPN, extensão ou bloqueio de huggingface.co."
    );
  }
  try {
    JSON.parse(text);
  } catch (err) {
    throw new Error(
      `config.json inválido do Hub (${HUB_CONFIG_URL}): ${err?.message || err}`
    );
  }
}

/**
 * @param {{ device?: string, localModelPath?: string, allowRemoteModels?: boolean }} opts
 */
async function loadModel(opts) {
  const device = opts.device === "webgpu" ? "webgpu" : "wasm";
  const useLocalOnly = Boolean(opts.localModelPath);
  if (useLocalOnly) {
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

  if (!didPurgeBadCache) {
    self.postMessage({
      type: "status",
      phase: "model",
      message: "Limpando cache inválido do modelo (se houver)…",
    });
    const purged = await purgeInvalidTransformersCache();
    didPurgeBadCache = true;
    if (purged > 0) {
      self.postMessage({
        type: "status",
        phase: "model",
        message: `Removidas ${purged} entrada(s) inválidas do cache do modelo.`,
      });
    }
  }

  if (!useLocalOnly) {
    self.postMessage({
      type: "status",
      phase: "model",
      message: "Verificando Hugging Face Hub…",
    });
    await assertHubConfigJson();
  }

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
