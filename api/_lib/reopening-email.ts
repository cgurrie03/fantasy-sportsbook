import type { EmailContent } from "./email-templates.ts";
export function reopeningEmail(input: {
  brand?: string;
  greeting: string;
  week: number;
  closes_at: string;
  url: string;
}): EmailContent {
  const closes = new Date(input.closes_at);
  if (!Number.isFinite(closes.getTime()))
    throw Error("The reopening cutoff is unavailable.");
  const cutoff =
    closes.toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " Eastern";
  return {
    brand: input.brand,
    greeting: input.greeting,
    url: input.url,
    subject: `The Book Is Reopened · Week ${input.week} · Sunday Noon ET`,
    heading: "The Book Is Back Open",
    paragraphs: [
      `Week ${input.week} is reopened with updated lines. You have until ${cutoff} to get your picks in.`,
      "Matchup screens now show current fantasy scores alongside model projections. Updated team lines account for completed-game points and remaining eligible starters.",
      "Bets on players whose NFL games have started or finished remain locked. Incomplete lineups, uncertain data, and affected games in progress can also keep individual bets unavailable.",
      "Already placed a bet? Your accepted picks, odds, and payout terms stay unchanged. Reopening gives you a new opportunity to place eligible bets before the cutoff.",
    ],
    details: [
      ["Betting closes", cutoff],
      ["Current scores", "Provisional until settlement"],
      ["Availability", "Check the current board for eligible selections"],
    ],
    button: "View Updated Lines",
  };
}
