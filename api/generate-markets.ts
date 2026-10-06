import { createClient } from "@supabase/supabase-js";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const roundHalf = (value: number) => Math.round(value * 2) / 2;
const american = (probability: number) => Math.round(probability >= 0.5 ? -100 * probability / (1 - probability) : 100 * (1 - probability) / probability);
const SLEEPER_LEAGUE_ID = "1312126153980391424";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
  const url = process.env.SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!url || !serviceKey || !token) return json({ error: "Market generation is not configured." }, 401);
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const userClient = createClient(url, process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "", { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) return json({ error: "Sign in again before generating markets." }, 401);
  // Keep the membership mapping in sync with the verified email before checking admin access.
  await userClient.rpc("claim_memberships");
  let input: { league_id?: string; week?: number; nfl_season?: number; category?: string };
  try { input = await request.json(); } catch { return json({ error: "Invalid generation request." }, 400); }
  if (!input.league_id || !Number.isInteger(input.week) || !Number.isInteger(input.nfl_season)) return json({ error: "League, week, and season are required." }, 400);
  const { data: memberById } = await client.from("league_memberships").select("role,invited_email").eq("league_id", input.league_id).eq("user_id", auth.user.id).maybeSingle();
  const { data: memberByEmail } = auth.user.email && !memberById
    ? await client.from("league_memberships").select("role,invited_email").eq("league_id", input.league_id).ilike("invited_email", auth.user.email).maybeSingle()
    : { data: null };
  const member = memberById ?? memberByEmail;
  const primaryAdmin = auth.user.email?.toLowerCase() === "cooper.gurrie@gmail.com";
  if (!primaryAdmin && member?.role !== "admin") return json({ error: "Only the league admin can generate markets." }, 403);
  const { data: teams, error: teamError } = await userClient.from("teams").select("id,roster_id,team_name,wins,losses,ties").eq("league_id", input.league_id).order("roster_id");
  if (teamError) return json({ error: `League teams could not be loaded: ${teamError.message}` }, 400);
  if (!teams?.length) return json({ error: "League teams could not be loaded for this league." }, 400);
  const sleeper = async (path: string) => { const response = await fetch(`https://api.sleeper.app/v1/${path}`); if (!response.ok) throw new Error(`Sleeper returned ${response.status}.`); return response.json(); };
  try {
    const matchups = await sleeper(`league/${SLEEPER_LEAGUE_ID}/matchups/${input.week}`) as Array<{ matchup_id?: number; roster_id: number; points?: number; starters?: string[]; starters_points?: number[] }>;
    const previous = input.week > 1 ? await sleeper(`league/${SLEEPER_LEAGUE_ID}/matchups/${input.week - 1}`) as Array<{ roster_id: number; points?: number; starters?: string[]; starters_points?: number[] }> : [];
    const previousByRoster = new Map(previous.map(row => [row.roster_id, Number(row.points ?? 0)]));
    const rosterMap = new Map(teams.map(t => [t.roster_id, t]));
    const groups = new Map<number, typeof matchups>();
    matchups.forEach(row => { if (row.matchup_id != null) groups.set(row.matchup_id, [...(groups.get(row.matchup_id) ?? []), row]); });
    const pairings = [...groups.values()].filter(group => group.length >= 2);
    if (!pairings.length) return json({ error: "Sleeper has not published matchups for this week yet." }, 409);
    const quotes: unknown[] = [];
    for (const pairing of pairings) {
      const home = rosterMap.get(pairing[0].roster_id), away = rosterMap.get(pairing[1].roster_id); if (!home || !away) continue;
      if (input.category === "Player Points") continue;
      const homeProjection = roundHalf(Number(previousByRoster.get(home.roster_id) ?? pairing[0].points ?? 100) * 0.65 + 100 * 0.35);
      const awayProjection = roundHalf(Number(previousByRoster.get(away.roster_id) ?? pairing[1].points ?? 100) * 0.65 + 100 * 0.35);
      const matchupKey = `sleeper-${input.week}-${Math.min(home.roster_id, away.roster_id)}-${Math.max(home.roster_id, away.roster_id)}`, spread = roundHalf((awayProjection - homeProjection) / 2), total = roundHalf(homeProjection + awayProjection);
      const rationale = `${home.team_name} projects to ${homeProjection} and ${away.team_name} to ${awayProjection}. The generator blends the most recent Sleeper matchup score at 65% with a neutral 100-point baseline at 35%, then derives the spread from the projection gap and the total from both projections.`;
      const probability = Math.min(0.82, Math.max(0.18, 0.5 + (homeProjection - awayProjection) / 180));
      const add = (kind: string, side: string, label: string, odds: number, line: number | null, teamId: string | null, featured = "") => quotes.push({ id: crypto.randomUUID(), board_id: "generated", market_key: `${matchupKey}:${kind}:${side}${kind === "team_total" ? `:${teamId ?? ""}` : ""}`, matchup_key: matchupKey, kind, label, subject: label, side, line, odds, boost_pct: 0, team_id: teamId, home_team_id: home.id, away_team_id: away.id, home_projection: homeProjection, away_projection: awayProjection, featured, metadata: { generated: true, generated_at: new Date().toISOString(), projection_method: "Sleeper recent matchup blend", rationale }, active: true });
      add("spread", "home", `${home.team_name} ${spread >= 0 ? "+" : ""}${spread}`, -110, spread, home.id); add("spread", "away", `${away.team_name} ${-spread >= 0 ? "+" : ""}${-spread}`, -110, -spread, away.id);
      add("match_total", "over", `Over ${total}`, -110, total, null); add("match_total", "under", `Under ${total}`, -110, total, null);
      add("moneyline", "home", `Win · ${home.team_name}`, american(probability), null, home.id); add("moneyline", "away", `Win · ${away.team_name}`, american(1 - probability), null, away.id);
      add("team_total", "over", `${home.team_name} Over ${roundHalf(homeProjection / 2)}`, -110, roundHalf(homeProjection / 2), home.id); add("team_total", "under", `${home.team_name} Under ${roundHalf(homeProjection / 2)}`, -110, roundHalf(homeProjection / 2), home.id);
      add("team_total", "over", `${away.team_name} Over ${roundHalf(awayProjection / 2)}`, -110, roundHalf(awayProjection / 2), away.id); add("team_total", "under", `${away.team_name} Under ${roundHalf(awayProjection / 2)}`, -110, roundHalf(awayProjection / 2), away.id);
    }
    if (input.category === "Player Points") {
      const players = (await sleeper("players/nfl") ?? {}) as Record<string, { full_name?: string; first_name?: string; last_name?: string; position?: string; team?: string }>;
      const excluded = new Set(["K", "DEF", "DST"]);
      for (const pairing of pairings) {
        const home = rosterMap.get(pairing[0].roster_id), away = rosterMap.get(pairing[1].roster_id); if (!home || !away) continue;
        const matchupKey = `sleeper-${input.week}-${Math.min(home.roster_id, away.roster_id)}-${Math.max(home.roster_id, away.roster_id)}`;
        for (const row of pairing) {
          const roster = rosterMap.get(row.roster_id), prior = previous.find(item => item.roster_id === row.roster_id);
          if (!roster) continue;
          const starters = row.starters?.length ? row.starters : prior?.starters ?? [];
          starters.forEach((playerId, index) => {
            const info = players[playerId]; if (!info || !info.position || excluded.has(info.position)) return;
            const name = info.full_name ?? ([info.first_name, info.last_name].filter(Boolean).join(" ") || `Player ${playerId}`);
            const priorPoints = Number(prior?.starters_points?.[index] ?? row.starters_points?.[index] ?? 10);
            const projection = roundHalf(Math.max(0.5, priorPoints || 10));
            const marketKey = `${matchupKey}:player_points:${playerId}`;
            const metadata = { generated: true, generated_at: new Date().toISOString(), projection_method: "Sleeper projected best lineup", player_id: playerId, position: info.position, nfl_team: info.team ?? "", season_average: projection, projection, game_info: `Week ${input.week} Sleeper projection` };
            quotes.push({ id: crypto.randomUUID(), board_id: "generated", market_key: marketKey, matchup_key: matchupKey, kind: "player_points", label: `${name} Over ${projection}`, subject: name, side: "over", line: projection, odds: -110, boost_pct: 0, team_id: roster.id, home_team_id: home.id, away_team_id: away.id, home_projection: null, away_projection: null, featured: "", metadata, active: true });
            quotes.push({ id: crypto.randomUUID(), board_id: "generated", market_key: marketKey, matchup_key: matchupKey, kind: "player_points", label: `${name} Under ${projection}`, subject: name, side: "under", line: projection, odds: -110, boost_pct: 0, team_id: roster.id, home_team_id: home.id, away_team_id: away.id, home_projection: null, away_projection: null, featured: "", metadata, active: true });
          });
        }
      }
      return json({ week: input.week, quotes, generated_at: new Date().toISOString(), projection_method: "Sleeper projected best lineup" });
    }
    return json({ week: input.week, quotes, generated_at: new Date().toISOString(), projection_method: "Sleeper recent matchup blend" });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Sleeper market generation failed." }, 502); }
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Market generation failed before the request could be completed." }, 500); }
}
