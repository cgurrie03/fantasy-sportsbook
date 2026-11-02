import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationWindow } from "./notification-window.js";
import { editorialLabel, selectEditorialStories } from "./editorial-stories.js";
import type { EditorialEdition, EditorialFacts } from "./editorial-stories.js";

const positive = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1000;
export function openingEditorialFacts(
  league: any,
  board: any,
  window: NotificationWindow,
  teams: any[],
  groups: any[][],
  championship: any[],
): EditorialFacts {
  if (
    teams.length > 128 ||
    new Set(teams.map((t) => t.id)).size !== teams.length
  )
    throw Error("Editorial team field exceeds its supported budget.");
  const known = new Map(teams.map((t) => [t.id, t])),
    projections = new Map<string, number | null>();
  const matchups: EditorialFacts["matchups"] = [];
  const record = (id: string, v: number) => {
    if (!projections.has(id)) projections.set(id, v);
    else if (projections.get(id) !== v) projections.set(id, null);
  };
  for (const group of groups) {
    const q = group.find(
      (m) =>
        m.kind === "spread" &&
        positive(Number(m.home_projection)) &&
        positive(Number(m.away_projection)),
    );
    if (
      !q ||
      !known.has(q.home_team_id) ||
      !known.has(q.away_team_id) ||
      q.home_team_id === q.away_team_id ||
      typeof q.matchup_key !== "string" ||
      new TextEncoder().encode(q.matchup_key).length > 160
    )
      continue;
    const home = Number(q.home_projection),
      away = Number(q.away_projection);
    record(q.home_team_id, home);
    record(q.away_team_id, away);
    matchups.push({
      id: q.matchup_key,
      home: q.home_team_id,
      away: q.away_team_id,
      home_projected: home,
      away_projected: away,
      featured: ["Game of the Week", "Tank Bowl"].includes(q.featured)
        ? q.featured
        : null,
    });
  }
  const prices = championship
    .filter(
      (m) =>
        known.has(m.id) &&
        Number.isInteger(m.odds) &&
        m.odds !== 0 &&
        Math.abs(m.odds) <= 1000000,
    )
    .slice(0, 16)
    .map((m) => ({
      id: m.id,
      team: editorialLabel(known.get(m.id).team_name),
      owner: editorialLabel(known.get(m.id).sportsbook_owner_name, 80),
      odds: m.odds,
    }));
  return {
    contract: "opening-editorial-facts-v1",
    league_id: window.league_id,
    nfl_season: league.nfl_season,
    league_season: league.league_season,
    market_week: window.market_week,
    board_id: board.id,
    board_revision: board.revision ?? 0,
    window_key: window.window_key!,
    prepared_at: new Date().toISOString(),
    team_ids: [...known.keys()].sort(),
    teams: [...known]
      .filter(([id]) => positive(projections.get(id)))
      .map(([id, t]) => ({
        id,
        name: editorialLabel(t.team_name),
        projected: projections.get(id)! as number,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    matchups: matchups.sort((a, b) => a.id.localeCompare(b.id)),
    championship: prices.sort((a, b) => a.id.localeCompare(b.id)),
  };
}
function validEdition(
  value: unknown,
  scope: EditorialFacts,
  exact: boolean,
): value is EditorialEdition {
  const d = value as EditorialEdition;
  return (
    !!d &&
    d.contract === "opening-editorial-edition-v1" &&
    !!d.facts &&
    d.facts.contract === scope.contract &&
    d.facts.league_id === scope.league_id &&
    d.facts.nfl_season === scope.nfl_season &&
    d.facts.league_season === scope.league_season &&
    Array.isArray(d.facts.team_ids) &&
    d.facts.team_ids.length <= 128 &&
    Array.isArray(d.facts.teams) &&
    d.facts.teams.length <= 128 &&
    Array.isArray(d.facts.matchups) &&
    d.facts.matchups.length <= 64 &&
    Array.isArray(d.facts.championship) &&
    d.facts.championship.length <= 16 &&
    JSON.stringify([...d.facts.team_ids].sort()) ===
      JSON.stringify([...scope.team_ids].sort()) &&
    (!exact ||
      (d.facts.market_week === scope.market_week &&
        d.facts.window_key === scope.window_key &&
        d.facts.board_id === scope.board_id &&
        d.facts.board_revision === scope.board_revision)) &&
    Array.isArray(d.stories) &&
    d.stories.length <= 3 &&
    new Set(d.stories.map((s) => s.group)).size === d.stories.length &&
    d.stories.every(
      (s) =>
        typeof s.key === "string" &&
        typeof s.group === "string" &&
        typeof s.title === "string" &&
        typeof s.text === "string" &&
        new TextEncoder().encode(s.text).length <= 4096 &&
        Array.isArray(s.evidence) &&
        s.evidence.length <= 8 &&
        s.evidence.every((id) => scope.team_ids.includes(id)),
    ) &&
    Number.isFinite(Date.parse(d.facts.prepared_at)) &&
    new TextEncoder().encode(JSON.stringify(d)).length <= 65536
  );
}
export async function sharedOpeningEdition(
  db: SupabaseClient,
  facts: EditorialFacts,
): Promise<EditorialEdition> {
  const r = await db
    .rpc("opening_editorial_context", {
      p_league: facts.league_id,
      p_season: facts.nfl_season,
      p_week: facts.market_week,
      p_window_key: facts.window_key,
    })
    .abortSignal(AbortSignal.timeout(15000));
  if (r.error) throw Error("Opening editorial evidence could not be verified.");
  if (r.data?.current) {
    if (!validEdition(r.data.current, facts, true))
      throw Error("Opening editorial snapshot scope changed.");
    return r.data.current;
  }
  const previous = validEdition(r.data?.previous, facts, false)
    ? r.data.previous
    : null;
  const edition = selectEditorialStories(facts, previous);
  const saved = await db
    .rpc("publish_opening_editorial", {
      p_league: facts.league_id,
      p_document: edition,
    })
    .abortSignal(AbortSignal.timeout(15000));
  if (saved.error || !validEdition(saved.data, facts, true))
    throw Error("Opening edition changed before its evidence was saved.");
  return saved.data;
}
