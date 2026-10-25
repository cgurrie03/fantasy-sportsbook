import { TicketProgressNotice } from "./TicketProgress";
export function MatchupScore({ row, teamId }: { row: any; teamId?: string }) {
  const value = teamId ? row?.payload?.teams?.[teamId] : undefined;
  return (
    <span className="match-current-score">
      <strong>
        {row?.payload?.week_final ? "Final score" : "Current score"}:{" "}
        {typeof value === "number" && Number.isFinite(value)
          ? value.toFixed(2)
          : "Unavailable"}
      </strong>
    </span>
  );
}
export function MatchupScoresNotice(props: {
  row: any;
  loading: boolean;
  error: boolean;
  now: number;
}) {
  return (
    <div className="match-score-notice">
      <TicketProgressNotice {...props} />
    </div>
  );
}
