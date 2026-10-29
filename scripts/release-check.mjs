import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const suites = ["lint", "build:fixture", "test:financial-recovery", "test:environment", "test:board-cache",
  "test:refresh-retention", "test:futures-edit", "test:accounts", "test:accounts:ux", "test:lines",
  "test:import", "test:refresh", "test:starters", "test:live", "test:weekly",
  "test:transitions", "test:futures", "test:reporting", "test:reopening",
  "test:isolation", "test:promos", "test:model", "test:teasers", "test:monday",
  "test:extra-markets", "test:operations", "test:transitions:ux", "test:quick-start",
  "test:featured-cards", "test:extra-markets:ux", "test:audit", "test:receipts",
  "test:promos:ux", "test:teasers:ux", "test:ux", "test:sleeper-links"];
if (!process.env.npm_execpath) throw new Error("Run npm run test:release.");
const env = { ...process.env };
for (const key of Object.keys(env))
  if (/^(BOFF_|VITE_|SUPABASE_|RESEND_|WEEKLY_WORKER_SECRET)/.test(key)) delete env[key];
mkdirSync("work/release-checks", { recursive: true });
const results = [];
for (const suite of suites) {
  const start = Date.now();
  console.log(`Checking ${suite}`);
  const result = spawnSync(process.execPath, [process.env.npm_execpath, "run", suite], {
    env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 180000,
  });
  const entry = { suite, passed: result.status === 0 && !result.error,
    seconds: Math.round((Date.now() - start) / 100) / 10 };
  results.push(entry);
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}`;
  writeFileSync(`work/release-checks/${suite.replaceAll(":", "-")}.log`, output.slice(-65536));
  writeFileSync("work/release-checks/results.json", JSON.stringify(results, null, 2));
  console.log(`${entry.passed ? "PASS" : "FAIL"} ${suite} (${entry.seconds}s)`);
  if (!entry.passed) console.log(output.slice(-1800));
}
const failed = results.filter((r) => !r.passed);
console.log(`${results.length - failed.length}/${results.length} checks passed. This does not authorize a production release.`);
process.exitCode = failed.length ? 1 : 0;
