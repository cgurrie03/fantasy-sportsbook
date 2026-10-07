import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

// Match deployment: TypeScript sources become JavaScript, without preserving .ts files.
const root = await mkdtemp(path.resolve("node_modules/.api-runtime-"));
try {
  await mkdir(path.join(root, "_lib"));
  for (const file of [
    "generate-markets",
    "weekly-execution",
    "_lib/line-model",
    "_lib/futures-model",
    "_lib/futures-settlement",
    "_lib/settlement",
    "_lib/worker-auth",
    "_lib/email-templates",
    "_lib/mail",
    "weekly-worker",
    "place-bet",
  ]) {
    const source = await readFile(`api/${file}.ts`, "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2023,
      },
      fileName: `${file}.ts`,
    });
    await writeFile(path.join(root, `${file}.js`), outputText);
  }
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  const { POST } = await import(
    pathToFileURL(path.join(root, "generate-markets.js")).href
  );
  const response = await POST(
    new Request("https://example.invalid/api/generate-markets", {
      method: "POST",
    }),
  );
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /not configured/);
  const weekly = await import(
    pathToFileURL(path.join(root, "weekly-execution.js")).href
  );
  assert.equal(
    (
      await weekly.POST(
        new Request("https://example.invalid/api/weekly-execution", {
          method: "POST",
        }),
      )
    ).status,
    401,
  );
  const worker = await import(
    pathToFileURL(path.join(root, "weekly-worker.js")).href
  );
  assert.equal(
    (
      await worker.POST(
        new Request("https://example.invalid/api/weekly-worker", {
          method: "POST",
        }),
      )
    ).status,
    401,
  );
  assert.equal(
    worker.easternTime("2026-10-07", "08:00"),
    "2026-10-07T12:00:00.000Z",
  );
  assert.equal(
    worker.easternTime("2026-11-04", "08:00"),
    "2026-11-04T13:00:00.000Z",
  );
  console.log(
    "Scheduled worker rejects unauthenticated requests; Eastern times follow daylight saving.",
  );
  const mail = await import(
    pathToFileURL(path.join(root, "_lib/mail.js")).href
  );
  const oldMailFetch = globalThis.fetch,
    oldMailKey = process.env.RESEND_API_KEY;
  const changes = [];
  let providerFails = false;
  const acceptedPayload = {
    from: "Goldy Fantasy Sportsbook <sportsbook@coopergurrie.com>",
    to: ["test@example.invalid"],
    subject: "Accepted Ticket",
    html: "<p>Saved picks</p>",
    text: "Saved picks",
  };
  const emailDb = {
    rpc: async () => ({
      data: [
        {
          id: "mail",
          event_key: "confirmation:test",
          kind: "confirmation",
          ticket_id: "ticket",
          attempts: 1,
          payload: acceptedPayload,
        },
      ],
    }),
    from: (table) => ({
      update: (patch) => ({
        eq: async () => {
          changes.push({ table, patch });
          return {};
        },
      }),
    }),
  };
  process.env.RESEND_API_KEY = "test-provider-key";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.resend.com/emails");
    assert.equal(init.headers["Idempotency-Key"], "confirmation:test");
    assert.deepEqual(JSON.parse(init.body), acceptedPayload);
    return new Response(
      JSON.stringify(
        providerFails
          ? { message: "Temporary provider failure" }
          : { id: "provider-id" },
      ),
      {
        status: providerFails ? 503 : 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };
  try {
    assert.equal((await mail.deliverEmails(emailDb)).sent, 1);
    assert(
      changes.some(
        (c) => c.table === "outbound_emails" && c.patch.status === "sent",
      ),
    );
    providerFails = true;
    changes.length = 0;
    assert.equal((await mail.deliverEmails(emailDb)).sent, 0);
    assert(
      changes.some((c) => c.patch.status === "failed" && c.patch.lease_until),
    );
    console.log(
      "Email delivery preserves the saved payload/idempotency key and records transient failures for retry.",
    );
  } finally {
    globalThis.fetch = oldMailFetch;
    if (oldMailKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldMailKey;
  }
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
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer test-session",
    );
    const json = (value, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url.includes("/auth/v1/user"))
      return json({ id: "approved-user", email: "admin@example.invalid" });
    if (url.includes("/rpc/claim_memberships"))
      return claimFails ? json({ message: "claim unavailable" }, 400) : json(0);
    if (url.includes("/league_memberships"))
      return lookupFails
        ? json({ message: "lookup unavailable" }, 400)
        : json(membership);
    if (url.includes("/teams")) return json([]);
    throw new Error(`Unexpected test request: ${url}`);
  };
  const request = () =>
    new Request("https://example.invalid/api/generate-markets", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-session",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        league_id: "approved-league",
        week: 5,
        nfl_season: 2026,
        category: "Weekly Specials",
      }),
    });
  try {
    const adminResponse = await POST(request());
    assert.equal(adminResponse.status, 400);
    assert.match(
      (await adminResponse.json()).error,
      /teams could not be loaded/,
    );
    membership = { ...membership, role: "member" };
    assert.equal((await POST(request())).status, 403);
    membership = null;
    assert.equal((await POST(request())).status, 403);
    lookupFails = true;
    assert.equal((await POST(request())).status, 503);
    lookupFails = false;
    claimFails = true;
    assert.equal((await POST(request())).status, 503);
    console.log(
      "Approved admin passes; members and unmapped users are denied; lookup failures are distinct.",
    );
  } finally {
    globalThis.fetch = savedFetch;
    if (savedUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = savedKey;
  }
  if (process.argv.includes("--live-futures")) {
    const liveFetch = globalThis.fetch;
    const sleeper = async (path) => {
      const r = await liveFetch(
        `https://api.sleeper.com/v1/league/1312126153980391424/${path}`,
      );
      assert(r.ok);
      return r.json();
    };
    const [rosters, users] = await Promise.all([
      sleeper("rosters"),
      sleeper("users"),
    ]);
    const teams = rosters.map((r) => ({
      id: `00000000-0000-4000-8000-${String(r.roster_id).padStart(12, "0")}`,
      roster_id: r.roster_id,
      team_name:
        users.find((u) => u.user_id === r.owner_id)?.metadata?.team_name ??
        users.find((u) => u.user_id === r.owner_id)?.display_name ??
        `Team ${r.roster_id}`,
      wins: r.settings.wins,
      losses: r.settings.losses,
      ties: r.settings.ties,
    }));
    process.env.SUPABASE_URL = "https://futures-test.invalid";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.SUPABASE_ANON_KEY = "test-key";
    process.env.WEEKLY_WORKER_SECRET = "local-read-only-check";
    globalThis.fetch = async (input, init) =>
      String(input).startsWith("https://futures-test.invalid/rest/v1/teams")
        ? new Response(JSON.stringify(teams), {
            headers: { "Content-Type": "application/json" },
          })
        : liveFetch(input, init);
    try {
      const response = await POST(
        new Request("https://example.invalid/api/generate-markets", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-worker-secret": "local-read-only-check",
          },
          body: JSON.stringify({
            league_id: "test",
            week: 5,
            nfl_season: 2026,
            category: "Season Futures",
          }),
        }),
      );
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.quotes.length, 48);
      assert(result.quotes.every((q) => q.odds % 50 === 0));
      console.log(
        `Live Sleeper futures check: ${result.quotes.length} quotes, ${teams.length} teams, all odds rounded to 50; no live database changes.`,
      );
    } finally {
      globalThis.fetch = liveFetch;
    }
  }
  console.log(
    "Compiled generation API loads and returns JSON without TypeScript source files.",
  );
} finally {
  const parent = path.resolve("node_modules") + path.sep;
  if (!path.resolve(root).startsWith(parent))
    throw new Error("Runtime test cleanup escaped node_modules.");
  await rm(root, { recursive: true, force: true });
}
