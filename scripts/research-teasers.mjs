import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  priceResearch,
  CANDIDATE_ADJUSTMENTS,
} from "../api/_lib/teaser-research.ts";

const input =
  process.argv[2] || "docs/research/teaser-completed-scores-2026-w1-w4.json";
const output = process.argv[3] || "work/teasers/research.json";
const snapshot = JSON.parse(fs.readFileSync(input, "utf8"));
const digest = createHash("sha256")
  .update(fs.readFileSync(input))
  .digest("hex");
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) =>
  Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1));
const quantile = (xs, p) => {
  const a = [...xs].sort((a, b) => a - b),
    k = (a.length - 1) * p,
    i = Math.floor(k);
  return a[i] + (a[Math.ceil(k)] - a[i]) * (k - i);
};
const describe = (xs) => ({
  n: xs.length,
  mean: mean(xs),
  median: quantile(xs, 0.5),
  sd: sd(xs),
  p25: quantile(xs, 0.25),
  p75: quantile(xs, 0.75),
  p95: quantile(xs, 0.95),
  min: Math.min(...xs),
  max: Math.max(...xs),
});
const margins = [],
  scores = [],
  seen = new Set();
for (const w of snapshot.weeks) {
  if (seen.has(w.week)) throw Error("Duplicate week.");
  seen.add(w.week);
  if (w.teams.length !== 12 || new Set(w.teams.map((t) => t.id)).size !== 12)
    throw Error("Incomplete/duplicated team week.");
  const groups = Map.groupBy(w.teams, (t) => t.matchup);
  if (groups.size !== 6) throw Error("Expected six matchups.");
  for (const rows of groups.values()) {
    if (rows.length !== 2 || rows.some((t) => !Number.isFinite(t.points)))
      throw Error("Invalid matchup.");
    rows.sort((a, b) => Number(a.id) - Number(b.id));
    margins.push(rows[0].points - rows[1].points);
    scores.push(...rows.map((t) => t.points));
  }
}
// Scale diagnostic only: actual margins are not pregame forecast residuals.
const marginSd = sd(margins),
  teamSd = marginSd / Math.sqrt(2),
  seed = 19092026,
  trials = 100000;
export function draws(rho = 0, scale = 1, negative = false) {
  let state = seed;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 1) / 4294967297;
  };
  const normal = () =>
    Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
  return Array.from({ length: trials }, () => {
    const common = normal(),
      row = {};
    for (let i = 0; i < 6; i++) {
      const sign = negative && i % 2 ? -1 : 1;
      // Explicit artificial common game/player exposure stress, not calibrated league covariance.
      row["t" + i] =
        150 +
        (sign * Math.sqrt(rho) * common + Math.sqrt(1 - rho) * normal()) *
          teamSd *
          scale;
      row["o" + i] = 150 + normal() * teamSd * scale;
    }
    return row;
  });
}
const cases = [];
for (const [name, rho, scale, negative] of [
  ["independent", 0, 1, false],
  ["positive-dependence", 0.4, 1, false],
  ["mixed-dependence", 0.4, 1, true],
  ["wider-residuals", 0, 1.25, false],
  ["narrower-residuals", 0, 0.75, false],
]) {
  const joint = draws(rho, scale, negative);
  for (const legCount of [3, 6]) {
    const legs = Array.from({ length: legCount }, (_, i) => ({
      id: "leg" + i,
      team: "t" + i,
      opponent: "o" + i,
      line: 0,
    }));
    for (const adjustment of CANDIDATE_ADJUSTMENTS) {
      const contract = priceResearch(legs, joint, adjustment, {
        hold: 0.05,
        seed,
        model: name,
        sourceDigest: digest,
        originalLegDecimals: legs.map(() => 1 + 100 / 110),
      });
      const full = contract.prices[String((1 << legCount) - 1)];
      const independent = legs.reduce(
        (p, _, i) => p * contract.prices[String(1 << i)].probability,
        1,
      );
      cases.push({
        name,
        rho,
        scale,
        negative,
        legCount,
        adjustment,
        ...full,
        independenceProbability: independent,
        jointMinusIndependent: full.probability - independent,
      });
    }
  }
}
const report = {
  asOf: snapshot.captured_at,
  source: snapshot.source,
  sourceDigest: digest,
  weeks: snapshot.weeks.map((w) => w.week),
  matchups: margins.length,
  scores: describe(scores),
  signedMargins: describe(margins),
  absoluteMargins: describe(margins.map(Math.abs)),
  withinActualMargin: CANDIDATE_ADJUSTMENTS.map((adjustment) => ({
    adjustment,
    count: margins.filter((m) => Math.abs(m) <= adjustment).length,
    total: margins.length,
  })),
  simulation: {
    trials,
    seed,
    teamSd,
    marginSd,
    hold: 0.05,
    confidence: "Wilson 95% Monte Carlo only, not model uncertainty",
    cases,
  },
  recommendation:
    "Retain 6/9/12 centered on 9 for research only; no final range selected.",
  limitations: [
    "Four completed weeks; cluster by week, not 24 independent observations.",
    "Actual margins are not as-of forecast errors; no backtest or calibrated cover probability.",
    "Dependence factors are artificial stresses, not estimated shared-player/game correlations.",
    "Continuous Gaussian research draws omit discrete push mass. Conditional push pricing and expected-return validation are required before acceptance.",
    "Single and pair fallback prices are saved, but exogenous void independence is unvalidated.",
    "5% hold is an illustration, not an approved pricing margin.",
  ],
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      output,
      matchups: report.matchups,
      signedMargins: report.signedMargins,
      absoluteMargins: report.absoluteMargins,
      withinActualMargin: report.withinActualMargin,
      threeLegCases: cases.filter((c) => c.legCount === 3),
    },
    null,
    2,
  ),
);
