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
          {standings.some(s=>s.wallet_id) ? "Ranked by settled net profit, then bets placed." : "Ranked by settled net profit, balance, then bets placed."} Expand a member for statistics.
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
            const totals=data.betting_scope?.season===null&&data.betting_scope.week===null?
              data.betting_totals?.find(t=>s.wallet_id?t.wallet_id===s.wallet_id:t.team_id===s.team_id):undefined;
            const key=s.wallet_id??s.team_id,name=s.display_name??owner(s.team_id);
            const open = s.open_stakes??totals?.open??(data.tickets ?? [])
              .filter((t) => t.team_id === s.team_id && t.status === "OPEN")
              .reduce((n, t) => n + Number(t.stake), 0);
            const complete = s.wallet_id ? s.open_stakes!==undefined&&s.settled_stakes!==undefined : data.history_remote?!!totals&&!data.betting_error:!data.history_error&&!data.history_loading;
            const settled = s.settled_stakes??totals?.stake??Number(s.total_wagered) - open;
            return (
              <Fragment key={key}>
                <tr>
                  <th scope="row">
                    <button
                      className="standing-expand"
                      aria-expanded={expanded === key}
                      aria-controls={`standing-${key}`}
                      onClick={() =>
                        setExpanded(expanded === key ? null : key)
                      }
                    >
                      {i + 1}. {name}
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
                  <td>{s.balance_visible === false ? "Private" : money(s.current_balance)}</td>
                  <td>{s.bets_placed}</td>
                </tr>
                <tr hidden={expanded !== key}>
                  <td colSpan={4}>
                    <section
                      id={`standing-${key}`}
                      role="region"
                      aria-label={`${name} statistics`}
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
