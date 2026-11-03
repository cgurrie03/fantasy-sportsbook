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
      await p
        .getByText("Pricing defaults and policy transfer", { exact: true })
        .click();
      await p
        .getByRole("button", { name: "Export pricing values", exact: true })
        .click();
      const transfer = p.getByLabel("Pricing policy JSON", { exact: true });
      const exported = JSON.parse(await transfer.inputValue());
      assert.equal(exported.contract, "sportsbook-policy-v1");
      assert(!("league_id" in exported));
      await transfer.fill(JSON.stringify({ ...exported, league_id: B }));
      await p
        .getByRole("button", { name: "Apply pricing policy JSON", exact: true })
        .click();
      await p
        .getByText(
          "Only the matching policy contract and values may be imported.",
          { exact: true },
        )
        .waitFor();
      await p
        .getByRole("button", {
          name: "Load pricing shared defaults",
          exact: true,
        })
        .click();
      assert.equal(
        await p
          .getByLabel("Featured profit boost percent", { exact: true })
          .inputValue(),
        "25",
      );
      await transfer.fill(
        JSON.stringify({
          ...exported,
          values: { ...exported.values, featured_boost_pct: 30 },
        }),
      );
      await p
        .getByRole("button", { name: "Apply pricing policy JSON", exact: true })
        .click();
      assert.equal(
        await p
          .getByLabel("Featured profit boost percent", { exact: true })
          .inputValue(),
        "30",
      );
      let pricingSaves = 0;
      await p.route("**/rpc/save_sportsbook_policy", (r) => {
        const b = r.request().postDataJSON();
        assert.equal(b.p_league, A);
        assert.equal(b.p_expected, 0);
        assert.equal(b.p_week, 6);
        assert.equal(b.p_overrides.featured_boost_pct, 30);
        pricingSaves++;
        return r.fulfill({ json: { revision: 1, duplicate: false } });
      });
      const pricingSave = p.getByRole("button", {
        name: "Save sportsbook policy version",
        exact: true,
      });
      assert(await pricingSave.isDisabled());
      await p
        .getByLabel("Featured profit boost percent", { exact: true })
        .fill("30");
      await p.getByLabel("Pricing effective week", { exact: true }).fill("6");
      await p
        .getByLabel("Pricing policy review reason", { exact: true })
        .fill("Reviewed future featured pricing and disabled families");
      await p
        .getByLabel("I reviewed the effective period and enabled families.", {
          exact: false,
        })
        .check();
      await pricingSave.click();
      await p
        .getByText(
          "Policy version saved. Existing accepted tickets and prices are unchanged.",
          { exact: true },
        )
        .waitFor();
      assert.equal(pricingSaves, 1);

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
      let identities = 0;
      await p.route("**/rpc/save_communication_identity", (r) => {
        const b = r.request().postDataJSON();
        assert.equal(b.p_league, A);
        assert.equal(b.p_sender, "reviewed@example.invalid");
        assert.equal(b.p_url, "https://dev.sportsbook.coopergurrie.com");
        identities++;
        return r.fulfill({
          json: {
            league_id: A,
            revision_hash: "b".repeat(64),
            sportsbook_url: b.p_url,
            email_sender: b.p_sender,
            required_origin: b.p_url,
          },
        });
      });
      await p
        .getByLabel("Sportsbook communication URL", { exact: true })
        .fill("https://dev.sportsbook.coopergurrie.com");
      await p
        .getByLabel("Verified league sender", { exact: true })
        .fill("reviewed@example.invalid");
      await p
        .getByLabel("Communication identity review reason", { exact: true })
        .fill("Reviewed synthetic mail identity without sending");
      await p
        .getByRole("button", {
          name: "Save communication identity",
          exact: true,
        })
        .click();
      await p
        .getByText(
          "Communication identity saved. Provider capability review must match the new configuration before activation.",
          { exact: true },
        )
        .waitFor();
      assert.equal(identities, 1);

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
