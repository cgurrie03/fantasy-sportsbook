// Localhost fixtures only. All account/data/mutation calls are intercepted.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
const { setup, A } = require("./test-ux.cjs");
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [390, 1280]) {
      const f = await setup(browser, width, 900),
        p = f.page;
      f.state.platformOwner = true;
      let saved = 60,
        previewCalls = 0,
        saves = 0,
        available = true,
        hold = null;
      const jobs = {
        settlement: "00:30",
        recheck: "07:00",
        replenishment: "08:00",
        generation: "08:30",
        refresh: "07:30",
        cutoff: "20:00",
      };
      await p.route("**/rest/v1/weekly_schedule?*", (r) =>
        r.fulfill({
          json: {
            automation_enabled: false,
            publication_paused: false,
            opening_email: true,
            reminder_email: true,
            recap_email: true,
            opening_time: "08:00",
            reminder_time: "19:00",
            recap_time: "08:15",
            reminder_lead_minutes: saved,
            job_times: jobs,
          },
        }),
      );
      await p.route("**/rest/v1/rpc/reminder_schedule_preview", async (r) => {
        const body = r.request().postDataJSON();
        previewCalls++;
        assert.equal(body.p_league, A);
        const response = {
          league_id: A,
          market_week: 5,
          automation_enabled: false,
          saved_lead_minutes: saved,
          proposed_lead_minutes: body.p_lead,
          saved: {
            eligible: available,
            send_after: "2026-11-10T01:00:00Z",
            deadline: "2026-11-10T02:00:00Z",
          },
          proposed: {
            eligible: available,
            send_after: "2026-11-10T00:00:00Z",
            deadline: "2026-11-10T02:00:00Z",
          },
        };
        if (hold) await hold;
        await r.fulfill({ json: response });
      });
      let availabilityCalls = 0;
      await p.route("**/rest/v1/rpc/notification_preview", (r) => {
        const b = r.request().postDataJSON();
        assert.equal(b.p_league, A);
        availabilityCalls++;
        return r.fulfill({
          json: {
            contract: "notification-preview-v1",
            league_id: A,
            kind: b.p_kind,
            eligible: false,
            phase: "weekly",
            calendar_week: 5,
            market_week: 5,
            reason: "Operations or automation are disabled.",
            note: "Shared availability only. No messages or budget credits are created.",
          },
        });
      });
      await p.route("**/rest/v1/rpc/configure_weekly_schedule_v3", (r) => {
        const b = r.request().postDataJSON();
        assert.equal(b.p_league, A);
        assert.equal(b.p_reminder_lead_minutes, 120);
        assert.equal(b.p_reminder, true);
        assert.equal(b.p_job_times.cutoff, "20:00");
        saved = b.p_reminder_lead_minutes;
        saves++;
        return r.fulfill({ json: null });
      });
      await p.goto("http://127.0.0.1:5185/#/admin/schedule");
      const input = p.getByRole("spinbutton", {
        name: "Reminder lead minutes",
      });
      await input.waitFor();
      assert.equal(await input.inputValue(), "60");
      assert(await input.isEnabled());
      const row = p.locator("tr").filter({ has: input });
      assert(!/Thursday|19:00|above \$0/.test(await row.innerText()));
      await input.fill("120");
      await p
        .getByRole("button", { name: "Preview reminder timing", exact: true })
        .click();
      await p.getByText(/Proposed \(120 minutes\)/).waitFor();
      assert.equal(saves, 0);
      assert.equal(saved, 60);
      assert.match(
        await p
          .getByRole("region", { name: "Reminder timing preview" })
          .innerText(),
        /Nov 9.*7:00 PM/,
      );
      assert.match(
        await p
          .getByRole("region", { name: "Reminder timing preview" })
          .innerText(),
        /Automation is off/,
      );
      await p
        .getByRole("region", { name: "Reminder timing preview" })
        .screenshot({ path: `work/ux-evidence/reminder-timing-${width}.png` });
      await p
        .getByRole("button", { name: "Save Schedule", exact: true })
        .click();
      await p.getByText(/Schedule preferences saved/).waitFor();
      assert.equal(saves, 1);
      assert.equal(
        await p.getByText(/Proposed \(120 minutes\)/).count(),
        0,
        "save invalidates old comparison",
      );
      available = false;
      await p
        .getByRole("button", { name: "Preview reminder timing", exact: true })
        .click();
      await p.getByText(/No actionable weekly window/).waitFor();
      let release;
      hold = new Promise((r) => (release = r));
      available = true;
      await p
        .getByRole("button", { name: "Preview reminder timing", exact: true })
        .click();
      await p
        .getByRole("button", { name: "Checking timing…", exact: true })
        .waitFor();
      await input.fill("180");
      release();
      hold = null;
      await p.waitForTimeout(100);
      assert.equal(
        await p.getByText(/Proposed \(120 minutes\)/).count(),
        0,
        "late preview cannot overwrite changed input",
      );
      await input.fill("4");
      assert(
        await p
          .getByRole("button", { name: "Preview reminder timing", exact: true })
          .isDisabled(),
      );
      assert(
        await p
          .getByRole("button", { name: "Save Schedule", exact: true })
          .isDisabled(),
      );
      assert.equal(previewCalls, 3);
      await p
        .getByLabel("Email template", { exact: true })
        .selectOption("opening");
      const opening = p.frameLocator('iframe[title="Opening Email sample"]');
      await opening.getByText('Template preview with sample data.',{exact:false}).waitFor();
      const storyText = await opening.locator("body").innerText();
      assert.match(storyText, /Saved championship prices/);
      assert(!/Top 3 Projected|Bottom 3 Projected/.test(storyText));
      assert.equal(
        availabilityCalls,
        0,
        "availability is requested explicitly",
      );
      await p
        .getByRole("button", {
          name: "Check notification availability",
          exact: true,
        })
        .click();
      await p
        .getByText("Operations or automation are disabled.", { exact: true })
        .waitFor();
      assert.equal(availabilityCalls, 1);
      await p
        .getByLabel("Email template", { exact: true })
        .selectOption("attention");
      assert.equal(
        await p
          .getByText("Operations or automation are disabled.", { exact: true })
          .count(),
        0,
        "different template clears old result",
      );
      await p
        .getByRole("button", {
          name: "Check notification availability",
          exact: true,
        })
        .click();
      await p
        .getByText("Operations or automation are disabled.", { exact: true })
        .waitFor();
      await p
        .getByLabel("Email template", { exact: true })
        .selectOption("opening");
      await p
        .locator('iframe[title="Opening Email sample"]')
        .screenshot({ path: `work/ux-evidence/editorial-sample-${width}.png` });
      assert.equal(f.state.betCalls, 0);
      assert.deepEqual(f.errors, []);
      await f.context.close();
    }
    console.log(
      "Reminder timing phone/desktop: actual Monday date, saved/proposed preview without mutation, owner save, unavailable state, invalid lead and late-response fence; no live calls.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
