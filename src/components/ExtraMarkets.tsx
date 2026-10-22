import { displayProjection, formatGameInfo } from "../../api/_lib/event-time";
import type { ReactNode } from "react";
import type { AccountData } from "../lib/accounts";
import type { Market } from "../lib/markets";
import { formatOdds } from "../lib/markets";
import { Chevron } from "./TicketHistory";
import "./ExtraMarkets.css";
type Quote = (market: Market | undefined, label?: string) => ReactNode;
export function Milestones({
  markets,
  quote,
  data,
}: {
  markets: Market[];
  quote: Quote;
  data?: AccountData;
}) {
  if (!markets.length) return null;
  return (
    <details className="team-totals extra-market">
      <summary>
        <strong>Milestones</strong>
        <Chevron />
      </summary>
      <p>
        {data
          ? "Reach this team score or higher."
          : "Reach this score or higher. A player who does not play pushes."}
      </p>
      <div className={data ? "extra-team-grid" : "milestone-options"}>
        {data
          ? [...new Set(markets.map((m) => m.team_id))].map((id) => (
              <section className="margin-team" key={id}>
                <strong>
                  {data.teams.find((t) => t.id === id)?.team_name}
                </strong>
                <div className="milestone-options">
                  {markets
                    .filter((m) => m.team_id === id)
                    .map((m) => (
                      <div key={m.id}>{quote(m, `${m.line}+`)}</div>
                    ))}
                </div>
              </section>
            ))
          : markets.map((m) => <div key={m.id}>{quote(m, `${m.line}+`)}</div>)}
      </div>
    </details>
  );
}
export function WinningMargins({
  markets,
  data,
  quote,
}: {
  markets: Market[];
  data: AccountData;
  quote: Quote;
}) {
  if (!markets.length) return null;
  return (
    <details className="team-totals extra-market">
      <summary>
        <strong>Winning Margin</strong>
        <Chevron />
      </summary>
      <p>A tied matchup pushes. Each range excludes its upper boundary.</p>
      <div className="extra-team-grid">
        {[...new Set(markets.map((m) => m.team_id))].map((id) => (
          <section className="margin-team" key={id}>
            <strong>{data.teams.find((t) => t.id === id)?.team_name}</strong>
            <div className="milestone-options">
              {markets
                .filter((m) => m.team_id === id)
                .map((m) => (
                  <div key={m.id}>
                    {quote(
                      m,
                      Number(m.metadata.margin_lower) === 0
                        ? "Under 10"
                        : m.metadata.margin_upper == null
                          ? "30+"
                          : `${m.metadata.margin_lower} - ${m.metadata.margin_upper}`,
                    )}
                  </div>
                ))}
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}
interface PlayerIdentity {
  id: string;
  name: string;
  projection: number | null;
  average: number | null;
  team: string;
  position: string;
  game: string;
  kickoff: string | null;
}
function Player({ value, right }: { value: PlayerIdentity; right?: boolean }) {
  return (
    <div className={`duel-player${right ? " right" : ""}`}>
      {/^\d+$/.test(value.id) && (
        <img
          src={`https://sleepercdn.com/content/nfl/players/${value.id}.jpg`}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
      <strong>{value.name}</strong>
      <span>
        {value.position} · {value.team || "—"}
      </span>
      <div className="duel-stat">
        <span>
          Model projection <b>{displayProjection(value.projection)}</b>
        </span>
        <span>
          Average <b>{value.average?.toFixed(1) ?? "—"}</b>
        </span>
      </div>
      <small>{formatGameInfo(value.game, value.kickoff)}</small>
    </div>
  );
}
export function HeadToHead({
  groups,
  selected,
  onSelect,
  data,
  quote,
}: {
  groups: Market[][];
  selected: string;
  onSelect: (value: string) => void;
  data: AccountData;
  quote: Quote;
}) {
  const group = groups.find((g) => g[0].matchup_key === selected) ?? [],
    match = group[0];
  const team = (id: string | null) => data.teams.find((t) => t.id === id);
  const duels = group
    .filter((m) => m.kind === "player_h2h" && m.side === "home")
    .sort(
      (a, b) => Number(a.metadata.slot_index) - Number(b.metadata.slot_index),
    );
  return (
    <section className="head-to-head">
      <label className="matchup-picker">
        Matchup
        <select value={selected} onChange={(e) => onSelect(e.target.value)}>
          {groups.map((g) => (
            <option key={g[0].matchup_key} value={g[0].matchup_key ?? ""}>
              {team(g[0].home_team_id)?.team_name} vs.{" "}
              {team(g[0].away_team_id)?.team_name}
            </option>
          ))}
        </select>
      </label>
      {match && (
        <div className="duel-team-header">
          {[match.home_team_id, match.away_team_id].map((id, i) => {
            const t = team(id);
            return (
              <div className={i ? "right" : ""} key={id}>
                {t?.avatar_url && <img src={t.avatar_url} alt="" />}
                <strong>
                  {t?.team_name}{" "}
                  <span className="team-record">
                    ({t?.wins}–{t?.losses}
                    {t?.ties ? `–${t.ties}` : ""})
                  </span>
                </strong>
                <span>
                  {data.memberships.find((m) => m.team_id === id)
                    ?.display_name ?? t?.sportsbook_owner_name}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className="duel-help">
        Same starting slot, player vs. player. Ties or either player not playing
        push the leg. Bet one duel as a single, or combine picks from different
        fantasy matchups.
      </p>
      {!duels.length && (
        <p>
          Head-to-head lines will appear after Player Points is regenerated and
          published.
        </p>
      )}
      {duels.map((m) => (
        <article className="duel-row" key={m.market_key}>
          {Boolean(m.metadata.lineup_locked) && (
            <p className="duel-unavailable">
              Unavailable: both starting slots need an eligible player,
              projection, and confirmed game time.
            </p>
          )}
          <div className="duel-side duel-left">
            <Player
              value={m.metadata.left_player as unknown as PlayerIdentity}
            />
          </div>
          <div className="duel-choice duel-choice-left">
            {quote(m, "Score More")}
            <small className="duel-price">{formatOdds(m.odds)}</small>
          </div>
          <div className="duel-slot">
            {String(m.metadata.slot).replaceAll("_", " ")}
            <small>vs.</small>
          </div>
          <div className="duel-choice duel-choice-right">
            {quote(
              group.find(
                (q) => q.market_key === m.market_key && q.side === "away",
              ),
              "Score More",
            )}
            <small className="duel-price">
              {formatOdds(
                group.find(
                  (q) => q.market_key === m.market_key && q.side === "away",
                )?.odds ?? 0,
              )}
            </small>
          </div>
          <div className="duel-side duel-right">
            <Player
              value={m.metadata.right_player as unknown as PlayerIdentity}
              right
            />
          </div>
        </article>
      ))}
    </section>
  );
}
