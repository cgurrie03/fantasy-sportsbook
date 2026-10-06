import { createClient } from "@supabase/supabase-js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export async function POST(request: Request) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return json({ error: "Bet placement is not configured yet." }, 503);
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer "))
    return json({ error: "Sign in before placing a bet." }, 401);
  const userClient = createClient(url, process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "", {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: user, error: userError } = await userClient.auth.getUser();
  if (userError || !user.user) return json({ error: "Your sign-in session has expired." }, 401);
  let body: { board_id?: unknown; revision?: unknown; picks?: unknown; stake?: unknown; request_id?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ error: "The bet request was invalid." }, 400); }
  if (!body.board_id || !Number.isInteger(body.revision) || !Array.isArray(body.picks) || !body.picks.every(v => typeof v === "string") || !Number.isFinite(Number(body.stake)) || typeof body.request_id !== "string")
    return json({ error: "The bet request was incomplete." }, 400);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await userClient.rpc("place_sportsbook_ticket", {
    p_board: body.board_id,
    p_revision: body.revision,
    p_picks: body.picks,
    p_stake: Number(body.stake),
    p_request: body.request_id,
  });
  if (error) return json({ error: error.message }, 400);
  const result = data as { ticket_id?: string; balance?: number; duplicate?: boolean };
  if (!result.ticket_id) return json({ error: "The bet was not accepted." }, 500);
  const { data: delivery } = await admin.from("email_deliveries").select("status").eq("ticket_id", result.ticket_id).maybeSingle();
  let emailStatus = delivery?.status ?? "pending";
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey && emailStatus === "pending") {
    const { data: ticket } = await admin.from("tickets").select("id,stake,accepted_combined_odds,accepted_potential_payout,market_week,placed_at,team_id").eq("id", result.ticket_id).maybeSingle();
    const { data: legs } = await admin.from("ticket_legs").select("selection,market_type,matchup,accepted_odds,accepted_line").eq("ticket_id", result.ticket_id).order("leg_number");
    const { data: team } = ticket ? await admin.from("teams").select("team_name").eq("id", ticket.team_id).maybeSingle() : { data: null };
    const { data: member } = ticket ? await admin.from("league_memberships").select("display_name,invited_email").eq("team_id", ticket.team_id).maybeSingle() : { data: null };
    if (ticket && member?.invited_email) {
      const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]!));
      const rows = (legs ?? []).map(l => `<li><strong>${escape(l.selection)}</strong><br><span>${escape(l.matchup ?? "")} · ${escape(l.market_type)}</span></li>`).join("");
      const html = `<div style="background:#0b1422;color:#edf2fa;padding:32px;font-family:Arial,sans-serif"><div style="max-width:620px;margin:auto;background:#132137;padding:28px;border-radius:16px"><p style="color:#f4c453;letter-spacing:.08em;font-size:12px">GOLDY FANTASY SPORTSBOOK</p><h1 style="font-size:24px">Bet Confirmation</h1><p>${escape(member.display_name)}, your Week ${escape(ticket.market_week)} ticket is accepted.</p><p style="color:#a7b6ca">${escape(team?.team_name)} · ${escape(new Date(ticket.placed_at).toLocaleString("en-US",{timeZone:"America/New_York"}))} Eastern</p><ul>${rows}</ul><p><strong>Wager: $${Number(ticket.stake).toFixed(2)}</strong><br>Potential payout: $${Number(ticket.accepted_potential_payout).toFixed(2)}</p></div></div>`;
      const send = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `ticket-confirmation-${ticket.id}` }, body: JSON.stringify({ from: "Goldy Fantasy Sportsbook <sportsbook@coopergurrie.com>", to: [member.invited_email], subject: `Bet Confirmation · Week ${ticket.market_week}`, html }) });
      const payload = await send.json().catch(() => ({})) as { id?: string; message?: string };
      emailStatus = send.ok ? "sent" : "failed";
      await admin.from("email_deliveries").update({ status: emailStatus, attempts: 1, provider_id: payload.id ?? null, last_error: send.ok ? null : payload.message ?? "Resend rejected the message.", sent_at: send.ok ? new Date().toISOString() : null }).eq("ticket_id", ticket.id);
    }
  }
  return json({ ticket_id: result.ticket_id, balance: result.balance, duplicate: Boolean(result.duplicate), email_status: emailStatus });
}
