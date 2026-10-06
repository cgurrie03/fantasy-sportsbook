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
  const savedFetch = globalThis.fetch;
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_ANON_KEY;
  let membership = { role: "admin", invited_email: "admin@example.invalid" };
  let lookupFails = false;
  let claimFails = false;
  process.env.SUPABASE_URL = "https://supabase.example.invalid";
  process.env.SUPABASE_ANON_KEY = "public-test-key";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-session");
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/auth/v1/user")) return json({ id: "approved-user", email: "admin@example.invalid" });
    if (url.includes("/rpc/claim_memberships")) return claimFails ? json({ message: "claim unavailable" }, 400) : json(0);
    if (url.includes("/league_memberships")) return lookupFails ? json({ message: "lookup unavailable" }, 400) : json(membership);
    if (url.includes("/teams")) return json([]);
    throw new Error(`Unexpected test request: ${url}`);
  };
  const request = () => new Request("https://example.invalid/api/generate-markets", {
    method: "POST", headers: { Authorization: "Bearer test-session", "Content-Type": "application/json" },
    body: JSON.stringify({ league_id: "approved-league", week: 5, nfl_season: 2026, category: "Weekly Specials" }),
  });
  try {
    const adminResponse = await POST(request());
    assert.equal(adminResponse.status, 400);
    assert.match((await adminResponse.json()).error, /teams could not be loaded/);
    membership = { ...membership, role: "member" };
    assert.equal((await POST(request())).status, 403);
    membership = null;
    assert.equal((await POST(request())).status, 403);
    lookupFails = true;
    assert.equal((await POST(request())).status, 503);
    lookupFails = false;
    claimFails = true;
    assert.equal((await POST(request())).status, 503);
    console.log("Approved admin passes; members and unmapped users are denied; lookup failures are distinct.");
  } finally {
    globalThis.fetch = savedFetch;
    if (savedUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = savedKey;
  }
  console.log("Compiled generation API loads and returns JSON without TypeScript source files.");
} finally {
  const parent = path.resolve("node_modules") + path.sep;
  if (!path.resolve(root).startsWith(parent)) throw new Error("Runtime test cleanup escaped node_modules.");
  await rm(root, { recursive: true, force: true });
}
