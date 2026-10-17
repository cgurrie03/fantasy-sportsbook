const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { setup, A, B, teams } = require("./test-ux.cjs");
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [390, 1280]) {
      const f = await setup(browser, width, 844),
        p = f.page;
      f.state.scoreRows = [
        {
          league_id: A,
          nfl_season: 2026,
          market_week: 5,
          fetched_at: new Date().toISOString(),
          cadence_minutes: 120,
          payload: {
            teams: { [teams[0].id]: 0, [teams[1].id]: 18.25 },
            players: {},
          },
        },
      ];
      f.state.tickets = Array.from({ length: 31 }, (_, i) => ({
        id: "audit-ticket-" + String(i).padStart(2, "0"),
        league_id: A,
        team_id: teams[0].id,
        nfl_season: 2026,
        ticket_type: i === 0 ? "future" : "standard",
        placement_week: 5,
        market_week: i === 0 ? 1 : 5,
        placed_at: new Date(Date.now() - i * 60000).toISOString(),
        settled_at: null,
        stake: 10,
        accepted_combined_odds: 264,
        accepted_potential_payout: 36.4,
        actual_payout: 0,
        status: "OPEN",
      }));
      f.state.legs = f.state.tickets.map((t, i) => ({
        id: "audit-leg-" + i,
        ticket_id: t.id,
        leg_number: 1,
        selection:
          i === 0
            ? "Demo team to make playoffs"
            : "Receiver " + i + " over 19.5",
        market_type: i === 0 ? "Make / Miss Playoffs" : "Player Points",
        matchup: "Fixture game",
        status: "OPEN",
      }));
      await p.reload();
      await p.getByText("Current score: 0.00", { exact: true }).waitFor();
      await p.getByText("Current score: 18.25", { exact: true }).waitFor();
      for (const b of await p.locator(".market-quote:not(:disabled)").all()) {
        const name = await b.getAttribute("aria-label"),
          price = (await b.locator(".quote-price").innerText())
            .trim()
            .split(/\s+/)
            .at(-1);
        assert(name.includes(price));
      }
      await p.getByRole("link", { name: "My Bets", exact: true }).click();
      assert(p.url().endsWith("#/bets"));
      await p.reload();
      await p.getByLabel("Search tickets").waitFor();
      assert(p.url().endsWith("#/bets"));
      assert.equal(await p.locator("details.history-ticket").count(), 20);
      await p.getByRole("button", { name: "Filters", exact: true }).click();
      assert.equal(await p.getByLabel("Bettor", { exact: true }).count(), 0);
      await p
        .getByRole("button", { name: "Compact view", exact: true })
        .click();
      assert(await p.locator(".ticket-results.compact").isVisible());
      await p.getByRole("button", { name: "Show 20 more tickets" }).click();
      assert.equal(await p.locator("details.history-ticket").count(), 31);
      await p.getByLabel("Search tickets").fill("audit-ticket-25");
      assert.equal(await p.locator("details.history-ticket").count(), 1);
      await p.goto("http://127.0.0.1:5185/#/bets?ticket=audit-ticket-00");
      await p.locator("details.history-ticket[open]").waitFor();
      assert.match(
        await p.locator("details.history-ticket").innerText(),
        /Season futures/,
      );
      await p.getByRole("link", { name: "Home", exact: true }).click();
      await p.goBack();
      assert(p.url().includes("ticket=audit-ticket-00"));
      await p.goForward();
      assert(p.url().endsWith("#/home"));
      await p.goto("http://127.0.0.1:5185/#/account");
      await p
        .getByRole("heading", { name: "Balance History", exact: true })
        .waitFor();
      assert.equal(
        await p
          .getByRole("heading", { name: "Balance History" })
          .getAttribute("aria-level"),
        null,
      );
      assert.equal(
        await p.locator("h2").filter({ hasText: "Balance History" }).count(),
        1,
      );
      await p.getByLabel("League", { exact: true }).selectOption(B);
      await p.goto("http://127.0.0.1:5185/#/admin/reopening");
      await p.getByRole("heading", { name: "Admin access required" }).waitFor();
      assert.equal(await p.locator("summary button").count(), 0);
      assert.deepEqual(f.errors, []);
      await f.context.close();
    }
    const coverage = await setup(browser, 1280, 844);
    let reportCalls = 0;
    let releaseForecast;
    const forecastGate = new Promise((resolve) => {
      releaseForecast = resolve;
    });
    await coverage.context.route(
      "**/rest/v1/forecast_snapshots*",
      async (route) => {
        await forecastGate;
        return route.fulfill({ contentType: "application/json", body: "[]" });
      },
    );
    const cached = [1, 2, 3, 4].map((market_week) => ({
      nfl_season: 2026,
      market_week,
      final: true,
      fetched_at: new Date().toISOString(),
      results: {},
    }));
    await coverage.context.route("**/rest/v1/league_result_weeks*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(cached),
      }),
    );
    await coverage.context.route("**/rest/v1/rpc/sportsbook_period", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([{ week: 6, league_season: 3, nfl_season: 2026 }]),
      }),
    );
    await coverage.context.route("**/api/report-results", (route) => {
      reportCalls++;
      cached.push({ ...cached[0], market_week: 5 });
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ refreshed: [5], remaining: 0 }),
      });
    });
    await coverage.page.goto("http://127.0.0.1:5185/#/admin/reports");
    await coverage.page
      .getByText("Source coverage: through completed Week 5", { exact: true })
      .waitFor();
    releaseForecast();
    assert.equal(
      reportCalls,
      1,
      "a completely absent Week 5 must trigger backfill even if Weeks 1-4 are final",
    );
    assert.deepEqual(coverage.errors, []);
    await coverage.context.close();
    const f = await setup(browser, 390, 844, false),
      p = f.page;
    await p.goto(
      "http://127.0.0.1:5185/#error=access_denied&error_code=otp_expired",
    );
    await p.reload();
    await p
      .getByRole("alert")
      .filter({ hasText: /invalid, expired, or already used/ })
      .waitFor();
    assert.match(await p.locator(".signin-card").innerText(), /60 minutes/);
    await p.getByRole("link", { name: "Explore the read-only demo" }).click();
    await p
      .getByText(/All names, scores, balances, and tickets here are fictional/)
      .waitFor();
    await p.getByRole("button", { name: "My Bets", exact: true }).click();
    await p.locator("details.history-ticket").waitFor();
    assert.equal(f.state.betCalls, 0);
    assert.equal(await p.locator("summary button").count(), 0);
    assert.deepEqual(f.errors, []);
    await f.context.close();
    console.log(
      "Passed mobile/desktop score zero and current values, price/name agreement, reload/back/forward, personal search/compact/31-ticket paging, exact-ticket links/futures labels, headings, member admin-route refusal, fresh invalid-link recovery and synthetic read-only demo.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
