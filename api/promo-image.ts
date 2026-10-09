import { createClient } from "@supabase/supabase-js";
import { validatePng } from "./_lib/promo-image.js";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
export async function POST(request: Request) {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json({ error: "Image service unavailable." }, 503);
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer "))
    return json({ error: "Sign in before uploading." }, 401);
  const client = createClient(
    url,
    process.env.SUPABASE_ANON_KEY ??
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
      "",
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return json({ error: "Sign-in expired." }, 401);
  try {
    const body = (await request.json()) as {
      png?: unknown;
      league_id?: unknown;
    };
    const png = validatePng(body.png);
    const service = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const r = await service.rpc("store_promo_image", {
      p_league: body.league_id,
      p_user: data.user.id,
      p_png: png,
    });
    if (r.error) throw r.error;
    return json({ id: r.data });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Invalid upload." },
      400,
    );
  }
}
