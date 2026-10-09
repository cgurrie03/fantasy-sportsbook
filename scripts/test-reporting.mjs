import { csvCell } from "../src/lib/csv.ts";
assert(csvCell('=HYPERLINK("https://bad.test")').startsWith(`"'=`));
assert.equal(csvCell(-12.5), '"-12.5"');
assert.equal(csvCell('Team, "Long"'), '"Team, ""Long"""');
import assert from "node:assert/strict";
import { readAllRows } from "../src/lib/pagination.ts";
const pages = [];
const fullHistory = await readAllRows(async (from, to) => {
  pages.push([from, to]);
  return {
    data: Array.from({ length: from === 0 ? 1000 : 7 }, (_, i) => ({
      id: from + i,
    })),
    error: null,
  };
});
assert.equal(
  fullHistory.data.length,
  1007,
  "Season history must continue beyond the provider's default row limit",
);
assert.deepEqual(pages, [
  [0, 999],
  [1000, 1999],
]);
await assert.rejects(
  readAllRows(async () => ({ data: null, error: new Error("Read failed") })),
  /Read failed/,
);
import {
  deduplicateForecasts,
  scoreRows,
  optimalActualLineup,
  bettingStats,
  winQuantile,
  performanceVsExpectations,
} from "../src/lib/reporting.ts";
assert.deepEqual(
  performanceVsExpectations(
    [
      { team: "a", final: true, error: 20 },
      { team: "a", final: true, error: -10 },
      { team: "a", final: false, error: -150 },
      { team: "a", final: true, error: null },
      { team: "b", final: true, error: 80 },
    ],
    "a",
  ),
  { total: 10, average: 5 },
  "Live scores and missing projections must not distort team performance",
);
assert.deepEqual(performanceVsExpectations([], "a"), {
  total: null,
  average: null,
});
assert.equal(winQuantile({ 3: 0.15, 8: 0.5, 12: 0.35 }, 0.1), 3);
assert.equal(winQuantile({ 3: 0.15, 8: 0.5, 12: 0.35 }, 0.9), 12);
assert.equal(winQuantile({ 3: 0.15, 8: 0.5, 12: 0.35 }, 0.5), 8);
assert.equal(
  winQuantile({ 3: 0.15, 8: 0.5 }, 0.9),
  undefined,
  "Incomplete win histogram must not claim an uncertainty interval",
);
assert.equal(winQuantile({ 3: -0.5, 8: 1.5 }, 0.5), undefined);
const opening = "2026-10-14T12:00:00Z";
const quote = {
  kind: "moneyline",
  home_team_id: "a",
  away_team_id: "b",
  home_projection: 120,
  away_projection: 110,
};
const snapshot = {
  id: "one",
  board_id: "board",
  revision: 1,
  nfl_season: 2026,
  market_week: 6,
  board_type: "weekly",
  captured_at: "2026-10-14T12:00:03Z",
  opens_at: opening,
  provenance: "published_snapshot",
  quotes: [quote],
};
const later = {
  ...snapshot,
  id: "two",
  revision: 2,
  captured_at: "2026-10-15T12:00:00Z",
  quotes: [{ ...quote, home_projection: 200 }],
};
assert.equal(deduplicateForecasts([later, snapshot])[0].id, "one");
assert.equal(
  deduplicateForecasts([
    { ...snapshot, provenance: "existing_board_at_install" },
    later,
  ]).length,
  0,
);
const early = { ...snapshot, captured_at: "2026-10-14T11:30:00Z" };
assert.equal(deduplicateForecasts([early, later])[0].id, "one");
const week = {
  nfl_season: 2026,
  market_week: 6,
  final: true,
  results: {
    a: { points: 135, projection: 100, matchup_id: 1 },
    b: { points: 105, projection: 100, matchup_id: 1 },
  },
};
const rows = scoreRows([week], [snapshot, later]);
assert.equal(rows[0].error, 15);
assert.equal(rows[1].error, -5);
assert.equal(rows[0].allPlay, 1);
assert.equal(rows[1].allPlay, 0);
assert.match(rows[0].basis, /Archived/);
assert.equal(scoreRows([week], [])[0].error, 35);
assert.match(scoreRows([week], [])[0].basis, /Reconstructed/);
assert.equal(
  scoreRows(
    [
      {
        ...week,
        results: {
          ...week.results,
          a: { ...week.results.a, projection: null },
        },
      },
    ],
    [],
  )[0].error,
  null,
);
assert.equal(
  optimalActualLineup(
    [
      { id: "q", positions: ["QB"] },
      { id: "r", positions: ["RB"] },
    ],
    ["QB", "RB"],
    { q: 4, r: -3 },
  ),
  1,
);
assert.equal(
  optimalActualLineup(
    [
      { id: "r", positions: ["RB"] },
      { id: "w", positions: ["WR"] },
    ],
    ["RB", "FLEX"],
    { r: 10, w: 20 },
  ),
  30,
);
assert.equal(
  optimalActualLineup([{ id: "r", positions: ["RB"] }], ["RB", "FLEX"], {
    r: 30,
  }),
  null,
);
assert.equal(
  optimalActualLineup([{ id: "r", positions: ["RB"] }], ["RB"], {}),
  null,
);
const data = {
  tickets: [
    {
      team_id: "a",
      nfl_season: 2026,
      market_week: 6,
      status: "WON",
      stake: 10,
      actual_payout: 30,
    },
    {
      team_id: "a",
      nfl_season: 2026,
      market_week: 6,
      status: "LOST",
      stake: 10,
      actual_payout: 0,
    },
    {
      team_id: "a",
      nfl_season: 2026,
      market_week: 6,
      status: "VOIDED",
      stake: 100,
      actual_payout: 100,
    },
    {
      team_id: "a",
      nfl_season: 2025,
      market_week: 6,
      status: "WON",
      stake: 1000,
      actual_payout: 2000,
    },
  ],
};
assert.equal(bettingStats(data, "a", 6, 2026).profit, 10);
assert.equal(bettingStats(data, "a", 6, 2026).roi, 0.5);
console.log(
  "Opening snapshot selection, revision deduplication, provenance, missing predictions, all-play, exact lineup assignment, and season/void-safe ROI passed.",
);
