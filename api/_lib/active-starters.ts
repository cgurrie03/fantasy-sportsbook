import type { GameState } from "./game-status.js";
const aliases: Record<string, string> = { WAS: "WSH", JAC: "JAX", LA: "LAR" };
const nflTeam = (value: string) => aliases[value] ?? value;
export function activeStarters(
  starters: string[],
  players: Record<
    string,
    {
      team?: string | null;
      full_name?: string;
      injury_status?: string;
      status?: string;
    }
  >,
  games: { state: GameState; teams: string[] }[],
) {
  if (games.some((g) => g.teams.length !== 2))
    throw new Error("NFL team mapping is unavailable.");
  const active = new Set(
    games
      .filter((g) => g.state === "in_progress")
      .flatMap((g) => g.teams.map(nflTeam)),
  );
  const playing: { id: string; name: string }[] = [];
  let incomplete = false;
  for (const id of new Set(starters)) {
    if (id === "0") continue;
    const player = players[id];
    // Sleeper defense IDs are NFL abbreviations rather than numeric IDs.
    const defense = /^[A-Z]{2,3}$/.test(id);
    if (!player && !defense) {
      incomplete = true;
      continue;
    }
    const team = player?.team ?? (defense ? id : null);
    if (!team) continue;
    if (["Out", "IR", "PUP", "Suspended"].includes(player?.injury_status ?? ""))
      continue;
    if (active.has(nflTeam(team)))
      playing.push({ id, name: player?.full_name || `${team} defense` });
  }
  return { playing, incomplete };
}
