const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { setup, A, boards, quotes } = require("./test-ux.cjs");
const output = path.resolve("work/extra-markets-ux");
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [320, 390, 768, 1440])
      for (const theme of ["dark", "light"]) {
        const f = await setup(browser, width, 1000),
          board = boards.find((b) => b.league_id === A),
          base = quotes(board).find((q) => q.kind === "spread");
        const identity = (id, name) => ({
          id,
          name,
          projection: 20,
          average: 18,
          team: "BUF",
          position: "QB",
          game: "2030-10-10T17:00:00Z vs. ATL",
          kickoff: "2030-10-10T17:00:00Z",
        });
        const duel = [1, 2].flatMap((index) =>
          ["home", "away"].map((side) => ({
            ...base,
            id: `duel-${index}-${side}`,
            kind: "player_h2h",
            side,
            market_key: `duel-${index}`,
            matchup_key: index === 1 ? base.matchup_key : "second-match",
            label: `Player ${index}${side} to score more`,
            subject: `Player ${index}${side}`,
            line: null,
            odds: 110,
            metadata: {
              left_player: identity("p" + index, `Left Starter ${index}`),
              right_player: identity("q" + index, `Right Starter ${index}`),
              player_id: "p" + index,
              opponent_player_id: "q" + index,
              slot: "SUPER_FLEX",
              slot_index: 0,
              lineup_locked: false,
            },
          })),
        );
        const advanced = [
          ...quotes(board),
          {
            ...base,
            id: "second-spread",
            matchup_key: "second-match",
            market_key: "second-spread",
          },
          ...duel,
          ...[125, 150, 175, 200].map((line) => ({
            ...base,
            id: "ladder" + line,
            market_key: "ladder" + line,
            kind: "team_milestone",
            side: "at_least",
            line,
            label: `Team ${line}+`,
            metadata: {},
          })),
          ...[0, 10, 20, 30].map((lo) => ({
            ...base,
            id: "margin" + lo,
            kind: "winning_margin",
            market_key: "margin",
            side: String(lo),
            line: null,
            odds: 300,
            metadata: {
              margin_lower: lo,
              margin_upper: lo === 30 ? null : lo + 10,
            },
          })),
        ];
        for (const market of advanced.filter((m) =>
          ["team_milestone", "winning_margin"].includes(m.kind),
        ))
          advanced.push({
            ...market,
            id: market.id + "-away",
            team_id: base.away_team_id,
          });
        for (const team_id of [base.home_team_id, base.away_team_id])
          for (const side of ["over", "under"])
            advanced.push({
              ...base,
              id: `total-${team_id}-${side}`,
              kind: "team_total",
              team_id,
              side,
              line: 125.5,
              metadata: {},
            });
        await f.context.route(
          "**/rest/v1/rpc/sportsbook_current_snapshot",
          (route) =>
            route.fulfill({ json: { week: 5, board, markets: advanced } }),
        );
        await f.page.reload();
        await f.page.waitForLoadState("networkidle");
        await f.page.evaluate(
          (t) => (document.documentElement.dataset.theme = t),
          theme,
        );
        await f.page
          .getByRole("button", { name: "Head to Head", exact: true })
          .click();
        assert.equal(await f.page.locator(".duel-row").count(), 1);
        assert.equal(
          await f.page.locator(".head-to-head select").inputValue(),
          base.matchup_key,
        );
        assert.match(
          await f.page.locator(".duel-row").innerText(),
          /Left Starter 1/,
        );
        assert(
          !/Left Starter 2/.test(
            await f.page.locator(".head-to-head").innerText(),
          ),
        );
        await f.page
          .locator(".head-to-head select")
          .selectOption("second-match");
        assert.match(
          await f.page.locator(".duel-row").innerText(),
          /Left Starter 2/,
        );
        await f.page.screenshot({
          path: path.join(output, `duels-${width}-${theme}.png`),
          fullPage: true,
        });
        assert(
          await f.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await f.page
          .getByRole("button", { name: "Matchups", exact: true })
          .click();
        await f.page
          .locator(".extra-market")
          .filter({ hasText: "Winning Margin" })
          .first()
          .locator("summary")
          .click();
        await f.page
          .locator(".team-totals")
          .filter({
            has: f.page.locator("summary", { hasText: "Team Totals" }),
          })
          .first()
          .locator("summary")
          .click();
        await f.page
          .locator(".extra-market")
          .filter({ hasText: "Milestones" })
          .first()
          .locator("summary")
          .click();
        for (const grid of await f.page.locator(".extra-team-grid").all()) {
          const rows = await grid.locator(".margin-team").all();
          assert.equal(rows.length, 2);
          const first = await rows[0].boundingBox(),
            second = await rows[1].boundingBox();
          assert(
            second.y >= first.y + first.height,
            "Each team gets its own row",
          );
          for (const row of rows) {
            const buttons = await row.locator(".market-quote").all();
            assert.equal(buttons.length, 4);
            const positions = await Promise.all(
              buttons.map(async (b) => (await b.boundingBox()).y),
            );
            assert(
              Math.max(...positions) - Math.min(...positions) < 2,
              "All four options fit a single line",
            );
            assert.equal(
              await row.locator("small").count(),
              0,
              "No duplicate odds below buttons",
            );
          }
        }
        for (const quote of await f.page
          .locator(".team-totals[open] .market-quote")
          .all()) {
          assert.equal(await quote.locator(".quote-price").count(), 1);
          const styles = await quote.evaluate((el) => ({
            line: getComputedStyle(el.querySelector("strong")).fontWeight,
            odds: getComputedStyle(el.querySelector(".quote-price")).fontWeight,
          }));
          assert.notEqual(styles.line, styles.odds);
        }
        assert.equal(await f.page.locator(".matchup-toolbar").count(), 0);
        const link = f.page.locator(".sleeper-matchup-link").first();
        assert.equal(
          await link.locator("svg").getAttribute("fill"),
          "currentColor",
        );
        assert.equal(
          await link.evaluate(
            (el) =>
              el.closest(".matchup-card-tools") ===
              document.querySelector(".matchup-card-tools"),
          ),
          true,
        );
        assert.match(
          await f.page
            .locator(".match-team > div > strong")
            .first()
            .innerText(),
          /\(3–1\)/,
        );
        assert(
          await f.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await f.page.screenshot({
          path: path.join(output, `ladders-${width}-${theme}.png`),
          fullPage: true,
        });
        assert.deepEqual(f.errors, []);
        assert.equal(f.state.betCalls, 0);
        await f.context.close();
      }
    console.log(
      "Passed single-matchup Head to Head, default user matchup, dropdown switching, mobile/desktop light/dark layouts and expandable milestones/margin markets. No production transactions.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
