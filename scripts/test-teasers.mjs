import assert from "node:assert/strict";
import {
  priceResearch,
  settleResearch,
  contractualPrice,
  wilson,
} from "../api/_lib/teaser-research.ts";
import {
  teaserEligibility,
  adjustedSpread,
} from "../src/lib/teaser-eligibility.ts";

assert.equal(adjustedSpread(-8.5, 9), 0.5);
assert.equal(adjustedSpread(5.5, 9), 14.5);
const board = { id: "b", phase: "pregame", board_type: "weekly" };
const picks = Array.from({ length: 6 }, (_, i) => ({
  id: "leg" + i,
  board_id: "b",
  matchup_key: "m" + i,
  kind: "spread",
  line: -8.5,
  boost_pct: 0,
  team_id: "t" + i,
  home_team_id: "t" + i,
  away_team_id: "o" + i,
  active: true,
  market_state: "open",
  metadata: {},
}));
assert.equal(teaserEligibility(picks.slice(0, 3), board, 6), "");
assert.equal(teaserEligibility(picks, board, 6), "");
for (const [ps, b, n, promo] of [
  [picks.slice(0, 2), board, 6, false],
  [picks, board, 5, false],
  [[...picks.slice(0, 3), picks[0]], board, 6, false],
  [picks, { ...board, phase: "live" }, 6, false],
  [picks, board, 6, true],
  [picks.map((p) => ({ ...p, boost_pct: 10 })), board, 6, false],
  [picks.map((p) => ({ ...p, kind: "moneyline" })), board, 6, false],
  [picks.map((p) => ({ ...p, market_state: "suspended" })), board, 6, false],
  [picks.map((p) => ({ ...p, board_id: "other" })), board, 6, false],
])
  assert(teaserEligibility(ps, b, n, promo));
const legs = picks
  .slice(0, 3)
  .map((p) => ({
    id: p.id,
    team: p.team_id,
    opponent: p.away_team_id,
    line: p.line,
  }));
let seed = 123;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return (seed + 1) / 4294967297;
};
const normal = () =>
  Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
const rows = Array.from({ length: 100000 }, () =>
  Object.fromEntries(
    legs.flatMap((l) => [
      [l.team, 158.5 + normal() * 20],
      [l.opponent, 150 + normal() * 20],
    ]),
  ),
);
const context = {
  hold: 0.05,
  seed: 123,
  model: "synthetic-independent",
  sourceDigest: "fixture-only",
  originalLegDecimals: legs.map(() => 1 + 100 / 110),
};
const contracts = [6, 9, 12].map((a) => priceResearch(legs, rows, a, context));
for (let i = 1; i < contracts.length; i++)
  for (const key of Object.keys(contracts[i].prices)) {
    assert(
      contracts[i].prices[key].probability >=
        contracts[i - 1].prices[key].probability,
    );
    assert(
      contracts[i].prices[key].decimal <= contracts[i - 1].prices[key].decimal,
    );
  }
const c = JSON.parse(JSON.stringify(contracts[1]));
assert.equal(Object.keys(c.prices).length, 7);
const independent = [1, 2, 4].reduce((n, k) => n * c.prices[k].probability, 1);
assert(Math.abs(c.prices[7].probability - independent) < 0.008);
const dependentRows = rows.map((row) =>
  Object.fromEntries(
    legs.flatMap((l) => [
      [l.team, row.t0],
      [l.opponent, 150],
    ]),
  ),
);
const dependent = priceResearch(legs, dependentRows, 9, {
  ...context,
  model: "perfect-shared-factor",
});
assert(
  dependent.prices[7].probability > c.prices[7].probability + 0.2,
  "Joint pricing must respond to dependencies",
);
assert(dependent.prices[7].decimal < c.prices[7].decimal);
assert(c.prices[7].decimal < (1 + 100 / 110) ** 3);
const all = { leg0: "WON", leg1: "WON", leg2: "WON" };
assert.deepEqual(settleResearch(c, all, 1000), {
  status: "WON",
  payoutCents: Math.round(1000 * c.prices[7].decimal),
});
assert.equal(
  settleResearch(c, { ...all, leg2: "PUSH" }, 1000).payoutCents,
  Math.round(1000 * c.prices[3].decimal),
);
assert.equal(
  settleResearch(c, { ...all, leg1: "PUSH", leg2: "VOID" }, 1000).payoutCents,
  Math.round(1000 * c.prices[1].decimal),
);
assert.deepEqual(
  settleResearch(c, { leg0: "PUSH", leg1: "VOID", leg2: "PUSH" }, 1000),
  { status: "PUSH", payoutCents: 1000 },
);
assert.deepEqual(
  settleResearch(c, { leg0: "LOST", leg1: "VOID", leg2: "OPEN" }, 1000),
  { status: "LOST", payoutCents: 0 },
);
assert.deepEqual(settleResearch(c, { ...all, leg2: "OPEN" }, 1000), {
  status: "OPEN",
  payoutCents: 0,
});
assert.deepEqual(settleResearch(c, { ...all, leg2: "LOST" }, 1000, true), {
  status: "VOID",
  payoutCents: 1000,
});
delete c.prices[1];
assert.throws(
  () => settleResearch(c, { ...all, leg1: "PUSH", leg2: "VOID" }, 1000),
  /missing/,
);
assert.throws(() => settleResearch(c, { leg0: "WON" }, 1000), /Missing/);
assert.throws(
  () =>
    priceResearch(
      [...legs.slice(0, 2), { ...legs[2], team: legs[0].opponent }],
      rows,
      9,
      context,
    ),
  /distinct/,
);
assert.throws(
  () => priceResearch(legs, rows.slice(0, 100), 9, context),
  /Insufficient/,
);
assert.throws(
  () =>
    priceResearch(
      legs,
      Array(20000).fill({ t0: 0, o0: 0, t1: 0, o1: 0, t2: 0, o2: 0 }),
      9,
      context,
    ),
  /Rare-event/,
);
assert.throws(
  () =>
    priceResearch(
      legs,
      Array(20000).fill({ t0: 0, o0: 0.5, t1: 0, o1: 0.5, t2: 0, o2: 0.5 }),
      9,
      context,
    ),
  /Push mass/,
);
for (const d of [1.13, 1.91, 1.999, 2, 2.73, 11.07]) {
  const q = contractualPrice(d);
  assert(q.decimal <= d + 1e-10);
  assert(Math.abs(q.odds % 10) === 0);
}
const ci = wilson(50000, 100000);
assert(ci.lower < 0.5 && ci.upper > 0.5);
console.log(
  "Teaser eligibility, joint pricing, uncertainty, monotonicity, one/two-leg saved settlement and loss precedence fixtures passed. Acceptance guards run in test:api against compiled functions.",
);
