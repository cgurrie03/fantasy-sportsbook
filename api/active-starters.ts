import { createClient } from "@supabase/supabase-js";
import { fetchGameStatus } from "./_lib/game-status.js";
import { activeStarters } from "./_lib/active-starters.js";
export const maxDuration = 30;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
// Public player directory only; never cache memberships or league responses here.
let directory: { at: number; players: any } | undefined;
async function source(path: string): Promise<any> {
  const response = await fetch(`https://api.sleeper.app/v1/${path}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Starter status source is unavailable.");
  return response.json();
}
async function playerDirectory() {
  if (directory && Date.now() - directory.at < 86400000)
    return directory.players;
  const players = await source("players/nfl");
  if (!players || Array.isArray(players) || typeof players !== "object")
    throw new Error("Player directory is unavailable.");
  directory = { at: Date.now(), players };
  return players;
}
export async function GET(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer "))
    return json({ error: "Sign in to view starter status." }, 401);
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    return json({ error: "Starter status is unavailable." }, 503);
  const leagueId = new URL(request.url).searchParams.get("league_id");
  if (!leagueId || !/^[\da-f-]{36}$/i.test(leagueId))
    return json({ error: "A league is required." }, 400);
  const db = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const auth = await db.auth.getUser();
  if (auth.error || !auth.data.user)
    return json({ error: "Sign in to view starter status." }, 401);
  const membership = await db
    .from("league_memberships")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", auth.data.user.id)
    .maybeSingle();
  if (membership.error || !membership.data)
    return json({ error: "League membership required." }, 403);
  try {
    const config = await db
      .from("leagues")
      .select("sleeper_league_id,nfl_season")
      .eq("id", leagueId)
      .single();
    const id = config.data?.sleeper_league_id;
    if (config.error || !id || !/^\d+$/.test(id))
      throw new Error("League configuration is unavailable.");
    const [state, observation] = await Promise.all([
      source("state/nfl"),
      fetchGameStatus(),
    ]);
    if (
      Number(state.season) !== config.data.nfl_season ||
      !Number.isInteger(state.week) ||
      state.week < 1 ||
      state.week > 18 ||
      state.season_type !== "regular"
    )
      throw new Error("Current NFL week is unavailable.");
    if (observation.reason) throw new Error(observation.reason);
    const checked = Date.now();
    const [matchups, players] = await Promise.all([
      source(`league/${id}/matchups/${state.week}`),
      playerDirectory(),
    ]);
    if (
      !Array.isArray(matchups) ||
      !matchups.length ||
      matchups.some(
        (m) =>
          !Number.isInteger(m.roster_id) ||
          !Array.isArray(m.starters) ||
          m.starters.some((p: unknown) => typeof p !== "string"),
      )
    )
      throw new Error("Actual starting lineups are unavailable.");
    return json({
      observed_at: new Date(checked).toISOString(),
      week: state.week,
      rosters: matchups.map((m) => ({
        roster_id: m.roster_id,
        ...activeStarters(m.starters, players, observation.games),
      })),
    });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Starter status is unavailable.",
      },
      503,
    );
  }
}
