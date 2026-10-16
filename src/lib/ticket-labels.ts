import type { Ticket } from "./accounts";
export const ticketCategory = (ticket: Ticket) =>
  ticket.ticket_type === "future"
    ? "Season futures"
    : `Week ${ticket.market_week}`;
export const ticketTypeLabel = (ticket: Ticket, legs: number) =>
  ticket.ticket_type === "future"
    ? legs > 1
      ? `${legs}-pick futures parlay`
      : "Futures single"
    : legs > 1
      ? `${legs}-pick parlay`
      : "Single bet";
export function ticketReturns(ticket: Ticket) {
  const stake = Number(ticket.stake);
  const total =
    ticket.status === "OPEN"
      ? Number(ticket.accepted_potential_payout ?? 0)
      : ticket.status === "VOIDED"
        ? stake
        : Number(ticket.actual_payout);
  return { total, profit: total - stake };
}
