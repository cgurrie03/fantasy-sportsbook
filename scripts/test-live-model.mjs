import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
const dir = await fs.mkdtemp(path.resolve("node_modules/.live-model-"));
const db = new PGlite();
try {
  for (const file of [
    "line-model",
    "live-model",
    "live-review",
    "game-status",
    "live-pipeline",
  ]) {
    const { outputText } = ts.transpileModule(
      await fs.readFile(`api/_lib/${file}.ts`, "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2023,
        },
      },
    );
    await fs.writeFile(path.join(dir, `${file}.js`), outputText);
  }
  await fs.writeFile(path.join(dir, "package.json"), '{"type":"module"}');
  const { remainingForecast, buildLiveForecast, elapsedMinutes, sameGameDate } =
    await import(pathToFileURL(path.join(dir, "live-model.js")).href);
  const { evaluateLiveWeek } = await import(
    pathToFileURL(path.join(dir, "live-review.js")).href
  );
  assert.deepEqual(remainingForecast(23, 30, 60, [10, 20]), {
    mean: 23,
    remaining: 0,
    sd: 0,
  });
  assert.equal(remainingForecast(0, 30, 0, []).mean, 30);
  const half = remainingForecast(12, 24, 30, [20, 28]);
  assert.equal(half.remaining, 12);
  assert.equal(half.mean, 24);
  assert.notEqual(half.mean, 36);
  assert(remainingForecast(-2, 12, 30, []).mean < 12);
  assert.throws(() => remainingForecast(NaN, 10, 30, []));
  const game = {
    id: "g",
    starts_at: "2026-10-09T00:15:00Z",
    state: "in_progress",
    teams: ["DAL", "TB"],
    period: 2,
    clock_seconds: 0,
  };
  assert.equal(elapsedMinutes(game), 30);
  assert.equal(sameGameDate("2026-10-08", game.starts_at), true);
  assert.equal(sameGameDate("2026-10-11", "2026-10-11T17:00:00Z"), true);
  assert.equal(sameGameDate("2026-10-07", game.starts_at), false);
  assert.throws(() => elapsedMinutes({ ...game, period: 5 }), /overtime/);
  assert.throws(() => elapsedMinutes({ ...game, state: "suspended" }));
  const fixture = {
    games: [game],
    rosters: [
      {
        roster_id: 1,
        matchup_id: 1,
        starters: ["p"],
        starters_points: [12],
        points: 12,
      },
      {
        roster_id: 2,
        matchup_id: 1,
        starters: ["q"],
        starters_points: [8],
        points: 8,
      },
    ],
    projections: [
      {
        player_id: "p",
        team: "DAL",
        date: game.starts_at,
        stats: { pts: 24 },
        player: {},
      },
      {
        player_id: "q",
        team: "TB",
        date: game.starts_at,
        stats: { pts: 16 },
        player: {},
      },
      {
        player_id: "bench",
        team: "DAL",
        date: game.starts_at,
        stats: { pts: 100 },
        player: {},
      },
    ],
    stats: [
      {
        player_id: "p",
        updated_at: Date.parse(game.starts_at),
        stats: { pts: 12 },
      },
      {
        player_id: "q",
        updated_at: Date.parse(game.starts_at),
        stats: { pts: 8 },
      },
    ],
    history: [],
    scoring: { pts: 1 },
    teams: [
      { id: "a", roster_id: 1, team_name: "A" },
      { id: "b", roster_id: 2, team_name: "B" },
    ],
    fetched_at: "2026-10-09T01:30:00Z",
    slots: 1,
  };
  const built = buildLiveForecast(fixture);
  assert.equal(built.status, "shadow");
  assert.equal(built.teams[0].mean, 24);
  assert.equal(built.teams[0].players.length, 1);
  assert.equal(built.quotes.length, 1);
  assert.equal(built.quotes[0].acceptance_enabled, false);
  assert.equal(
    built.quotes[0].home_fair_probability +
      built.quotes[0].away_fair_probability,
    1,
  );
  const completed = buildLiveForecast({
    ...fixture,
    games: [{ ...game, state: "final" }],
  });
  assert.equal(completed.quotes.length, 0);
  assert.equal(completed.teams[0].mean, 12);
  assert.equal(completed.teams[0].sd, 0);
  const mismatch = buildLiveForecast({
    ...fixture,
    stats: [{ ...fixture.stats[0], stats: { pts: 9 } }, fixture.stats[1]],
  });
  assert.equal(mismatch.quotes.length, 0);
  assert.match(mismatch.teams[0].reasons.join(" "), /disagrees/);
  assert.equal(
    buildLiveForecast({
      ...fixture,
      rosters: [
        { ...fixture.rosters[0], custom_points: 100 },
        fixture.rosters[1],
      ],
    }).quotes.length,
    0,
  );
  assert.equal(
    buildLiveForecast({
      ...fixture,
      rosters: [{ ...fixture.rosters[0], starters: ["0"] }, fixture.rosters[1]],
    }).quotes.length,
    0,
  );
  assert.equal(
    buildLiveForecast({ ...fixture, games: [{ ...game, period: 5 }] }).quotes
      .length,
    0,
  );
  const runs = [
    {
      id: "r1",
      captured_at: "2026-10-09T00:30:00Z",
      status: "shadow",
      payload: built,
    },
    {
      id: "r2",
      captured_at: "2026-10-09T00:45:00Z",
      status: "shadow",
      payload: built,
    },
  ];
  const outcomes = [
    { roster_id: 1, points: 26, starters: ["p"] },
    { roster_id: 2, points: 14, starters: ["q"] },
  ];
  const report = evaluateLiveWeek(runs, outcomes);
  assert.equal(report.observations.length, 2);
  assert(report.observations.every((o) => o.run_id === "r2"));
  const horizon = report.horizons.find((h) => h.team_count);
  assert.equal(horizon.mae, 2);
  assert.equal(horizon.rmse, 2);
  assert.equal(horizon.bias, 0);
  assert(horizon.brier >= 0 && horizon.brier <= 1);
  assert.equal(
    evaluateLiveWeek(runs, [
      { ...outcomes[0], starters: ["different"] },
      outcomes[1],
    ]).excluded.length,
    1,
  );
  assert.equal(
    evaluateLiveWeek(runs, [outcomes[0], { ...outcomes[1], points: 26 }])
      .matches[0].tie,
    true,
  );
  assert.match(report.change_decision, /No model change/);
  assert.throws(() => evaluateLiveWeek(runs, []));
  const { reviewLiveWeek } = await import(
    pathToFileURL(path.join(dir, "live-pipeline.js")).href
  );
  const savedFetch = globalThis.fetch;
  let gameStatus = "STATUS_IN_PROGRESS",
    reviewSaved = false;
  const fakeReviewDb = {
    from(_name) {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return Promise.resolve({ data: runs, error: null });
        },
        then(resolve) {
          return Promise.resolve({
            data: [{ roster_id: 1 }, { roster_id: 2 }],
            error: null,
          }).then(resolve);
        },
      };
      return builder;
    },
    rpc: async () => {
      reviewSaved = true;
      return { data: "review", error: null };
    },
  };
  try {
    globalThis.fetch = async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes("state/nfl")
            ? { season: "2026", week: 6 }
            : String(url).includes("scoreboard")
              ? {
                  season: { year: 2026, type: 2 },
                  week: { number: 5 },
                  leagues: [{ slug: "nfl" }],
                  events: [
                    {
                      id: "one",
                      date: game.starts_at,
                      status: { type: { name: gameStatus } },
                    },
                  ],
                }
              : outcomes,
        ),
        { headers: { "content-type": "application/json" } },
      );
    const pendingReview = await reviewLiveWeek(
      fakeReviewDb,
      { league_id: "fixture", market_week: 5 },
      { nfl_season: 2026, sleeper_league_id: "123" },
    );
    assert.equal(pendingReview.pending, true);
    assert.equal(reviewSaved, false);
    gameStatus = "STATUS_FINAL";
    assert.equal(
      (
        await reviewLiveWeek(
          fakeReviewDb,
          { league_id: "fixture", market_week: 5 },
          { nfl_season: 2026, sleeper_league_id: "123" },
        )
      ).status,
      "complete",
    );
    assert.equal(reviewSaved, true);
  } finally {
    globalThis.fetch = savedFetch;
  }

  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;",
  );
  for (const file of (await fs.readdir("supabase/migrations")).sort())
    await db.exec(await fs.readFile(`supabase/migrations/${file}`, "utf8"));
  const league = "13121261-5398-4391-8240-000000000003",
    admin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  // Shadow/review fixtures below target Weeks 5 and 4. Anchor only the test
  // league so the real calendar cannot invalidate their week guards.
  await db.query(
    "update leagues set active_week=5,week_anchor=now() where id=$1",
    [league],
  );
  await db.exec(
    `insert into auth.users values('${admin}','cooper.gurrie@gmail.com',now());set role authenticated;set request.jwt.claim.sub='${admin}';select claim_memberships();reset role;set request.jwt.claim.role='service_role';`,
  );
  const cycle = randomUUID(),
    job = randomUUID();
  await db.query(
    "insert into line_refresh_cycles(id,league_id,market_week,slot)values($1,$2,5,123)",
    [cycle, league],
  );
  await db.query(
    "insert into automation_jobs(id,league_id,event_key,operation,market_week,refresh_cycle_id,status,attempts,lease_until) values($1,$2,'shadow-test','interval_matchups',5,$3,'running',1,now()+interval '5 minutes')",
    [job, league, cycle],
  );
  const snapshot = {
    model_version: "live-clock-shadow-v1",
    model_config: { mode: "shadow" },
    observed_at: new Date().toISOString(),
    source_hash: "a".repeat(64),
    sources: {},
    payload: built,
  };
  const save = async (attempt = 1) =>
    (
      await db.query("select save_live_shadow($1,$2,$3) as id", [
        job,
        attempt,
        JSON.stringify(snapshot),
      ])
    ).rows[0].id;
  const saved = await save();
  assert.equal(await save(), saved);
  await assert.rejects(() => save(2), /lease/);
  await assert.rejects(
    () =>
      db.query("update live_forecast_runs set status='blocked' where id=$1", [
        saved,
      ]),
    /append-only/,
  );
  await assert.rejects(
    () => db.query("delete from live_forecast_runs where id=$1", [saved]),
    /append-only/,
  );
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}';`);
  assert.equal(
    (await db.query("select count(*)::int as n from live_forecast_runs"))
      .rows[0].n,
    1,
  );
  await db.exec(
    "set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';",
  );
  assert.equal(
    (await db.query("select count(*)::int as n from live_forecast_runs"))
      .rows[0].n,
    0,
  );
  await assert.rejects(
    () =>
      db.query("select save_live_shadow($1,1,$2)", [
        job,
        JSON.stringify(snapshot),
      ]),
    /permission denied/,
  );
  await db.exec("reset role;set request.jwt.claim.role='service_role';");
  const reviewJob = randomUUID();
  await db.query(
    "insert into automation_jobs(id,league_id,event_key,operation,market_week,status,attempts,lease_until) values($1,$2,'review-test','model_review',4,'running',1,now()+interval '5 minutes')",
    [reviewJob, league],
  );
  const reviewSave = async () =>
    (
      await db.query("select save_live_model_review($1,1,$2,$3,$4,$5) as id", [
        reviewJob,
        "b".repeat(64),
        "c".repeat(64),
        JSON.stringify(outcomes),
        JSON.stringify(report),
      ])
    ).rows[0].id;
  const reviewId = await reviewSave();
  assert.equal(await reviewSave(), reviewId);
  await assert.rejects(
    () =>
      db.query("update live_model_reviews set report='{}' where id=$1", [
        reviewId,
      ]),
    /append-only/,
  );
  await db.query("update automation_jobs set market_week=5 where id=$1", [
    reviewJob,
  ]);
  await assert.rejects(reviewSave, /completed week/);
  await db.query(
    "update automation_jobs set lease_until=now()-interval '1 second' where id=$1",
    [job],
  );
  await assert.rejects(save, /lease/);
  console.log(
    "Live remaining-point boundaries, actual-starter locks, score mismatches, overtime suspension, horizon deduplication, independently checked MAE/RMSE/Brier, corrected append-only reviews, RLS, idempotency and lease fencing pass. Acceptance stays disabled.",
  );
} finally {
  await db.close();
  await fs.rm(dir, { recursive: true, force: true });
}
