import { buildLiveForecast, sameGameDate } from "./live-model.js";
import type { Projection } from "./line-model.js";
import type { Market } from "../../src/lib/markets.ts";
import { exactEventTime } from "./event-time.js";
export const REOPENING_MODEL = "between-games-conditional-v1";
const aliases: Record<string, string> = { WAS: "WSH", JAC: "JAX", LA: "LAR" };
const nfl = (v: string) => aliases[v] ?? v;
export function canonicalProjections(
  projections: Projection[],
  games: { id: string; teams: string[]; starts_at: string }[],
) {
  return projections.map((p) => {
    const matches = games.filter(
      (g) =>
        g.teams.some((t) => nfl(t) === nfl(p.team ?? "")) &&
        sameGameDate(p.date, g.starts_at),
    );
    return {
      ...p,
      date:
        matches.length === 1
          ? (exactEventTime(matches[0].starts_at) ?? p.date)
          : p.date,
    };
  });
}
export function validateReopeningDeadline(value: string, now = Date.now()) {
  const exact = exactEventTime(value),
    t = exact ? Date.parse(exact) : NaN;
  const local = Number.isFinite(t)
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).format(new Date(t))
    : "";
  if (
    !exact ||
    t <= now ||
    t > now + 7 * 86400000 ||
    !local.includes("Sunday") ||
    !local.includes("12:00:00")
  )
    throw Error("Choose the upcoming Sunday at 12:00 PM Eastern.");
  return exact;
}
export function conditionalReopening(
  input: Parameters<typeof buildLiveForecast>[0],
) {
  const result = buildLiveForecast(input);
  for (const team of result.teams) {
    if (
      team.players.some(
        (p) => p.state === "scheduled" && (p.prior === null || p.prior <= 0),
      )
    )
      team.reasons.push(
        "An unstarted actual starter has no eligible positive projection.",
      );
    if (team.players.some((p) => !["scheduled", "final"].includes(p.state)))
      team.reasons.push(
        "This lineup has a game in progress or an uncertain event. Live game pricing is unavailable.",
      );
    if (
      team.players.some(
        (p) =>
          p.state === "scheduled" &&
          Date.parse(input.games.find((g) => g.id === p.game_id)!.starts_at) <=
            Date.parse(input.fetched_at),
      )
    )
      team.reasons.push(
        "A scheduled kickoff has passed; wait for a verified game-state update.",
      );
  }
  return {
    model: REOPENING_MODEL,
    checked_at: input.fetched_at,
    teams: result.teams,
    formula:
      "Verified completed starter points plus projections for unstarted actual starters; completed players have zero remaining variance.",
    limitations: [
      "Remaining-player correlations and future lineup changes remain model assumptions.",
      "Scores are provisional until settlement. No elapsed-clock forecast is eligible for acceptance.",
    ],
  };
}
export function tagReopeningQuotes(
  quotes: Market[],
  snapshot: ReturnType<typeof conditionalReopening>,
  games: { id: string; starts_at: string; state: string }[],
) {
  const players = snapshot.teams.flatMap((t) => t.players);
  for (const q of quotes) {
    let reasons: string[] = [];
    const isPlayer = [
      "player_points",
      "player_milestone",
      "player_h2h",
    ].includes(q.kind);
    const ids = isPlayer
      ? [
          q.metadata.player_id,
          q.kind === "player_h2h" ? q.metadata.opponent_player_id : null,
        ]
          .filter(Boolean)
          .map(String)
      : [];
    const selected = ids.map((id) => players.find((p) => p.id === id));
    const relevant = isPlayer
      ? []
      : snapshot.teams.filter(
          (t) =>
            q.kind.startsWith("weekly_") ||
            q.kind.startsWith("future_") ||
            (["team_total", "team_milestone"].includes(q.kind)
              ? t.team_id === q.team_id
              : [q.home_team_id, q.away_team_id].includes(t.team_id)),
        );
    if (
      isPlayer &&
      (selected.length === 0 ||
        selected.some((p) => !p || p.state !== "scheduled"))
    )
      reasons.push(
        "A selected player's NFL game has started, finished, or cannot be verified.",
      );
    if (!isPlayer) reasons.push(...relevant.flatMap((t) => t.reasons));
    if (!isPlayer && relevant.length && relevant.every((t) => t.sd === 0))
      reasons.push("The outcome is already determined.");
    if (
      (q.kind === "weekly_any_200" &&
        relevant.some(
          (t) => !t.reasons.length && t.sd === 0 && t.observed >= 200,
        )) ||
      (q.kind === "weekly_any_below_100" &&
        relevant.some(
          (t) => !t.reasons.length && t.sd === 0 && t.observed < 100,
        ))
    )
      reasons.push(
        "A completed team's score has already determined this outcome.",
      );
    const requiredIds = [
      ...new Set(
        isPlayer
          ? selected.flatMap((p) => (p ? [p.game_id] : []))
          : relevant.flatMap((t) => t.players.map((p) => p.game_id)),
      ),
    ];
    const requiredGames = games.filter((g) => requiredIds.includes(g.id));
    if (!requiredGames.length)
      reasons.push("Verified game mapping is unavailable.");
    q.metadata = {
      ...q.metadata,
      reopening_model: REOPENING_MODEL,
      reopening_checked_at: snapshot.checked_at,
      reopening_game_ids: requiredIds,
      reopening_events: requiredGames,
      reopening_locked: reasons.length > 0,
      reopening_lock_reason: [...new Set(reasons)].join(" "),
      reopening_player_market: isPlayer,
    };
    if (isPlayer)
      q.metadata.cutoff_at =
        selected.length && selected.every(Boolean)
          ? new Date(
              Math.min(
                ...selected.map((p) =>
                  Date.parse(games.find((g) => g.id === p!.game_id)!.starts_at),
                ),
              ),
            ).toISOString()
          : null;
  }
}
