import type { StarterSnapshot } from "../lib/starter-activity";
export function StarterActivity({
  rosterIds,
  snapshot,
  unavailable,
  now,
}: {
  rosterIds: (number | undefined)[];
  snapshot: StarterSnapshot | null;
  unavailable: boolean;
  now: number;
}) {
  const rosters = rosterIds.map((id) =>
    snapshot?.rosters.find((r) => r.roster_id === id),
  );
  if (
    unavailable ||
    (snapshot &&
      (rosters.some((r) => !r) ||
        now - Date.parse(snapshot.observed_at) > 180000))
  )
    return (
      <span className="matchup-status-unavailable">
        Game status unavailable
      </span>
    );
  if (!snapshot)
    return (
      <span className="matchup-status-unavailable">Checking game status…</span>
    );
  if (!rosters.some((r) => r?.playing.length))
    return rosters.some((r) => r?.incomplete) ? (
      <span className="matchup-status-unavailable">
        Game status unavailable
      </span>
    ) : null;
  return (
    <span
      className="matchup-in-progress"
      title="An actual Sleeper starter’s NFL game is in progress, including halftime. This does not confirm the player is on the field."
    >
      <span aria-hidden="true">●</span> In progress
    </span>
  );
}
