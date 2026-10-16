import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const load = async (filename) =>
  import(
    "data:text/javascript;base64," +
      Buffer.from(
        ts.transpileModule(fs.readFileSync(filename, "utf8"), {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2023,
          },
        }).outputText,
      ).toString("base64")
  );
const t = await load("api/_lib/event-time.ts");
assert.equal(t.exactEventTime("2026-10-15"), null);
assert.match(t.formatEventTime("2026-10-15"), /Thu.*Oct.*15.*Time TBD/);
assert.match(
  t.formatGameInfo("2026-10-19 vs. ATL"),
  /ATL.*Mon.*Oct.*19.*Time TBD/,
);
assert.equal(
  t.easternInstant("2026-10-18", "12:00:00"),
  "2026-10-18T16:00:00.000Z",
);
assert.equal(
  t.easternInstant("2026-11-08", "12:00:00"),
  "2026-11-08T17:00:00.000Z",
);
assert.match(t.formatEventTime("2026-10-16T00:00:00Z"), /Thu.*Oct.*15.*8:00/);
assert.equal(t.displayProjection(null), "Unavailable");
assert.equal(t.displayProjection(undefined), "Unavailable");
assert.equal(t.displayProjection(0), "0.0");
assert.equal(t.displayProjection(12.345), "12.3");
const labels = await load("src/lib/ticket-labels.ts");
const future = {
  ticket_type: "future",
  market_week: 1,
  status: "OPEN",
  stake: 25,
  accepted_potential_payout: 91,
  actual_payout: 0,
};
assert.equal(labels.ticketCategory(future), "Season futures");
assert.equal(labels.ticketTypeLabel(future, 3), "3-pick futures parlay");
assert.deepEqual(labels.ticketReturns(future), { total: 91, profit: 66 });
assert.deepEqual(labels.ticketReturns({ ...future, status: "VOIDED" }), {
  total: 25,
  profit: 0,
});
const luminance = (hex) => {
  const c = hex
    .match(/\w\w/g)
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
assert((luminance("ffffff") + 0.05) / (luminance("896000") + 0.05) >= 4.5);
console.log(
  "Passed date-only calendar preservation, exact and near-midnight events, DST/noon conversion, missing versus real-zero projections, shared futures/parlay labels, return/refund/profit math and corrected selected-filter contrast.",
);
