import { rolldown } from "rolldown";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("./server/weekly-worker-entry.mjs", import.meta.url));
const output = fileURLToPath(new URL("../work/dev-weekly-worker.mjs", import.meta.url));
await mkdir(new URL("../work/", import.meta.url), { recursive: true });
const bundle = await rolldown({ input: entry, platform: "node", external: [/^node:/] });
try {
  await bundle.write({ file: output, format: "esm", codeSplitting: false, minify: true });
} finally {
  await bundle.close();
}

