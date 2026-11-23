// Illustrative historical quotes for visual review only. Never settlement input.
import context from "./season-context.json";
export type HistoricalGame = (typeof context.rows)[number];
export function previewLines(r: HistoricalGame) {
  const low = Math.min(r.roster, r.opponent),
    high = Math.max(r.roster, r.opponent);
  const lowFavored = (low + high + r.week) % 2 === 0;
  const favorite = lowFavored ? low : high;
  let spread = ((low + high + r.week) % 5) * 3 + 2.5;
  if (Math.abs(Math.abs(r.points - r.against) - spread) < 0.001) spread += 1;
  const teamLine = r.roster === favorite ? -spread : spread;
  const teamCovered = r.points + teamLine > r.against;
  const winner = r.points > r.against ? r.roster : r.opponent;
  const favoritePrice = -(125 + ((low + high + r.week) % 6) * 25);
  const underdogPrice = Math.abs(favoritePrice) - 15;
  const total = r.points + r.against;
  const totalLine =
    Math.floor(total + ((low + high + r.week) % 2 === 0 ? 7 : -7)) + 0.5;
  return {
    teamLine,
    coverRoster: teamCovered ? r.roster : r.opponent,
    coverLine: teamCovered ? teamLine : -teamLine,
    winner,
    moneyline: winner === favorite ? favoritePrice : underdogPrice,
    total,
    totalLine,
    totalSide: total > totalLine ? "Over" : "Under",
  };
}
export function exampleATS(roster: number) {
  const rows = context.rows.filter((r) => r.roster === roster);
  const wins = rows.filter(
    (r) => previewLines(r).coverRoster === roster,
  ).length;
  return {
    wins,
    losses: rows.length - wins,
    rate: wins / Math.max(1, rows.length),
  };
}
