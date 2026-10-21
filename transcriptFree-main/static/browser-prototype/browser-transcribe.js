/**
 * Motor de transcrição no navegador para a UI principal.
 * Caminho estável: /browser-prototype/browser-transcribe.js (run.py e Vercel).
 * Não envia áudio a /transcribe nem a APIs de STT.
 */

import { chunksToTxt, safeStem } from "./segments.js";

const SAMPLE_RATE = 16000;
/** Aviso de memória (não bloqueia) — independente do teto da API. */
export const BROWSER_LARGE_FILE_BYTES = 25 * 1024 * 1024;

/**
 * @param {string} [assetBase]
 */
export function workerUrl(assetBase = "/browser-prototype") {
  const base = String(assetBase || "/browser-prototype").replace(/\/$/, "");
  // Caminho absoluto no site (válido em run.py e na Vercel).
  return `${base}/whisper-worker.js`;
}

/**
 * @param {File} file
 * @returns {Promise<Float32Array>}
 */
export async function decodeToMono16k(file) {
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (err) {
    throw new Error(`Falha ao ler "${file.name}": ${err?.message || err}`);
  }
  const ctx = new AudioContext();
  try {
    let decoded;
    try {
      decoded = await ctx.decodeAudioData(buffer.slice(0));
    } catch (err) {
      throw new Error(
        `Não foi possível decodificar "${file.name}". (${err?.message || err})`
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

async function canUseWebGpu() {
  if (!navigator.gpu?.requestAdapter) return false;
  try {
    return Boolean(await navigator.gpu.requestAdapter());
  } catch {
    return false;
  }
}

/**
 * Sessão de Worker reutilizável entre arquivos do lote.
 */
export class BrowserTranscribeSession {
  /**
   * @param {{ assetBase?: string, onStatus?: (msg: string) => void }} [opts]
   */
  constructor(opts = {}) {
    this.assetBase = opts.assetBase || "/browser-prototype";
    this.onStatus = opts.onStatus || (() => {});
    /** @type {Worker | null} */
    this.worker = null;
    this.ready = false;
    this.cancelled = false;
    /** @type {number} */
    this.generation = 0;
  }

  async ensureReady() {
    if (this.worker && this.ready) return;
    this.dispose(false);
    this.cancelled = false;
    const url = workerUrl(this.assetBase);
    this.worker = new Worker(url, { type: "module" });
    this.worker.onerror = (ev) => {
      this.onStatus(`Erro no Worker: ${ev.message || "falha"}`);
    };

    const useGpu = await canUseWebGpu();
    await new Promise((resolve, reject) => {
      const onMsg = (ev) => {
        const msg = ev.data || {};
        if (msg.type === "progress" && msg.phase === "model") {
          const p = msg.progress;
          if (p?.file) {
            const pct = typeof p.progress === "number" ? ` ${Math.round(p.progress)}%` : "";
            this.onStatus(`Modelo: ${p.file}${pct}`);
          }
          return;
        }
        if (msg.type === "status") {
          this.onStatus(msg.message || "");
          return;
        }
        if (msg.type === "ready") {
          this.worker?.removeEventListener("message", onMsg);
          this.ready = true;
          resolve(msg);
          return;
        }
        if (msg.type === "error") {
          this.worker?.removeEventListener("message", onMsg);
          reject(new Error(msg.message || "Falha ao carregar modelo."));
        }
      };
      this.worker.addEventListener("message", onMsg);
      this.worker.postMessage({
        type: "load",
        device: useGpu ? "webgpu" : "wasm",
        allowRemoteModels: true,
      });
    });
  }

  /**
   * @param {File} file
   * @param {{ label?: string }} [opts]
   */
  async transcribeFile(file, opts = {}) {
    if (this.cancelled) {
      throw new DOMException("Cancelado", "AbortError");
    }
    await this.ensureReady();
    if (!this.worker || this.cancelled) {
      throw new DOMException("Cancelado", "AbortError");
    }

    const gen = this.generation;
    this.onStatus(`Decodificando ${opts.label || file.name}…`);
    const samples = await decodeToMono16k(file);
    if (this.cancelled || gen !== this.generation) {
      throw new DOMException("Cancelado", "AbortError");
    }

    const durationSec = samples.length / SAMPLE_RATE;
    const label = opts.label || file.name;

    const result = await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearInterval(poll);
        this.worker?.removeEventListener("message", onMsg);
      };
      const onMsg = (ev) => {
        const msg = ev.data || {};
        if (msg.type === "progress" || msg.type === "status") {
          if (msg.message) this.onStatus(msg.message);
          else if (msg.phase === "chunk") {
            this.onStatus(
              msg.message ||
                `${label}: janela ${(msg.chunkIndex || 0) + 1}/${msg.chunkTotal || "?"}`
            );
          }
          return;
        }
        if (msg.type === "result" || msg.type === "cancelled" || msg.type === "error") {
          cleanup();
          resolve(msg);
        }
      };
      const poll = setInterval(() => {
        if (this.cancelled || gen !== this.generation || !this.worker) {
          cleanup();
          resolve({ type: "cancelled" });
        }
      }, 120);
      this.worker.addEventListener("message", onMsg);
      try {
        const buf = samples.buffer;
        this.worker.postMessage(
          {
            type: "transcribe",
            samples,
            samplingRate: SAMPLE_RATE,
            fileLabel: label,
          },
          [buf]
        );
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    if (result.type === "cancelled" || this.cancelled || gen !== this.generation) {
      throw new DOMException("Cancelado", "AbortError");
    }
    if (result.type === "error") {
      throw new Error(result.message || "Erro na transcrição no navegador.");
    }

    const text = chunksToTxt(result.chunks || []);
    const body =
      text ||
      ((result.text || "").trim() ? `${String(result.text).trim()}\n` : "");
    if (!body.trim()) {
      throw new Error("Nenhuma fala detectada no áudio.");
    }
    return {
      sourceName: file.name,
      downloadName: `${safeStem(file.name)}.txt`,
      text: body,
      durationSec,
      meta: {
        device: result.device,
        windowCount: result.windowCount,
      },
    };
  }

  cancel() {
    this.cancelled = true;
    this.generation += 1;
    if (this.worker) {
      try {
        this.worker.postMessage({ type: "cancel" });
      } catch {
        /* ignore */
      }
      try {
        this.worker.terminate();
      } catch {
        /* ignore */
      }
    }
    this.worker = null;
    this.ready = false;
  }

  /**
   * @param {boolean} [hard]
   */
  dispose(hard = true) {
    if (hard) this.cancel();
    else if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        /* ignore */
      }
      this.worker = null;
      this.ready = false;
    }
  }
}
