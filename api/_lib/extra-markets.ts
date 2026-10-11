import { cdf } from "./model-assessment.js";
import type { Candidate, History, Projection } from "./line-model.ts";
import type { Market } from "../../src/lib/markets.ts";

export const extraKinds = [
  "player_h2h",
  "player_milestone",
  "team_milestone",
  "winning_margin",
];
export function oddsFor(p: number) {
  p = Math.max(0.01, Math.min(0.99, p));
  const odds = p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p;
  return Math.sign(odds) * Math.max(100, Math.round(Math.abs(odds) / 10) * 10);
}
export function milestones(mean: number, step: number) {
  const center = Math.max(step, Math.round(mean / step) * step);
  return [
    ...new Set([-1, 0, 1, 2].map((i) => Math.max(step, center + i * step))),
  ];
}
// Gaussian joint-difference approximation, with empirical covariance shrunk toward zero.
// Eight prior independent observations prevent a small sample dominating prices.
export function differenceSd(a: number[], b: number[], sa: number, sb: number) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return Math.hypot(sa, sb);
  const ma = a.reduce((s, x) => s + x, 0) / n,
    mb = b.reduce((s, x) => s + x, 0) / n;
  const covariance =
    ((a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / (n - 1)) * n) /
    (n + 8);
  const bounded = Math.max(-0.6 * sa * sb, Math.min(0.6 * sa * sb, covariance));
  return Math.sqrt(Math.max(4, sa * sa + sb * sb - 2 * bounded));
}
export function extraMatchups(
  context: Partial<Market>,
  home: any,
  away: any,
  history: History[][],
): Market[] {
  const out: Market[] = [];
  const push = (
    kind: Market["kind"],
    team: any,
    side: string,
    line: number | null,
    p: number,
    meta: Record<string, unknown>,
    label: string,
    key: string,
  ) =>
    out.push({
      ...context,
      id: crypto.randomUUID(),
      kind,
      team_id: team.id,
      side,
      line,
      label,
      subject: team.team_name,
      market_key: `${context.matchup_key}:${key}`,
      odds: oddsFor(p),
      boost_pct: 0,
      featured: "",
      metadata: {
        ...context.metadata,
        ...meta,
        simulated_probability: p,
        fair_probability: p,
        pricing_method: "joint-normal-shrinkage-v1",
        lineup_locked: home.unfilled_slots > 0 || away.unfilled_slots > 0,
      },
    } as Market);
  const paired = history
    .map((week) => [
      week.find((t) => t.roster_id === home.roster_id)?.points,
      week.find((t) => t.roster_id === away.roster_id)?.points,
    ])
    .filter((pair) => pair.every(Number.isFinite));
  const sd = differenceSd(
    paired.map((p) => Number(p[0])),
    paired.map((p) => Number(p[1])),
    home.sd,
    away.sd,
  );
  for (const team of [home, away]) {
    for (const target of milestones(team.mean, 25)) {
      const p = 1 - cdf((target - team.mean) / team.sd);
      push(
        "team_milestone",
        team,
        "at_least",
        target,
        p,
        { threshold: target, lineup_locked: team.unfilled_slots > 0 },
        `${team.team_name} ${target}+ points`,
        `team_milestone:${team.id}:${target}`,
      );
      out.at(-1)!.metadata.lineup_locked = team.unfilled_slots > 0;
    }
    const opponent = team === home ? away : home,
      mean = team.mean - opponent.mean;
    for (const [lower, upper] of [
      [0, 10],
      [10, 20],
      [20, 30],
      [30, null],
    ] as const) {
      const p =
        (upper == null ? 1 : cdf((upper - mean) / sd)) -
        cdf((lower - mean) / sd);
      push(
        "winning_margin",
        team,
        `${team.id}:${lower}`,
        null,
        p,
        { margin_lower: lower, margin_upper: upper, tie_policy: "push" },
        `${team.team_name} by ${upper == null ? "30+" : lower === 0 ? "under 10" : `${lower} to under ${upper}`} points`,
        `winning_margin`,
      );
    }
  }
  return out;
}
export function playerExtras(
  context: Partial<Market>,
  home: any,
  away: any,
  rosterHome: string[],
  rosterAway: string[],
  slots: string[],
  pool: (Candidate & { assessment_sd: number })[],
  projections: Projection[],
  history: History[][],
): Market[] {
  const out: Market[] = [];
  const identity = (id: string | undefined) => {
    const candidate = pool.find((p) => p.id === id),
      row = projections.find((p) => p.player_id === id);
    return {
      id: id ?? "0",
      name:
        candidate?.name ||
        [row?.player?.first_name, row?.player?.last_name]
          .filter(Boolean)
          .join(" ") ||
        "Empty / unavailable",
      projection: candidate?.projection ?? 0,
      expected: candidate?.expected ?? 0,
      average: candidate?.average ?? null,
      team: candidate?.team ?? row?.team ?? "",
      position: candidate?.positions[0] ?? row?.player?.position ?? "",
      game: candidate?.game ?? "Unavailable",
      kickoff: row?.date ?? null,
      sd: candidate?.assessment_sd ?? 2,
    };
  };
  slots
    .filter((s) => !["BN", "IR", "TAXI"].includes(s))
    .forEach((slot, index, all) => {
      const left = identity(rosterHome[index]),
        right = identity(rosterAway[index]);
      const label =
        all.filter((s) => s === slot).length > 1
          ? `${slot}${all.slice(0, index + 1).filter((s) => s === slot).length}`
          : slot;
      const past = history.flatMap((week) => {
        const points = Object.assign(
          {},
          ...week.map((t) => t.players_points ?? {}),
        );
        return Number.isFinite(points[left.id]) &&
          Number.isFinite(points[right.id])
          ? [[points[left.id], points[right.id]]]
          : [];
      });
      const sd = differenceSd(
        past.map((p) => p[0]),
        past.map((p) => p[1]),
        left.sd,
        right.sd,
      );
      const p = cdf((left.expected - right.expected) / sd);
      const times = [left.kickoff, right.kickoff].map((t) =>
        t ? Date.parse(t) : NaN,
      );
      const locked =
        left.expected <= 0 ||
        right.expected <= 0 ||
        left.id === right.id ||
        times.some((t) => !Number.isFinite(t));
      for (const [team, player, side, probability] of [
        [home, left, "home", p],
        [away, right, "away", 1 - p],
      ] as const)
        out.push({
          ...context,
          id: crypto.randomUUID(),
          market_key: `${context.matchup_key}:player_h2h:${index}:${left.id}:${right.id}`,
          kind: "player_h2h",
          team_id: team.id,
          side,
          line: null,
          subject: player.name,
          label: `${player.name} to outscore ${side === "home" ? right.name : left.name} · ${label}`,
          odds: oddsFor(probability),
          boost_pct: 0,
          featured: "",
          metadata: {
            ...context.metadata,
            slot: label,
            slot_index: index,
            left_player: left,
            right_player: right,
            player_id: left.id,
            opponent_player_id: right.id,
            cutoff_at: locked
              ? null
              : new Date(Math.min(...times)).toISOString(),
            lineup_locked: locked,
            lock_reason: locked
              ? "Both actual starters need an eligible projection and confirmed kickoff."
              : "",
            simulated_probability: probability,
            fair_probability: probability,
            pricing_method: "joint-normal-shrinkage-v1",
            tie_policy: "push",
            no_play_policy: "push",
          },
        } as Market);
    });
  return out;
}
