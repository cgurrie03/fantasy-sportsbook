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
    for (const width of [390, 1440])
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
          .locator(".extra-market")
          .filter({ hasText: "Milestones" })
          .first()
          .locator("summary")
          .click();
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
