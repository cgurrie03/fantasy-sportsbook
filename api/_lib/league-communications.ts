import type { SupabaseClient } from "@supabase/supabase-js";

export async function participantMailAudience(
  db: SupabaseClient,
  league: string,
  legacy: any[],
) {
  const result = await db.rpc("financial_email_audience", { p_league: league });
  if (result.error) throw new Error("Financial email audience is unavailable.");
  if (result.data === null) return legacy;
  if (
    !Array.isArray(result.data) ||
    result.data.length > 128 ||
    result.data.some(
      (r: any) =>
        !r.id || !r.team_id || !r.invited_email || r.league_id !== league,
    )
  )
    throw new Error("Financial email audience scope is invalid.");
  return result.data;
}

export function communicationIdentity(league: any) {
  if (!league?.name || !league.sportsbook_url || !league.email_sender)
    throw new Error("League communication configuration is incomplete.");
  const url = new URL(league.sportsbook_url);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("League sportsbook URL must use HTTPS.");
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(league.email_sender))
    throw new Error("League email sender is invalid.");
  const brand = `${String(league.name).replace(/[\r\n<>]/g, "")} · Fantasy Sportsbook`;
  return { brand, url: url.href, from: `${brand} <${league.email_sender}>` };
}

export async function validateDeliveryScope(db: SupabaseClient, row: any) {
  if (row.kind === "attention") {
    await staffAlertContext(db, row);
    if (row.payload) validatePayloadRecipient(row.payload, row.recipient);
    return;
  }
  let financial = false;
  if (row.ticket_id) {
    const ticket = await db
      .from("tickets")
      .select("id,user_wallet_id")
      .eq("id", row.ticket_id)
      .eq("league_id", row.league_id)
      .eq("team_id", row.team_id)
      .maybeSingle();
    if (ticket.error || !ticket.data)
      throw new Error("Email ticket league or team mismatch.");
    if (ticket.data.user_wallet_id) {
      const result = await db.rpc("financial_email_recipient", {
        p_ticket: row.ticket_id,
      });
      const recipient = result.data;
      if (
        result.error ||
        row.kind !== "confirmation" ||
        !recipient ||
        recipient.wallet_id !== ticket.data.user_wallet_id ||
        recipient.league_id !== row.league_id ||
        recipient.team_id !== row.team_id ||
        recipient.recipient !== row.recipient
      )
        throw new Error(
          "Email recipient no longer matches the accepted financial account.",
        );
      financial = true;
    }
  }
  if (
    !financial &&
    row.wallet_model === "user" &&
    row.kind !== "attention" &&
    !row.ticket_id
  ) {
    const result = await db.rpc("financial_email_context", {
      p_league: row.league_id,
      p_team: row.team_id,
      p_recipient: row.recipient,
    });
    const recipient = result.data;
    if (
      result.error ||
      !recipient?.wallet_id ||
      recipient.league_id !== row.league_id ||
      recipient.team_id !== row.team_id ||
      recipient.recipient !== row.recipient
    )
      throw new Error(
        "Email recipient no longer matches the approved financial account.",
      );
    financial = true;
  }
  if (!financial) {
    const membership = await db
      .from("league_memberships")
      .select("id,role")
      .eq("league_id", row.league_id)
      .eq("team_id", row.team_id)
      .eq("invited_email", row.recipient)
      .maybeSingle();
    if (
      membership.error ||
      !membership.data ||
      (row.kind === "attention" && membership.data.role !== "admin")
    )
      throw new Error(
        "Email recipient no longer matches the approved league membership.",
      );
  }
  if (row.payload) validatePayloadRecipient(row.payload, row.recipient);
}
export function validatePayloadRecipient(payload: any, recipient: string) {
  if (
    !Array.isArray(payload?.to) ||
    payload.to.length !== 1 ||
    payload.to[0] !== recipient ||
    "cc" in payload ||
    "bcc" in payload
  )
    throw new Error("Email payload recipient mismatch.");
}
export function validateCommunicationPayload(payload: any, league: any) {
  const identity = communicationIdentity(league);
  if (
    payload?.from !== identity.from ||
    typeof payload.html !== "string" ||
    typeof payload.text !== "string"
  )
    throw Error("Frozen email sender no longer matches the configured league.");
  const origin = new URL(identity.url).origin;
  for (const match of (payload.html+"\n"+(typeof payload.amp==="string"?payload.amp:"")).matchAll(
    /\bhref\s*=\s*["']([^"']*)["']/gi,
  )) {
    const url = new URL(match[1].replaceAll("&amp;", "&"));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.origin !== origin
    )
      throw Error("Email action URL no longer matches the configured league.");
  }
}

export async function staffAlertContext(db: SupabaseClient, row: any) {
  if (
    !row.id ||
    !row.staff_user_id ||
    row.team_id != null ||
    row.ticket_id != null
  )
    throw Error("Current verified staff alert binding is unavailable.");
  const r = await db
    .rpc("staff_alert_context", { p_email: row.id })
    .abortSignal(AbortSignal.timeout(15000));
  const c = r.data;
  if (
    r.error ||
    !c ||
    c.contract !== "staff-attention-v1" ||
    c.league_id !== row.league_id ||
    c.user_id !== row.staff_user_id ||
    !c.user_id ||
    c.recipient !== row.recipient ||
    row.team_id != null ||
    row.ticket_id != null ||
    c.market_week !== row.market_week ||
    !["results", "futures", "lineup", "automation"].includes(c.category) ||
    !/^[a-z_]{1,40}$/.test(c.operation) ||
    !Number.isInteger(c.nfl_season) ||
    !Number.isFinite(Date.parse(c.queued_at))
  )
    throw Error("Current verified staff alert scope is unavailable.");
  return c;
}
