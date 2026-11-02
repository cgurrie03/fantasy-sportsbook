// All account, preference and save requests are intercepted on localhost.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
const { setup, A, B } = require("./test-ux.cjs");
const defaults = {
  opening: true,
  reminder: true,
  recap: true,
  monday_watch: true,
  reopening: true,
};
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [390, 1280]) {
      const f = await setup(browser, width, 900),
        p = f.page;
      f.state.platformOwner = true;
      const states = {
        [A]: { revision: 0, overrides: {} },
        [B]: { revision: 0, overrides: { opening: true } },
      };
      let saves = 0,
        conflict = false,
        hold = null,
        ownerSaves = 0,
        ownerRevision = 0,
        ownerValues = { ...defaults };
      const response = (league) => ({
        league_id: league,
        ...states[league],
        defaults: { ...defaults },
        available: { ...defaults, reminder: league !== B },
        effective: { ...defaults, ...states[league].overrides },
      });
      await p.route("**/rpc/my_notification_preferences", (r) =>
        r.fulfill({ json: response(r.request().postDataJSON().p_league) }),
      );
      await p.route("**/rpc/save_my_notification_preferences", async (r) => {
        const b = r.request().postDataJSON();
        assert([A, B].includes(b.p_league));
        saves++;
        if (conflict) {
          conflict = false;
          return r.fulfill({
            status: 409,
            json: {
              message:
                "Notification preferences changed; reload before saving.",
            },
          });
        }
        assert.equal(b.p_revision, states[b.p_league].revision);
        states[b.p_league] = {
          revision: b.p_revision + 1,
          overrides: b.p_values,
        };
        const result = response(b.p_league);
        if (hold) await hold;
        return r.fulfill({ json: result });
      });
      await p.route("**/rpc/league_notification_defaults", (r) =>
        r.fulfill({
          json: {
            league_id: r.request().postDataJSON().p_league,
            revision: ownerRevision,
            defaults: ownerValues,
            available: ownerValues,
            effective: ownerValues,
            overrides: {},
          },
        }),
      );
      await p.route("**/rpc/save_league_notification_defaults", (r) => {
        const b = r.request().postDataJSON();
        assert.equal(b.p_revision, ownerRevision);
        ownerRevision++;
        ownerSaves++;
        ownerValues = b.p_values;
        return r.fulfill({
          json: {
            league_id: b.p_league,
            revision: ownerRevision,
            defaults: ownerValues,
            available: ownerValues,
            effective: ownerValues,
            overrides: {},
          },
        });
      });
      await p.goto("http://127.0.0.1:5185/#/account");
      const card = p.getByRole("region", {
        name: "Your notification preferences",
      });
      await card.getByRole("combobox", { name: "Opening editions" }).waitFor();
      assert.match(
        await card.innerText(),
        /three routine emails.*Tuesday–Monday/,
      );
      assert.match(
        await card.innerText(),
        /receipts and security messages are separate/,
      );
      await card
        .getByRole("combobox", { name: "Opening editions" })
        .selectOption("off");
      await card
        .getByRole("button", { name: "Save my notification choices" })
        .click();
      await card.getByText(/Notification choices saved/).waitFor();
      assert.equal(states[A].overrides.opening, false);
      conflict = true;
      await card
        .getByRole("combobox", { name: "Opening editions" })
        .selectOption("on");
      await card
        .getByRole("button", { name: "Save my notification choices" })
        .click();
      await card.getByText(/changed; reload/).waitFor();
      await card
        .getByRole("button", { name: "Reload notification choices" })
        .click();
      await p.waitForFunction(() => document.querySelector('[aria-label="Your notification preferences"] select[aria-label="Opening editions"]')?.value === 'off');
      await card.getByRole("combobox", { name: "Opening editions" }).waitFor();
      assert.equal(
        await card
          .getByRole("combobox", { name: "Opening editions" })
          .inputValue(),
        "off",
      );
      let release;
      hold = new Promise((r) => (release = r));
      await card
        .getByRole("combobox", { name: "Opening editions" })
        .selectOption("default");
      await card
        .getByRole("button", { name: "Save my notification choices" })
        .click();
      await card
        .getByRole("button", { name: "Saving notification choices…" })
        .waitFor();
      await p.getByLabel("League", { exact: true }).selectOption(B);
      await card.getByRole("combobox", { name: "Opening editions" }).waitFor();
      release();
      hold = null;
      assert.equal(
        await card
          .getByRole("combobox", { name: "Opening editions" })
          .inputValue(),
        "on",
        "late league-A save must not overwrite B",
      );
      assert(
        await card
          .getByRole("combobox", { name: "Closing reminders" })
          .isDisabled(),
      );
      assert.match(await card.innerText(), /Disabled by league settings/);
      await card.screenshot({
        path: `work/ux-evidence/notification-preferences-${width}.png`,
      });
      await p.goto("http://127.0.0.1:5185/#/admin/settings");
      const owner = p.getByRole("region", {
        name: "League notification defaults",
      });
      await owner.getByRole("checkbox", { name: "Opening editions" }).waitFor();
      await owner.getByRole("checkbox", { name: "Opening editions" }).uncheck();
      await owner
        .getByRole("button", { name: "Save league notification defaults" })
        .click();
      await owner.getByText(/Notification choices saved/).waitFor();
      assert.equal(ownerSaves, 1);
      assert.equal(ownerValues.opening, false);
      assert.equal(saves, 3);
      assert.equal(f.state.betCalls, 0);
      assert.deepEqual(f.errors, []);
      await f.context.close();
    }
    console.log(
      "Notification preferences phone/desktop: selected-league choices, inheritance/opt-out, disabled league type, stale revision/reload, late-save fence and owner defaults; all calls intercepted.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
