import fs from "node:fs";
import React from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
import { displayNames } from "./display-names.mjs";
const read = (name) =>
  JSON.parse(
    fs
      .readFileSync(new URL("../../outputs/" + name, import.meta.url), "utf8")
      .replace(/^\uFEFF/, ""),
  );
const source = read("sleeper-league-stage1.json"),
  approved = read("week3-import-prepared.json");
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { Account, Admin } = await server.ssrLoadModule("/src/App.tsx");
  const leagueId = "review-league";
  const teams = source.rosters.map((r) => {
    const user = source.users.find((u) => u.user_id === r.owner_id),
      mapping = approved.mappings.find((u) => u.roster_id === r.roster_id);
    return {
      id: "review-" + r.roster_id,
      league_id: leagueId,
      roster_id: r.roster_id,
      team_name: user.metadata?.team_name?.trim() || user.display_name,
      sportsbook_owner_id: mapping.sleeper_user_id,
      sportsbook_owner_name: mapping.sleeper_username,
      co_owner_names: r.co_owners?.length ? ["nellyknowsball"] : [],
      avatar_url:
        user.metadata?.avatar ||
        (user.avatar ? "https://sleepercdn.com/avatars/" + user.avatar : null),
      wins: r.settings.wins,
      losses: r.settings.losses,
      ties: r.settings.ties,
    };
  });
  const memberships = approved.mappings.map((u) => ({
    id: "member-" + u.roster_id,
    league_id: leagueId,
    team_id: "review-" + u.roster_id,
    user_id: null,
    invited_email: u.email,
    display_name: displayNames[u.roster_id],
    role: u.role,
  }));
  const data = {
    leagues: [],
    teams,
    memberships,
    wallets: approved.mappings.map((u) => ({
      team_id: "review-" + u.roster_id,
      balance: u.proposed_week5_balance_cents / 100,
    })),
    events: [],
    tickets: approved.tickets.map((t) => ({
      id: t.legacy_ticket_id,
      legacy_ticket_id: t.legacy_ticket_id,
      league_id: leagueId,
      team_id:
        "review-" +
        approved.mappings.find((m) => m.legacy_user_id === t.legacy_user_id)
          .roster_id,
      placement_week: 3,
      market_week: 3,
      placed_at: t.placed_at,
      settled_at: approved.prepared_at,
      stake: t.stake_cents / 100,
      actual_payout: t.payout_cents / 100,
      status: t.result,
      accepted_combined_odds: t.accepted_combined_odds,
      ticket_type: "parlay",
      accepted_potential_payout:
        (t.stake_cents / 100) *
        (t.accepted_combined_odds > 0
          ? 1 + t.accepted_combined_odds / 100
          : 1 + 100 / Math.abs(t.accepted_combined_odds)),
    })),
    legs: approved.tickets.flatMap((t) =>
      t.legs.map((l, i) => ({
        id: t.legacy_ticket_id + "-" + i,
        ticket_id: t.legacy_ticket_id,
        leg_number: i + 1,
        selection: l.selection,
        market_type: l.type,
        actual_value: l.actual_value,
        matchup: l.matchup,
        status: l.result,
      })),
    ),
    ledger: [
      {
        id: "sample-history",
        team_id: "review-1",
        reason: "Week 3 Winning Tickets",
        balance_before: 0,
        balance_after: 259,
        created_at: "2026-10-05T23:00:00Z",
        kind: "settlement",
      },
    ],
  };
  for (const [view, element] of [
    [
      "account",
      React.createElement(Account, {
        data,
        member: memberships[0],
        team: teams[0],
      }),
    ],
    [
      "admin",
      React.createElement(Admin, {
        data,
        leagueId,
        reviewMode: true,
        refresh: async () => {
          throw new Error("Static Review Only");
        },
      }),
    ],
    ...[
      "users",
      "tickets",
      "logs",
      "lines",
      "promos",
      "approvals",
      "schedule",
      "emails",
      "settings",
    ].map((category) => [
      "admin-" + category,
      React.createElement(Admin, {
        data,
        leagueId,
        initialCategory: category,
        reviewMode: true,
        refresh: async () => {
          throw new Error("Static review only");
        },
      }),
    ]),
  ]) {
    const markup = renderToString(element);
    const category = view.startsWith("admin-") ? view.slice(6) : "";
    const disabled = view === "account" || category === "users";
    const payload = JSON.stringify({
      data,
      leagueId,
      view,
      category,
    }).replaceAll("<", "\\u003c");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stage 1 ${view} Layout Review</title><link rel="stylesheet" href="/src/index.css"><link rel="stylesheet" href="/src/App.css"></head><body><div class="app-shell"><header class="masthead"><div class="brand"><div><strong>Goldy Plays Pretend With Men</strong><span>Fantasy Sportsbook</span></div></div><div class="account-tools"><button class="theme-toggle" id="review-theme" aria-label="Switch to light mode">☀</button><div class="profile"><span class="avatar">C</span>Cooper Gurrie</div></div></header><nav class="account-nav"><a href="/stage1-account-review.html">Account</a><a href="/stage1-admin-review.html">Admin</a></nav><p class="result-count">Local layout review · Account changes disabled</p><fieldset ${disabled ? "disabled" : ""} style="border:0;margin:0;padding:0;min-width:0"><div id="review-root">${markup}</div></fieldset></div><script type="application/json" id="review-data">${payload}</script><script>
      const themeButton = document.getElementById('review-theme');
      function applyTheme(light) { document.documentElement.dataset.theme = light ? 'light' : 'dark'; themeButton.textContent = light ? '☾' : '☀'; themeButton.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode'); localStorage.setItem('goldy-theme', light ? 'light' : 'dark'); }
      applyTheme(localStorage.getItem('goldy-theme') === 'light');
      themeButton.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme !== 'light'));
    </script><script type="module">
      import React from 'react';
      import { hydrateRoot } from 'react-dom/client';
      import { Account, Admin } from '/src/App.tsx';
      const {data, leagueId, view, category} = JSON.parse(document.getElementById('review-data').textContent);
      const element = view === 'account' ? React.createElement(Account, {data,member:data.memberships[0],team:data.teams[0]}) : React.createElement(Admin, {data,leagueId,reviewMode:true,initialCategory:category,refresh:async () => {throw new Error('Review only');}});
      hydrateRoot(document.getElementById('review-root'), element);
    </script></body></html>`;
    fs.writeFileSync(
      new URL("../stage1-" + view + "-review.html", import.meta.url),
      html,
    );
  }
  console.log(
    "Rendered local-only Account and Admin layout reviews using approved mapping and balance examples. These HTML files are excluded from Git and production builds.",
  );
} finally {
  await server.close();
}
