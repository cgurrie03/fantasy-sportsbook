const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { setup, A, boards, quotes, teams } = require("./test-ux.cjs");
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [390, 1280]) {
      const f = await setup(browser, width, 844),
        p = f.page;
      await f.context.addInitScript(() => {
        window.pendingSeen = false;
        new MutationObserver(() => {
          if (
            document.querySelector("h1")?.textContent === "Membership Pending"
          )
            window.pendingSeen = true;
        }).observe(document, { subtree: true, childList: true });
      });
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      await f.context.route(
        "**/rest/v1/rpc/claim_memberships",
        async (route) => {
          await held;
          await route.fulfill({ json: 2 });
        },
      );
      await p.reload();
      await p.getByText("Loading Your League…", { exact: true }).waitFor();
      assert.equal(
        await p
          .getByRole("heading", { name: "Membership Pending", exact: true })
          .count(),
        0,
      );
      release();
      await p.getByRole("heading", { name: /SEASON/ }).waitFor();
      assert.equal(
        await p.evaluate(() => window.pendingSeen),
        false,
        "Approved account must never flash pending",
      );
      await f.context.unroute("**/rest/v1/rpc/claim_memberships");
      await f.context.route("**/rest/v1/rpc/sportsbook_readiness", (route) =>
        route.fulfill({ json: { runtime: {}, boards: [] } }),
      );
      await p.goto("http://127.0.0.1:5185/#/admin/readiness");
      await p
        .getByRole("heading", { name: "Board Readiness", exact: true })
        .waitFor();
      const adminUrl = p.url();
      await p.getByRole("link", { name: "Skip to content" }).focus();
      await p.keyboard.press("Enter");
      assert.equal(p.url(), adminUrl, "Skip must preserve the admin route");
      assert.equal(
        await p.evaluate(() => document.activeElement.id),
        "main-content",
      );
      let week = 5,
        locked = true,
        walletReads = 0,
        snapshotReads = 0,
        legacyReads = 0;
      p.on("request", (req) => {
        if (
          /rpc\/(sportsbook_period|sportsbook_quote_snapshot)$/.test(
            new URL(req.url()).pathname,
          )
        )
          legacyReads++;
      });
      await f.context.route(
        "**/rest/v1/rpc/sportsbook_current_snapshot",
        async (route) => {
          const body = route.request().postDataJSON();
          if (body.p_type !== "weekly" || body.p_league !== A)
            return route.fallback();
          snapshotReads++;
          const b = {
            ...boards.find((b) => b.league_id === A),
            market_week: week,
            id: "rollover-" + week,
          };
          return route.fulfill({
            json: {
              week,
              board: b,
              markets: quotes(b).map((q) => ({
                ...q,
                metadata: locked
                  ? {
                      lineup_locked: true,
                      lock_reason:
                        "6770: Player game is missing or ambiguous (including bye).",
                    }
                  : {},
              })),
            },
          });
        },
      );
      await f.context.route("**/rest/v1/wallets*", (route) => {
        walletReads++;
        return route.fulfill({
          json: teams.map((t) => ({
            team_id: t.id,
            balance: week === 5 ? 100 : 150,
          })),
        });
      });
      await p.goto("http://127.0.0.1:5185/#/home");
      await p.locator(".market-quote:disabled").first().waitFor();
      const disabled = p.locator(".market-quote:disabled").first();
      const label = await disabled.getAttribute("aria-label");
      assert.match(label, /no confirmed NFL game/);
      assert(!/6770|ambiguous/.test(label));
      assert.match(
        await p.locator(".market-availability").first().innerText(),
        /lineup or schedule is corrected/,
      );
      locked = false;
      await p.clock.install();
      await p.reload();
      await p.locator(".market-quote:not(:disabled)").first().waitFor();
      const before = walletReads;
      await p.locator(".market-quote").first().click();
      await p.locator(".slip-banner").waitFor();
      week = 6;
      await p.clock.fastForward(31000);
      await p.getByRole("heading", { name: /WEEK\s+6/ }).waitFor();
      await p
        .locator(".feedback")
        .filter({ hasText: /Week 6 is ready/ })
        .waitFor();
      assert(walletReads > before, "Rollover refreshes account automatically");
      assert.match(
        await p.locator(".profile-copy small").innerText(),
        /150\.00/,
      );
      assert.equal(
        await p.locator(".slip-banner").count(),
        0,
        "Unfinished prior-week picks are cleared",
      );
      assert.equal(
        legacyReads,
        0,
        "Quote loading uses one current-snapshot request per board, no period/board waterfall",
      );
      assert(snapshotReads >= 2);
      assert.equal(f.state.betCalls, 0);
      assert.deepEqual(f.errors, []);
      await f.context.close();
    }
    console.log(
      "Passed phone/desktop delayed approved-account loading without false pending, keyboard skip-route preservation, plain-language locked quotes, one-request board loading and automatic week/balance refresh with stale-slip clearing.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exit(1);
});
