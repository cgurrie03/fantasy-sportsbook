import type { AccountData } from "./accounts";

export function buildBalanceHistory(data: AccountData, teamId: string) {
  const tickets = (data.tickets ?? []).filter((t) => t.team_id === teamId);
  const entries = [
    ...tickets
      .filter(
        (t) =>
          !data.ledger.some((e) => e.ticket_id === t.id && e.kind === "wager"),
      )
      .map((t) => ({
        id: "wager-" + t.id,
        title: "Ticket Placed",
        reason:
          "Week " +
          t.market_week +
          " · " +
          (t.legacy_ticket_id ?? t.id.slice(0, 8)),
        recordedBalance: null as number | null,
        amount: -Number(t.stake),
        date: t.placed_at,
        imported: false,
        phase: 0,
        placed: Date.parse(t.placed_at),
      })),
    ...data.events
      .filter((e) => e.team_id === teamId && e.kind !== "opening_balance")
      .map((e) => ({
        id: e.id,
        title: "Balance Adjustment",
        reason: e.reason,
        recordedBalance: Number(e.new_balance),
        amount: Number(e.new_balance) - Number(e.previous_balance ?? 0),
        date: e.created_at,
        imported: false,
        phase: 3,
        placed: 0,
      })),
    ...data.ledger
      .filter((e) => e.team_id === teamId && e.kind !== "historical_opening")
      .map((e) => {
        const ticket = tickets.find((t) => t.id === e.ticket_id);
        return {
          id: e.id,
          title:
            e.kind === "void_refund"
              ? "Ticket Voided · Refund"
              : e.kind === "wager"
                ? "Ticket Placed"
                : e.kind === "weekly_replenishment"
                  ? "Weekly Replenishment"
                  : ticket?.status === "PUSH"
                    ? "Wager Returned"
                    : "Ticket Won",
          reason: ticket
            ? "Week " +
              ticket.market_week +
              " · " +
              (ticket.legacy_ticket_id ?? ticket.id.slice(0, 8))
            : e.reason,
          recordedBalance: Number(e.balance_after),
          amount: Number(e.balance_after) - Number(e.balance_before ?? 0),
          date: e.created_at,
          imported: Boolean(e.source_batch),
          phase: e.kind === "weekly_replenishment" ? 2 : 1,
          placed: ticket ? Date.parse(ticket.placed_at) : 0,
        };
      }),
  ].filter((e) => e.amount !== 0);
  // Import settlements share a timestamp; use ticket placement order as a stable tie-breaker.
  const ordered = entries.sort(
    (a, b) =>
      Date.parse(b.date) - Date.parse(a.date) ||
      b.phase - a.phase ||
      b.placed - a.placed ||
      a.id.localeCompare(b.id),
  );
  const currentBalance = data.wallets?.find(
    (w) => w.team_id === teamId,
  )?.balance;
  let balanceCents: number | null =
    currentBalance == null ? null : Math.round(Number(currentBalance) * 100);
  return ordered.map((entry) => {
    // Recorded snapshots anchor the ledger; replay changes backward for wagers
    // whose stakes were deducted in the original spreadsheet before import.
    if (entry.recordedBalance != null)
      balanceCents = Math.round(entry.recordedBalance * 100);
    const balanceAfter = balanceCents == null ? null : balanceCents / 100;
    if (balanceCents != null) balanceCents -= Math.round(entry.amount * 100);
    return { ...entry, balanceAfter };
  });
}
