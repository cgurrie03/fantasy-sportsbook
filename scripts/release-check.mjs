import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import {releaseSuites as suites} from "./release-suite-plan.mjs";
import {sourceIdentity,createEvidence} from "./release-evidence.mjs";
const sourceStart=sourceIdentity(),startedAt=new Date().toISOString();
if (!process.env.npm_execpath) throw new Error("Run npm run test:release.");
const env = { ...process.env };
for (const key of Object.keys(env))
  if (/^(BOFF_|VITE_|SUPABASE_|RESEND_|WEEKLY_WORKER_SECRET|VERCEL(?:_|$)|GH_TOKEN$|GITHUB_TOKEN$|PGPASSWORD$|DATABASE_URL$)/.test(key)) delete env[key];
mkdirSync("work/release-checks", { recursive: true });
const results = [];
writeFileSync("work/release-checks/provenance.json", JSON.stringify({format:"boff-release-evidence-v1",valid:false,started_at:startedAt},null,2));
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
const evidence=createEvidence({start:sourceStart,end:sourceIdentity(),results,suites,startedAt,finishedAt:new Date().toISOString()});
writeFileSync("work/release-checks/provenance.json",JSON.stringify(evidence,null,2)+"\n");
if(!evidence.valid)console.error("Release evidence invalid: checks failed or source was dirty/changed during verification.");
process.exitCode = failed.length || !evidence.valid ? 1 : 0;
