// Local fixtures only: exercise member display plus the complete admin save payload.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { setup, A, boards, quotes, teams } = require("./test-ux.cjs");
const fs = require("node:fs");
const path = require("node:path");
const output = path.resolve(
  process.env.FEATURED_OUTPUT || "work/featured-cards",
);
fs.mkdirSync(output, { recursive: true });
const board = boards.find((b) => b.league_id === A);
const leagueTeams = Array.from({ length: 6 }, (_, i) => ({
  ...teams[i % 2],
  league_id: A,
  id: `aaaaaaaa-0000-4000-8000-00000000000${i + 1}`,
  roster_id: i + 1,
  team_name:
    i < 2
      ? teams[i].team_name
      : ["Kis Emeka", "Thank you josh allen", "Short", "A normal team name"][
          i - 2
        ],
}));
const full = Array.from({ length: 3 }, (_, index) =>
  quotes(board).map((quote, i) => {
    const home = leagueTeams[index * 2],
      away = leagueTeams[index * 2 + 1];
    const isHome = i % 2 === 0;
    const featured = ["Game of the Week", "Tank Bowl", ""][index];
    return {
      ...quote,
      id: `match-${index}-${i}`,
      market_key: `match-${index}:${quote.kind}`,
      matchup_key: `match-${index}`,
      home_team_id: home.id,
      away_team_id: away.id,
      team_id: quote.team_id ? (isHome ? home.id : away.id) : null,
      side: quote.team_id ? (isHome ? home.id : away.id) : quote.side,
      label: quote.team_id
        ? isHome
          ? home.team_name
          : away.team_name
        : quote.label,
      featured,
      boost_pct:
        (featured && quote.kind === "moneyline") ||
        (featured === "Tank Bowl" &&
          quote.kind === "match_total" &&
          quote.side === "over")
          ? 25
          : 0,
      metadata: { settlement_marker: "retain-complete-record" },
    };
  }),
).flat();
full.push({
  ...full[0],
  id: "duel",
  kind: "player_h2h",
  market_key: "duel",
  side: "home",
  line: null,
  boost_pct: 0,
  metadata: {
    player_id: "player-a",
    opponent_player_id: "player-b",
    slot: "QB",
    slot_index: 0,
    settlement_marker: "retain-complete-record",
  },
});
const compact = full.map((quote) => ({
  ...quote,
  metadata: {
    ...quote.metadata,
    opponent_player_id: undefined,
    settlement_marker: undefined,
  },
}));

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [320, 390, 768, 1440]) {
      const f = await setup(browser, width, 1000),
        p = f.page;
      let saved = null;
      await p.route("**/rest/v1/teams**", (route) =>
        route.fulfill({
          json: [...leagueTeams, ...teams.filter((t) => t.league_id !== A)],
        }),
      );
      await p.route("**/rest/v1/rpc/sportsbook_current_snapshot", (route) => {
        const body = route.request().postDataJSON();
        return body.p_league === A && body.p_type === "weekly"
          ? route.fulfill({ json: { week: 5, board, markets: compact } })
          : route.fallback();
      });
      await p.route("**/rest/v1/rpc/sportsbook_quote_snapshot", (route) =>
        route.fulfill({ json: { board, markets: full } }),
      );
      await p.route("**/rest/v1/rpc/save_market_board", (route) => {
        saved = route.request().postDataJSON();
        assert.equal(
          saved.p_quotes.find((q) => q.kind === "player_h2h").metadata
            .opponent_player_id,
          "player-b",
        );
        assert(
          saved.p_quotes.every(
            (q) => q.metadata.settlement_marker === "retain-complete-record",
          ),
        );
        return route.fulfill({ json: board.id });
      });
      await p.reload();
      await p.locator(".matchup-card").nth(2).waitFor();
      await p.waitForLoadState("networkidle");
      for (const theme of ["dark", "light"]) {
        await p.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        const geometry = await p.locator(".matchup-card").evaluateAll((cards) =>
          cards.map((card) => {
            const rect = card.getBoundingClientRect();
            return {
              height: rect.height,
              width: rect.width,
              grid:
                card.querySelector(".match-grid").getBoundingClientRect().top -
                rect.top,
              footer:
                card.querySelector(".projections-link").getBoundingClientRect()
                  .top - rect.top,
              teams: [...card.querySelectorAll(".match-team")].map(
                (team) => team.getBoundingClientRect().top - rect.top,
              ),
            };
          }),
        );
        for (const key of ["height", "width", "grid", "footer"])
          assert(
            Math.max(...geometry.map((g) => g[key])) -
              Math.min(...geometry.map((g) => g[key])) <
              2,
            `${key} differs at ${width}px`,
          );
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        assert.equal(await p.locator(".board-dates").count(), 0);
        assert.match(
          await p.locator(".board-window").innerText(),
          /15 min during games/,
        );
      }
      await p.evaluate(() => (document.documentElement.dataset.theme = "dark"));
      if (width === 390 || width === 1440)
        await p.screenshot({
          path: path.join(output, `equal-cards-${width}.png`),
          fullPage: true,
        });
      if (width === 1440) {
        await p.goto("http://127.0.0.1:5185/#/admin/lines");
        await p.getByLabel("Featured Matchup").nth(2).waitFor();
        await p.getByLabel("Featured Matchup").nth(2).selectOption("Tank Bowl");
        await p
          .getByRole("button", { name: "Publish Board", exact: true })
          .click();
        await p.waitForFunction(() =>
          document
            .querySelector(".market-admin-notice")
            ?.textContent.includes("Market board published"),
        );
        assert(saved, "Admin must save through the complete-record path");
        assert.equal(
          saved.p_quotes.find(
            (q) => q.matchup_key === "match-2" && q.kind === "moneyline",
          ).boost_pct,
          25,
        );
        assert.equal(
          saved.p_quotes.find(
            (q) =>
              q.matchup_key === "match-2" &&
              q.kind === "match_total" &&
              q.side === "over",
          ).boost_pct,
          25,
        );
        assert.equal(
          saved.p_quotes.find(
            (q) => q.matchup_key === "match-2" && q.kind === "spread",
          ).boost_pct,
          0,
        );
      }
      assert.deepEqual(f.errors, []);
      await f.context.close();
      console.log(
        `Equal featured/plain cards and refresh header pass at ${width}px`,
      );
    }
    console.log(
      "Tank Bowl save preserves head-to-head opponent identity and complete settlement metadata.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
