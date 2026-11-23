import type { Pick } from "./model";
import { line, teams } from "./model";
export function PickLabel({ pick: p }: { pick: Pick }) {
  if (p.family !== "spread") return <>{p.label}</>;
  const match = p.label.match(/\s([+-]?\d+(?:\.\d+)?)$/),
    value = p.line ?? Number(match?.[1]);
  const name =
    teams.find((t) => t.id === p.teamId)?.name ||
    (match ? p.label.slice(0, match.index) : p.label);
  return (
    <span className="pick-label">
      <span>{name}</span>
      <span className="pick-handicap">{line(value)}</span>
    </span>
  );
}
