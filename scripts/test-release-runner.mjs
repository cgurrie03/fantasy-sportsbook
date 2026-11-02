import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runSuitePlan } from "./lib/release-runner.mjs";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "boff-release-runner-"));
try {
  const script = path.join(root, "fixture.mjs");
  await fs.writeFile(
    script,
    `const n=process.argv[2];console.log(n==='noisy'?'x'.repeat(100000):n);if(n==='hang')await new Promise(()=>{});else{await new Promise(r=>setTimeout(r,n==='slow'?150:30));if(n==='failure')process.exitCode=1;}`,
  );
  const plan = ["lint", "build:fixture", "slow", "fast", "failure", "noisy"];
  let active = 0,
    max = 0;
  const finished = new Set(),
    logs = [];
  const result = await runSuitePlan({
    suites: plan,
    commandFor: (n) => [process.execPath, script, n],
    onStart: (n) => {
      if (n !== "lint") assert(finished.has("lint"));
      if (!["lint", "build:fixture"].includes(n))
        assert(finished.has("build:fixture"));
      active++;
      max = Math.max(max, active);
    },
    onResult: (r, out) => {
      active--;
      finished.add(r.suite);
      logs.push(out);
    },
  });
  assert.equal(max, 2);
  assert.equal(active, 0);
  assert.deepEqual(
    result.map((r) => r.suite),
    plan,
  );
  assert.deepEqual(
    result.map((r) => r.passed),
    [true, true, true, true, false, true],
  );
  assert(logs.every((s) => s.length <= 65536));
  const blocked = await runSuitePlan({
    suites: ["lint", "build:fixture", "must-not-run"],
    commandFor: (n) => [
      process.execPath,
      script,
      n === "build:fixture" ? "failure" : n,
    ],
  });
  assert.deepEqual(
    blocked.map((r) => r.passed),
    [true, false, false],
  );
  const timed = await runSuitePlan({
    suites: ["lint", "build:fixture", "hang"],
    timeoutMs: 1000,
    commandFor: (n) => [
      process.execPath,
      "-e",
      n === "hang" ? "setInterval(()=>{},1000)" : "",
    ],
  });
  assert.equal(timed[2].passed, false);
  await assert.rejects(
    runSuitePlan({ suites: plan, concurrency: 3, commandFor: () => [] }),
    /one or two jobs/,
  );
  console.log(
    "Release runner: build barrier, two-process ceiling, deterministic results, bounded logs, failure/timeout and prerequisite propagation.",
  );
} finally {
  if (
    path.dirname(path.resolve(root)) === path.resolve(os.tmpdir()) &&
    path.basename(root).startsWith("boff-release-runner-")
  )
    await fs.rm(root, { recursive: true, force: true });
  else {
    console.error("Refusing cleanup of unexpected temporary directory");
    process.exitCode = 1;
  }
}
