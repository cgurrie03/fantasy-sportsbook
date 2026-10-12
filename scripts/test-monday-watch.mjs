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
  const { mondayTickets, mondayEmail } = await import(
    pathToFileURL(path.join(root, "monday-watch.js")).href
  );
  const { sampleEmail, renderEmail } = await import(
    pathToFileURL(path.join(root, "email-templates.js")).href
  );
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
  const ticket = {
    id: "personal-1",
    status: "OPEN",
    stake: 10,
    accepted_potential_payout: 36.4,
  };
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
