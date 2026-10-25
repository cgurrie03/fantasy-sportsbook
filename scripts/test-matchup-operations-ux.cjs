// All auth, data and API requests use the existing isolated localhost fixtures.
const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { setup, A, teams, menu } = require("./test-ux.cjs");
const output = path.resolve(
  process.env.ITERATION_OUTPUT || "work/matchup-operations",
);
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [320, 390, 768, 1440]) {
      const f = await setup(browser, width, 1000),
        p = f.page;
      f.state.scoreRows = [
        {
          league_id: A,
          nfl_season: 2026,
          market_week: 5,
          fetched_at: new Date().toISOString(),
          cadence_minutes: 15,
          payload: {
            teams: { [teams[0].id]: 0, [teams[1].id]: 18.25 },
            players: {},
          },
        },
      ];
      await p.reload();
      await p.waitForLoadState("networkidle");
      assert.equal(
        await p.locator(".board-window .match-score-notice").count(),
        1,
      );
      assert.equal(
        await p.locator(".matchup-card .match-score-notice").count(),
        0,
      );
      assert(
        !/Scores are provisional|Fantasy points under/.test(
          await p.locator("body").innerText(),
        ),
      );
      const dimensions = await p
        .locator(".matchup-card")
        .first()
        .evaluate((card) => {
          const teams = [...card.querySelectorAll(".match-team")];
          return {
            width: innerWidth,
            scroll: document.documentElement.scrollWidth,
            rows: teams.map((team) => {
              const t = team.getBoundingClientRect(),
                buttons = [
                  ...team.parentElement.querySelectorAll(".market-quote"),
                ].map((e) => e.getBoundingClientRect());
              const title = team.querySelector(".match-team-name"),
                style = getComputedStyle(title);
              return {
                center: t.y + t.height / 2,
                buttons: buttons.map((r) => ({
                  center: r.y + r.height / 2,
                  left: r.left,
                })),
                right: t.right,
                nowrap: style.whiteSpace,
                fits:
                  title.scrollWidth <= title.clientWidth + 1 &&
                  title.scrollHeight <= title.clientHeight + 1,
              };
            }),
            link: card
              .querySelector(".sleeper-matchup-link")
              .getBoundingClientRect().top,
            banner: card
              .querySelector(".featured-strip")
              .getBoundingClientRect().bottom,
          };
        });
      assert(dimensions.scroll <= width, `Page overflow at ${width}`);
      for (const row of dimensions.rows) {
        assert.equal(row.nowrap, "normal");
        assert(row.fits, "Full team name must remain visible");
        assert.equal(row.buttons.length, 3);
        for (const b of row.buttons) {
          assert(
            Math.abs(row.center - b.center) < 2,
            `Team and bets split at ${width}`,
          );
          assert(b.left >= row.right - 1);
        }
      }
      assert(
        dimensions.link >= dimensions.banner,
        "Sleeper must be below banner",
      );
      assert.match(
        await p.locator(".board-window .ticket-progress-notice").innerText(),
        /^Last Refresh \d{1,2}:\d{2}[AP]M ET$/,
      );
      const colors = [];
      for (const theme of ["dark", "light"]) {
        await p.evaluate(
          (t) => (document.documentElement.dataset.theme = t),
          theme,
        );
        colors.push(
          await p
            .locator(".sleeper-matchup-icon")
            .first()
            .evaluate((el) => getComputedStyle(el).fill),
        );
      }
      assert.notEqual(colors[0], colors[1], "Icon must adapt to theme");
      await p.evaluate(() => (document.documentElement.dataset.theme = "dark"));
      if (width === 390 || width === 1440)
        await p.screenshot({
          path: path.join(output, `sportsbook-${width}.png`),
          fullPage: true,
        });
      assert.deepEqual(f.errors, []);
      await f.context.close();
    }
    const f = await setup(browser, 390, 1000),
      p = f.page;
    let mode = "slow";
    const now = new Date().toISOString();
    await p.route("**/rest/v1/weekly_schedule*", async (route) => {
      if (mode === "slow") await new Promise((r) => setTimeout(r, 900));
      return route.fulfill({
        status: mode === "fail" ? 503 : 200,
        contentType: "application/json",
        body: JSON.stringify(
          mode === "fail"
            ? { message: "Fixture failure" }
            : {
                automation_enabled: true,
                publication_paused: false,
                job_times: {},
              },
        ),
      });
    });
    await p.route("**/rest/v1/weekly_execution_runs*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          [1, 2].map((i) => ({
            id: "run" + i,
            operation: "replenishment",
            nfl_season: 2026,
            market_week: 7,
            created_at: now,
            summary: { blocked: 0, replenished: 0, already_processed: 12 },
          })),
        ),
      }),
    );
    await menu(p, "Admin");
    await p.getByRole("link", { name: /Automation & Communications/ }).click();
    await p.getByText("Checking automation…", { exact: true }).waitFor();
    assert.equal(
      await p.getByText("Automation Paused", { exact: true }).count(),
      0,
    );
    assert.equal(
      await p
        .getByText("No weekly execution jobs have run.", { exact: true })
        .count(),
      0,
    );
    await p.getByText("Automation Active", { exact: true }).waitFor();
    assert.equal(await p.locator(".execution-group").count(), 1);
    assert.match(
      await p.locator(".execution-group summary").innerText(),
      /No balance changes.*2 recent attempts/,
    );
    mode = "fail";
    await p.reload();
    await p
      .getByRole("button", { name: "Retry operating status", exact: true })
      .waitFor();
    assert.equal(
      await p.getByText("Automation Paused", { exact: true }).count(),
      0,
    );
    mode = "good";
    await p
      .getByRole("button", { name: "Retry operating status", exact: true })
      .click();
    await p.getByText("Automation Active", { exact: true }).waitFor();
    assert.deepEqual(f.errors, []);
    await f.context.close();
    console.log(
      "320–1440px aligned matchup rows, header refresh placement, Sleeper corner, disclaimer removal, slow/error recovery and grouped retries pass.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
