import { createClient } from "@supabase/supabase-js";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const roundHalf = (value: number) => Math.round(value * 2) / 2;
const american = (probability: number) => Math.round(probability >= 0.5 ? -100 * probability / (1 - probability) : 100 * (1 - probability) / probability);

export async function POST(request: Request) {
  const url = process.env.SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!url || !serviceKey || !token) return json({ error: "Market generation is not configured." }, 401);
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const userClient = createClient(url, process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "", { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) return json({ error: "Sign in again before generating markets." }, 401);
  let input: { league_id?: string; week?: number; nfl_season?: number };
  try { input = await request.json(); } catch { return json({ error: "Invalid generation request." }, 400); }
  if (!input.league_id || !Number.isInteger(input.week) || !Number.isInteger(input.nfl_season)) return json({ error: "League, week, and season are required." }, 400);
  const { data: member } = await client.from("league_memberships").select("role").eq("league_id", input.league_id).eq("user_id", auth.user.id).maybeSingle();
  if (member?.role !== "admin") return json({ error: "Only the league admin can generate markets." }, 403);
  const { data: teams, error: teamError } = await client.from("teams").select("id,roster_id,team_name,wins,losses,ties").eq("league_id", input.league_id).order("roster_id");
  if (teamError || !teams?.length) return json({ error: "League teams are unavailable." }, 400);
  const sleeper = async (path: string) => { const response = await fetch(`https://api.sleeper.app/v1/${path}`); if (!response.ok) throw new Error(`Sleeper returned ${response.status}.`); return response.json(); };
  try {
    const matchups = await sleeper(`league/${input.league_id}/matchups/${input.week}`) as Array<{ matchup_id?: number; roster_id: number; points?: number; starters_points?: number[] }>;
    const previous = input.week > 1 ? await sleeper(`league/${input.league_id}/matchups/${input.week - 1}`) as Array<{ roster_id: number; points?: number }> : [];
    const previousByRoster = new Map(previous.map(row => [row.roster_id, Number(row.points ?? 0)]));
    const rosterMap = new Map(teams.map(t => [t.roster_id, t]));
    const groups = new Map<number, typeof matchups>();
    matchups.forEach(row => { if (row.matchup_id != null) groups.set(row.matchup_id, [...(groups.get(row.matchup_id) ?? []), row]); });
    const pairings = [...groups.values()].filter(group => group.length >= 2);
    if (!pairings.length) return json({ error: "Sleeper has not published matchups for this week yet." }, 409);
    const quotes: unknown[] = [];
    for (const pairing of pairings) {
      const home = rosterMap.get(pairing[0].roster_id), away = rosterMap.get(pairing[1].roster_id); if (!home || !away) continue;
      const homeProjection = roundHalf(Number(previousByRoster.get(home.roster_id) ?? pairing[0].points ?? 100) * 0.65 + 100 * 0.35);
      const awayProjection = roundHalf(Number(previousByRoster.get(away.roster_id) ?? pairing[1].points ?? 100) * 0.65 + 100 * 0.35);
      const matchupKey = crypto.randomUUID(), spread = roundHalf((awayProjection - homeProjection) / 2), total = roundHalf(homeProjection + awayProjection);
      const probability = Math.min(0.82, Math.max(0.18, 0.5 + (homeProjection - awayProjection) / 180));
      const add = (kind: string, side: string, label: string, odds: number, line: number | null, teamId: string | null, featured = "") => quotes.push({ id: crypto.randomUUID(), board_id: "generated", market_key: `${matchupKey}:${kind}:${side}`, matchup_key: matchupKey, kind, label, subject: label, side, line, odds, boost_pct: 0, team_id: teamId, home_team_id: home.id, away_team_id: away.id, home_projection: homeProjection, away_projection: awayProjection, featured, metadata: { generated: true, generated_at: new Date().toISOString(), projection_method: "Sleeper recent matchup blend" }, active: true });
      add("spread", "home", `${home.team_name} ${spread >= 0 ? "+" : ""}${spread}`, -110, spread, home.id); add("spread", "away", `${away.team_name} ${-spread >= 0 ? "+" : ""}${-spread}`, -110, -spread, away.id);
      add("match_total", "over", `Over ${total}`, -110, total, null); add("match_total", "under", `Under ${total}`, -110, total, null);
      add("moneyline", "home", `Win · ${home.team_name}`, american(probability), null, home.id); add("moneyline", "away", `Win · ${away.team_name}`, american(1 - probability), null, away.id);
      add("team_total", "over", `${home.team_name} Over ${roundHalf(homeProjection / 2)}`, -110, roundHalf(homeProjection / 2), home.id); add("team_total", "under", `${home.team_name} Under ${roundHalf(homeProjection / 2)}`, -110, roundHalf(homeProjection / 2), home.id);
      add("team_total", "over", `${away.team_name} Over ${roundHalf(awayProjection / 2)}`, -110, roundHalf(awayProjection / 2), away.id); add("team_total", "under", `${away.team_name} Under ${roundHalf(awayProjection / 2)}`, -110, roundHalf(awayProjection / 2), away.id);
    }
    return json({ week: input.week, quotes, generated_at: new Date().toISOString(), projection_method: "Sleeper recent matchup blend" });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Sleeper market generation failed." }, 502); }
}
