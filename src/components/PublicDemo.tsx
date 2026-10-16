import { PortfolioLink } from "./PortfolioLink";
import { Sportsbook } from "./Sportsbook";
import {
  demoBoard,
  demoMarkets,
  demoData,
  demoMemberships,
} from "../lib/demo-data";
import "../App.css";
export function PublicDemo() {
  return (
    <div className="app-shell">
      <header className="masthead">
        <div>
          <strong>Fantasy Sportsbook</strong>
          <p>Synthetic league demo</p>
        </div>
        <div>
          <a href="#/home">Member sign-in</a>
          <PortfolioLink />
        </div>
      </header>
      <p className="review-notice">
        All names, scores, balances, and tickets here are fictional. This demo
        cannot place bets, change accounts, or send emails.
      </p>
      <Sportsbook
        data={demoData}
        member={demoMemberships[0]}
        refresh={async () => {}}
        review={{
          board: demoBoard,
          markets: demoMarkets,
          standings: demoData.teams.map((t, i) => ({
            team_id: t.id,
            bets_placed: i ? 0 : 1,
            bets_won: i ? 0 : 1,
            bets_lost: 0,
            bets_push: 0,
            total_wagered: i ? 0 : 25,
            total_payout: i ? 0 : 91,
            net_profit: i ? 0 : 66,
            roi: i ? 0 : 264,
            win_percentage: i ? 0 : 100,
            biggest_parlay_legs: i ? 0 : 2,
            biggest_parlay_odds: i ? 0 : 264,
            biggest_payout: i ? 0 : 91,
            current_balance: 100 + i * 25,
          })),
        }}
      />
    </div>
  );
}
