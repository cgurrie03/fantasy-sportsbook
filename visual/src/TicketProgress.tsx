import {live} from "./live";
import { league, teams, matchups, profileTeam } from "./model";
import type { Pick, Ticket } from "./model";
export function PickProgress({ pick: p }: { pick: Pick }) {
  if (p.result && p.result.status !== "Open") return null;
  if (p.kind === "future") {
    if (p.line == null || !(p.family==="future_win_total"||p.id.startsWith("future-wins-")))
      return <small className="progress-pending">Season Outcome Pending</small>;
    const t = teams.find((t) => p.teamId === t.id) || profileTeam,
      target = p.line,
      pct = Math.min(100, Math.max(0, (t.wins / Math.max(0.5, target)) * 100));
    return (
      <div className="season-progress leg-progress">
        <div
          className="wins-meter"
          role="progressbar"
          aria-label={t.name + " Season Wins"}
          aria-valuenow={t.wins}
          aria-valuemin={0}
          aria-valuemax={Math.max(target, t.wins)}
          aria-valuetext={t.wins + " wins; accepted target " + target}
        >
          <span className="wins-track">
            <span style={{ width: pct + "%" }} />
          </span>
          <span
            className="wins-marker"
            style={{ left: "clamp(14px," + pct + "%,calc(100% - 14px))" }}
          >
            {t.wins}
          </span>
          <span className="wins-target">{target}</span>
        </div>
        <small>
          {Math.max(0, league.regularSeasonWeeks - t.games)} Regular-Season
          Games Remaining
        </small>
      </div>
    );
  }
  if (p.kind === "player" || p.kind === "player-group")
    return (
      <small className="progress-pending">
        {p.kind === "player-group"
          ? "Position Group Progress Awaiting Source"
          : "Player Progress Awaiting Source"}
      </small>
    );
  const m = matchups.find((m) => m.id === p.matchupId);
  if (!m) return null;
  const score = (roster: number) =>
    league.finalScores.find((s) => s.roster === roster)?.points || 0;
  const forecast = p.family==="match_total"?m.awayProjection+m.homeProjection:p.teamId===m.home.id?m.homeProjection:m.awayProjection;
  const value =
    p.family === "match_total"
      ? score(m.away.roster_id) + score(m.home.roster_id)
      : score(p.teamId === m.home.id ? m.home.roster_id : m.away.roster_id);
  return (
    <div className="leg-progress">
      <div className="leg-score-values">
        <span>
          Score <b>{value.toFixed(2)}</b>
        </span>
        <span>
          Remaining <b>{live()?Math.max(0,forecast-value).toFixed(2):"0.0"}</b>
        </span>
        <span>
          Forecast <b>{(live()?forecast:value).toFixed(2)}</b>
        </span>
      </div>
      <small>{live()?"Current Sleeper Score":"Awaiting Final Confirmation · Archived Scores"}</small>
    </div>
  );
}
export function TicketProgress({ ticket }: { ticket: Ticket }) {
  return (
    <>
      {ticket.picks.map((p) => (
        <PickProgress key={p.id} pick={p} />
      ))}
    </>
  );
}
