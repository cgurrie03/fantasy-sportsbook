import schedule from "./featured-schedule.json";
import { teams, matchups, league } from "./model";
import { featureCatalog } from "./featuredOptions";
import {
  effectiveRivals,
  featureEvidence,
  featureSettingsForWeek,
} from "./featuredRules";
import type { FeatureSettings, Assignment } from "./featuredRules";
import type { Matchup } from "./model";
export type PlannedMatch = Pick<Matchup, "id" | "away" | "home">;
export function scheduledMatches(week: number): PlannedMatch[] {
  if (week === league.week) return matchups;
  return (schedule.weeks.find((w) => w.week === week)?.pairs || []).flatMap(
    ([a, b]) => {
      const away = teams.find((t) => t.roster_id === a),
        home = teams.find((t) => t.roster_id === b);
      return away && home
        ? [
            {
              id: `sleeper-${week}-${Math.min(a, b)}-${Math.max(a, b)}`,
              away,
              home,
            },
          ]
        : [];
    },
  );
}
export function plannedFeature(
  m: PlannedMatch,
  week: number,
  s: FeatureSettings,
): Assignment | null {
  const local = featureSettingsForWeek(s, week);
  const explicit = Object.prototype.hasOwnProperty.call(local.overrides, m.id);
  const chosen = local.overrides[m.id];
  if (explicit && chosen === null) return null;
  let kind = chosen,
    origin: "Automatic" | "Commissioner" = "Commissioner";
  if (!explicit && week > league.week) {
    origin = "Automatic";
    if (
      s.enabled.championship &&
      scheduledMatches(week).length >= 2 &&
      featureEvidence.finalists.length === 2 &&
      [m.away.roster_id, m.home.roster_id].every((r) =>
        featureEvidence.finalists.includes(r),
      )
    )
      kind = "championship";
    else if (
      s.enabled.rivalry &&
      effectiveRivals(s).some((pair) => {
        const p = featureEvidence.people.find((p) => p.id === pair[0]),
          q = featureEvidence.people.find((p) => p.id === pair[1]);
        return (
          p &&
          q &&
          [p.roster, q.roster].includes(m.away.roster_id) &&
          [p.roster, q.roster].includes(m.home.roster_id)
        );
      })
    )
      kind = "rivalry";
  }
  if (!kind) return null;
  const c = featureCatalog[kind];
  let label: string = c.label,
    targets: string[] = [],
    raceTeams: string[] = [];
  if (["game", "rivalry", "championship"].includes(kind))
    targets = [m.away.id, m.home.id];
  if (kind === "playoff") {
    const mode = local.playoffModes?.[m.id] || "auto";
    if (mode === "both") {
      targets = [m.away.id, m.home.id];
      raceTeams = [...targets];
    } else if (mode !== "auto") {
      const racing = mode === "away-racing" ? m.away : m.home;
      raceTeams = [racing.id];
      targets = [racing.id === m.away.id ? m.home.id : m.away.id];
      label = "Playoff Spoiler";
    }
  }
  return {
    kind,
    label,
    boost: c.boost,
    market: kind === "tank" ? "over" : "moneyline",
    targets,
    raceTeams,
    source: origin,
    reason:
      week < league.week
        ? "Saved Preset Only"
        : "Scheduled · Rechecked At Week Opening",
  };
}
