// Compiled worker handlers with all network calls intercepted. No hosted work.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import assert from "node:assert/strict";
for (const k of Object.keys(process.env))
  if (/^(BOFF_|VITE_|SUPABASE_|RESEND_|WEEKLY_WORKER_SECRET|VERCEL)/.test(k))
    delete process.env[k];
Object.assign(process.env, {
  BOFF_ENVIRONMENT: "test",
  NODE_ENV: "test",
  SUPABASE_URL: "https://worker.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
  WEEKLY_WORKER_SECRET: "synthetic-worker",
  RESEND_API_KEY: "synthetic-never-used",
});
const root = await fs.mkdtemp(path.resolve("node_modules/.worker-outage-"));
assert(root.startsWith(path.resolve("node_modules") + path.sep));
const realFetch = globalThis.fetch,
  realTimeout = AbortSignal.timeout,
  realError = console.error;
const timeouts = [],
  errors = [],
  events = [];
let claims = 0,
  active = 0,
  peak = 0,
  aborts = 0;
try {
  async function compile(dir = "") {
    for (const e of await fs.readdir(path.join("api", dir), {
      withFileTypes: true,
    })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) await compile(rel);
      else if (e.name.endsWith(".ts")) {
        const out = path.join(root, rel.replace(/\.ts$/, ".js"));
        await fs.mkdir(path.dirname(out), { recursive: true });
        await fs.writeFile(
          out,
          ts.transpileModule(await fs.readFile(path.join("api", rel), "utf8"), {
            compilerOptions: {
              module: ts.ModuleKind.ESNext,
              target: ts.ScriptTarget.ES2023,
            },
            fileName: rel,
          }).outputText,
        );
      }
    }
  }
  await compile();
  const { POST } = await import(
    pathToFileURL(path.join(root, "weekly-worker.js")).href
  );
  const { runWorkerCleanup } = await import(
    pathToFileURL(path.join(root, "_lib/worker-maintenance.js")).href
  );
  const attempted = [];
  for (const kind of ["refresh", "evaluation"]) {
    const result = await runWorkerCleanup(
      {
        rpc: (name, args) => ({
          abortSignal: async (signal) => {
            attempted.push({
              name,
              args,
              signal: signal instanceof AbortSignal,
            });
            throw Error("Synthetic optional transport rejection");
          },
        }),
      },
      kind,
    );
    assert.equal(result.error.code, "MAINTENANCE_UNAVAILABLE");
  }
  assert.deepEqual(
    attempted.map((x) => [x.name, x.args.p_limit, x.signal]),
    [
      ["cleanup_terminal_refresh_payloads", 5, true],
      ["cleanup_evaluated_samples", 2, true],
    ],
  );
  AbortSignal.timeout = (ms) => {
    timeouts.push(ms);
    return realTimeout(Math.min(ms, 40));
  };
  console.error = (...args) => errors.push(args);
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const name = url.pathname.split("/").at(-1);
    if (url.hostname === "site.api.espn.com")
      return new Response("{}", { status: 503 });
    assert.equal(
      url.hostname,
      "worker.invalid",
      "all other network destinations rejected",
    );
    assert(
      url.pathname.startsWith("/rest/v1/rpc/"),
      "no table mutation or external mail expected",
    );
    events.push(name);
    if (
      [
        "cleanup_terminal_refresh_payloads",
        "cleanup_evaluated_samples",
      ].includes(name)
    ) {
      active++;
      peak = Math.max(peak, active);
      try {
        return await new Promise((resolve, reject) => {
          const signal = input instanceof Request ? input.signal : init.signal;
          const timer = setTimeout(
            () =>
              resolve(
                new Response(
                  JSON.stringify({
                    message: "Fixture stalled cleanup",
                    code: "TEST_STALL",
                  }),
                  { status: 503 },
                ),
              ),
            200,
          );
          const abort = () => {
            clearTimeout(timer);
            aborts++;
            reject(new DOMException("Fixture deadline", "AbortError"));
          };
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        });
      } finally {
        active--;
      }
    }
    if (name === "claim_automation_job") {
      claims++;
      return new Response("[]");
    }
    if (name === "claim_scoped_outbound_emails") return new Response("[]");
    if (name === "observe_line_refresh")
      return new Response(
        JSON.stringify({
          message: "Fixture status persistence outage",
          code: "TEST_OUTAGE",
        }),
        { status: 503 },
      );
    if (name === "cleanup_routine_payloads")
      return new Response(JSON.stringify({ retired: 0 }));
    throw Error("Unexpected worker RPC " + name);
  };
  const request = () =>
    new Request("https://fixture.invalid/api/weekly-worker", {
      method: "POST",
      headers: { "x-worker-secret": "synthetic-worker" },
      body: "{}",
    });
  const results = await Promise.all([POST(request()), POST(request())]);
  const bodies = await Promise.all(results.map((r) => r.json()));
  assert.equal(
    peak,
    2,
    "actual worker handlers overlap in their intercepted cleanup requests",
  );
  assert.equal(
    aborts,
    4,
    "both preclaim cleanup calls in both workers have effective deadlines",
  );
  assert.equal(
    claims,
    2,
    "both workers reach claiming despite cleanup and status-source failure",
  );
  assert(results.every((r) => r.status === 200));
  assert(
    bodies.every(
      (x) =>
        x.cleanup.failed === true && x.status_source_error && x.job === null,
    ),
  );
  assert.equal(
    events.filter((x) => x === "claim_scoped_outbound_emails").length,
    2,
  );
  assert(
    timeouts.filter((x) => x === 3000).length >= 6,
    "three-second maintenance budgets retained",
  );
  const receipt = {
    synthetic: true,
    compiled_api: true,
    overlapping_local_handlers: 2,
    peak_cleanup_requests: peak,
    cleanup_aborts: aborts,
    claim_calls: claims,
    responses: results.map((r) => r.status),
    provider: "intercepted 503",
    status_persistence: "intercepted 503",
    hosted_worker_or_capacity_measurement: false,
  };
  await fs.mkdir("work", { recursive: true });
  await fs.writeFile(
    "work/worker-outage.json",
    JSON.stringify(receipt, null, 2) + "\n",
  );
  realError(
    "Worker outage regression passed: two compiled handlers overlap, four stalled optional cleanups abort, both still claim work, status-provider/persistence failures remain visible. All destinations intercepted; no actual claim, wallet or email.",
  );
} finally {
  globalThis.fetch = realFetch;
  AbortSignal.timeout = realTimeout;
  console.error = realError;
  await fs.rm(root, { recursive: true, force: true });
}
