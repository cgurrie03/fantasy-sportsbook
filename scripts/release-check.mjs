import { runSuitePlan } from "./lib/release-runner.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { releaseSuites as suites } from "./release-suite-plan.mjs";
import { sourceIdentity, createEvidence } from "./release-evidence.mjs";
const sourceStart = sourceIdentity(),
  startedAt = new Date().toISOString();
if (!process.env.npm_execpath) throw new Error("Run npm run test:release.");
const env = { ...process.env };
for (const key of Object.keys(env))
  if (
    /^(BOFF_|VITE_|SUPABASE_|RESEND_|WEEKLY_WORKER_SECRET|VERCEL(?:_|$)|GH_TOKEN$|GITHUB_TOKEN$|PGPASSWORD$|DATABASE_URL$)/.test(
      key,
    )
  )
    delete env[key];
mkdirSync("work/release-checks", { recursive: true });
writeFileSync(
  "work/release-checks/provenance.json",
  JSON.stringify(
    { format: "boff-release-evidence-v1", valid: false, started_at: startedAt },
    null,
    2,
  ),
);
const results = await runSuitePlan({
  suites,
  env,
  concurrency: Number(process.env.RELEASE_JOBS ?? 2),
  commandFor: (suite) => [
    process.execPath,
    process.env.npm_execpath,
    "run",
    suite,
  ],
  onStart: (suite) => console.log(`Checking ${suite}`),
  onResult: (entry, output, completed) => {
    writeFileSync(
      `work/release-checks/${entry.suite.replaceAll(":", "-")}.log`,
      output,
    );
    writeFileSync(
      "work/release-checks/results.json",
      JSON.stringify(completed, null, 2),
    );
    console.log(
      `${entry.passed ? "PASS" : "FAIL"} ${entry.suite} (${entry.seconds}s)`,
    );
    if (!entry.passed) console.log(output.slice(-1800));
  },
});
const failed = results.filter((r) => !r.passed);
console.log(
  `${results.length - failed.length}/${results.length} checks passed. This does not authorize a production release.`,
);
const evidence = createEvidence({
  start: sourceStart,
  end: sourceIdentity(),
  results,
  suites,
  startedAt,
  finishedAt: new Date().toISOString(),
});
writeFileSync(
  "work/release-checks/provenance.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
if (!evidence.valid)
  console.error(
    "Release evidence invalid: checks failed or source was dirty/changed during verification.",
  );
process.exitCode = failed.length || !evidence.valid ? 1 : 0;
