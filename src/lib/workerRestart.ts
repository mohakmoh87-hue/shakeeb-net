import path from "node:path";

export const WORKER_ENTRY = "src/worker.ts";

export const UI_ONLY = [
  /^src\/app\//,
  /^src\/components\//,
  /^public\//, /^docs\//, /^\.github\//, /^android\//, /^native\//,
  /^prisma\/rls\//,
  /\.md$/,
  /^tests\//, /\.test\.ts$/, /^scripts\//,
];

export const ALWAYS_RESTART = [
  /^package\.json$/,
  /^package-lock\.json$/,
  /^npm-shrinkwrap\.json$/,
  /^\.npmrc$/,
  /^prisma\/schema\.prisma$/,
  /^tsconfig\.json$/,
  /^worker-loop\.cmd$/,
];

const IMPORT_RE = /(?:\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?|\bexport\s+(?:type\s+)?[\w*{}\s,$]+?\s+from\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"`])([^'"`]+)\1/g;
const DYNAMIC_RE = /\b(?:import|require)\s*\(\s*(?!['"`][^'"`$]+['"`]\s*[,)])/;
const EXTS = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", "/index.ts", "/index.tsx", "/index.js"];

export function resolveLocal(from: string, spec: string, tree: Set<string>): string | null | undefined {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith("./") || spec.startsWith("../")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return null;
  for (const ext of EXTS) if (tree.has(base + ext)) return base + ext;
  return undefined;
}

export function workerImportGraph(
  tree: Set<string>,
  readMany: (files: string[]) => Map<string, string>,
  entry: string = WORKER_ENTRY,
): Set<string> | null {
  if (!tree.has(entry)) return null;
  const seen = new Set<string>();
  let frontier = [entry];
  while (frontier.length > 0) {
    const batch = [...new Set(frontier)].filter((f) => !seen.has(f));
    frontier = [];
    if (batch.length === 0) break;
    for (const f of batch) seen.add(f);
    const contents = readMany(batch);
    for (const f of batch) {
      const src = contents.get(f);
      if (src === undefined) return null;
      if (DYNAMIC_RE.test(src)) return null;
      for (const m of src.matchAll(IMPORT_RE)) {
        if (m[1] === "`" && m[2].includes("${")) return null;
        const target = resolveLocal(f, m[2], tree);
        if (target === undefined) return null;
        if (target !== null && !seen.has(target)) frontier.push(target);
      }
    }
  }
  return seen;
}

export function workerRestartTrigger(files: string[], graph: Set<string> | null): string | null {
  if (files.length === 0) return "(قائمة تغييراتٍ فارغة)";
  for (const f of files) {
    if (ALWAYS_RESTART.some((re) => re.test(f))) return f;
    if (graph?.has(f)) return f;
    const ui = UI_ONLY.some((re) => re.test(f));
    if (!ui && (!graph || !f.startsWith("src/"))) return f;
  }
  return null;
}
