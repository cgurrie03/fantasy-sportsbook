import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

// Match deployment: TypeScript sources become JavaScript, without preserving .ts files.
const root = await mkdtemp(path.resolve("node_modules/.api-runtime-"));
try {
  await mkdir(path.join(root, "_lib"));
  for (const file of ["generate-markets", "_lib/line-model"]) {
    const source = await readFile(`api/${file}.ts`, "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
      fileName: `${file}.ts`,
    });
    await writeFile(path.join(root, `${file}.js`), outputText);
  }
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  const { POST } = await import(pathToFileURL(path.join(root, "generate-markets.js")).href);
  const response = await POST(new Request("https://example.invalid/api/generate-markets", { method: "POST" }));
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /not configured/);
  console.log("Compiled generation API loads and returns JSON without TypeScript source files.");
} finally {
  const parent = path.resolve("node_modules") + path.sep;
  if (!path.resolve(root).startsWith(parent)) throw new Error("Runtime test cleanup escaped node_modules.");
  await rm(root, { recursive: true, force: true });
}
