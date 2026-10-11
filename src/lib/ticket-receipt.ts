import type { AccountData, Ticket } from "./accounts";
import { money } from "./accounts";

export function ticketReceipt(
  data: AccountData,
  ticket: Ticket,
  owner: string,
) {
  const team = data.teams.find(
    (t) => t.id === ticket.team_id && t.league_id === ticket.league_id,
  );
  const league = data.leagues.find((l) => l.id === ticket.league_id);
  const legs = (data.legs ?? [])
    .filter((l) => l.ticket_id === ticket.id)
    .sort((a, b) => a.leg_number - b.leg_number);
  const status = ticket.status[0] + ticket.status.slice(1).toLowerCase();
  const price =
    ticket.accepted_combined_odds > 0
      ? `+${ticket.accepted_combined_odds}`
      : String(ticket.accepted_combined_odds);
  const payoutLabel =
    ticket.status === "OPEN"
      ? "Potential payout"
      : ticket.status === "VOIDED"
        ? "Refund"
        : "Payout";
  const payout = money(
    ticket.status === "OPEN"
      ? (ticket.accepted_potential_payout ?? 0)
      : ticket.actual_payout,
  );
  const placed = new Date(ticket.placed_at).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const label =
    ticket.ticket_type === "future"
      ? "Season Futures"
      : `Week ${ticket.market_week}`;
  const id = ticket.legacy_ticket_id ?? ticket.id.slice(0, 8);
  const title = `${legs.length === 1 ? "Single Bet" : `${legs.length} Pick Parlay`} · ${label}`;
  const promotion = data.ticketPromotions?.find(
    (p) =>
      p.ticket_id === ticket.id &&
      p.kind === "boost" &&
      Number(p.boost_pct) > 0,
  );
  const boost = promotion
    ? `${Number(promotion.boost_pct)}% profit boost included`
    : null;
  const text = [
    league?.name ?? "Fantasy Sportsbook",
    `${owner} · ${status}`,
    title,
    ...legs.map(
      (l) =>
        `${l.leg_number}. ${l.selection}${l.status !== "OPEN" ? ` — ${l.status[0]}${l.status.slice(1).toLowerCase()}` : ""}`,
    ),
    `Wager ${money(ticket.stake)} · Odds ${price}`,
    `${payoutLabel} ${payout}`,
    ticket.status !== "OPEN"
      ? `Net profit ${money(Number(ticket.actual_payout) - Number(ticket.stake))}`
      : "",
    `${placed} ET · Bet ${id}`,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    team,
    league,
    legs,
    status,
    price,
    payoutLabel,
    payout,
    placed,
    label,
    id,
    title,
    text: boost ? text + "\n" + boost : text,
    boost,
    ticket: { ...ticket },
  };
}
