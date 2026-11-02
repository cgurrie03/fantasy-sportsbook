const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
const { setup, A, B, menu } = require("./test-ux.cjs");
const values = {
  minimum_stake: 5,
  maximum_picks: 2,
  weekly_target: 150,
  futures_cash_floor: 40,
};
const policy = {
  contract: "wallet-ticket-policy-v1",
  defaults_version: 1,
  revision: 1,
  effective_season: 2026,
  effective_week: 5,
  values,
};
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [390, 1440]) {
      const f = await setup(browser, width, 900),
        p = f.page;
      f.state.platformOwner = true;
      f.state.walletPolicies = { [A]: policy };
      let saves = 0,
        latest = 1;
      await p.route("**/rpc/wallet_policy_review", (r) =>
        r.fulfill({
          json: {
            season: 2026,
            week: 5,
            latest_revision: latest,
            current: policy,
            versions: [],
          },
        }),
      );
      await p.route("**/rpc/save_wallet_policy", (r) => {
        const b = r.request().postDataJSON();
        assert.equal(b.p_league, A);
        assert.equal(b.p_expected, 1);
        assert.equal(b.p_season, 2026);
        assert.equal(b.p_week, 6);
        assert.equal(b.p_overrides.minimum_stake, 7);
        assert.equal(b.p_overrides.maximum_picks, 2);
        saves++;
        latest = 2;
        return r.fulfill({ json: { revision: 2, duplicate: false } });
      });
      await p.reload();
      await p.getByRole("heading", { name: /SEASON/ }).waitFor();
      await p.locator(".market-quote").nth(0).click();
      await p.locator(".market-quote").nth(1).click();
      await p.getByRole("button", { name: /Bet Slip/ }).click();
      await p.getByLabel("Wager", { exact: true }).fill("1");
      assert(await p.locator(".place-bet").isDisabled());
      await p.getByLabel("Wager", { exact: true }).fill("5");
      assert(await p.locator(".place-bet").isEnabled());
      await p.keyboard.press("Escape");
      await p.locator(".market-quote").nth(2).click();
      await p
        .getByText("A ticket can contain up to 2 picks.", { exact: true })
        .first()
        .waitFor();
      // The guide consumes the same current policy as acceptance, including examples.
      await p
        .getByRole("button", {
          name: "Open sportsbook quick start",
          exact: true,
        })
        .click();
      const guide = p.getByRole("dialog", {
        name: "Welcome to your league sportsbook",
      });
      await guide.getByRole("button", { name: "Next", exact: true }).click();
      await guide
        .getByText("$150 minus those stakes, with at least $40 in cash", {
          exact: true,
        })
        .waitFor();
      await p.keyboard.press("Escape");
      await p.goto("http://127.0.0.1:5185/#/admin/settings");
      await p.getByLabel("Minimum wager", { exact: true }).waitFor();
      assert.equal(
        await p.getByLabel("Minimum wager", { exact: true }).inputValue(),
        "5",
      );
      const save = p.getByRole("button", {
        name: "Save effective policy version",
        exact: true,
      });
      assert(await save.isDisabled());
      await p.getByLabel("Minimum wager", { exact: true }).fill("7");
      await p.getByLabel("Policy effective week", { exact: true }).fill("6");
      await p
        .getByLabel("Policy review reason", { exact: true })
        .fill("Reviewed next week minimum and cash policy");
      assert(await save.isDisabled());
      await p.getByLabel("Acknowledge policy impact", { exact: true }).check();
      await save.click();
      await p
        .getByText(
          "Policy version saved. Effective-period rules apply to new wagers and replenishment; accepted ticket terms remain fixed.",
          { exact: true },
        )
        .waitFor();
      assert.equal(saves, 1);
      await p.getByLabel("League", { exact: true }).selectOption(B);
      await menu(p, "Home");
      await p.getByRole("heading", { name: /SEASON 9/ }).waitFor();
      await p.locator(".market-quote").nth(0).click();
      await p.locator(".market-quote").nth(1).click();
      await p.getByRole("button", { name: /Bet Slip/ }).click();
      await p.getByLabel("Wager", { exact: true }).fill("1");
      assert(
        await p.locator(".place-bet").isEnabled(),
        "other league retains shared minimum",
      );
      assert.equal(f.state.betCalls, 0);
      assert.deepEqual(f.errors, []);
      await f.context.close();
    }
    console.log(
      "Phone/desktop policy: custom minimum and pick limit, matching cash-floor tutorial, before/after effective-period acknowledgement, and unaffected second-league default. All requests intercepted.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
