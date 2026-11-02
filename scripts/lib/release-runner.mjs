import { spawn } from "node:child_process";
// Separate child processes keep fixture globals isolated. Build is a barrier;
// subsequent suites share only the already-built, read-only localhost fixture.
export async function runSuitePlan({
  suites,
  commandFor,
  env = process.env,
  cwd = process.cwd(),
  concurrency = 2,
  timeoutMs = 180000,
  onStart = () => {},
  onResult = () => {},
}) {
  if (
    ![1, 2].includes(concurrency) ||
    suites[0] !== "lint" ||
    suites[1] !== "build:fixture"
  )
    throw Error(
      "Release plan requires lint/build barriers and one or two jobs.",
    );
  const results = new Array(suites.length);
  async function run(index) {
    const suite = suites[index],
      start = Date.now();
    onStart(suite);
    const outcome = await new Promise((resolve) => {
      const [command, ...args] = commandFor(suite);
      let tail = "",
        bytes = 0,
        failure = "",
        settled = false,
        forced;
      const child = spawn(command, args, {
        cwd,
        env,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      function finish(code) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(forced);
        resolve({
          passed: code === 0 && !failure,
          output: (tail + "\n" + failure).slice(-65536),
        });
      }
      function stop(message) {
        if (failure) return;
        failure = message;
        if (child.pid) {
          if (process.platform === "win32")
            spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
              windowsHide: true,
              stdio: "ignore",
            }).on("error", () => child.kill());
          else {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill();
            }
          }
        }
        forced = setTimeout(() => finish(null), 2000);
      }
      const timer = setTimeout(
        () => stop("Suite exceeded its execution budget."),
        timeoutMs,
      );
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding("utf8");
        stream.on("data", (chunk) => {
          bytes += Buffer.byteLength(chunk);
          tail = (tail + chunk).slice(-65536);
          if (bytes > 32 * 1024 * 1024)
            stop("Suite exceeded its output budget.");
        });
      }
      child.once("error", (e) => {
        failure = e.message;
        finish(null);
      });
      child.once("close", finish);
    });
    const entry = {
      suite,
      passed: outcome.passed,
      seconds: Math.round((Date.now() - start) / 100) / 10,
    };
    results[index] = entry;
    onResult(entry, outcome.output, results.filter(Boolean));
  }
  await run(0);
  await run(1);
  if (!results[1].passed) {
    for (let i = 2; i < suites.length; i++) {
      const entry = { suite: suites[i], passed: false, seconds: 0 };
      results[i] = entry;
      onResult(
        entry,
        "Fixture build prerequisite failed; suite was not started.",
        results.filter(Boolean),
      );
    }
    return results;
  }
  let next = 2;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const index = next++;
        if (index >= suites.length) return;
        await run(index);
      }
    }),
  );
  return results;
}
