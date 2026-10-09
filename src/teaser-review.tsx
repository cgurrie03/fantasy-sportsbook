import { createRoot } from "react-dom/client";
import { Sportsbook } from "./components/Sportsbook";
import type { AccountData, Team } from "./lib/accounts";
import type { Board, Market } from "./lib/markets";
import "./index.css";
import "./App.css";

const teams: Team[] = [
  "The Rebuild",
  "Sunday Scaries",
  "Gridiron Club",
  "Last Place Legends",
  "Bench Mob",
  "Fourth and Long",
].map((team_name, i) => ({
  id: `team${i}`,
  league_id: "review",
  roster_id: i + 1,
  team_name,
  sportsbook_owner_id: `fixture${i}`,
  sportsbook_owner_name: `Member ${i + 1}`,
  co_owner_names: [],
  avatar_url: null,
  wins: 2,
  losses: 2,
  ties: 0,
}));
const board: Board = {
  id: "research-board",
  league_id: "review",
  market_week: 5,
  nfl_season: 2026,
  league_season: 3,
  status: "published",
  phase: "pregame",
  revision: 1,
  opens_at: new Date(Date.now() - 3600000).toISOString(),
  closes_at: new Date(Date.now() + 86400000).toISOString(),
};
const markets: Market[] = teams
  .filter((_, i) => i % 2 === 0)
  .map((t, i) => ({
    id: `fixture-spread${i}`,
    board_id: board.id,
    market_key: `spread${i}`,
    matchup_key: `match${i}`,
    kind: "spread",
    label: `${t.team_name} ${[-8.5, 5.5, 1.5][i]}`,
    subject: t.team_name,
    side: "home",
    line: [-8.5, 5.5, 1.5][i],
    odds: -110,
    boost_pct: 0,
    team_id: t.id,
    home_team_id: t.id,
    away_team_id: teams[2 * i + 1].id,
    home_projection: 150 - [-8.5, 5.5, 1.5][i],
    away_projection: 150,
    featured: "",
    metadata: {},
    active: true,
    market_state: "open",
  }));
const data: AccountData = {
  leagues: [
    {
      id: "review",
      name: "Fantasy teaser research",
      league_season: 3,
      nfl_season: 2026,
      avatar_url: null,
    },
  ],
  teams,
  memberships: teams.map((t, i) => ({
    id: `m${i}`,
    league_id: "review",
    team_id: t.id,
    user_id: null,
    invited_email: "",
    display_name: t.sportsbook_owner_name,
    role: "member",
  })),
  wallets: teams.map((t) => ({ team_id: t.id, balance: 100 })),
  events: [],
  ledger: [],
  tickets: [],
  legs: [],
};
// From research.json's independent three-leg stress scenario; never a published offer.
const teaserPrices = [
  { adjustment: 6, decimal: 5.5, odds: 450 },
  { adjustment: 9, decimal: 4.8, odds: 380 },
  { adjustment: 12, decimal: 4.2, odds: 320 },
];
document.documentElement.dataset.theme = "dark";
createRoot(document.getElementById("root")!).render(
  <div className="app-shell">
    <header className="masthead">
      <div className="brand">
        <div className="avatar">T</div>
        <div>
          <strong>Fantasy teaser research</strong>
          <span>Local fixtures • No bets or emails</span>
        </div>
      </div>
    </header>
    <Sportsbook
      data={data}
      member={data.memberships[0]}
      refresh={async () => {}}
      review={{
        board,
        markets,
        standings: [],
        teaserPrices: new URLSearchParams(location.search).has("unpriced")
          ? undefined
          : teaserPrices,
      }}
    />
  </div>,
);
