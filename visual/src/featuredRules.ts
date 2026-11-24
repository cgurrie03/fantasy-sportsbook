import source from "./featured-source.json";
import fixture from "./data.json";
import history from "./season-context.json";
import { featureCatalog, featurePriority } from "./featuredOptions";
import type { FeatureKind } from "./featuredOptions";
import type { Matchup, Team } from "./model";
export type RivalTeam = {
  id: string;
  name: string;
  roster: number;
  division: string | number | null;
  avatar: string | null;
};
export const rivalTeams: RivalTeam[] = fixture.teams.map((t) => ({
  id: t.id,
  name: t.name,
  roster: t.roster_id,
  division:
    source.participants.find((p) => p.roster === t.roster_id)?.division ?? null,
  avatar: t.avatar,
}));
export type RivalPair = [string, string];
export type Cutoffs = {
  tankStart: number;
  tankPct: number;
  playoffWeeks: number;
  playoffGap: number;
  upsetStart: number;
  upsetOutside: number;
  upsetTop: number;
  upsetGap: number;
  revengeMargin: number;
  streakWins: number;
};
export type PlayoffMode = "auto" | "both" | "away-racing" | "home-racing";
export type WeekPlan = {
  overrides: Record<string, FeatureKind | null>;
  playoffModes: Record<string, PlayoffMode>;
};
export type FeatureSettings = {
  plans?: Record<string, WeekPlan>;
  playoffModes?: Record<string, PlayoffMode>;
  schema: 2;
  rivalScope?: "teams";
  cutoffs: Cutoffs;
  enabled: Record<FeatureKind, boolean>;
  rivals: RivalPair[];
  week: number;
  overrides: Record<string, FeatureKind | null>;
};
export type Assignment = {
  kind: FeatureKind;
  label: string;
  boost: number;
  market: "moneyline" | "over";
  targets: string[];
  raceTeams: string[];
  reason: string;
  source: "Automatic" | "Commissioner";
};
function balancedRivalSuggestions(
  people: RivalTeam[],
  eligible: (a: RivalTeam, b: RivalTeam) => boolean,
  score: (a: RivalTeam, b: RivalTeam) => number = () => 0,
): RivalPair[] {
  const pairs: RivalPair[] = [];
  const degree = (id: string) =>
    pairs.filter((pair) => pair.includes(id)).length;
  const alreadyTeam = (id: string, roster: number) =>
    pairs.some(
      (pair) =>
        pair.includes(id) &&
        people.find((p) => p.id === pair.find((other) => other !== id))
          ?.roster === roster,
    );
  const candidates = people.flatMap((p, i) =>
    people
      .slice(i + 1)
      .filter((q) => q.roster !== p.roster && eligible(p, q))
      .map((q) => [p, q] as const),
  );
  while (true) {
    const available = candidates.filter(
      ([a, b]) =>
        degree(a.id) < 3 &&
        degree(b.id) < 3 &&
        !pairs.some((pair) => pair.includes(a.id) && pair.includes(b.id)) &&
        !alreadyTeam(a.id, b.roster) &&
        !alreadyTeam(b.id, a.roster),
    );
    available.sort(
      ([a, b], [c, d]) =>
        Math.max(degree(a.id), degree(b.id)) -
          Math.max(degree(c.id), degree(d.id)) ||
        degree(a.id) + degree(b.id) - (degree(c.id) + degree(d.id)) ||
        score(c, d) - score(a, b) ||
        [a.id, b.id]
          .sort()
          .join(":")
          .localeCompare([c.id, d.id].sort().join(":")),
    );
    if (!available.length) break;
    const [a, b] = available[0];
    pairs.push([a.id, b.id]);
  }
  return pairs;
}
export function divisionRivals(people: RivalTeam[]): RivalPair[] {
  return balancedRivalSuggestions(
    people,
    (a, b) => a.division != null && a.division === b.division,
  );
}
export function historyRivals(
  people: RivalTeam[] = rivalTeams,
  rows: typeof history.rows = history.rows,
): RivalPair[] {
  const scores = new Map<string, number>();
  const key = (a: RivalTeam, b: RivalTeam) =>
    [a.roster, b.roster].sort((x, y) => x - y).join(":");
  for (const a of people)
    for (const b of people) {
      const k = key(a, b);
      if (scores.has(k) || a.roster === b.roster) continue;
      const games = rows.filter(
        (r) =>
          r.roster === a.roster &&
          r.opponent === b.roster &&
          r.week <= fixture.week,
      );
      if (!games.length) continue;
      const margin =
        games.reduce((n, r) => n + Math.abs(r.points - r.against), 0) /
        games.length;
      const wins = games.reduce(
        (n, r) =>
          n + (r.points > r.against ? 1 : r.points === r.against ? 0.5 : 0),
        0,
      );
      const balance = 1 - Math.abs(wins / games.length - 0.5) * 2;
      scores.set(
        k,
        0.6 / (1 + margin / 10) +
          0.25 * balance +
          0.15 * Math.min(1, games.length / 3),
      );
    }
  return balancedRivalSuggestions(
    people,
    (a, b) => scores.has(key(a, b)),
    (a, b) => scores.get(key(a, b)) || 0,
  );
}
export function standingsRivals(
  people: RivalTeam[] = rivalTeams,
  standings: Team[] = fixture.teams,
): RivalPair[] {
  const row = (p: RivalTeam) => standings.find((t) => t.roster_id === p.roster);
  const score = (a: RivalTeam, b: RivalTeam) => {
    const x = row(a)!,
      y = row(b)!;
    const xp = x.pointsFor / x.games,
      yp = y.pointsFor / y.games;
    return (
      0.7 *
        (1 -
          Math.abs(
            (x.wins + 0.5 * x.ties) / x.games -
              (y.wins + 0.5 * y.ties) / y.games,
          )) +
      0.3 * (1 - Math.abs(xp - yp) / Math.max(1, xp, yp))
    );
  };
  return balancedRivalSuggestions(
    people,
    (a, b) => !!row(a)?.games && !!row(b)?.games,
    score,
  );
}
export function validRivals(pairs: RivalPair[], people = rivalTeams) {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  return pairs.every((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) return false;
    const [a, b] = pair;
    const pa = people.find((p) => p.id === a),
      pb = people.find((p) => p.id === b);
    const key = [a, b].sort().join(":");
    if (!pa || !pb || a === b || pa.roster === pb.roster || seen.has(key))
      return false;
    seen.add(key);
    counts.set(a, (counts.get(a) || 0) + 1);
    counts.set(b, (counts.get(b) || 0) + 1);
    return counts.get(a)! <= 3 && counts.get(b)! <= 3;
  });
}
export function migrateTeamRivals(value: unknown): RivalPair[] {
  if (!Array.isArray(value)) return [];
  const resolve = (id: string) =>
    rivalTeams.find((t) => t.id === id)?.id ||
    rivalTeams.find(
      (t) => t.roster === source.participants.find((p) => p.id === id)?.roster,
    )?.id;
  const result: RivalPair[] = [];
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const a = resolve(pair[0]),
      b = resolve(pair[1]);
    if (!a || !b) continue;
    const next: RivalPair[] = [...result, [a, b]];
    if (validRivals(next)) result.push([a, b]);
  }
  return result;
}
export function defaultFeatureSettings(): FeatureSettings {
  return {
    schema: 2,
    rivalScope: "teams",
    plans: {},
    cutoffs: {
      tankStart: Math.floor(fixture.regularSeasonWeeks / 2) + 1,
      tankPct: 33.3,
      playoffWeeks: 4,
      playoffGap: 1,
      upsetStart: 4,
      upsetOutside: 50,
      upsetTop: 25,
      upsetGap: 10,
      revengeMargin: 10,
      streakWins: 5,
    },
    enabled: Object.fromEntries(
      featurePriority.map((k) => [k, true]),
    ) as Record<FeatureKind, boolean>,
    rivals: [],
    week: fixture.week,
    overrides: {},
    playoffModes: {},
  };
}
const settingsKey = "boff-features-v2:" + fixture.leagueId;
export function cleanWeekPlans(
  value: Record<string, WeekPlan> = {},
): Record<string, WeekPlan> {
  const out: Record<string, WeekPlan> = {};
  for (const [key, p] of Object.entries(value)) {
    const week = Number(key);
    if (
      !Number.isInteger(week) ||
      week < 1 ||
      week > fixture.regularSeasonWeeks ||
      !p ||
      typeof p !== "object"
    )
      continue;
    const overrides = Object.fromEntries(
      Object.entries(p.overrides || {})
        .filter(([, kind]) => kind === null || kind in featureCatalog)
        .slice(0, fixture.teams.length),
    ) as Record<string, FeatureKind | null>;
    const playoffModes = Object.fromEntries(
      Object.entries(p.playoffModes || {}).filter(
        ([id, mode]) =>
          overrides[id] === "playoff" &&
          ["auto", "both", "away-racing", "home-racing"].includes(mode),
      ),
    ) as Record<string, PlayoffMode>;
    if (Object.keys(overrides).length) out[key] = { overrides, playoffModes };
  }
  return out;
}
export function featureSettingsForWeek(
  s: FeatureSettings,
  week: number,
): FeatureSettings {
  const plan =
    s.plans?.[String(week)] ||
    (s.week === week
      ? { overrides: s.overrides, playoffModes: s.playoffModes || {} }
      : { overrides: {}, playoffModes: {} });
  return {
    ...s,
    week,
    overrides: { ...plan.overrides },
    playoffModes: { ...plan.playoffModes },
  };
}
export function putWeekPlan(
  s: FeatureSettings,
  week: number,
  plan: WeekPlan,
): FeatureSettings {
  const next = {
    ...s,
    plans: cleanWeekPlans({ ...s.plans, [String(week)]: plan }),
  };
  return week === s.week
    ? {
        ...next,
        overrides: { ...plan.overrides },
        playoffModes: { ...plan.playoffModes },
      }
    : next;
}
export function effectiveRivals(
  s: FeatureSettings,
  _people: RivalTeam[] = rivalTeams,
): RivalPair[] {
  return s.rivals;
}
export function getFeatureSettings(): FeatureSettings {
  const fallback = defaultFeatureSettings();
  try {
    const stored = JSON.parse(localStorage.getItem(settingsKey) || "null");
    if (!stored || stored.schema !== 2) return fallback;
    const plans = cleanWeekPlans(stored.plans || {});
    if (!plans[String(stored.week)])
      Object.assign(
        plans,
        cleanWeekPlans({
          [String(stored.week)]: {
            overrides: stored.overrides || {},
            playoffModes: stored.playoffModes || {},
          },
        }),
      );
    const active = plans[String(fixture.week)] || {
      overrides: {},
      playoffModes: {},
    };
    return {
      ...fallback,
      plans,
      cutoffs: validCutoffs({ ...fallback.cutoffs, ...stored.cutoffs })
        ? { ...fallback.cutoffs, ...stored.cutoffs }
        : fallback.cutoffs,
      enabled: { ...fallback.enabled, ...stored.enabled },
      rivals:
        stored.rivalScope === "teams"
          ? validRivals(stored.rivals || [])
            ? stored.rivals || []
            : fallback.rivals
          : migrateTeamRivals(stored.rivals),
      overrides: active.overrides,
      playoffModes: active.playoffModes,
    };
  } catch {
    return fallback;
  }
}
export function validCutoffs(c: Cutoffs) {
  const ranges: Record<keyof Cutoffs, [number, number]> = {
    tankStart: [1, fixture.regularSeasonWeeks],
    tankPct: [0, 100],
    playoffWeeks: [1, fixture.regularSeasonWeeks],
    playoffGap: [0, fixture.regularSeasonWeeks],
    upsetStart: [1, fixture.regularSeasonWeeks],
    upsetOutside: [1, 99],
    upsetTop: [1, 99],
    upsetGap: [0, 100],
    revengeMargin: [0, 200],
    streakWins: [1, fixture.regularSeasonWeeks],
  };
  if (
    !(
      [
        "tankStart",
        "playoffWeeks",
        "upsetStart",
        "streakWins",
      ] as (keyof Cutoffs)[]
    ).every((key) => Number.isInteger(c[key]))
  )
    return false;
  return Object.entries(ranges).every(
    ([key, [min, max]]) =>
      Number.isFinite(c[key as keyof Cutoffs]) &&
      c[key as keyof Cutoffs] >= min &&
      c[key as keyof Cutoffs] <= max,
  );
}
export function saveFeatureSettings(s: FeatureSettings) {
  if (!validCutoffs(s.cutoffs))
    throw Error("Enter valid numeric eligibility cutoffs before saving.");
  if (!validRivals(s.rivals))
    throw Error("Each team can have up to three rival teams.");
  const plans = cleanWeekPlans({
    ...s.plans,
    [String(s.week)]: {
      overrides: s.overrides,
      playoffModes: s.playoffModes || {},
    },
  });
  const active = plans[String(fixture.week)] || {
    overrides: {},
    playoffModes: {},
  };
  localStorage.setItem(
    settingsKey,
    JSON.stringify({
      ...s,
      schema: 2,
      rivalScope: "teams",
      week: fixture.week,
      plans,
      overrides: active.overrides,
      playoffModes: active.playoffModes,
    }),
  );
  window.dispatchEvent(new Event("boff-settings-changed"));
}
export type FeatureEvidence = {
  week: number;
  regularWeeks: number;
  playoffTeams: number;
  finalists: number[];
  people: RivalTeam[];
  history: {
    week: number;
    roster: number;
    opponent: number;
    points: number;
    against: number;
  }[];
  playoffStatus?: Record<number, "racing" | "clinched" | "eliminated">;
};
export const featureEvidence: FeatureEvidence = {
  week: fixture.week,
  regularWeeks: fixture.regularSeasonWeeks,
  playoffTeams: source.playoffTeams,
  finalists: source.previousFinalists,
  people: rivalTeams,
  history: history.rows,
};
const streak = (t: Team) =>
  /^W(\d+)$/.exec(t.streak)?.[1] ? Number(t.streak.slice(1)) : 0;
export function selectFeatureAssignments(
  matches: Matchup[],
  allTeams: Team[],
  settings: FeatureSettings,
  evidence: FeatureEvidence = featureEvidence,
): Map<string, Assignment> {
  const out = new Map<string, Assignment>();
  const used = new Set<FeatureKind>();
  const rankedMatches=matches.slice().sort((a,b)=>b.rankScore-a.rankScore||a.id.localeCompare(b.id));
  const gameOfTheWeek=rankedMatches[0]?.id;
  const sorted = allTeams
    .slice()
    .sort(
      (a, b) =>
        (b.wins + 0.5 * b.ties) / Math.max(1, b.games) -
          (a.wins + 0.5 * a.ties) / Math.max(1, a.games) ||
        b.pointsFor - a.pointsFor,
    );
  const seed = (t: Team) => sorted.findIndex((x) => x.id === t.id) + 1;
  const race = (t: Team) => evidence.playoffStatus?.[t.roster_id] === "racing";
  const assignment = (
    kind: FeatureKind,
    m: Matchup,
    manual = false,
  ): Assignment | null => {
    const a = m.away,
      b = m.home,
      c = settings.cutoffs,
      both = [a.id, b.id];
    let targets = both,
      reason = "",
      raceTeams: string[] = [];
    let market: "moneyline" | "over" = "moneyline";
    switch (kind) {
      case "championship":
        if (
          !manual &&
          !(
            evidence.finalists.length === 2 &&
            [a.roster_id, b.roster_id].every((r) =>
              evidence.finalists.includes(r),
            )
          )
        )
          return null;
        reason = "Previous championship finalists";
        break;
      case "rivalry": {
        const eligible = effectiveRivals(settings, evidence.people).some(
          (pair) => {
            const p = evidence.people.find((x) => x.id === pair[0]),
              q = evidence.people.find((x) => x.id === pair[1]);
            return (
              p &&
              q &&
              ((p.roster === a.roster_id && q.roster === b.roster_id) ||
                (q.roster === a.roster_id && p.roster === b.roster_id))
            );
          },
        );
        if (!manual && !eligible) return null;
        reason = eligible
          ? "Saved Team Rivalry"
          : "Commissioner Assigned Rivalry";
        break;
      }
      case "tank": {
        const pct =
          Math.round(
            ((a.wins + b.wins + 0.5 * (a.ties + b.ties)) /
              Math.max(1, a.games + b.games)) *
              1000,
          ) / 10;
        if (!manual && (evidence.week < c.tankStart || pct > c.tankPct))
          return null;
        market = "over";
        targets = [];
        reason = `Combined Win % ${pct.toFixed(1)} · Over Only`;
        break;
      }
      case "streak": {
        const qualifying = [a, b].filter((t) => streak(t) >= c.streakWins);
        if (!manual && !qualifying.length) return null;
        const strong = qualifying.length
          ? qualifying
          : [streak(a) >= streak(b) ? a : b];
        targets = strong.map((t) => (t.id === a.id ? b.id : a.id));
        reason = strong
          .map((t) => `${t.name}: ${streak(t)} Straight Wins`)
          .join(" · ");
        break;
      }
      case "revenge": {
        const prior = evidence.history
          .filter(
            (r) =>
              r.roster === a.roster_id &&
              r.opponent === b.roster_id &&
              r.week < evidence.week,
          )
          .sort((x, y) => y.week - x.week)[0];
        if (!prior || prior.points === prior.against) return null;
        if (!manual && Math.abs(prior.points - prior.against) > c.revengeMargin)
          return null;
        targets = [prior.points < prior.against ? a.id : b.id];
        reason = `Revenge For Week ${prior.week}`;
        break;
      }
      case "upset": {
        const under = [a, b].find((t) =>
          m.markets.some(
            (row) =>
              row.kind === "moneyline" && row.team_id === t.id && row.odds > 0,
          ),
        );
        if (!under) return null;
        const favorite = under.id === a.id ? b : a;
        const up = under.id === a.id ? m.awayProjection : m.homeProjection,
          fp = favorite.id === a.id ? m.awayProjection : m.homeProjection;
        if (
          !manual &&
          (!Number.isFinite(up) || !Number.isFinite(fp) || fp <= 0 || up < 0)
        )
          return null;
        const gap = (Math.abs(fp - up) / Math.max(0.1, fp)) * 100;
        if (
          !manual &&
          (evidence.week < c.upsetStart ||
            seed(under) <=
              Math.floor((allTeams.length * c.upsetOutside) / 100) ||
            seed(favorite) > Math.ceil((allTeams.length * c.upsetTop) / 100) ||
            seed(under) <= seed(favorite) ||
            gap > c.upsetGap)
        )
          return null;
        targets = [under.id];
        reason = `${under.name} · Pre-Scoring Projection Gap ${gap.toFixed(1)}%`;
        break;
      }
      case "playoff": {
        if (
          !manual &&
          (!Number.isInteger(evidence.playoffTeams) ||
            evidence.playoffTeams < 1 ||
            evidence.playoffTeams >= allTeams.length)
        )
          return null;
        if (
          !manual &&
          (evidence.week < evidence.regularWeeks - c.playoffWeeks + 1 ||
            evidence.week > evidence.regularWeeks)
        )
          return null;
        const cutoff =
          sorted[
            Math.max(0, Math.min(sorted.length - 1, evidence.playoffTeams - 1))
          ];
        const contenders = [a, b].filter(
          (t) =>
            race(t) &&
            Math.abs(
              t.wins + 0.5 * t.ties - (cutoff.wins + 0.5 * cutoff.ties),
            ) <= c.playoffGap,
        );
        if (!manual && !contenders.length) return null;
        if (manual) {
          const mode = settings.playoffModes?.[m.id] || "both";
          if (mode === "auto") {
            if (!contenders.length) return null;
          } else
            contenders.splice(
              0,
              contenders.length,
              ...(mode === "both" ? [a, b] : [mode === "away-racing" ? a : b]),
            );
        }
        raceTeams = contenders.map((t) => t.id);
        if (contenders.length === 1) {
          targets = [contenders[0].id];
          reason = `${contenders[0].name} Is Fighting For Qualification · Contender Boosted`;
        } else if (contenders.length === 2) {
          reason = "Both Teams Fighting For Qualification";
        } else {
          reason = "Commissioner Assignment · Qualification Evidence Pending";
        }
        break;
      }
      case "game":
        reason = "Highest Matchup Rating";
        break;
    }
    return {
      kind,
      label: featureCatalog[kind].label,
      boost: featureCatalog[kind].boost,
      market,
      targets,
      raceTeams,
      reason,
      source: manual ? "Commissioner" : "Automatic",
    };
  };
  for (const kind of featurePriority) {
    if (!settings.enabled[kind]) continue;
    for (const m of rankedMatches) {
      if (
        out.has(m.id) ||
        (kind === "game" && (m.id !== gameOfTheWeek || used.has(kind)))
      )
        continue;
      const a = assignment(kind, m);
      if (!a) continue;
      out.set(m.id, a);
      if (kind !== "rivalry") {
        used.add(kind);
      }
    }
  }
  for (const [id, kind] of Object.entries(settings.overrides)) {
    const m = matches.find((m) => m.id === id);
    if (!m) continue;
    if (kind === null) {
      out.delete(id);
      continue;
    }
    if (!(kind in featureCatalog)) continue;
    const a = assignment(kind, m, true);
    if (a) out.set(id, a);
    else out.delete(id);
  }
  return out;
}
