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
    "_lib/model-assessment",
    "_lib/model-pipeline",
    "_lib/count-options",
    "_lib/futures-model",
    "_lib/futures-settlement",
    "_lib/settlement",
    "_lib/worker-auth",
    "_lib/game-status",
    "_lib/active-starters",
    "_lib/live-model",
    "_lib/live-review",
    "_lib/live-pipeline",
    "active-starters",
    "_lib/email-templates",
    "_lib/mail",
    "_lib/league-communications",
    "weekly-worker",
    "place-bet",
    "promo-image",
    "_lib/promo-image",
    "report-results",
    "report-avatar",
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
  const starterStatus = await import(
    pathToFileURL(path.join(root, "active-starters.js")).href
  );
  assert.equal(
    (
      await starterStatus.GET(
        new Request("https://example.invalid/api/active-starters"),
      )
    ).status,
    401,
  );
  const response = await POST(
    new Request("https://example.invalid/api/generate-markets", {
      method: "POST",
    }),
  );
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /not configured/);
  const report = await import(
    pathToFileURL(path.join(root, "report-results.js")).href
  );
  const avatar = await import(
    pathToFileURL(path.join(root, "report-avatar.js")).href
  );
  assert.equal(
    (
      await avatar.GET(
        new Request(
          "https://example.invalid/api/report-avatar?path=https://evil.invalid",
        ),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await avatar.GET(
        new Request(
          "https://example.invalid/api/report-avatar?path=/avatars/../../secret",
        ),
      )
    ).status,
    400,
  );
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(
        url,
        "https://sleepercdn.com/avatars/964be8b3957b1ce3d42b656f4d747c73",
      );
      assert.equal(options.redirect, "error");
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      });
    };
    const image = await avatar.GET(
      new Request(
        "https://example.invalid/api/report-avatar?path=/avatars/964be8b3957b1ce3d42b656f4d747c73",
      ),
    );
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal((await image.arrayBuffer()).byteLength, 3);
    globalThis.fetch = async () =>
      new Response("not an image", {
        headers: { "content-type": "text/html" },
      });
    assert.equal(
      (
        await avatar.GET(
          new Request(
            "https://example.invalid/api/report-avatar?path=/avatars/964be8b3957b1ce3d42b656f4d747c73",
          ),
        )
      ).status,
      404,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(
    (
      await report.POST(
        new Request("https://example.invalid/api/report-results", {
          method: "POST",
        }),
      )
    ).status,
    401,
  );
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
  assert.equal(
    worker.retainPublishedBoard("published", "refresh_matchups"),
    false,
  );
  assert.equal(
    worker.retainPublishedBoard("published", "refresh_players"),
    false,
  );
  assert.equal(
    worker.retainPublishedBoard("published", "refresh_specials"),
    false,
  );
  assert.equal(
    worker.retainPublishedBoard("published", "generate_matchups"),
    true,
  );
  const morningRefresh = [
    "refresh_matchups",
    "refresh_players",
    "refresh_specials",
  ].map((operation) => ({ operation, status: "done" }));
  assert(worker.publicationRefreshComplete(morningRefresh));
  assert.equal(
    worker.publicationRefreshComplete(morningRefresh.slice(0, 2)),
    false,
  );
  assert.equal(
    worker.publicationRefreshComplete([
      ...morningRefresh.slice(0, 2),
      { operation: "refresh_specials", status: "failed" },
    ]),
    false,
  );
  console.log(
    "Scheduled worker rejects unauthenticated requests; Eastern times follow daylight saving.",
  );
  const mail = await import(
    pathToFileURL(path.join(root, "_lib/mail.js")).href
  );
  const oldMailFetch = globalThis.fetch,
    oldMailKey = process.env.RESEND_API_KEY;
  // Opening content must be built from the final published board, not preview fixtures.
  const openingTeams = Array.from({ length: 4 }, (_, i) => ({
    id: `team${i}`,
    team_name: `Final Team ${i}`,
    wins: 4 - i,
    losses: i,
    ties: 0,
    avatar_url: `https://example.invalid/team${i}.png`,
  }));
  const openingQuotes = [
    {
      kind: "spread",
      matchup_key: "match",
      home_team_id: "team0",
      away_team_id: "team1",
      team_id: "team0",
      line: 7.5,
      home_projection: 140,
      away_projection: 147,
      featured: "Game of the Week",
    },
    { kind: "spread", matchup_key: "match", team_id: "team1", line: -7.5 },
    {
      kind: "moneyline",
      matchup_key: "match",
      team_id: "team0",
      odds: 150,
      boost_pct: 25,
    },
    {
      kind: "moneyline",
      matchup_key: "match",
      team_id: "team1",
      odds: -170,
      boost_pct: 25,
    },
    {
      kind: "match_total",
      matchup_key: "match",
      side: "over",
      line: 287.5,
      odds: -110,
      boost_pct: 0,
    },
  ];
  let openingStatus = "published";
  const openingDb = {
    from(table) {
      const filters = {};
      const query = {
        select() {
          return query;
        },
        eq(k, v) {
          filters[k] = v;
          return query;
        },
        lte() {
          return query;
        },
        gt() {
          return query;
        },
        then(resolve) {
          const records =
            table === "teams"
              ? openingTeams
              : table === "league_memberships"
                ? openingTeams.map((t, i) => ({
                    team_id: t.id,
                    display_name: `Final Owner ${i}`,
                  }))
                : table === "wallets"
                  ? [{ balance: 173.25 }]
                  : table === "leagues"
                    ? [
                        {
                          name: "Test League",
                          sportsbook_url: "https://test.example.invalid/",
                          email_sender: "test@example.invalid",
                          nfl_season: 2026,
                          league_season: 3,
                        },
                      ]
                    : table === "sportsbook_boards"
                      ? [
                          filters.board_type === "future"
                            ? { id: "future" }
                            : {
                                id: "weekly",
                                status: openingStatus,
                                opens_at: "2026-10-07T12:00:00Z",
                                closes_at: "2026-10-09T00:00:00Z",
                              },
                        ]
                      : filters.board_id === "future"
                        ? openingTeams.map((t, i) => ({
                            team_id: t.id,
                            odds: 300 + i * 50,
                            metadata: { simulated_probability: 0.4 - i * 0.05 },
                          }))
                        : openingQuotes;
          return Promise.resolve({ data: records }).then(resolve);
        },
      };
      return query;
    },
  };
  const openingRow = {
    kind: "opening",
    league_id: "test",
    team_id: "team0",
    market_week: 5,
  };
  const finalOpening = await mail.buildEmail(openingDb, openingRow);
  assert.equal(finalOpening.featured[0].teams[0].record, "4–0");
  assert.equal(
    finalOpening.featured[0].teams[0].avatarUrl,
    openingTeams[0].avatar_url,
  );
  assert.equal(finalOpening.featured[0].teams[0].boostedOdds, "+188");
  assert.equal(finalOpening.featured[0].total, "287.5");
  assert.match(finalOpening.stories[0].title, /FUTURE BETS ARE LIVE/);
  assert.match(finalOpening.stories[0].text, /Final Owner 3.*\+450/);
  openingQuotes[4].line = 299.5;
  assert.equal(
    (await mail.buildEmail(openingDb, openingRow)).featured[0].total,
    "299.5",
  );
  openingStatus = "draft";
  await assert.rejects(
    () => mail.buildEmail(openingDb, openingRow),
    /waits for final publication/,
  );
  console.log(
    "Opening email uses final published lines, boosted odds, current records, avatars, owner favorites and balance; drafts cannot send.",
  );
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
          league_id: "test",
          team_id: "team0",
          recipient: "test@example.invalid",
          event_key: "confirmation:test",
          kind: "confirmation",
          ticket_id: "ticket",
          attempts: 1,
          payload: acceptedPayload,
        },
      ],
    }),
    from: (table) => ({
      select: () => {
        const query = {
          eq: () => query,
          maybeSingle: async () => ({
            data: { id: "fixture", role: "member" },
            error: null,
          }),
        };
        return query;
      },
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
      assert(result.quotes.every((q) => Math.abs(q.odds) <= 10000));
      console.log(
        JSON.stringify(
          result.quotes
            .filter((q) => q.kind === "future_champion")
            .map((q) => ({
              team: q.label,
              champion: q.metadata.simulated_probability,
              mean: q.metadata.season_mean,
              sd: q.metadata.weekly_score_sd,
              uncertainty: q.metadata.strength_uncertainty,
              missing: q.metadata.missing_projection_weeks,
            })),
        ),
      );
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
