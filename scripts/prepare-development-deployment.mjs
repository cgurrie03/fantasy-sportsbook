import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const buildScripts = new Set([
  "scripts/verify-hosted-development.mjs", "scripts/check-development-environment.mjs",
  "scripts/test-api-runtime.mjs",
]);
const files = [];
for (const file of paths) {
  if (!/^(api\/|src\/|public\/|package(?:-lock)?\.json$|tsconfig(?:\.[\w-]+)?\.json$|index\.html$|vite\.config\.ts$|vercel\.json$)/.test(file)
      && !buildScripts.has(file)) continue;
  const data = await fs.readFile(file);
  const committed = execFileSync("git", ["rev-parse", `${sha}:${file}`], { encoding: "utf8" }).trim();
  const working = execFileSync("git", ["hash-object", "--path", file, file], { encoding: "utf8" }).trim();
  if (working !== committed) throw new Error(`Uncommitted deployment source: ${file}`);
  files.push({ file, data: data.toString("base64"), encoding: "base64" });
}
if (!files.some((f) => f.file === "scripts/verify-hosted-development.mjs"))
  throw new Error("Hosted verification missing");
const payload = JSON.stringify({ sha, files });
await fs.mkdir("work", { recursive: true });
await fs.writeFile("work/development-deployment.json", payload);
console.log(JSON.stringify({ sha, files: files.length, bytes: Buffer.byteLength(payload), digest: createHash("sha256").update(payload).digest("hex") }));
