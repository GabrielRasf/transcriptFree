/** Reexecuta só 60s e mescla no JSON existente (sem apagar 300/600). */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, "fixtures");
const main = join(FIX, "node_bench_results.json");
const bak = join(FIX, "node_bench_results_long.json");

if (existsSync(main)) {
  writeFileSync(bak, readFileSync(main));
}

const r = spawnSync(process.execPath, ["run_node_bench.mjs", "--only=60"], {
  cwd: __dirname,
  encoding: "utf8",
  stdio: "inherit",
});
if (r.status !== 0) process.exit(r.status || 1);

const long = JSON.parse(readFileSync(bak, "utf8"));
const short = JSON.parse(readFileSync(main, "utf8"));
const keepLong = (long.runs || []).filter(
  (x) => x.label.startsWith("300s_") || x.label.startsWith("600s_")
);
const keepShort = (short.runs || []).filter(
  (x) =>
    x.label.startsWith("quality_") ||
    x.label.startsWith("60s_")
);
const merged = {
  ...short,
  when: new Date().toISOString(),
  modelLoadMs: short.modelLoadMs,
  runs: [...keepShort, ...keepLong],
  mergedFrom: ["60s+quality (fresh)", "300s+600s (previous file)"],
};
writeFileSync(main, JSON.stringify(merged, null, 2));
console.log("Merged runs:", merged.runs.map((x) => x.label).join(", "));
