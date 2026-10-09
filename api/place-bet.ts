import { deliverEmails } from "./_lib/mail.js";
import { createClient } from "@supabase/supabase-js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ error: "The bet request was invalid." }, 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    return json({ error: "The bet request was invalid." }, 400);
  const allowed = [
    "board_id",
    "revision",
    "picks",
    "stake",
    "request_id",
    "offer_id",
    "offer_kind",
  ];
  // Fail closed: never silently accept a teaser payload as an ordinary parlay.
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    return json(
      {
        error:
          "Unsupported ticket terms. Teaser acceptance is disabled during research.",
        code: "UNSUPPORTED_TICKET_TERMS",
      },
      400,
    );
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return json({ error: "Bet placement is not configured yet." }, 503);
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer "))
    return json({ error: "Sign in before placing a bet." }, 401);
  const userClient = createClient(
    url,
    process.env.SUPABASE_ANON_KEY ??
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
      "",
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data: user, error: userError } = await userClient.auth.getUser();
  if (userError || !user.user)
    return json({ error: "Your sign-in session has expired." }, 401);
  let body: {
    board_id?: unknown;
    revision?: unknown;
    picks?: unknown;
    stake?: unknown;
    request_id?: unknown;
    offer_id?: unknown;
    offer_kind?: unknown;
  };
  body = input as typeof body;
  if (
    !body.board_id ||
    !Number.isInteger(body.revision) ||
    !Array.isArray(body.picks) ||
    !body.picks.every((v) => typeof v === "string") ||
    !Number.isFinite(Number(body.stake)) ||
    typeof body.request_id !== "string"
  )
    return json({ error: "The bet request was incomplete." }, 400);
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (
    (body.offer_id !== undefined || body.offer_kind !== undefined) &&
    (typeof body.offer_id !== "string" ||
      !["boost", "fixed"].includes(String(body.offer_kind)))
  )
    return json({ error: "Invalid offer request." }, 400);
  const rpcName =
    body.offer_kind === "fixed"
      ? "place_fixed_ticket"
      : body.offer_kind === "boost"
        ? "place_boosted_ticket"
        : "place_sportsbook_ticket";
  const args =
    body.offer_kind === "fixed"
      ? {
          p_offer: body.offer_id,
          p_stake: Number(body.stake),
          p_request: body.request_id,
        }
      : {
          p_board: body.board_id,
          p_revision: body.revision,
          p_picks: body.picks,
          p_stake: Number(body.stake),
          p_request: body.request_id,
          ...(body.offer_id ? { p_offer: body.offer_id } : {}),
        };
  const { data, error } = await userClient.rpc(rpcName, args);
  if (error) {
    if (error.message.includes("Lines have changed")) {
      const latest = await userClient.rpc("sportsbook_quote_snapshot", {
        p_board: body.board_id,
      });
      return json(
        {
          error:
            "Lines have changed. Review and explicitly approve the new prices.",
          code: "QUOTE_CHANGED",
          quote: latest.data,
        },
        409,
      );
    }
    return json({ error: error.message }, 400);
  }
  const result = data as {
    ticket_id?: string;
    balance?: number;
    duplicate?: boolean;
  };
  if (!result.ticket_id)
    return json({ error: "The bet was not accepted." }, 500);
  // The database queued this message atomically with ticket acceptance.
  // Failed immediate delivery remains queued for the scheduled worker to retry.
  try {
    await deliverEmails(admin, result.ticket_id);
  } catch {
    /* accepted bet remains valid */
  }
  const delivery = await admin
    .from("outbound_emails")
    .select("status")
    .eq("ticket_id", result.ticket_id)
    .maybeSingle();
  const emailStatus = delivery.data?.status ?? "pending";
  return json({
    ticket_id: result.ticket_id,
    balance: result.balance,
    duplicate: Boolean(result.duplicate),
    email_status: emailStatus,
  });
}
