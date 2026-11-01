import { createServerClient } from "./_lib/server-client.js";
import { fetchSleeperIntake, sleeperLeagueId } from "./_lib/league-intake.js";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return json({ error: "Sign in as the platform owner." }, 401);
  try {
    const url = process.env.SUPABASE_URL,
      key =
        process.env.SUPABASE_ANON_KEY ??
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key)
      return json({ error: "League intake is unavailable." }, 503);
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
    let raw = "";
    if (request.body) {
      const reader = request.body.getReader(),
        decoder = new TextDecoder();
      let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.length;
          if (bytes > 2048)
            return json({ error: "Intake request exceeds its budget." }, 413);
          raw += decoder.decode(part.value, { stream: true });
        }
        raw += decoder.decode();
      } finally {
        await reader.cancel();
      }
    }
    const body = JSON.parse(raw);
    const id = sleeperLeagueId(body.sleeper_league_id);
    if (
      typeof body.request_key !== "string" ||
      !/^([a-f0-9]{8}-){1}([a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(
        body.request_key,
      )
    )
      return json({ error: "An intake request identifier is required." }, 400);
    const previous = await db
      .from("league_intake_drafts")
      .select(
        "id,revision,state,source,capabilities,source_league_id,expires_at",
      )
      .eq("owner_id", auth.data.user.id)
      .eq("request_key", body.request_key)
      .maybeSingle();
    if (previous.error) throw new Error("Intake retry state is unavailable.");
    if (previous.data) {
      if (previous.data.source_league_id !== id)
        return json(
          {
            error: "Intake request already belongs to another provider league.",
          },
          409,
        );
      if (
        previous.data.state === "expired" ||
        (previous.data.state === "draft" &&
          Date.parse(previous.data.expires_at) <= Date.now())
      )
        return json(
          { error: "Draft expired; start a fresh provider preview." },
          410,
        );
      return json({ ...previous.data, duplicate: true });
    }
    const intake = await fetchSleeperIntake(id);
    const result = await db.rpc("save_league_intake_draft", {
      p_request: body.request_key,
      p_source: intake.source,
      p_capabilities: intake.capabilities,
    });
    if (result.error) throw new Error(result.error.message);
    return json({
      ...result.data,
      source: intake.source,
      capabilities: intake.capabilities,
    });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "League intake failed.",
      },
      400,
    );
  }
}
