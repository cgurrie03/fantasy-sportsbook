// Same reconnaissance/networkidle workflow as Webapp Testing; use the installed
// Node Playwright package because the bundled Python runtime lacks Playwright.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const output = path.resolve(process.env.TEASER_UX_OUTPUT || "work/teasers/ux");
const origin = process.env.TEASER_UX_ORIGIN || "http://127.0.0.1:5188";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
fs.mkdirSync(output, { recursive: true });
const evidence = [],
  browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [
    [390, 844],
    [1440, 1000],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: width < 768,
      hasTouch: width < 768,
    });
    const page = await context.newPage(),
      errors = [],
      external = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (
        url.startsWith(origin + "/") ||
        url.startsWith("data:") ||
        url.startsWith("blob:")
      )
        return route.continue();
      external.push(url);
      await route.abort();
    });
    await page.goto(origin + "/teaser-review.html");
    await page.waitForLoadState("networkidle");
    const buttons = page.locator(".market-quote");
    assert.equal(await buttons.count(), 3);
    await buttons.nth(0).click();
    await buttons.nth(1).click();
    await page.getByRole("button", { name: /Bet Slip/ }).click();
    assert.equal(
      await page.getByRole("tab", { name: "Teaser", exact: true }).count(),
      0,
    );
    await page.keyboard.press("Escape");
    await buttons.nth(2).click();
    await page.getByRole("button", { name: /Bet Slip/ }).click();
    const wager = page.getByLabel("Wager", { exact: true });
    assert.equal(await wager.inputValue(), "");
    assert.equal(await wager.getAttribute("placeholder"), "0");
    await wager.pressSequentially("10");
    assert.equal(await wager.inputValue(), "10");
    await wager.fill("0");
    await wager.blur();
    await wager.focus();
    assert.equal(await wager.inputValue(), "");
    await wager.pressSequentially("10");
    const originals = await page.locator(".slip-leg > span").allInnerTexts();
    await page.getByRole("tab", { name: "Teaser", exact: true }).click();
    assert(await page.locator(".place-bet").isDisabled());
    assert.equal(
      await page
        .getByRole("tab", { name: "Teaser", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    await page.getByRole("tab", { name: "Teaser", exact: true }).focus();
    await page.keyboard.press("ArrowLeft");
    assert.equal(
      await page
        .getByRole("tab", { name: "Parlay", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: /Point Teaser/ }).click();
    await page.keyboard.press("Escape");
    assert(await page.locator(".bet-slip-dialog").isVisible());
    assert.equal(
      await page.locator("#teaser-point-choices").isVisible(),
      false,
    );
    const lines = await page.locator(".teaser-new-line").allInnerTexts();
    assert(lines.includes("+0.5") && lines.includes("+14.5"));
    assert.equal(await page.locator(".slip-leg").count(), 3);
    const payouts = [];
    for (const n of [6, 9, 12]) {
      await page.getByRole("button", { name: /Point Teaser/ }).click();
      await page
        .getByRole("radio", { name: new RegExp("^" + n + "-Point Teaser") })
        .check();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      payouts.push(await page.locator(".place-bet").innerText());
    }
    assert(
      payouts[0].includes("$55.00") &&
        payouts[1].includes("$48.00") &&
        payouts[2].includes("$42.00"),
    );
    await page.getByRole("button", { name: /Point Teaser/ }).click();
    await page.getByRole("radio", { name: /^9-Point Teaser/ }).check();
    await page.screenshot({
      path: path.join(output, "picker-" + width + ".png"),
      fullPage: false,
    });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    for (const theme of ["dark", "light"]) {
      await page.evaluate(
        (t) => (document.documentElement.dataset.theme = t),
        theme,
      );
      await page.locator(".teaser-conversion").scrollIntoViewIfNeeded();
      const geometry = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.equal(geometry.width, width);
      assert(!geometry.overflow);
      assert(
        await page
          .locator(".teaser-conversion")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      await page.screenshot({
        path: path.join(output, `teaser-${width}-${theme}.png`),
        fullPage: false,
      });
    }
    await page.getByRole("tab", { name: "Parlay", exact: true }).click();
    assert(await page.locator(".place-bet").isEnabled());
    assert.deepEqual(
      await page.locator(".slip-leg > span").allInnerTexts(),
      originals,
    );
    await page.getByRole("tab", { name: "Teaser", exact: true }).click();
    await page
      .getByRole("button", { name: /Remove / })
      .first()
      .click();
    assert(
      (await page.locator(".teaser-conversion").innerText()).includes(
        "3 or more distinct",
      ),
    );
    assert(await page.locator(".place-bet").isDisabled());
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await page.goto(origin + "/teaser-review.html?unpriced=1");
    await page.waitForLoadState("networkidle");
    for (const button of await page.locator(".market-quote").all())
      await button.click();
    await page.getByRole("button", { name: /Bet Slip/ }).click();
    await page.getByRole("tab", { name: "Teaser", exact: true }).click();
    assert(
      (await page.locator(".ticket-total-odds").innerText()).includes(
        "Price pending",
      ),
    );
    assert(!(await page.locator(".place-bet").innerText()).includes("Pays"));
    assert(await page.locator(".place-bet").isDisabled());
    evidence.push({
      viewport: { width, height },
      themes: ["dark", "light"],
      payouts,
      immutableOriginals: true,
      convertBack: true,
      invalidAfterRemoval: true,
      unpricedAcceptanceDisabled: true,
      externalRequests: 0,
      errors,
    });
    await context.close();
  }
} finally {
  await browser.close();
}
fs.writeFileSync(
  path.join(output, "checks.json"),
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
