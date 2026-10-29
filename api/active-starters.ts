import { createServerClient } from "./_lib/server-client.js";
import { fetchGameStatus } from "./_lib/game-status.js";
import { activeStarters } from "./_lib/active-starters.js";
import {
  cachedStarter,
  starterContext,
  projectStarterPlayers,
} from "./_lib/starter-cache.js";
export const maxDuration = 30;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
async function source(path: string, signal?: AbortSignal): Promise<any> {
  const response = await fetch(`https://api.sleeper.app/v1/${path}`, {
    signal: AbortSignal.any([
      AbortSignal.timeout(10000),
      ...(signal ? [signal] : []),
    ]),
  });
  if (!response.ok) throw new Error("Starter status source is unavailable.");
  const text = await response.text();
  if (Buffer.byteLength(text) > (path === "players/nfl" ? 8388608 : 262144))
    throw new Error("Starter source exceeds its read budget.");
  return JSON.parse(text);
}
// This is a service client only. User clients, auth results and memberships are
// always created/checked per request. Key/target changes discard the old client.
let serviceClient:
  | { url: string; key: string; promise: ReturnType<typeof createServerClient> }
  | undefined;
function sharedServiceClient(url: string, key: string) {
  if (serviceClient?.url === url && serviceClient.key === key)
    return serviceClient.promise;
  const promise = createServerClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).catch((error) => {
    if (serviceClient?.promise === promise) serviceClient = undefined;
    throw error;
  });
  serviceClient = { url, key, promise };
  return promise;
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
  const db = await createServerClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const auth = await db.auth.getUser();
  if (auth.error || !auth.data.user)
    return json({ error: "Sign in to view starter status." }, 401);
  const config = await db
    .rpc("starter_status_access", { p_league: leagueId })
    .abortSignal(AbortSignal.timeout(3000));
  if (config.error)
    return json({ error: "League access is unavailable." }, 503);
  if (!config.data) return json({ error: "League membership required." }, 403);
  try {
    const id = config.data.sleeper_league_id;
    if (!id || !/^\d+$/.test(id))
      throw new Error("League configuration is unavailable.");
    const deadline = Date.now() + 26000,
      signal = AbortSignal.timeout(26000);
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) throw new Error("Starter cache is unavailable.");
    const service = await sharedServiceClient(url, serviceKey);
    const cache = <T>(
      scope: "state" | "games" | "players" | "league",
      key: string,
      context: string,
      load: () => Promise<{ payload: T; checked_at: string }>,
    ) =>
      cachedStarter(
        service,
        url,
        scope,
        key,
        starterContext(context),
        load,
        deadline,
      );
    const result = await cache(
      "league",
      leagueId,
      JSON.stringify([id, config.data.nfl_season]),
      async () => {
        const [stateValue, observationValue] = await Promise.all([
          cache("state", "current", "nfl", async () => ({
            payload: await source("state/nfl", signal),
            checked_at: new Date().toISOString(),
          })),
          cache("games", "current", "nfl", async () => {
            const checked_at = new Date().toISOString(),
              payload = await fetchGameStatus();
            if (payload.reason)
              throw new Error("NFL game status is unavailable.");
            return { payload, checked_at };
          }),
        ]);
        const state = stateValue.payload,
          observation = observationValue.payload;
        if (
          Number(state.season) !== config.data.nfl_season ||
          !Number.isInteger(state.week) ||
          state.week < 1 ||
          state.week > 18 ||
          state.season_type !== "regular"
        )
          throw new Error("Current NFL week is unavailable.");
        const checked = Math.min(
          Date.now(),
          Date.parse(observationValue.checked_at),
        );
        const [matchups, playerValue] = await Promise.all([
          source(`league/${id}/matchups/${state.week}`, signal),
          cache("players", "current", "nfl", async () => ({
            payload: projectStarterPlayers(await source("players/nfl", signal)),
            checked_at: new Date().toISOString(),
          })),
        ]);
        const players = playerValue.payload;
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
        return {
          payload: {
            observed_at: new Date(checked).toISOString(),
            week: state.week,
            rosters: matchups.map((m) => ({
              roster_id: m.roster_id,
              ...activeStarters(m.starters, players, observation.games),
            })),
          },
          checked_at: new Date(checked).toISOString(),
        };
      },
    );
    return json(result.payload);
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
