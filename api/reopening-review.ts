import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { generateMarkets } from "./generate-markets.js";
import {
  REOPENING_MODEL,
  validateReopeningDeadline,
} from "./_lib/reopening.js";
export const config = { maxDuration: 120 };
const json = (data: unknown, status = 200) => Response.json(data, { status });
export async function POST(request: Request) {
  try {
    const url = process.env.SUPABASE_URL,
      key =
        process.env.SUPABASE_ANON_KEY ??
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const authorization = request.headers.get("authorization") ?? "";
    if (!url || !key || !secret || !authorization.startsWith("Bearer "))
      return json(
        { error: "Sign in as the league admin to review reopening." },
        401,
      );
    const client = createClient(url, key, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const auth = await client.auth.getUser();
    if (!auth.data.user) return json({ error: "Sign in again." }, 401);
    const input = (await request.json()) as {
      league_id?: string;
      action?: string;
      review_id?: string;
      snapshot_hash?: string;
      closes_at?: string;
    };
    if (
      !input.league_id ||
      !["preview", "publish", "announce"].includes(input.action ?? "")
    )
      return json({ error: "Choose a reopening review action." }, 400);
    const member = await client
      .from("league_memberships")
      .select("role")
      .eq("league_id", input.league_id)
      .eq("user_id", auth.data.user.id)
      .maybeSingle();
    if (member.error || member.data?.role !== "admin")
      return json(
        { error: "Only this league admin can review or reopen the book." },
        403,
      );
    if (input.action !== "preview") {
      const proposal = await client
        .from("sportsbook_reopening_reviews")
        .select("id,league_id")
        .eq("id", input.review_id)
        .eq("league_id", input.league_id)
        .single();
      if (proposal.error)
        return json(
          { error: "Reopening review not found for this league." },
          404,
        );
      const result =
        input.action === "publish"
          ? await client.rpc("activate_reopening_review", {
              p_review: input.review_id,
              p_hash: input.snapshot_hash,
            })
          : await client.rpc("queue_reopening_announcement", {
              p_review: input.review_id,
            });
      if (result.error) return json({ error: result.error.message }, 409);
      return json({
        result: result.data,
        email_queued: input.action === "announce",
      });
    }
    const closes = validateReopeningDeadline(input.closes_at ?? "");
    const [league, period] = await Promise.all([
      client
        .from("leagues")
        .select("nfl_season")
        .eq("id", input.league_id)
        .single(),
      client.rpc("sportsbook_period", { p_league: input.league_id }),
    ]);
    if (league.error || period.error || !period.data?.[0]?.week)
      throw Error("The current league season and week are unavailable.");
    const week = period.data[0].week,
      season = league.data!.nfl_season;
    // Each request owns its source cache; all families use the same raw inputs.
    const cache = new Map<
      string,
      Promise<{ body: string; status: number; type: string }>
    >();
    const sourceFetch: typeof fetch = async (input, init) => {
      const source = String(input);
      if (!cache.has(source))
        cache.set(
          source,
          fetch(input, init).then(async (r) => ({
            body: await r.text(),
            status: r.status,
            type: r.headers.get("content-type") ?? "application/json",
          })),
        );
      const data = await cache.get(source)!;
      return new Response(data.body, {
        status: data.status,
        headers: { "content-type": data.type },
      });
    };
    const categories = [
      "Matchups",
      "Player Points",
      "Weekly Specials",
      "Season Futures",
    ];
    const responses = await Promise.all(
      categories.map(async (category) => {
        const response = await generateMarkets(
          new Request(new URL("/api/generate-markets", request.url), {
            method: "POST",
            headers: { authorization, "content-type": "application/json" },
            body: JSON.stringify({
              league_id: input.league_id,
              week,
              nfl_season: season,
              category,
              reopening_preview: true,
            }),
          }),
          sourceFetch,
        );
        const result = (await response.json()) as {
          quotes: any[];
          reopening: any;
          warnings?: string[];
          error?: string;
        };
        if (!response.ok) throw Error(`${category}: ${result.error}`);
        return result;
      }),
    );
    if (responses.some((r) => !r.reopening))
      throw Error("Every category needs a verified reopening snapshot.");
    const fingerprint = (r: any) => JSON.stringify(r.reopening.teams);
    if (responses.some((r) => fingerprint(r) !== fingerprint(responses[0])))
      throw Error(
        "Inputs changed during preparation. Refresh all categories together.",
      );
    const weekly = responses.slice(0, 3).flatMap((r) => r.quotes),
      futures = responses[3].quotes;
    const checked = new Date().toISOString();
    const scoreboard = [...cache.entries()].find(([u]) =>
      u.includes("site.api.espn.com"),
    );
    const rawGames = scoreboard ? JSON.parse((await scoreboard[1]).body) : null;
    const { parseScoreboard } = await import("./_lib/game-status.js");
    const context = {
      ...responses[0].reopening,
      model: REOPENING_MODEL,
      games: parseScoreboard(rawGames).games,
      checked_at: checked,
      source_urls: [...cache.keys()],
      warnings: responses.flatMap((r) => r.warnings ?? []),
    };
    const matchupSource = [...cache.entries()].find(([u]) =>
      u.endsWith(`/matchups/${week}`),
    );
    const actualMatchups = matchupSource
      ? JSON.parse((await matchupSource[1]).body)
      : [];
    context.scores = Object.fromEntries(
      context.teams.flatMap((t: any) => {
        const row = actualMatchups.find(
          (r: any) => r.roster_id === t.roster_id,
        );
        return typeof row?.points === "number" ? [[t.team_id, row.points]] : [];
      }),
    );
    const hash = createHash("sha256")
      .update(JSON.stringify({ weekly, futures, context, closes }))
      .digest("hex");
    const server = createClient(url, secret, {
      auth: { persistSession: false },
    });
    const staged = await server.rpc("stage_reopening_review", {
      p_league: input.league_id,
      p_week: week,
      p_season: season,
      p_closes: closes,
      p_checked: checked,
      p_hash: hash,
      p_weekly: weekly,
      p_futures: futures,
      p_context: context,
    });
    if (staged.error) throw Error(staged.error.message);
    return json({
      id: staged.data,
      snapshot_hash: hash,
      closes_at: closes,
      checked_at: checked,
      weekly_quotes: weekly,
      future_quotes: futures,
      context,
      week,
      nfl_season: season,
    });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "Reopening review failed.",
      },
      503,
    );
  }
}
