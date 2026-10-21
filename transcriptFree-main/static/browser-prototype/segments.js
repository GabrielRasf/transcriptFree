/**
 * Formatação de saída alinhada a app.py (format_timestamp / segments_to_txt).
 * Módulo puro — testável sem Transformers.js.
 */

/**
 * @param {number} seconds
 * @returns {string}
 */
export function formatTimestamp(seconds) {
  const total = Math.max(0, Math.trunc(seconds));
  const h = Math.floor(total / 3600);
  const rem = total % 3600;
  const m = Math.floor(rem / 60);
  const s = rem % 60;
  if (h) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * @param {{ timestamp?: [number, number] | number[], text?: string }[]} chunks
 * @returns {string}
 */
export function chunksToTxt(chunks) {
  const blocks = [];
  for (const chunk of chunks || []) {
    const text = (chunk.text || "").trim();
    if (!text) continue;
    const ts = chunk.timestamp;
    if (!Array.isArray(ts) || ts.length < 2) continue;
    const start = formatTimestamp(Number(ts[0]) || 0);
    const end = formatTimestamp(Number(ts[1]) || 0);
    blocks.push(`(${start} - ${end})\n${text}`);
  }
  return blocks.length ? `${blocks.join("\n\n")}\n` : "";
}

/**
 * @param {string} filename
 * @returns {string}
 */
export function safeStem(filename) {
  const base = (filename || "transcricao").replace(/^.*[/\\]/, "");
  const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  const cleaned = stem.replace(/[^\w\-]+/gu, "_").replace(/^_+|_+$/g, "");
  return cleaned || "transcricao";
}
