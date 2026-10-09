// ESPN's public scoreboard is a best-effort cadence source, not a licensed
// live pricing feed. Never use its polling timestamp as player-stat freshness.
export type GameState =
  | "scheduled"
  | "in_progress"
  | "final"
  | "delayed"
  | "suspended"
  | "postponed"
  | "cancelled"
  | "unknown";
export function normalizeGameStatus(name: string): GameState {
  switch (name) {
    case "STATUS_SCHEDULED":
      return "scheduled";
    case "STATUS_IN_PROGRESS":
    case "STATUS_HALFTIME":
    case "STATUS_END_PERIOD":
      return "in_progress";
    case "STATUS_FINAL":
    case "STATUS_FINAL_OVERTIME":
      return "final";
    case "STATUS_DELAYED":
      return "delayed";
    case "STATUS_SUSPENDED":
      return "suspended";
    case "STATUS_POSTPONED":
      return "postponed";
    case "STATUS_CANCELED":
    case "STATUS_CANCELLED":
      return "cancelled";
    default:
      return "unknown";
  }
}
export function scoreboardWindow(now: Date) {
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const start = new Date(local + "T12:00:00Z");
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 5) % 7));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return [start, end]
    .map((d) => d.toISOString().slice(0, 10).replaceAll("-", ""))
    .join("-");
}
export function parseScoreboard(value: any) {
  if (
    !Array.isArray(value?.events) ||
    !value?.leagues?.some((l: any) => l.slug === "nfl")
  )
    throw new Error("NFL status feed has an invalid shape.");
  const games = value.events.map((e: any) => {
    if (!e.id || !e.status?.type?.name || !Number.isFinite(Date.parse(e.date)))
      throw new Error("NFL status feed has an incomplete game.");
    return {
      id: String(e.id),
      starts_at: e.date,
      state: normalizeGameStatus(e.status.type.name),
    };
  });
  const uncertain = games.some((g: any) =>
    ["unknown", "suspended"].includes(g.state),
  );
  return {
    games,
    any_in_progress: games.some((g: any) => g.state === "in_progress"),
    week_started: games.some((g: any) =>
      ["in_progress", "final", "suspended"].includes(g.state),
    ),
    reason: uncertain ? "NFL game status is uncertain or suspended." : null,
  };
}
export async function fetchGameStatus(now = new Date()) {
  const response = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${scoreboardWindow(now)}&limit=1000`,
    { cache: "no-store", signal: AbortSignal.timeout(6000) },
  );
  if (!response.ok)
    throw new Error(`NFL status source returned ${response.status}.`);
  return parseScoreboard(await response.json());
}
