import { createServerClient } from "./_lib/server-client.js";
import {
  compareProviderContract,
  fetchSleeperIntake,
} from "./_lib/league-intake.js";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
export async function POST(request: Request) {
  const startedAt = new Date().toISOString();
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return json({ error: "Verified platform owner sign-in required." }, 401);
  try {
    const url = process.env.SUPABASE_URL,
      key =
        process.env.SUPABASE_ANON_KEY ??
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key)
      return json({ error: "Provider review is unavailable." }, 503);
    const db = await createServerClient(url, key, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const auth = await db.auth.getUser();
    if (auth.error || !auth.data.user?.email_confirmed_at)
      return json({ error: "Verified sign-in required." }, 401);
    const owner = await db.rpc("league_intake_owner");
    if (owner.error || owner.data !== true)
      return json({ error: "Platform owner access required." }, 403);
    // League ID is a local UUID. The provider destination comes only from that row.
    const leagueId = new URL(request.url).searchParams.get("league_id");
    if (
      !leagueId ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(leagueId)
    )
      return json({ error: "Select a valid league." }, 400);
    if (request.body)
      return json(
        { error: "Provider review accepts no caller-supplied provider data." },
        400,
      );
    const league = await db
      .from("leagues")
      .select("id,sleeper_league_id,nfl_season,provider_contract")
      .eq("id", leagueId)
      .maybeSingle();
    if (league.error || !league.data?.provider_contract)
      return json(
        {
          error:
            "This league has no retained imported provider contract to compare.",
        },
        409,
      );
    const teams = await db
      .from("teams")
      .select("roster_id,sleeper_owner_id,co_owner_ids")
      .eq("league_id", leagueId)
      .limit(33);
    if (teams.error) throw Error("Retained roster identities are unavailable.");
    const before = JSON.stringify({ league: league.data, teams: teams.data });
    const renewalId = new URL(request.url).searchParams.get("renewal_source");
    if (renewalId !== null && !/^[0-9]{1,32}$/.test(renewalId))
      return json(
        { error: "A numeric next-season Sleeper league ID is required." },
        400,
      );
    const observed = await fetchSleeperIntake(
      renewalId ?? league.data.sleeper_league_id,
    );
    const review = compareProviderContract(
      league.data.provider_contract,
      teams.data,
      observed.source,
    );
    // Fence changed baseline/authorization while network reads were in flight.
    const [freshOwner, freshLeague, freshTeams] = await Promise.all([
      db.rpc("league_intake_owner"),
      db
        .from("leagues")
        .select("id,sleeper_league_id,nfl_season,provider_contract")
        .eq("id", leagueId)
        .maybeSingle(),
      db
        .from("teams")
        .select("roster_id,sleeper_owner_id,co_owner_ids")
        .eq("league_id", leagueId)
        .limit(33),
    ]);
    if (freshOwner.error || freshOwner.data !== true)
      return json({ error: "Owner authorization changed during review." }, 403);
    // Sort both reads: row order is not a provider-rule change.
    const stable = (v: any) =>
      JSON.stringify({
        league: v.league,
        teams: [...(v.teams ?? [])].sort(
          (a: any, b: any) => a.roster_id - b.roster_id,
        ),
      });
    if (
      freshLeague.error ||
      freshTeams.error ||
      stable(JSON.parse(before)) !==
        stable({ league: freshLeague.data, teams: freshTeams.data })
    )
      return json(
        { error: "The retained league contract changed; run a fresh review." },
        409,
      );
    let capabilityObservation: unknown = null;
    if (new URL(request.url).searchParams.get("prepare") === "1") {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
        build = process.env.BOFF_BUILD_SHA;
      if (!serviceKey || !build || !/^[a-f0-9]{40}$/.test(build))
        return json(
          { error: "Qualified server capability preparation is unavailable." },
          503,
        );
      const server = await createServerClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const saved = await server.rpc("observe_provider_capability", {
        p_league: leagueId,
        p_source: observed.source,
        p_report: observed.capabilities,
        p_build: build,
        p_started: startedAt,
      });
      if (saved.error)
        throw Error("Capability observation could not be recorded.");
      capabilityObservation = saved.data;
    }
    return json({
      league_id: leagueId,
      checked_at: new Date().toISOString(),
      ...review,
      capability_observation: capabilityObservation,
      note: capabilityObservation
        ? "Current server observation prepared for explicit owner review. No approval, team mappings, funds or activation changed."
        : "Read-only comparison with the imported baseline. No approval, settings, team mappings, funds or activation changed. Projection/result coverage and supported house rules still require review.",
    });
  } catch (e) {
    return json(
      {
        error: e instanceof Error ? e.message : "Provider review unavailable.",
      },
      400,
    );
  }
}
