// Offline research only. No pricing policy in this module enables accepted tickets.
export const TEASER_RESEARCH_VERSION = "teaser-shadow-v1";
export const CANDIDATE_ADJUSTMENTS = [6, 9, 12] as const;
export interface ResearchLeg {
  id: string;
  team: string;
  opponent: string;
  line: number;
}
export interface PriceTerms {
  probability: number;
  upper95: number;
  wins: number;
  trials: number;
  decimal: number;
  odds: number;
  fairDecimal: number;
}
export interface ResearchContract {
  version: string;
  adjustment: number;
  legs: (ResearchLeg & { adjustedLine: number })[];
  prices: Record<string, PriceTerms>;
  fallbackMinimum: 1;
  hold: number;
  seed: number;
  model: string;
  sourceDigest: string;
  originalLegDecimals: number[];
  voidAssumption: string;
  acceptance: "disabled";
}
const decimal = (odds: number) =>
  odds >= 100 ? 1 + odds / 100 : 1 + 100 / -odds;
// Round toward smaller payout in the contractual 10-point American increment.
export function contractualPrice(value: number) {
  if (!Number.isFinite(value) || value <= 1)
    throw new Error("Unpriceable probability.");
  const raw = value >= 2 ? (value - 1) * 100 : -100 / (value - 1);
  const odds = Math.floor(raw / 10) * 10;
  return { odds, decimal: decimal(odds) };
}
export function wilson(wins: number, trials: number) {
  const z = 1.959963984540054,
    p = wins / trials,
    d = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / d;
  const half =
    (z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials))) /
    d;
  return {
    lower: Math.max(0, center - half),
    upper: Math.min(1, center + half),
  };
}
const count = (mask: number) => mask.toString(2).replaceAll("0", "").length;
// Every row is one JOINT score draw, retaining dependencies. Never multiply leg probabilities.
// Save each remaining subset's price; exogenous voids are modeled as independent of scores.
// Push-dependent conditional pricing remains a launch gate (not approximated silently).
export function priceResearch(
  legs: ResearchLeg[],
  scores: Record<string, number>[],
  adjustment: number,
  context: {
    hold: number;
    seed: number;
    model: string;
    sourceDigest: string;
    originalLegDecimals: number[];
  },
): ResearchContract {
  if (
    legs.length < 3 ||
    legs.length > 6 ||
    new Set(legs.map((l) => l.id)).size !== legs.length ||
    new Set(legs.flatMap((l) => [l.team, l.opponent])).size !== legs.length * 2
  )
    throw new Error("Require 3–6 distinct matchups.");
  if (
    !CANDIDATE_ADJUSTMENTS.includes(adjustment as 6 | 9 | 12) ||
    !Number.isFinite(context.hold) ||
    context.hold < 0 ||
    context.hold >= 1 ||
    !Number.isInteger(context.seed) ||
    !context.model ||
    !context.sourceDigest ||
    legs.some((l) => !Number.isFinite(l.line))
  )
    throw new Error("Invalid research pricing context.");
  if (scores.length < 20000) throw new Error("Insufficient simulation trials.");
  if (
    context.originalLegDecimals.length !== legs.length ||
    context.originalLegDecimals.some((d) => !Number.isFinite(d) || d <= 1)
  )
    throw new Error("Original parlay prices required.");
  const wins = Array(1 << legs.length).fill(0) as number[];
  const adjusted = legs.map((l) => ({
    ...l,
    adjustedLine: l.line + adjustment,
  }));
  for (const row of scores) {
    let mask = 0;
    adjusted.forEach((l, i) => {
      if (!Number.isFinite(row[l.team]) || !Number.isFinite(row[l.opponent]))
        throw new Error("Missing joint score.");
      const margin = row[l.team] - row[l.opponent] + l.adjustedLine;
      if (Math.abs(margin) < 1e-9)
        throw new Error(
          "Push mass requires conditional pricing; research price suspended.",
        );
      if (margin > 0) mask |= 1 << i;
    });
    for (let subset = mask; subset; subset = (subset - 1) & mask)
      wins[subset]++;
  }
  const prices: Record<string, PriceTerms> = {};
  for (let mask = 1; mask < wins.length; mask++) {
    if (wins[mask] < 400 || scores.length - wins[mask] < 400)
      throw new Error("Rare-event uncertainty: quote suspended.");
    const probability = wins[mask] / scores.length,
      upper95 = wilson(wins[mask], scores.length).upper;
    const original = context.originalLegDecimals.reduce(
      (p, d, i) => (mask & (1 << i) ? p * d : p),
      1,
    );
    prices[String(mask)] = {
      probability,
      upper95,
      wins: wins[mask],
      trials: scores.length,
      fairDecimal: 1 / probability,
      ...contractualPrice(
        Math.min((1 - context.hold) / upper95, original * 0.999999),
      ),
    };
  }
  return {
    version: TEASER_RESEARCH_VERSION,
    adjustment,
    legs: adjusted,
    prices,
    fallbackMinimum: 1,
    hold: context.hold,
    seed: context.seed,
    model: context.model,
    sourceDigest: context.sourceDigest,
    originalLegDecimals: [...context.originalLegDecimals],
    voidAssumption:
      "Exogenous voids independent of scores; push correlation not validated",
    acceptance: "disabled",
  };
}

export type ResearchResult = "WON" | "LOST" | "PUSH" | "VOID" | "OPEN";
// Pure settlement fixture. Production settlement/refund RPCs are deliberately untouched.
export function settleResearch(
  contract: ResearchContract,
  results: Record<string, ResearchResult>,
  stakeCents: number,
  adminVoid = false,
) {
  if (!Number.isSafeInteger(stakeCents) || stakeCents < 100)
    throw new Error("Invalid stake.");
  if (adminVoid) return { status: "VOID", payoutCents: stakeCents };
  const statuses = contract.legs.map((l) => results[l.id]);
  if (
    statuses.some((s) => !["WON", "LOST", "PUSH", "VOID", "OPEN"].includes(s))
  )
    throw new Error("Missing leg result.");
  if (statuses.includes("LOST")) return { status: "LOST", payoutCents: 0 };
  if (statuses.includes("OPEN")) return { status: "OPEN", payoutCents: 0 };
  const mask = statuses.reduce(
    (m, s, i) => (s === "WON" ? m | (1 << i) : m),
    0,
  );
  if (count(mask) < contract.fallbackMinimum)
    return { status: "PUSH", payoutCents: stakeCents };
  const saved = contract.prices[String(mask)];
  if (!saved || !Number.isFinite(saved.decimal) || saved.decimal <= 1)
    throw new Error("Saved settlement price missing; review required.");
  return { status: "WON", payoutCents: Math.round(stakeCents * saved.decimal) };
}
