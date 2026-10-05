import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
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
    display_name: u.name,
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
        refresh: async () => {
          throw new Error("Static Review Only");
        },
      }),
    ],
  ]) {
    const markup = renderToStaticMarkup(element);
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stage 1 ${view} Layout Review</title><link rel="stylesheet" href="/src/index.css"><link rel="stylesheet" href="/src/App.css"></head><body><div class="app-shell"><header class="masthead"><div class="brand"><div><strong>Goldy Plays Pretend With Men</strong><span>Fantasy Sportsbook</span></div></div><div class="profile"><span class="avatar">C</span>Cooper</div></header><nav class="account-nav"><a href="/stage1-account-review.html">Account</a><a href="/stage1-admin-review.html">Admin</a></nav><p>Local Layout Review · Controls Are Disabled · No Sign-In Or Balance Changes</p><fieldset disabled style="border:0;margin:0;padding:0;min-width:0">${markup}</fieldset></div></body></html>`;
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
