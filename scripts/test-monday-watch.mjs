import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";
const root = await mkdtemp(path.resolve("node_modules/.monday-test-"));
try {
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  for (const file of [
    "monday-watch",
    "email-templates",
    "game-status",
    "line-model",
    "ticket-progress",
    "settlement",
    "live-model",
  ]) {
    const source = await readFile(`api/_lib/${file}.ts`, "utf8");
    await writeFile(
      path.join(root, `${file}.js`),
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2023,
        },
      }).outputText,
    );
  }
  const { mondayTickets, mondayEmail, scoreContenders } = await import(
    pathToFileURL(path.join(root, "monday-watch.js")).href
  );
  const { sampleEmail, renderEmail, emailTemplateGroups, teamWatchText } =
    await import(pathToFileURL(path.join(root, "email-templates.js")).href);
  const snapshot = {
    checkedAt: "2026-10-12T21:00:00Z",
    games: [
      {
        teams: ["BUF", "LAR"],
        state: "scheduled",
        starts_at: "2026-10-13T00:15:00Z",
      },
      {
        teams: ["ATL", "TB"],
        state: "final",
        starts_at: "2026-10-11T17:00:00Z",
      },
    ],
    teams: { a: { name: "A", points: 100 }, b: { name: "B", points: 90 } },
    players: {
      allen: { played: false, points: 0 },
      bijan: { played: true, points: 15.8 },
      inactive: { played: false, points: 0 },
    },
    teamPlayers: { a: ["allen"], b: ["bijan"] },
    catalog: {
      allen: { full_name: "Josh Allen", team: "BUF" },
      bijan: { full_name: "Bijan Robinson", team: "ATL" },
      inactive: { full_name: "Inactive", team: "ATL" },
    },
  };
  const { remainingForecast } = await import(
    pathToFileURL(path.join(root, "live-model.js")).href
  );
  assert.equal(
    remainingForecast(10, 24, 30, []).remaining,
    11,
    "in-progress forecast adds remaining points, not the entire pregame projection",
  );
  const ticket = {
    id: "personal-1",
    status: "OPEN",
    stake: 10,
    accepted_potential_payout: 36.4,
  };
  const race = {
    ...snapshot,
    teams: {
      a: { name: "Finished Leader", points: 190 },
      b: { name: "Contender", points: 155 },
      c: { name: "Distant", points: 90 },
      d: { name: "Finished Runner", points: 170 },
    },
    forecasts: {
      a: { projected: 190, sd: 0, remaining: [], finished: true },
      b: { projected: 194, sd: 12, remaining: ["Josh Allen"], finished: false },
      c: {
        projected: 100,
        sd: 5,
        remaining: ["Another Player"],
        finished: false,
      },
      d: { projected: 170, sd: 0, remaining: [], finished: true },
    },
  };
  assert.deepEqual(
    scoreContenders(race, true).map((t) => t.name),
    ["Finished Leader", "Contender"],
  );
  assert.deepEqual(
    scoreContenders(
      {
        ...race,
        forecasts: {
          ...race.forecasts,
          b: {
            projected: 160,
            sd: 4,
            remaining: ["Josh Allen"],
            finished: false,
          },
        },
      },
      true,
    ).map((t) => t.name),
    ["Finished Leader"],
    "a distant challenger should not pad an uncontested leader's block",
  );
  assert.ok(
    scoreContenders(race, true, "c").some(
      (t) => t.selected && t.name === "Distant",
    ),
    "retain the bettor's longshot selection",
  );
  assert.equal(
    scoreContenders(
      {
        ...race,
        forecasts: {
          ...race.forecasts,
          c: {
            projected: null,
            sd: 0,
            remaining: ["Unknown"],
            finished: false,
          },
        },
      },
      true,
    ).find((t) => t.name === "Distant").projected,
    null,
  );
  const lowRace = {
    ...race,
    teams: {
      a: { name: "Current Low", points: 80 },
      b: { name: "Finished Low Contender", points: 100 },
    },
    forecasts: {
      a: { projected: 105, sd: 10, remaining: ["Josh Allen"], finished: false },
      b: { projected: 100, sd: 0, remaining: [], finished: true },
    },
  };
  assert.equal(
    scoreContenders(lowRace, false).length,
    2,
    "a finished team can become lowest after another team scores",
  );
  const tied = {
    ...race,
    teams: {
      a: { name: "Leader A", points: 190 },
      d: { name: "Leader B", points: 190 },
    },
  };
  assert.equal(scoreContenders(tied, true).filter((t) => t.leader).length, 2);
  assert.match(
    teamWatchText(scoreContenders(race, true)[0]),
    /Likely final: 190.0/,
  );
  assert.ok(
    !teamWatchText(scoreContenders(race, true)[0]).includes(
      "Remaining starters",
    ),
  );
  assert.deepEqual(emailTemplateGroups[0].kinds, [
    "opening",
    "reminder",
    "monday_watch",
    "attention",
    "recap",
  ]);
  assert.equal(new Set(emailTemplateGroups.flatMap((g) => g.kinds)).size, 7);
  const leg = (id, kind, player, line, side = "over") => ({
    id,
    ticket_id: ticket.id,
    leg_number: id === "one" ? 1 : 2,
    status: "OPEN",
    selection: `${player} ${side} ${line}`,
    accepted_line: line,
    settlement_context: {
      kind,
      side,
      team_id: "a",
      home_team_id: "a",
      away_team_id: "b",
      metadata: { player_id: player },
    },
  });
  const watch = leg("one", "player_points", "allen", 24);
  const highestUnder = {
    ...leg("one", "weekly_highest_score", null, 180, "under"),
    settlement_context: {
      kind: "weekly_highest_score",
      side: "under",
      team_id: null,
      metadata: { expected_team_count: 4 },
    },
  };
  assert.equal(
    mondayTickets([ticket], [highestUnder], race)[0].tone,
    "lost",
    "a finished team over the under line already defeats the ticket",
  );
  assert.equal(
    mondayTickets(
      [ticket],
      [
        {
          ...highestUnder,
          settlement_context: {
            ...highestUnder.settlement_context,
            side: "over",
          },
        },
      ],
      race,
    )[0].tone,
    "won",
  );
  const lost = leg("two", "player_points", "bijan", 23);
  assert.equal(mondayTickets([ticket], [watch], snapshot)[0].tone, "watch");
  assert.match(
    mondayTickets([ticket], [watch], snapshot)[0].legs[0].detail,
    /Josh Allen/,
  );
  assert.equal(
    mondayTickets([ticket], [watch, lost], snapshot)[0].tone,
    "lost",
    "a completed losing leg defeats an unfinished parlay",
  );
  assert.match(
    mondayTickets([ticket], [lost], snapshot)[0].status,
    /Awaiting Settlement/,
  );
  assert.equal(
    mondayTickets([ticket], [{ ...lost, accepted_line: 14 }], snapshot)[0].tone,
    "won",
  );
  assert.match(
    mondayTickets(
      [ticket],
      [leg("one", "player_points", "inactive", 10)],
      snapshot,
    )[0].status,
    /Pushed/,
  );
  assert.equal(
    mondayTickets(
      [ticket],
      [leg("one", "player_points", "unknown", 10)],
      snapshot,
    )[0].tone,
    "watch",
  );
  assert.equal(
    mondayTickets([{ ...ticket, status: "VOIDED" }], [watch], snapshot)[0]
      .status,
    "↩ Voided · Refunded",
  );
  assert.equal(
    mondayTickets([{ ...ticket, status: "WON" }], [watch], snapshot)[0].status,
    "Official Win",
  );
  assert.match(
    mondayTickets(
      [{ ...ticket, status: "WON", actual_payout: 27 }],
      [{ ...watch, status: "WON" }],
      snapshot,
    )[0].summary,
    /\$27.00 paid/,
  );
  assert.match(
    mondayTickets(
      [{ ...ticket, status: "VOIDED", actual_payout: 10 }],
      [watch],
      snapshot,
    )[0].legs[0].detail,
    /VOIDED/,
  );
  const queried = [];
  const db = {
    from(table) {
      assert.equal(table, "tickets");
      const q = {
        select() {
          return q;
        },
        eq(k, v) {
          queried.push([k, v]);
          return q;
        },
        neq(k, v) {
          queried.push([k, v]);
          return q;
        },
        order() {
          return Promise.resolve({ data: [], error: null });
        },
      };
      return q;
    },
  };
  const noBets = await mondayEmail(
    db,
    { league_id: "l", team_id: "my-team", market_week: 5 },
    { nfl_season: 2026, league_season: 3 },
    [],
    { greeting: "Hi Owner", url: "https://example.com/" },
  );
  assert.match(noBets.heading, /No Bets This Week 😢/);
  assert.deepEqual(queried, [
    ["league_id", "l"],
    ["team_id", "my-team"],
    ["nfl_season", 2026],
    ["market_week", 5],
    ["ticket_type", "future"],
  ]);
  const broken = {
    from() {
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        neq() {
          return q;
        },
        order() {
          return Promise.resolve({
            error: { message: "Database unavailable" },
          });
        },
      };
      return q;
    },
  };
  await assert.rejects(
    mondayEmail(broken, {}, {}, [], {}),
    /Database unavailable/,
    "a query failure must never become a no-bets email",
  );
  const sample = sampleEmail("monday_watch");
  const html = renderEmail({
    ...sample,
    tickets: [
      {
        ...sample.tickets[0],
        legs: [{ selection: "<script>alert(1)</script>", detail: "A&B" }],
      },
    ],
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;") && html.includes("A&amp;B"));
  assert.ok(renderEmail(sample).includes("Monday Watch"));
  assert.ok(renderEmail(sample).includes("Likely final: 190.5 points"));
  assert.ok(renderEmail(sample).includes("Josh Allen, DJ Moore"));
  assert.ok(!renderEmail(sample).includes("undefined"));
  for (const group of emailTemplateGroups)
    for (const kind of group.kinds) {
      const rendered = renderEmail(sampleEmail(kind));
      assert.ok(rendered.includes('lang="en"'));
      assert.ok(
        !rendered.includes("undefined") && !rendered.includes("NaN"),
        `${kind} must not print missing values`,
      );
    }
  const terminalDb = {
    from(table) {
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        neq() {
          return q;
        },
        in() {
          return q;
        },
        order() {
          return Promise.resolve({
            data:
              table === "tickets"
                ? [{ ...ticket, status: "WON", actual_payout: 20 }]
                : [
                    {
                      ...watch,
                      status: "WON",
                      result_evidence: "Official result.",
                    },
                  ],
            error: null,
          });
        },
      };
      return q;
    },
  };
  const terminal = await mondayEmail(
    terminalDb,
    { league_id: "l", team_id: "my-team", market_week: 5 },
    { nfl_season: 2026, league_season: 3 },
    [],
    { greeting: "Hi Owner", url: "https://example.com/" },
  );
  assert.match(terminal.paragraphs[0], /already been settled/);
  assert.equal(terminal.tickets[0].summary, "$10.00 wager · $20.00 paid");
  if (process.env.MONDAY_PREVIEW) {
    const dir = path.resolve("../monday-email-review");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "monday-ticket-watch.html"),
      renderEmail(sample),
    );
    await writeFile(
      path.join(dir, "monday-no-bets.html"),
      renderEmail({ ...noBets, sample: true }),
    );
  }
  console.log(
    "Passed Monday classification, accepted lines, partial parlays, inactive pushes, personal scope, no-bets errors, and HTML escaping. No emails sent.",
  );
} finally {
  if (!root.startsWith(path.resolve("node_modules") + path.sep))
    throw new Error("Unsafe test cleanup");
  await rm(root, { recursive: true, force: true });
}
