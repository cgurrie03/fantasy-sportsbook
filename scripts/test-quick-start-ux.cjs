// All account/data writes are intercepted by the local fixture harness.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { setup } = require("./test-ux.cjs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [320, 390, 1280]) {
      const f = await setup(
        browser,
        width,
        width === 320 ? 568 : 844,
        true,
        true,
      );
      const p = f.page;
      const guide = p.getByRole("dialog", {
        name: "Welcome to your league sportsbook",
      });
      await guide.waitFor();
      assert(
        await p
          .locator(".quick-start-close")
          .evaluate((el) => el === document.activeElement),
      );
      assert.equal(await guide.locator(".tour-dots button").count(), 5);
      assert(
        await p
          .locator(".quick-start-trigger")
          .evaluate(
            (el) =>
              el.nextElementSibling.tagName === "DIALOG" &&
              el.nextElementSibling.nextElementSibling.classList.contains(
                "theme-toggle",
              ),
          ),
      );
      for (const theme of ["dark", "light"]) {
        await p.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        assert(
          await guide.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        );
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        for (let page = 1; page <= 5; page++) {
          await guide
            .getByRole("button", { name: new RegExp("^Page " + page + ":") })
            .click();
          assert.equal(
            await guide.locator(".tour-page").getAttribute("aria-label"),
            page + " of 5",
          );
          assert(await guide.getByRole("img").isVisible());
          assert(
            await guide.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          );
        }
        await guide.getByRole("button", { name: "Back", exact: true }).click();
        assert.equal(
          await guide.locator(".tour-page").getAttribute("aria-label"),
          "4 of 5",
        );
      }
      const savePreference = p.waitForRequest(
        (request) =>
          request.url().includes("/auth/v1/user") && request.method() === "PUT",
      );
      await p.keyboard.press("Escape");
      assert.equal(
        (await savePreference).postDataJSON().data.sportsbook_quick_start_v1,
        true,
      );
      await guide.waitFor({ state: "hidden" });
      await p.waitForFunction(() =>
        document.activeElement?.classList.contains("quick-start-trigger"),
      );
      assert.equal(
        await p.evaluate(() =>
          localStorage.getItem(
            "sportsbook-quick-start-v1:cccccccc-3333-4333-8333-333333333333",
          ),
        ),
        "seen",
      );
      await p.reload();
      await p.getByRole("heading", { name: /SEASON/ }).waitFor();
      assert.equal(
        await p.locator(".quick-start[open]").count(),
        0,
        "Dismissed guide stays closed after reload",
      );
      await p
        .getByRole("button", { name: "Open sportsbook quick start" })
        .click();
      await guide.waitFor();
      // Tab stays within the native modal, including when moving backwards.
      await p.locator(".quick-start-close").focus();
      await p.keyboard.press("Shift+Tab");
      assert(await guide.evaluate((el) => el.contains(document.activeElement)));
      await guide.getByRole("button", { name: /^Page 5:/ }).click();
      await guide.getByRole("button", { name: "Got it", exact: true }).click();
      await guide.waitFor({ state: "hidden" });
      assert.equal(f.state.betCalls, 0);
      assert.deepEqual(f.errors, []);
      await f.context.close();
      console.log(`Quick start passed at ${width}px in both themes`);
    }
    const guest = await setup(browser, 390, 844, false, true);
    await guest.page
      .getByRole("heading", { name: "Welcome", exact: true })
      .waitFor();
    assert.equal(await guest.page.locator(".quick-start[open]").count(), 0);
    await guest.page
      .getByRole("button", { name: "Open sportsbook quick start" })
      .click();
    await guest.page.getByRole("dialog").waitFor();
    await guest.page.getByRole("button", { name: "Close quick start" }).click();
    await guest.context.close();
    console.log(
      "Guest help stays manual; no automatic tutorial before sign-in.",
    );
    const returning = await setup(browser, 390, 844, true, true);
    await returning.context.addInitScript(() => {
      const key = "sb-bmvjcdgxwxqalaohpsnw-auth-token";
      const account = JSON.parse(localStorage.getItem(key));
      account.user.user_metadata.sportsbook_quick_start_v1 = true;
      localStorage.setItem(key, JSON.stringify(account));
      localStorage.removeItem("sportsbook-quick-start-v1:" + account.user.id);
    });
    await returning.page.reload();
    await returning.page.getByRole("heading", { name: /SEASON/ }).waitFor();
    assert.equal(
      await returning.page.locator(".quick-start[open]").count(),
      0,
      "Account preference suppresses automatic tutorial on a fresh browser",
    );
    await returning.page
      .getByRole("button", { name: "Open sportsbook quick start" })
      .click();
    await returning.page.getByRole("dialog").waitFor();
    await returning.context.close();
    console.log(
      "Saved account preference works without a local dismissal marker.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
