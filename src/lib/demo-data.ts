import type { AccountData, Team } from "./accounts";
import type { Board, Market } from "./markets";
const league = "demo-league";
export const demoTeams: Team[] = [
  "North Stars",
  "Coastal Comets",
  "Summit Owls",
  "River Foxes",
].map((name, i) => ({
  id: `demo-team-${i}`,
  league_id: league,
  roster_id: i + 1,
  team_name: name,
  sportsbook_owner_id: `demo-owner-${i}`,
  sportsbook_owner_name: ["Avery", "Jordan", "Casey", "Morgan"][i],
  co_owner_names: [],
  avatar_url: null,
  wins: 3 - i,
  losses: i,
  ties: 0,
}));
export const demoMemberships = demoTeams.map((t, i) => ({
  id: `demo-member-${i}`,
  league_id: league,
  team_id: t.id,
  user_id: `demo-user-${i}`,
  invited_email: "",
  display_name: t.sportsbook_owner_name,
  role: "member" as const,
}));
export const demoBoard: Board = {
  id: "demo-board",
  league_id: league,
  market_week: 6,
  nfl_season: 2026,
  league_season: 1,
  status: "published",
  revision: 1,
  opens_at: "2026-10-14T12:00:00Z",
  closes_at: "2026-10-18T16:00:00Z",
  board_type: "weekly",
};
export const demoMarkets: Market[] = [];
for (let pair = 0; pair < 2; pair++) {
  const home = demoTeams[pair * 2],
    away = demoTeams[pair * 2 + 1],
    key = `demo-match-${pair}`;
  for (const [i, t] of [home, away].entries())
    for (const kind of [
      "spread",
      "moneyline",
      "match_total",
      "team_total",
    ] as const) {
      demoMarkets.push({
        id: `${key}-${kind}-${i}`,
        board_id: demoBoard.id,
        market_key: `${key}-${kind}`,
        matchup_key: key,
        kind,
        label: `${kind === "match_total" ? "Match total" : t.team_name} ${kind === "moneyline" ? "to win" : kind === "spread" ? (i ? "+4.5" : "-4.5") : i ? "Under" : "Over"}`,
        subject: t.team_name,
        side: kind.includes("total")
          ? i
            ? "under"
            : "over"
          : i
            ? "away"
            : "home",
        line:
          kind === "moneyline"
            ? null
            : kind === "spread"
              ? i
                ? 4.5
                : -4.5
              : kind === "team_total"
                ? 130.5
                : 265.5,
        odds: kind === "moneyline" ? (i ? 140 : -140) : -110,
        boost_pct: pair === 0 && kind === "moneyline" ? 25 : 0,
        team_id: kind === "match_total" ? null : t.id,
        home_team_id: home.id,
        away_team_id: away.id,
        home_projection: 135.2,
        away_projection: 130.7,
        featured: pair === 0 ? "Game of the Week" : "",
        metadata: { generated_at: "2026-10-16T14:00:00Z", demo: true },
        active: true,
      });
    }
  for (let player = 0; player < 2; player++)
    for (const side of ["over", "under"]) {
      demoMarkets.push({
        ...demoMarkets.find(
          (m) => m.matchup_key === key && m.kind === "spread",
        )!,
        id: `demo-player-${pair}-${player}-${side}`,
        market_key: `demo-player-${pair}-${player}`,
        kind: "player_points",
        label: `Demo ${player ? "receiver" : "quarterback"} ${side} 20.5`,
        subject: `Demo ${player ? "receiver" : "quarterback"}`,
        side,
        line: 20.5,
        odds: -110,
        boost_pct: 0,
        featured: "",
        metadata: {
          position: player ? "WR" : "QB",
          nfl_team: "BUF",
          projection: 21.1,
          expected_points: 21.1,
          season_average: 19.8,
          game_info: "2026-10-18 vs. NE",
          cutoff_at: "2026-10-18T17:00:00Z",
          player_id: `demo-player-${pair}-${player}`,
        },
      });
    }
}
export const demoData: AccountData = {
  leagues: [
    {
      id: league,
      name: "Demo Fantasy League",
      league_season: 1,
      nfl_season: 2026,
      avatar_url: null,
      operations_enabled: false,
    },
  ],
  teams: demoTeams,
  memberships: demoMemberships,
  wallets: demoTeams.map((t, i) => ({ team_id: t.id, balance: 100 + i * 25 })),
  events: [],
  ledger: [],
  tickets: [
    {
      id: "demo-ticket-1",
      league_id: league,
      team_id: demoTeams[0].id,
      nfl_season: 2026,
      legacy_ticket_id: null,
      placement_week: 5,
      market_week: 5,
      placed_at: "2026-10-10T15:00:00Z",
      settled_at: "2026-10-13T08:00:00Z",
      stake: 25,
      accepted_combined_odds: 264,
      accepted_potential_payout: 91,
      actual_payout: 91,
      status: "WON",
    },
  ],
  legs: [
    {
      id: "demo-leg-1",
      ticket_id: "demo-ticket-1",
      leg_number: 1,
      selection: "North Stars to win",
      market_type: "Moneyline",
      matchup: "North Stars vs. Coastal Comets",
      status: "WON",
    },
    {
      id: "demo-leg-2",
      ticket_id: "demo-ticket-1",
      leg_number: 2,
      selection: "River Foxes Over 120.5",
      market_type: "Team Total",
      matchup: "River Foxes vs. Summit Owls",
      status: "WON",
    },
  ],
};
