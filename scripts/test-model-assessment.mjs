import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import path from "node:path";
import { pathToFileURL } from "node:url";
const compiled = await fs.mkdtemp(path.resolve("node_modules/.assessment-"));
for (const name of [
  "model-assessment",
  "model-pipeline",
  "line-model",
  "settlement",
  "futures-settlement",
  "game-status",
]) {
  const out = ts.transpileModule(
    await fs.readFile(`api/_lib/${name}.ts`, "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2023,
      },
    },
  );
  await fs.writeFile(path.join(compiled, `${name}.js`), out.outputText);
}
await fs.writeFile(path.join(compiled, "package.json"), '{"type":"module"}');
const {
  assessWeek,
  BASELINE,
  digest,
  selectHorizons,
  numeric,
  probability,
  compareCandidate,
  validConfig,
  blockInterval,
} = await import(
  pathToFileURL(path.join(compiled, "model-assessment.js")).href
);
const { highLowProbabilities } = await import(
  pathToFileURL(path.join(compiled, "line-model.js")).href
);
const league = "13121261-5398-4391-8240-000000000003",
  admin = randomUUID();
const quote = {
  id: randomUUID(),
  market_key: "team-total:a",
  kind: "team_total",
  side: "over",
  line: 100,
  team_id: "a",
  home_team_id: "a",
  away_team_id: "b",
  metadata: { fair_probability: 0.5 },
};
const run = {
  id: randomUUID(),
  captured_at: "2026-10-07T12:00:00Z",
  category: "Matchups",
  phase: "pregame",
  provenance: "as_of",
  model_version: "fixture",
  model_config: BASELINE,
  payload: {
    model_config: BASELINE,
    quotes: [quote],
    pool: [
      { id: "p", expected: 80, positions: ["QB"], injury: "" },
      { id: "q", expected: 100, positions: ["QB"], injury: "" },
    ],
    models: [
      { id: "a", roster_id: 1, mean: 80, sd: 20, lineup: [{ id: "p" }] },
    ],
  },
};
const outcome = {
  final: true,
  completed_period: true,
  confirmed_games_final: true,
  rosters: [{ roster_id: 1, points: 90, starters: ["q"] }],
  teams: { a: { points: 90, name: "A" } },
  players: { p: { played: true, points: 70 }, q: { played: true, points: 90 } },
  season_results: { champion: null, last: null, playoffRosters: null },
};
const cutoff = "2026-10-09T00:15:00Z";
const report = assessWeek(
  [run, { ...run, id: randomUUID(), captured_at: "2026-10-08T12:00:00Z" }],
  [],
  outcome,
  cutoff,
);
assert.equal(
  report.score_views.find(
    (r) => r.view === "actual_starters" && r.horizon === "opening",
  ).bias,
  10,
);
assert.equal(
  report.score_views.find(
    (r) => r.view === "best_lineup_conditional" && r.horizon === "opening",
  ).bias,
  10,
);
assert.equal(report.selection[0].forecast_selection_gap, -20);
assert.equal(report.selection[0].realized_selection_gap, -20);
assert.equal(
  report.markets.length,
  2,
  "one prediction per opening/final horizon; refreshes are not extra samples",
);
assert.equal(
  selectHorizons([run, { ...run, captured_at: cutoff }], cutoff).length,
  2,
);
assert.deepEqual(
  assessWeek([run], [], outcome, cutoff),
  assessWeek([run], [], outcome, cutoff),
);
assert.throws(() =>
  assessWeek([run], [], { ...outcome, completed_period: false }, cutoff),
);
assert.throws(() =>
  assessWeek([run], [], { ...outcome, final: false }, cutoff),
);
const push = assessWeek(
  [{ ...run, payload: { ...run.payload, quotes: [{ ...quote, line: 90 }] } }],
  [],
  outcome,
  cutoff,
);
assert.equal(push.markets[0].status, "PUSH");
assert.equal(push.families[0].n, 0);
const inactive = assessWeek(
  [
    {
      ...run,
      payload: {
        ...run.payload,
        quotes: [
          {
            ...quote,
            kind: "player_points",
            metadata: { player_id: "p", fair_probability: null },
          },
        ],
      },
    },
  ],
  [],
  {
    ...outcome,
    players: { ...outcome.players, p: { played: false, points: 0 } },
  },
  cutoff,
);
assert.equal(inactive.markets[0].status, "PUSH");
const future = assessWeek(
  [
    {
      ...run,
      category: "Season Futures",
      payload: {
        ...run.payload,
        quotes: [
          {
            ...quote,
            kind: "future_champion",
            metadata: { roster_id: 1, fair_probability: 0.3 },
          },
        ],
      },
    },
  ],
  [],
  outcome,
  cutoff,
);
assert.equal(future.markets[0].status, "OPEN");
assert.equal(future.families[0].n, 0);
assert.equal(
  numeric([
    { predicted: 4, actual: 2 },
    { predicted: 1, actual: 3 },
  ]).mae,
  2,
);
assert.equal(
  numeric([
    { predicted: 4, actual: 2 },
    { predicted: 1, actual: 3 },
  ]).bias,
  0,
);
assert.equal(
  probability([
    { p: 0.8, y: 1 },
    { p: 0.2, y: 0 },
  ]).brier,
  0.039999999999999994,
);
assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
assert.deepEqual(
  highLowProbabilities(
    [
      { mean: 80, sd: 20 },
      { mean: 90, sd: 20 },
    ],
    7,
  ),
  highLowProbabilities(
    [
      { mean: 80, sd: 20 },
      { mean: 90, sd: 20 },
    ],
    7,
  ),
);
assert(validConfig({ score_scale: 1.02, variance_scale: 0.98 }));
assert(!validConfig({ score_scale: 1.03, variance_scale: 1 }));
assert(!compareCandidate([], BASELINE, false).passed);
assert.deepEqual(blockInterval([1, 2, 3]), blockInterval([1, 2, 3]));
const evidence = Array.from({ length: 24 }, (_, i) => {
  const models = Array.from({ length: 12 }, (_, j) => ({
    id: `t${j}`,
    roster_id: j,
    mean: 100,
    sd: 20,
    lineup: [],
  }));
  const o = {
    ...outcome,
    rosters: models.map((m) => ({
      roster_id: m.roster_id,
      points: 110,
      starters: [],
    })),
    teams: Object.fromEntries(
      models.map((m) => [m.id, { name: m.id, points: 110 }]),
    ),
  };
  const r = {
    ...run,
    payload: {
      ...run.payload,
      models,
      quotes: models.map((m) => ({
        ...quote,
        team_id: m.id,
        home_team_id: m.id,
        away_team_id: null,
      })),
    },
  };
  return {
    period: i,
    week: i + 1,
    known_at: "2026-01-01",
    prediction_at: "2026-02-01",
    outcome: o,
    runs: [r],
    report: {
      cutoff,
      coverage: { missing_families: [] },
      scores: models.map((m) => ({
        view: "actual_starters",
        horizon: "opening",
        team_id: m.id,
        predicted: 100,
        actual: 110,
        sd: 20,
        model_config: BASELINE,
      })),
      markets: r.payload.quotes,
    },
  };
});
const comparison = compareCandidate(evidence, BASELINE, false);
assert(comparison.passed, JSON.stringify(comparison));
assert.equal(comparison.candidate.score_scale, 1.02);
assert(!compareCandidate(evidence, BASELINE, true).passed);
const leaked = evidence.map((w) => ({ ...w, known_at: "2030-01-01" }));
assert(
  !compareCandidate(leaked, BASELINE, false).passed,
  "walk-forward future results must not train earlier folds",
);
const db = new PGlite();
const { reviewModelWeek } = await import(
  pathToFileURL(path.join(compiled, "model-pipeline.js")).href
);
const originalFetch = globalThis.fetch;
let incomplete = false,
  unsettled = false,
  scoreCorrection = 0;
const storedHashes = [];
const settings = {
  season: "2026",
  scoring_settings: { pts: 1 },
  roster_positions: ["QB"],
  settings: { playoff_week_start: 15, playoff_teams: 7 },
};
const mockDb = {
  from(name) {
    const data =
      name === "teams"
        ? [{ id: "a", roster_id: 1, team_name: "A" }]
        : name === "model_controls"
          ? { active_id: "baseline", baseline_id: "baseline", paused: false }
          : name === "model_config_versions"
            ? { id: "baseline", config: BASELINE, parent_id: null }
            : name === "model_forecast_runs"
              ? [
                  {
                    ...run,
                    nfl_season: 2026,
                    market_week: 4,
                    model_version: "baseline",
                  },
                ]
              : name === "tickets" && unsettled
                ? [{ id: "unresolved" }]
                : [];
    const b = {
      select() {
        return b;
      },
      eq() {
        return b;
      },
      neq() {
        return b;
      },
      order() {
        return b;
      },
      range() {
        return b;
      },
      single() {
        return b;
      },
      limit() {
        return b;
      },
      then(resolve) {
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return b;
  },
  async rpc(name, args) {
    assert.equal(name, "save_model_assessment");
    storedHashes.push(args.p_hash);
    return { data: args.p_hash, error: null };
  },
};
try {
  globalThis.fetch = async (input) => {
    const url = String(input);
    const data = url.includes("state/nfl")
      ? { season: "2026", week: incomplete ? 4 : 5, season_type: "regular" }
      : url.includes("scoreboard")
        ? {
            season: { year: 2026, type: 2 },
            week: { number: 4 },
            leagues: [{ slug: "nfl" }],
            events: [
              {
                id: "g",
                date: cutoff,
                status: { type: { name: "STATUS_FINAL" } },
              },
            ],
          }
        : url.includes("/stats/")
          ? [
              { player_id: "p", stats: { gp: 1, pts: 70 } },
              { player_id: "q", stats: { gp: 1, pts: 90 + scoreCorrection } },
            ]
          : url.includes("/matchups/")
            ? [
                {
                  roster_id: 1,
                  points: 90 + scoreCorrection,
                  starters: ["q"],
                  players_points: { q: 90 + scoreCorrection },
                },
              ]
            : settings;
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  };
  const job = { id: "fixture", attempts: 1, league_id: league, market_week: 4 },
    l = { nfl_season: 2026, sleeper_league_id: "123" };
  const first = await reviewModelWeek(mockDb, job, l),
    second = await reviewModelWeek(mockDb, job, l);
  assert.equal(
    first.review_id,
    second.review_id,
    "full pipeline deterministic rerun hash",
  );
  assert.equal(first.change, "hold");
  scoreCorrection = 1;
  assert.notEqual(
    (await reviewModelWeek(mockDb, job, l)).review_id,
    first.review_id,
  );
  incomplete = true;
  assert.equal((await reviewModelWeek(mockDb, job, l)).pending, true);
  incomplete = false;
  unsettled = true;
  assert.equal((await reviewModelWeek(mockDb, job, l)).pending, true);
  assert.equal(
    storedHashes.length,
    3,
    "incomplete week and unresolved tickets do not write a completed review",
  );
} finally {
  globalThis.fetch = originalFetch;
}
try {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;`,
  );
  for (const file of (await fs.readdir("supabase/migrations")).sort())
    await db.exec(await fs.readFile(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users values($1,$2,now())", [
    admin,
    "cooper.gurrie@gmail.com",
  ]);
  await db.exec(
    `set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${admin}';set role authenticated;select claim_memberships();reset role;set request.jwt.claim.role='service_role';`,
  );
  const c = (
    await db.query("select * from model_controls where league_id=$1", [league])
  ).rows[0];
  const actualTeam = (
    await db.query("select id from teams where league_id=$1 limit 1", [league])
  ).rows[0].id;
  const runId = randomUUID(),
    q = {
      ...quote,
      team_id: actualTeam,
      home_team_id: actualTeam,
      away_team_id: null,
      metadata: { ...quote.metadata, assessment_run_id: runId },
    };
  const payload = { ...run.payload, quotes: [q] };
  const archive = () =>
    db.query("select save_model_forecast($1,$2,2026,4,$3,$4,$5,$6) as id", [
      runId,
      league,
      "Matchups",
      c.active_id,
      JSON.stringify({}),
      JSON.stringify(payload),
    ]);
  assert.equal((await archive()).rows[0].id, runId);
  await archive();
  assert.equal(
    (await db.query("select count(*)::int as n from model_forecast_runs"))
      .rows[0].n,
    1,
  );
  await assert.rejects(
    db.query("update model_forecast_runs set sources=$1 where id=$2", [
      "{}",
      runId,
    ]),
    /append-only/,
  );
  const job = randomUUID();
  await db.query(
    "insert into automation_jobs(id,league_id,event_key,operation,market_week,status,attempts,lease_until) values($1,$2,'assessment-test','model_review',4,'running',1,now()+interval '5 minutes')",
    [job, league],
  );
  const save = (o = outcome, comp = comparison) =>
    db.query("select save_model_assessment($1,1,$2,$3,$4,$5) as id", [
      job,
      digest({ o, report, comp }),
      JSON.stringify(o),
      JSON.stringify(report),
      JSON.stringify(comp),
    ]);
  const id = (await save()).rows[0].id;
  assert.equal((await save()).rows[0].id, id);
  const corrected = { ...outcome, teams: { a: { name: "A", points: 91 } } };
  assert.notEqual((await save(corrected)).rows[0].id, id);
  assert.equal(
    (await db.query("select count(*)::int n from model_outcome_revisions"))
      .rows[0].n,
    2,
  );
  await assert.rejects(save({ ...outcome, final: false }), /Confirmed/);
  const promote = () =>
    db.query("select control_model($1,$2,$3,$4,$5) id", [
      league,
      "promote",
      "Fixture validated all gates",
      id,
      c.active_id,
    ]);
  const promoted = (await promote()).rows[0].id;
  assert.notEqual(promoted, c.active_id);
  await assert.rejects(promote(), /changed/);
  const restored = (
    await db.query("select control_model($1,$2,$3,null,$4) id", [
      league,
      "auto_rollback",
      "Fixture operational failure rollback",
      promoted,
    ])
  ).rows[0].id;
  assert.equal(restored, c.active_id);
  assert.equal(
    (
      await db.query("select paused from model_controls where league_id=$1", [
        league,
      ])
    ).rows[0].paused,
    true,
  );
  const hold = compareCandidate([], BASELINE, false),
    held = (await save(outcome, hold)).rows[0].id;
  await assert.rejects(
    db.query("select control_model($1,$2,$3,$4,$5)", [
      league,
      "promote",
      "Insufficient data must retain model",
      held,
      c.active_id,
    ]),
    /paused/,
  );
  await db.exec(
    `set request.jwt.claim.role='authenticated';set role authenticated;`,
  );
  await db.query("select control_model($1,$2,$3)", [
    league,
    "resume",
    "Fixture administrator resumed improvement",
  ]);
  await assert.rejects(
    db.query("select control_model($1,$2,$3,$4,$5)", [
      league,
      "promote",
      "Admin cannot bypass gates",
      id,
      c.active_id,
    ]),
    /worker/i,
  );
  await db.exec(`reset role;set request.jwt.claim.role='service_role';`);
  await assert.rejects(
    db.query("select control_model($1,$2,$3,$4,$5)", [
      league,
      "promote",
      "Failed confidence gates cannot promote",
      held,
      c.active_id,
    ]),
    /gates/,
  );
  const original = (
    await db.query("select report from model_weekly_reviews where id=$1", [id])
  ).rows[0].report;
  assert.deepEqual(
    original,
    report,
    "old review remains reproducible after correction/promotion/rollback",
  );
} finally {
  await db.close();
}
await fs.mkdir("work", { recursive: true });
await fs.writeFile(
  "work/model-review-fixture.json",
  JSON.stringify(
    {
      nfl_season: 2026,
      market_week: 4,
      report,
      comparison: compareCandidate([], BASELINE, false),
    },
    null,
    2,
  ),
);
console.log(
  "Passed: independent numeric/probability fixtures, lineup decomposition, as-of deduplication, incomplete/push/inactive/futures treatment, seeded replay, chronological leakage rejection, bounded promotion/hold/pause, append-only corrections, rerun idempotency, rollback and old report reproduction. Database tests are local PGlite.",
);
