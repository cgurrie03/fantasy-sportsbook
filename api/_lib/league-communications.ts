import type { SupabaseClient } from "@supabase/supabase-js";

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
  let financial = false;
  if (row.ticket_id) {
    const ticket = await db.from("tickets").select("id,user_wallet_id").eq("id", row.ticket_id)
      .eq("league_id", row.league_id).eq("team_id", row.team_id).maybeSingle();
    if (ticket.error || !ticket.data) throw new Error("Email ticket league or team mismatch.");
    if (ticket.data.user_wallet_id) {
      const result = await db.rpc("financial_email_recipient", { p_ticket: row.ticket_id });
      const recipient = result.data;
      if (result.error || row.kind !== "confirmation" || !recipient ||
          recipient.wallet_id !== ticket.data.user_wallet_id || recipient.league_id !== row.league_id ||
          recipient.team_id !== row.team_id || recipient.recipient !== row.recipient)
        throw new Error("Email recipient no longer matches the accepted financial account.");
      financial = true;
    }
  }
  if (!financial) {
    const membership = await db.from("league_memberships").select("id,role")
      .eq("league_id", row.league_id).eq("team_id", row.team_id)
      .eq("invited_email", row.recipient).maybeSingle();
    if (membership.error || !membership.data || (row.kind === "attention" && membership.data.role !== "admin"))
      throw new Error("Email recipient no longer matches the approved league membership.");
  }
  if (row.payload) validatePayloadRecipient(row.payload, row.recipient);
}
export function validatePayloadRecipient(payload: any, recipient: string) {
  if (!Array.isArray(payload?.to) || payload.to.length !== 1 || payload.to[0] !== recipient || "cc" in payload || "bcc" in payload)
    throw new Error("Email payload recipient mismatch.");
}
