/**
 * Janelas e junção temporal para o protótipo (Transformers.js 3.7.2).
 *
 * A lib aceita chunk_length_s / stride_length_s nativamente. Aqui espelhamos
 * o salto de janela (jump = chunk - 2*stride) e fazemos merge consciente de
 * tempo para progresso/cancelamento por janela no Worker.
 *
 * Limitações documentadas (não resolvidas com segurança só por overlap):
 * - Fala contínua sem pausa na fronteira pode gerar omissão ou eco residual.
 * - Whisper tiny alucina / repete frases; overlap temporal não remove isso
 *   se os timestamps não se sobrepuserem.
 * - Paráfrases na zona de stride (mesmo sentido, texto diferente) podem
 *   sobreviver se IoU for baixo.
 * - Timestamps do modelo podem ultrapassar levemente a duração; fazemos clamp.
 */

export const DEFAULT_CHUNK_S = 30;
export const DEFAULT_STRIDE_S = 5;
export const SAMPLE_RATE = 16000;

/**
 * @param {number} durationSec
 * @param {number} [chunkSec]
 * @param {number} [strideSec]
 * @returns {{ offsetSec: number, endSec: number, index: number, isFirst: boolean, isLast: boolean }[]}
 */
export function planWindows(
  durationSec,
  chunkSec = DEFAULT_CHUNK_S,
  strideSec = DEFAULT_STRIDE_S
) {
  if (!(durationSec > 0)) return [];
  if (chunkSec <= 0) throw new Error("chunkSec deve ser > 0");
  if (strideSec < 0 || chunkSec <= strideSec) {
    throw new Error("chunkSec deve ser maior que strideSec");
  }
  const jump = chunkSec - 2 * strideSec;
  const windows = [];
  let offset = 0;
  let index = 0;
  while (true) {
    const end = Math.min(durationSec, offset + chunkSec);
    const isLast = offset + chunkSec >= durationSec;
    windows.push({
      offsetSec: offset,
      endSec: end,
      index,
      isFirst: index === 0,
      isLast,
    });
    if (isLast) break;
    offset += jump;
    index += 1;
    if (index > 100000) throw new Error("planWindows: limite de segurança");
  }
  return windows;
}

/**
 * @param {number} durationSec
 */
export function pcmBytesMono16k(durationSec) {
  return Math.round(durationSec * SAMPLE_RATE * 4);
}

/**
 * @param {{ timestamp?: [number, number], text?: string }[]} chunks
 * @param {number} offsetSec
 */
export function shiftChunks(chunks, offsetSec) {
  return (chunks || []).map((c) => {
    const ts = c.timestamp;
    if (!Array.isArray(ts) || ts.length < 2) return { ...c, text: c.text };
    return {
      text: c.text,
      timestamp: [Number(ts[0]) + offsetSec, Number(ts[1]) + offsetSec],
    };
  });
}

/**
 * Mantém só a região “confiável” da janela (centro), descartando strides
 * laterais — análogo ao stride da pipeline ASR.
 *
 * @param {{ timestamp?: [number, number], text?: string }} seg
 * @param {{ offsetSec: number, endSec: number, isFirst: boolean, isLast: boolean }} win
 * @param {number} strideSec
 */
export function segmentInTrustedZone(seg, win, strideSec = DEFAULT_STRIDE_S) {
  const ts = seg.timestamp;
  if (!Array.isArray(ts) || ts.length < 2) return false;
  const start = Number(ts[0]);
  const end = Number(ts[1]);
  const mid = (start + end) / 2;
  const left = win.isFirst ? win.offsetSec : win.offsetSec + strideSec;
  const right = win.isLast ? win.endSec : win.endSec - strideSec;
  if (right <= left) {
    // Janela muito curta: aceita interseção com a janela
    return end > win.offsetSec && start < win.endSec;
  }
  return mid >= left && mid <= right;
}

/**
 * IoU temporal entre dois intervalos.
 * @param {[number, number]} a
 * @param {[number, number]} b
 */
export function temporalIou(a, b) {
  const overlap = Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
  const union = Math.max(a[1], b[1]) - Math.min(a[0], b[0]);
  if (union <= 0) return 0;
  return overlap / union;
}

function normText(t) {
  return (t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove segmentos com forte sobreposição temporal; em empate, prefere o
 * mais longo. Não usa só igualdade exata de string.
 *
 * @param {{ timestamp?: [number, number], text?: string }[]} chunks
 * @param {{ iouThreshold?: number, maxStartDelta?: number }} [opts]
 */
export function dedupeTemporalOverlaps(chunks, opts = {}) {
  const iouThreshold = opts.iouThreshold ?? 0.45;
  const maxStartDelta = opts.maxStartDelta ?? 1.25;
  const sorted = [...(chunks || [])]
    .filter((c) => Array.isArray(c.timestamp) && c.timestamp.length >= 2)
    .map((c) => ({
      text: (c.text || "").trim(),
      timestamp: [Number(c.timestamp[0]), Number(c.timestamp[1])],
    }))
    .filter((c) => c.text && c.timestamp[1] >= c.timestamp[0])
    .sort((a, b) => a.timestamp[0] - b.timestamp[0] || a.timestamp[1] - b.timestamp[1]);

  /** @type {typeof sorted} */
  const kept = [];
  for (const cur of sorted) {
    const prev = kept[kept.length - 1];
    if (!prev) {
      kept.push(cur);
      continue;
    }
    const iou = temporalIou(prev.timestamp, cur.timestamp);
    const startDelta = Math.abs(cur.timestamp[0] - prev.timestamp[0]);
    const ta = normText(prev.text);
    const tb = normText(cur.text);
    const textRelated =
      ta === tb ||
      (ta.length > 12 && tb.length > 12 && (ta.includes(tb) || tb.includes(ta)));
    const heavyOverlap = iou >= iouThreshold || (startDelta <= maxStartDelta && textRelated);

    if (!heavyOverlap) {
      kept.push(cur);
      continue;
    }
    // Mantém o segmento com maior duração (mais contexto na fronteira).
    const prevDur = prev.timestamp[1] - prev.timestamp[0];
    const curDur = cur.timestamp[1] - cur.timestamp[0];
    if (curDur > prevDur + 0.05 || (textRelated && cur.text.length > prev.text.length)) {
      kept[kept.length - 1] = cur;
    }
  }
  return kept;
}

/**
 * @param {{ timestamp?: [number, number], text?: string }[]} chunks
 * @param {number} durationSec
 */
export function clampChunksToDuration(chunks, durationSec) {
  const max = Math.max(0, durationSec);
  return (chunks || [])
    .map((c) => {
      if (!Array.isArray(c.timestamp) || c.timestamp.length < 2) return null;
      let start = Math.max(0, Number(c.timestamp[0]));
      let end = Math.min(max, Number(c.timestamp[1]));
      if (end < start) end = start;
      // Permite folga mínima além do fim (ruído do modelo) já clampada.
      return { text: c.text, timestamp: [start, end] };
    })
    .filter(Boolean);
}

/**
 * Junta resultados por janela (já com timestamps relativos à janela).
 *
 * @param {{
 *   window: { offsetSec: number, endSec: number, isFirst: boolean, isLast: boolean },
 *   chunks: { timestamp?: [number, number], text?: string }[]
 * }[]} windowResults
 * @param {number} durationSec
 * @param {number} [strideSec]
 */
export function mergeWindowResults(windowResults, durationSec, strideSec = DEFAULT_STRIDE_S) {
  /** @type {{ text: string, timestamp: [number, number] }[]} */
  const collected = [];
  for (const wr of windowResults || []) {
    const shifted = shiftChunks(wr.chunks || [], wr.window.offsetSec);
    for (const seg of shifted) {
      if (!segmentInTrustedZone(seg, wr.window, strideSec)) continue;
      if (!(seg.text || "").trim()) continue;
      collected.push({
        text: (seg.text || "").trim(),
        timestamp: [Number(seg.timestamp[0]), Number(seg.timestamp[1])],
      });
    }
  }
  const clamped = clampChunksToDuration(collected, durationSec);
  return dedupeTemporalOverlaps(clamped);
}

/**
 * @param {{ timestamp?: [number, number], text?: string }[]} chunks
 */
export function auditMergedChunks(chunks) {
  const issues = [];
  let prevEnd = -Infinity;
  for (let i = 0; i < (chunks || []).length; i++) {
    const c = chunks[i];
    const ts = c.timestamp;
    if (!Array.isArray(ts) || ts.length < 2) {
      issues.push({ type: "missing_timestamp", index: i });
      continue;
    }
    const start = Number(ts[0]);
    const end = Number(ts[1]);
    if (!(end >= start)) {
      issues.push({ type: "inverted_or_zero", index: i, start, end });
    }
    if (start + 1e-6 < prevEnd) {
      issues.push({ type: "overlap_or_out_of_order", index: i, start, prevEnd });
    }
    prevEnd = Math.max(prevEnd, end);
  }
  for (let i = 1; i < (chunks || []).length; i++) {
    const a = normText(chunks[i - 1].text);
    const b = normText(chunks[i].text);
    const iou = temporalIou(
      [Number(chunks[i - 1].timestamp[0]), Number(chunks[i - 1].timestamp[1])],
      [Number(chunks[i].timestamp[0]), Number(chunks[i].timestamp[1])]
    );
    if (a && b && a === b && iou > 0.2) {
      issues.push({ type: "possible_text_duplicate", index: i, text: b.slice(0, 80) });
    }
  }
  return issues;
}

/**
 * @param {{ timestamp?: [number, number] }[]} chunks
 * @param {number} durationSec
 * @param {number} [gapThresholdSec]
 */
export function findCoverageGaps(chunks, durationSec, gapThresholdSec = 1.5) {
  const gaps = [];
  let cursor = 0;
  const sorted = [...(chunks || [])]
    .filter((c) => Array.isArray(c.timestamp) && c.timestamp.length >= 2)
    .sort((a, b) => Number(a.timestamp[0]) - Number(b.timestamp[0]));
  for (const c of sorted) {
    const start = Number(c.timestamp[0]);
    const end = Number(c.timestamp[1]);
    if (start - cursor > gapThresholdSec) {
      gaps.push({ from: cursor, to: start });
    }
    cursor = Math.max(cursor, end);
  }
  if (durationSec - cursor > gapThresholdSec) {
    gaps.push({ from: cursor, to: durationSec });
  }
  return gaps;
}

/**
 * Critérios anti-truncamento para áudio longo.
 * @param {{ timestamp?: [number, number] }[]} chunks
 * @param {number} durationSec
 */
export function coverageStats(chunks, durationSec) {
  const sorted = [...(chunks || [])]
    .filter((c) => Array.isArray(c.timestamp) && c.timestamp.length >= 2)
    .sort((a, b) => Number(a.timestamp[0]) - Number(b.timestamp[0]));
  if (!sorted.length) {
    return { lastEnd: 0, firstStart: 0, ordered: true, withinDuration: true, ratio: 0 };
  }
  let ordered = true;
  let prev = -Infinity;
  for (const c of sorted) {
    const s = Number(c.timestamp[0]);
    if (s + 1e-6 < prev) ordered = false;
    prev = s;
  }
  const lastEnd = Number(sorted[sorted.length - 1].timestamp[1]);
  const firstStart = Number(sorted[0].timestamp[0]);
  const maxEnd = Math.max(...sorted.map((c) => Number(c.timestamp[1])));
  return {
    lastEnd,
    firstStart,
    ordered,
    withinDuration: maxEnd <= durationSec + 0.75,
    ratio: durationSec > 0 ? lastEnd / durationSec : 0,
  };
}
