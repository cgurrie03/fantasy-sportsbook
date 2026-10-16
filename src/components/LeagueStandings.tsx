import { Fragment, useState } from "react";
import type { AccountData } from "../lib/accounts";
import { money } from "../lib/accounts";
import type { Standing } from "./Sportsbook";
export function LeagueStandings({
  data,
  standings,
  owner,
}: {
  data: AccountData;
  standings: Standing[];
  owner: (id: string) => string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="standings-scroll">
      <table className="accessible-standings">
        <caption>
          Ranked by settled net profit, balance, then bets placed. Expand a
          member for statistics.
        </caption>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Net profit</th>
            <th scope="col">Balance</th>
            <th scope="col">Bets</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s, i) => {
            const open = (data.tickets ?? [])
              .filter((t) => t.team_id === s.team_id && t.status === "OPEN")
              .reduce((n, t) => n + Number(t.stake), 0);
            const complete = !data.history_error && !data.history_loading;
            const settled = Number(s.total_wagered) - open;
            return (
              <Fragment key={s.team_id}>
                <tr>
                  <th scope="row">
                    <button
                      className="standing-expand"
                      aria-expanded={expanded === s.team_id}
                      aria-controls={`standing-${s.team_id}`}
                      onClick={() =>
                        setExpanded(expanded === s.team_id ? null : s.team_id)
                      }
                    >
                      {i + 1}. {owner(s.team_id)}
                      <small>
                        {data.teams.find((t) => t.id === s.team_id)?.team_name}
                      </small>
                    </button>
                  </th>
                  <td
                    className={
                      Number(s.net_profit) >= 0
                        ? "profit-positive"
                        : "profit-negative"
                    }
                  >
                    {money(s.net_profit)}
                  </td>
                  <td>{money(s.current_balance)}</td>
                  <td>{s.bets_placed}</td>
                </tr>
                <tr hidden={expanded !== s.team_id}>
                  <td colSpan={4}>
                    <section
                      id={`standing-${s.team_id}`}
                      role="region"
                      aria-label={`${owner(s.team_id)} statistics`}
                    >
                      <dl className="standing-metrics">
                        {[
                          [
                            "Won / lost / push",
                            `${s.bets_won} / ${s.bets_lost} / ${s.bets_push}`,
                          ],
                          ["Settled net profit", money(s.net_profit)],
                          [
                            "Settled stake",
                            complete ? money(settled) : "History unavailable",
                          ],
                          [
                            "Open stakes",
                            complete ? money(open) : "History unavailable",
                          ],
                          ["All wagered stakes", money(s.total_wagered)],
                          [
                            "Total return including stake",
                            money(s.total_payout),
                          ],
                          [
                            "Return on settled stakes",
                            `${Number(s.roi).toFixed(1)}%`,
                          ],
                          [
                            "Win rate",
                            `${Number(s.win_percentage).toFixed(1)}%`,
                          ],
                          ["Largest return", money(s.biggest_payout)],
                          [
                            "Longest winning parlay",
                            `${s.biggest_parlay_legs} picks`,
                          ],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className="history-note">
                        ROI = settled net profit ÷ settled stake. Open stakes
                        and replenishments are excluded. A return includes the
                        original stake.
                      </p>
                    </section>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
