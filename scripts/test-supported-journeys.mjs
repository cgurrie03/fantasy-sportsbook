// Actual compiled generation and authoritative SQL transactions, entirely local.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID as uuid } from "node:crypto";
import assert from "node:assert/strict";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import {
  normalizeSleeperIntake,
  reviewIntake,
} from "../api/_lib/league-intake.ts";
import { settleLeg } from "../api/_lib/settlement.ts";
for (const k of Object.keys(process.env))
  if (/^(BOFF_|VITE_|SUPABASE_|RESEND_|WEEKLY_WORKER_SECRET|VERCEL)/.test(k))
    delete process.env[k];
Object.assign(process.env, {
  BOFF_ENVIRONMENT: "test",
  NODE_ENV: "test",
  SUPABASE_URL: "https://journey.invalid",
  SUPABASE_ANON_KEY: "synthetic",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
  WEEKLY_WORKER_SECRET: "synthetic-worker",
  BOFF_BUILD_SHA: "a".repeat(40),
});
const compiled = await fs.mkdtemp(
  path.resolve("node_modules/.journey-runtime-"),
);
const target = path.resolve(compiled);
if (
  !target.startsWith(path.resolve("node_modules") + path.sep) ||
  !path.basename(target).startsWith(".journey-runtime-")
)
  throw Error("Unsafe fixture cleanup target");
const db = new PGlite(),
  q = async (s, a = []) => (await db.query(s, a)).rows;
const owner = uuid(),
  bettor = uuid(),
  coowner = uuid(),
  outsider = uuid();
const act = (id) =>
  db.exec(
    `reset role;set row_security=on;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${id}';set role authenticated`,
  );
const server = () =>
  db.exec(
    "reset role;set row_security=on;set request.jwt.claim.role='service_role';set request.jwt.claim.sub='';set role service_role",
  );
const originalFetch = globalThis.fetch;
let fixture,
  providerFailure = false,
  priorQuote = null;
const cases = [];
const reason =
  "Reviewed synthetic supported profile and exact isolated settings";
try {
  async function compile(dir = "") {
    for (const e of await fs.readdir(path.join("api", dir), {
      withFileTypes: true,
    })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) await compile(rel);
      else if (e.name.endsWith(".ts")) {
        const out = path.join(compiled, rel.replace(/\.ts$/, ".js"));
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
  const { POST: generate } = await import(
    pathToFileURL(path.join(compiled, "generate-markets.js")).href
  );
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;grant usage on schema public,auth to anon,authenticated",
  );
  await db.exec(
    await fs.readFile("supabase/development/baseline-schema.sql", "utf8"),
  );
  for (const f of (await fs.readdir("supabase/migrations"))
    .sort()
    .filter((f) => f >= "202610280055"))
    await db.exec(await fs.readFile("supabase/migrations/" + f, "utf8"));
  await q(
    "insert into sportsbook_private.application_environment(environment,project_ref,app_origin)values('development','whlcnlacueweaqpsupqs','https://dev.sportsbook.coopergurrie.com')",
  );
  for (const id of [owner, bettor, coowner, outsider])
    await q("insert into auth.users values($1,$2,now())", [
      id,
      id + "@example.invalid",
    ]);
  await q("insert into sportsbook_private.platform_owners(user_id)values($1)", [
    owner,
  ]);
  const rpc = {
    sportsbook_policy: ["p_league", "p_season", "p_week"],
    observe_provider_capability: [
      "p_league",
      "p_source",
      "p_report",
      "p_build",
      "p_started",
    ],
    save_model_forecast: [
      "p_run",
      "p_league",
      "p_season",
      "p_week",
      "p_category",
      "p_version",
      "p_sources",
      "p_payload",
    ],
  };
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(String(input)),
      endpoint = u.pathname.split("/").at(-1),
      json = (v) => Response.json(v);
    if (u.hostname === "journey.invalid") {
      const id = (k) => {
        const v = u.searchParams.get(k);
        assert(v?.startsWith("eq."));
        return v.slice(3);
      };
      if (rpc[endpoint]) {
        const b = JSON.parse(init.body),
          args = rpc[endpoint].map((k) => b[k]);
        assert.equal(b.p_league, fixture.id);
        try {
          return json(
            (
              await q(
                `select public.${endpoint}(${args.map((_, i) => "$" + (i + 1)).join(",")})r`,
                args,
              )
            )[0].r,
          );
        } catch (e) {
          return Response.json(
            { code: e.code ?? "fixture", message: e.message },
            { status: 400 },
          );
        }
      }
      if (endpoint === "teams") {
        assert.equal(id("league_id"), fixture.id);
        return json(
          await q(
            "select id,roster_id,team_name,wins,losses,ties from teams where league_id=$1 order by roster_id",
            [fixture.id],
          ),
        );
      }
      if (endpoint === "leagues") {
        assert.equal(id("id"), fixture.id);
        return json(
          (
            await q(
              "select sleeper_league_id,nfl_season,provider_review_required from leagues where id=$1",
              [fixture.id],
            )
          )[0],
        );
      }
      if (endpoint === "line_refresh_runtime") return json(null);
      if (endpoint === "model_controls")
        return json(
          (
            await q(
              "select active_id,baseline_id from model_controls where league_id=$1",
              [fixture.id],
            )
          )[0],
        );
      if (endpoint === "model_config_versions")
        return json(
          (
            await q(
              "select id,config from model_config_versions where id=$1 and league_id=$2",
              [id("id"), fixture.id],
            )
          )[0],
        );
      throw Error("Unexpected local REST fixture endpoint " + endpoint);
    }
    assert(
      ["api.sleeper.app", "api.sleeper.com"].includes(u.hostname),
      "All unexpected network access rejected",
    );
    if (providerFailure)
      return Response.json(
        { error: "synthetic provider outage" },
        { status: 503 },
      );
    if (u.pathname.includes("/projections/")) return json(fixture.projections);
    if (endpoint === "rosters") return json(fixture.rosters);
    if (u.pathname.includes("/matchups/"))
      return json(
        fixture.rosters.map((r) => ({
          roster_id: r.roster_id,
          matchup_id: Math.ceil(r.roster_id / 2),
        })),
      );
    if (endpoint === "traded_picks") return json([]);
    assert.equal(endpoint, fixture.raw.league_id);
    return json(fixture.raw);
  };
  async function generateFamily(category) {
    await server();
    const response = await generate(
      new Request("https://fixture.invalid/api/generate-markets", {
        method: "POST",
        headers: { "x-worker-secret": "synthetic-worker" },
        body: JSON.stringify({
          league_id: fixture.id,
          nfl_season: fixture.raw.season * 1,
          week: 1,
          category,
        }),
      }),
    );
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert(body.quotes.length > 0);
    return body.quotes;
  }
  for (const count of [8, 10, 12, 14, 16]) {
    const alternate = count === 10 || count === 14,
      provider = "330000000000000" + count;
    const raw = {
      league_id: provider,
      sport: "nfl",
      season_type: "regular",
      season: "2030",
      status: "in_season",
      name: "Synthetic " + count + "-team journey",
      total_rosters: count,
      roster_positions: alternate
        ? ["QB", "WR", "FLEX", "BN"]
        : ["QB", "WR", "BN"],
      scoring_settings: {
        pass_yd: 0.04,
        pass_td: alternate ? 6 : 4,
        rush_yd: 0.1,
        rec: alternate ? 0.5 : 1,
        rec_yd: 0.1,
        rec_td: 6,
      },
      settings: { playoff_week_start: 15, playoff_teams: count >= 12 ? 6 : 4 },
    };
    const rosters = Array.from({ length: count }, (_, i) => ({
      league_id: provider,
      roster_id: i + 1,
      owner_id: null,
      co_owners: [],
      players: ["q" + i, "w" + i, "b" + i],
      starters: ["q" + i, "w" + i, ...(alternate ? ["b" + i] : [])],
      settings: { wins: i % 4, losses: (i + 1) % 3, ties: 0 },
    }));
    const projections = rosters.flatMap((r, i) =>
      [
        ["q", "QB", { gp: 1, pass_yd: 200 + i * 10, pass_td: 2 }],
        ["w", "WR", { gp: 1, rec: 5 + i, rec_yd: 60 + i * 3, rec_td: i % 2 }],
        ["b", "WR", { gp: 1, rec: 1, rec_yd: 10 }],
      ].map(([prefix, position, stats]) => ({
        player_id: prefix + i,
        date: "2050-10-13T17:00:00Z",
        stats,
        player: { position, first_name: prefix + i },
        team: "BUF",
      })),
    );
    const source = normalizeSleeperIntake(raw, rosters, []);
    await act(owner);
    const draft = (
      await q("select save_league_intake_draft($1,$2,$3)r", [
        uuid(),
        source,
        reviewIntake(source),
      ])
    )[0].r;
    const imported = (
      await q("select import_league_intake_draft($1,1,1,$2)r", [
        draft.id,
        reason,
      ])
    )[0].r;
    fixture = { id: imported.league_id, raw, rosters, projections };
    assert.equal(
      (
        await q("select import_league_intake_draft($1,1,1,$2)r", [
          draft.id,
          reason,
        ])
      )[0].r.duplicate,
      true,
    );
    const teams = await q(
      "select id,roster_id from teams where league_id=$1 order by roster_id",
      [fixture.id],
    );
    assert.equal(teams.length, count);
    const boost = alternate ? 40 : 30,
      step = alternate ? 50 : 25,
      minimum = alternate ? 2 : 5;
    await q("select save_wallet_policy($1,0,2030,1,$2,$3)", [
      fixture.id,
      {
        minimum_stake: minimum,
        maximum_picks: alternate ? 3 : 2,
        weekly_target: alternate ? 120 : 150,
        futures_cash_floor: 25,
      },
      reason,
    ]);
    await q("select save_sportsbook_policy($1,0,2030,1,$2,$3)", [
      fixture.id,
      {
        featured_boost_pct: boost,
        matchup_odds_step: step,
        weekly_odds_step: step,
        futures_enabled: false,
      },
      reason,
    ]);
    const wallets = [];
    for (const user of [bettor, coowner]) {
      const approved = (
        await q("select approve_user_wallet($1,$2,$3,$4)r", [
          fixture.id,
          user,
          teams[0].id,
          reason,
        ])
      )[0].r;
      wallets.push(approved.wallet_id);
    }
    const cutover = (
      await q("select prepare_user_finance_cutover($1,$2)r", [
        fixture.id,
        reason,
      ])
    )[0].r;
    await q("select activate_user_finance_cutover($1,$2,$3,$4)", [
      fixture.id,
      cutover.review_id,
      uuid(),
      reason,
    ]);
    for (const [i, user] of [bettor, coowner].entries()) {
      await q("select initialize_user_wallet($1,$2,'zero',null,$3,$4)", [
        fixture.id,
        user,
        reason,
        uuid(),
      ]);
      await q("select set_user_wallet_balance($1,0,100,$2,$3)", [
        wallets[i],
        reason,
        uuid(),
      ]);
    }
    const quotes = [];
    for (const category of ["Matchups", "Player Points", "Weekly Specials"])
      quotes.push(...(await generateFamily(category)));
    assert(quotes.every((x) => x.metadata.sportsbook_policy_revision === 1));
    assert(
      quotes
        .filter((x) => x.kind === "moneyline")
        .every((x) => x.odds % step === 0),
    );
    assert(
      quotes.filter((x) => x.boost_pct).every((x) => x.boost_pct === boost),
    );
    assert(
      quotes
        .filter((x) => x.kind.startsWith("weekly_"))
        .every((x) => x.metadata.expected_team_count === count),
    );
    assert(
      quotes
        .filter((x) => x.kind === "moneyline" || x.kind.startsWith("weekly_"))
        .every((x) => x.metadata.price_rounding_step === step),
      "saved rounding metadata follows the effective policy",
    );
    const featured = quotes.find(
      (x) => x.kind === "moneyline" && x.boost_pct === boost,
    );
    assert(featured);
    const picks = [
      featured,
      quotes.find(
        (x) => x.kind === "moneyline" && x.matchup_key !== featured.matchup_key,
      ),
    ];
    assert(picks[1]);
    const firstTeam = teams[0].id,
      firstLine = quotes.find(
        (x) => x.kind === "moneyline" && x.team_id === firstTeam,
      );
    const expectedMean = alternate ? 30 : 27;
    const observedMean =
      firstLine.team_id === firstLine.home_team_id
        ? firstLine.home_projection
        : firstLine.away_projection;
    assert.equal(
      observedMean,
      expectedMean,
      "actual generator respects scoring and lineup contrast",
    );
    if (count === 8) {
      const importedFixture = fixture;
      await db.exec("reset role");
      const legacyId = uuid(),
        legacyProvider = provider + "7";
      await q(
        "insert into leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor)values($1,'Synthetic existing futures profile',$2,2030,1,1,now())",
        [legacyId, legacyProvider],
      );
      await q("insert into weekly_schedule(league_id)values($1)", [legacyId]);
      for (let i = 1; i <= count; i++)
        await q(
          "insert into teams(id,league_id,roster_id,team_name,owner_name,sportsbook_owner_name)values($1,$2,$3,$4,'Unclaimed','Unclaimed')",
          [uuid(), legacyId, i, "Future " + i],
        );
      await act(owner);
      await q("select save_sportsbook_policy($1,0,2030,1,$2,$3)", [
        legacyId,
        { futures_odds_step: 25, futures_max_odds: 1000 },
        reason,
      ]);
      fixture = {
        id: legacyId,
        raw: { ...raw, league_id: legacyProvider },
        rosters: rosters.map((r) => ({ ...r, league_id: legacyProvider })),
        projections,
      };
      const futures = await generateFamily("Season Futures");
      assert(
        futures.every(
          (x) =>
            x.metadata.sportsbook_policy_revision === 1 &&
            x.metadata.price_rounding_step === 25 &&
            Math.abs(x.odds) <= 1000,
        ),
        "early-return futures path consumes current revision, cap and rounding",
      );
      await act(owner);
      await q("select save_future_board_revision($1,$2,null,$3,'published')", [
        uuid(),
        legacyId,
        futures,
      ]);
      fixture = importedFixture;
    }
    await act(owner);
    const reviewed = (
      await q("select provider_capability_review($1)r", [fixture.id])
    )[0].r;
    await q("select approve_provider_capability($1,$2,0,$3,$4,true)", [
      fixture.id,
      reviewed.review_hash,
      process.env.BOFF_BUILD_SHA,
      reason,
    ]);
    const board = uuid();
    await q(
      "select save_market_board($1,$2,1,now()-interval '1 hour',now()+interval '1 hour',$3,'published')",
      [board, fixture.id, quotes],
    );
    await db.exec("reset role;set session_replication_role=replica");
    await q("update leagues set operations_enabled=true where id=$1", [
      fixture.id,
    ]);
    await db.exec("set session_replication_role=origin");
    const boardStateBefore = (
      await q("select revision from sportsbook_boards where id=$1", [board])
    )[0].revision;
    providerFailure = true;
    await server();
    const failedGeneration = await generate(
      new Request("https://fixture.invalid/api/generate-markets", {
        method: "POST",
        headers: { "x-worker-secret": "synthetic-worker" },
        body: JSON.stringify({
          league_id: fixture.id,
          nfl_season: 2030,
          week: 1,
          category: "Matchups",
        }),
      }),
    );
    assert.notEqual(failedGeneration.status, 200);
    providerFailure = false;
    await db.exec("reset role");
    assert.equal(
      (
        await q("select revision from sportsbook_boards where id=$1", [board])
      )[0].revision,
      boardStateBefore,
      "provider outage retains the published board",
    );
    const revision = (
      await q("select revision from sportsbook_boards where id=$1", [board])
    )[0].revision;
    await act(bettor);
    await assert.rejects(
      q("select place_sportsbook_ticket($1,$2,$3::uuid[],$4,$5)", [
        board,
        revision,
        picks.map((x) => x.id),
        minimum - 1,
        uuid(),
      ]),
      /minimum/,
    );
    if (priorQuote)
      await assert.rejects(
        q("select place_sportsbook_ticket($1,$2,$3::uuid[],10,$4)", [
          board,
          revision,
          [featured.id, priorQuote],
          uuid(),
        ]),
        /selection|board|unavailable/i,
      );
    const request = uuid(),
      ticket = (
        await q("select place_sportsbook_ticket($1,$2,$3::uuid[],10,$4)r", [
          board,
          revision,
          picks.map((x) => x.id),
          request,
        ])
      )[0].r;
    assert.equal(
      (
        await q("select place_sportsbook_ticket($1,$2,$3::uuid[],10,$4)r", [
          board,
          revision,
          picks.map((x) => x.id),
          request,
        ])
      )[0].r.duplicate,
      true,
    );
    await act(coowner);
    await assert.rejects(
      q("select place_sportsbook_ticket($1,$2,$3::uuid[],10,$4)", [
        board,
        revision,
        picks.map((x) => x.id),
        request,
      ]),
      /another financial account/,
    );
    const playerPicks = quotes
      .filter(
        (x) =>
          x.kind === "player_points" &&
          x.side === "over" &&
          !x.metadata.lineup_locked,
      )
      .slice(0, 2);
    assert.equal(playerPicks.length, 2);
    const second = (
      await q("select place_sportsbook_ticket($1,$2,$3::uuid[],10,$4)r", [
        board,
        revision,
        playerPicks.map((x) => x.id),
        uuid(),
      ])
    )[0].r;
    await act(owner);
    const acceptedLegs = await q(
      "select * from ticket_legs where ticket_id=$1 order by leg_number",
      [ticket.ticket_id],
    );
    const accepted = acceptedLegs[0];
    const acceptedCopy = JSON.stringify(accepted);
    await q(
      "select save_market_board($1,$2,1,now()-interval '1 hour',now()+interval '1 hour',$3,'published')",
      [
        board,
        fixture.id,
        quotes.map((x) =>
          x.id === featured.id ? { ...x, odds: x.odds * 2 } : x,
        ),
      ],
    );
    assert.equal(
      JSON.stringify(
        (await q("select * from ticket_legs where id=$1", [accepted.id]))[0],
      ),
      acceptedCopy,
      "repricing preserves accepted terms",
    );
    const results = {
      final: true,
      teams: Object.fromEntries(
        teams.map((t, i) => [
          t.id,
          {
            name: "Final " + i,
            points: picks.some((x) => x.team_id === t.id) ? 999 - i : 100 - i,
          },
        ]),
      ),
      players: Object.fromEntries(
        playerPicks.map((x) => [
          x.metadata.player_id,
          { played: true, points: Number(x.line) + 10 },
        ]),
      ),
    };
    assert.equal(
      settleLeg(accepted, { ...results, final: false }).status,
      "OPEN",
    );
    const settled = acceptedLegs.map((x) => settleLeg(x, results));
    assert(settled.every((x) => x.status === "WON"));
    const paid = (
      await q("select settle_weekly_ticket($1,$2)r", [
        ticket.ticket_id,
        settled,
      ])
    )[0].r;
    const boostedDecimal = picks.reduce(
      (value, x) =>
        value *
        (1 +
          (x.odds > 0 ? x.odds / 100 : 100 / Math.abs(x.odds)) *
            (1 + x.boost_pct / 100)),
      1,
    );
    assert.equal(
      Number(paid.payout),
      Math.round(boostedDecimal * 10 * 100) / 100,
    );
    assert.equal(
      (
        await q("select settle_weekly_ticket($1,$2)r", [
          ticket.ticket_id,
          settled,
        ])
      )[0].r.duplicate,
      true,
    );
    const secondLegs = await q(
      "select * from ticket_legs where ticket_id=$1 order by leg_number",
      [second.ticket_id],
    );
    const outcomes = secondLegs.map((x) => settleLeg(x, results));
    assert(outcomes.every((x) => x.status === "WON"));
    await q("select settle_weekly_ticket($1,$2)", [second.ticket_id, outcomes]);
    assert.equal(
      (
        await q(
          "select count(*)::int n from user_wallet_entries where wallet_id=$1 and kind='settlement'",
          [wallets[0]],
        )
      )[0].n,
      1,
    );
    assert.equal(
      (
        await q("select recipient from outbound_emails where ticket_id=$1", [
          second.ticket_id,
        ])
      )[0].recipient,
      coowner + "@example.invalid",
    );
    await db.exec("reset role");
    const balancesBefore = await q(
      "select id,balance from user_wallets where league_id=$1 order by id",
      [fixture.id],
    );
    const acceptedFinal = JSON.stringify(
      (await q("select * from ticket_legs where id=$1", [accepted.id]))[0],
    );
    await q("update leagues set operations_enabled=false where id=$1", [
      fixture.id,
    ]);
    const next = structuredClone(source);
    next.previous_league_id = source.league_id;
    next.league_id = source.league_id + "1";
    next.season = 2031;
    next.teams[0].owner_id = "991122";
    await server();
    const observation = (
      await q("select observe_provider_capability($1,$2,$3,$4,$5)r", [
        fixture.id,
        next,
        reviewIntake(next),
        process.env.BOFF_BUILD_SHA,
        new Date().toISOString(),
      ])
    )[0].r;
    await act(owner);
    await q("select renew_provider_season($1,$2,2030,$3)", [
      fixture.id,
      observation.review_hash,
      reason,
    ]);
    assert.deepEqual(
      await q(
        "select id,balance from user_wallets where league_id=$1 order by id",
        [fixture.id],
      ),
      balancesBefore,
    );
    assert.equal(
      JSON.stringify(
        (await q("select * from ticket_legs where id=$1", [accepted.id]))[0],
      ),
      acceptedFinal,
    );
    assert.equal(
      (await q("select status from sportsbook_boards where id=$1", [board]))[0]
        .status,
      "closed",
    );
    assert.equal(
      (await q("select provider_capability_review($1)r", [fixture.id]))[0].r
        .approval_current,
      false,
    );
    assert.equal(
      (
        await q("select settle_weekly_ticket($1,$2)r", [
          ticket.ticket_id,
          settled,
        ])
      )[0].r.duplicate,
      true,
      "old-season settlement retry remains idempotent",
    );
    await act(bettor);
    const history = (
      await q("select account_ticket_page($1,$2,null,20)r", [
        fixture.id,
        { personal: true },
      ])
    )[0].r;
    assert.equal(history.total, 1);
    assert.equal(history.tickets[0].nfl_season, 2030);
    await act(outsider);
    await assert.rejects(
      q("select account_ticket_page($1,$2,null,20)", [
        fixture.id,
        { personal: true },
      ]),
      /access/,
    );
    priorQuote = featured.id;
    cases.push({
      teams: count,
      scoring: alternate ? "half-PPR/6-point passing" : "PPR/4-point passing",
      starters: alternate ? 3 : 2,
      quotes: quotes.length,
      shared_policy_revision: 1,
      settlement: "once",
      renewal: "preserved terms and wallets",
      synthetic: true,
    });
  }
  await fs.mkdir("work", { recursive: true });
  await fs.writeFile(
    "work/supported-journeys.json",
    JSON.stringify(
      {
        cases,
        scope:
          "Compiled API with intercepted provider/REST bridge to disposable Postgres; no actual league, Auth, wallet, email or deployment touched.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Supported journeys: actual compiled generation, inactive import, owner policies/review, publication, independent co-owner acceptance, repricing/settlement, tenant negatives and linked renewal/old-season receipts across 8/10/12/14/16 teams. All providers intercepted; SQL disposable.",
  );
} finally {
  globalThis.fetch = originalFetch;
  await db.close();
  await fs.rm(target, { recursive: true, force: true });
}
