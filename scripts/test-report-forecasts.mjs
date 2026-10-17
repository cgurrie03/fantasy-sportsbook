import assert from "node:assert/strict";
import { loadReportForecasts } from "../src/lib/report-forecasts.ts";
import { deduplicateForecasts } from "../src/lib/reporting.ts";
const base = {
  nfl_season: 2026,
  market_week: 5,
  board_type: "weekly",
  opens_at: "2026-10-14T12:00:00Z",
  closes_at: "2026-10-15T00:00:00Z",
  provenance: "published_snapshot",
};
const versions = [
  {
    ...base,
    id: "a1",
    board_id: "a",
    revision: 1,
    captured_at: "2026-10-14T10:00:00Z",
  },
  {
    ...base,
    id: "a2",
    board_id: "a",
    revision: 2,
    captured_at: "2026-10-14T11:00:00Z",
  },
  {
    ...base,
    id: "a3",
    board_id: "a",
    revision: 3,
    captured_at: "2026-10-14T13:00:00Z",
  },
  {
    ...base,
    id: "old",
    board_id: "old",
    revision: 1,
    captured_at: "2026-10-14T14:00:00Z",
    provenance: "existing_board_at_install",
  },
  ...["f1", "f2"].map((id, i) => ({
    ...base,
    id,
    board_id: "future",
    board_type: "future",
    revision: i + 1,
    captured_at: `2026-10-14T1${i}:00:00Z`,
  })),
];
let requested = [];
const load = (ids) => {
  requested.push(...ids);
  return Promise.resolve({
    data: ids.map((id) => ({
      id,
      quotes: [{ kind: "moneyline", home_projection: id === "a2" ? 123 : 999 }],
    })),
    error: null,
  });
};
const result = await loadReportForecasts(
  () => Promise.resolve({ data: versions, error: null }),
  load,
);
assert.deepEqual(requested.sort(), ["a2", "f1", "f2"]);
assert.equal(result.data.length, 6, "keep the real archived-version count");
assert.equal(
  deduplicateForecasts(result.data).find((f) => f.board_id === "a").quotes[0]
    .home_projection,
  123,
  "grade the same immutable opening baseline",
);
assert(
  result.data
    .filter((f) => f.board_type === "future")
    .every((f) => f.quotes.length === 1),
  "keep every futures trend snapshot",
);
assert.equal(
  result.data.find((f) => f.id === "a3").quotes.length,
  0,
  "do not download unused recalculated weekly slates",
);
await assert.rejects(
  () =>
    loadReportForecasts(
      () => Promise.resolve({ data: versions, error: null }),
      () => Promise.resolve({ data: [], error: null }),
    ),
  /Archived forecast details/,
);
console.log(
  "Passed metadata-first report hydration, exact opening baseline, complete futures trends, real archive counts and missing-detail failure.",
);
