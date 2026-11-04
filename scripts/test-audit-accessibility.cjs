// Intercepted localhost fixtures only. Desktop WebKit is not a physical iPhone.
const { chromium, webkit } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { setup, menu, A, B } = require("./test-ux.cjs");
const webkitOnly = process.argv.includes("--webkit");
const output = path.resolve("work/audit-accessibility");
fs.mkdirSync(output, { recursive: true });
const measurements = [];
(async () => {
  const engines = webkitOnly ? [["webkit", webkit]] : [["chromium", chromium]];
  for (const [engine, type] of engines) {
    const browser = await type.launch({ headless: true });
    try {
      for (const [width, height] of [
        [360, 800],
        [390, 844],
        [430, 932],
        [768, 1024],
        [1024, 768],
        [1440, 900],
        [844, 390],
      ]) {
        const f = await setup(browser, width, height),
          p = f.page;
        await p.emulateMedia({ reducedMotion: "reduce" });
        await p.getByRole("heading", { name: /SEASON/ }).waitFor();
        const measure = async (stage) => {
          const m = await p.evaluate(() => ({
            width: innerWidth,
            height: innerHeight,
            scroll: document.documentElement.scrollWidth,
            reduced_motion: matchMedia("(prefers-reduced-motion: reduce)")
              .matches,
          }));
          assert.equal(m.width, width);
          assert(
            m.scroll <= m.width + 2,
            `${engine} ${width} ${stage} overflow ${JSON.stringify(m)}`,
          );
          measurements.push({ engine, stage, ...m });
        };
        await measure("home");
        for (const theme of ["dark", "light"]) {
          await p.evaluate(
            (t) => (document.documentElement.dataset.theme = t),
            theme,
          );
          await measure("home-" + theme);
        }
        // Keyboard skip navigation, focus visibility and native modal boundaries.
        if (engine === "webkit") await p.locator(".skip-link").focus();
        else await p.keyboard.press("Tab");
        const first = await p.evaluate(() => ({
          name: document.activeElement.textContent,
          outline: getComputedStyle(document.activeElement).outlineStyle,
        }));
        assert.match(first.name, /Skip/);
        assert.notEqual(first.outline, "none");
        await p.keyboard.press("Enter");
        await p
          .getByRole("button", {
            name: "Open sportsbook quick start",
            exact: true,
          })
          .focus();
        await p.keyboard.press("Enter");
        const guide = p.getByRole("dialog", {
          name: "Welcome to your league sportsbook",
        });
        await guide.waitFor();
        for (let i = 0; i < 16; i++) {
          await p.keyboard.press(i % 3 ? "Tab" : "Shift+Tab");
          assert(
            await guide.evaluate((el) => el.contains(document.activeElement)),
            "focus remains inside guide",
          );
        }
        for (let i = 1; i <= 5; i++) {
          await guide
            .getByRole("button", { name: new RegExp("^Page " + i + ":") })
            .click();
          await measure("guide-" + i);
          assert(
            await guide.evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
          );
        }
        await p.keyboard.press("Escape");
        await guide.waitFor({ state: "hidden" });
        assert(
          await p
            .getByRole("button", {
              name: "Open sportsbook quick start",
              exact: true,
            })
            .evaluate((el) => el === document.activeElement),
          "guide restores focus",
        );
        const quotes = p.locator(".market-quote");
        await quotes.nth(0).click();
        await quotes.nth(1).click();
        await p.getByRole("button", { name: /Bet Slip/ }).click();
        const slip = p.getByRole("dialog");
        await slip.waitFor();
        await p.getByLabel("Wager", { exact: true }).fill("10");
        await p.getByLabel("Wager", { exact: true }).focus();
        await p.setViewportSize({ width, height: Math.min(height, 420) });
        await p.locator(".place-bet").scrollIntoViewIfNeeded();
        const submit = await p.locator(".place-bet").boundingBox();
        assert(
          submit.y >= 0 &&
            submit.y + submit.height <= Math.min(height, 420) + 2,
          "submit remains reachable with reduced viewport",
        );
        await p.screenshot({
          path: path.join(output, `${engine}-${width}x${height}-slip.png`),
          fullPage: true,
        });
        await p.keyboard.press("Escape");
        await slip.waitFor({ state: "hidden" });
        await p.setViewportSize({ width, height });
        await p.getByLabel("League", { exact: true }).selectOption(B);
        await menu(p, "Home");
        await p.getByRole("heading", { name: /SEASON 9/ }).waitFor();
        assert.equal(
          await p.locator(".slip-banner").count(),
          0,
          "league switch clears selections",
        );
        await measure("second-league");
        await p.getByLabel("League", { exact: true }).selectOption(A);
        await menu(p, "Home");
        await p.getByRole("heading", { name: /SEASON 3/ }).waitFor();
        await p.locator(".match-team").first().waitFor();
        // Fixture text-size override tests reflow; it is not an OS zoom claim.
        await p.waitForLoadState("networkidle");
        const textScale = await p.evaluate(() => {
          const before = parseFloat(getComputedStyle(document.body).fontSize);
          const sizes = [...document.querySelectorAll("*")].map((el) => [
            el,
            parseFloat(getComputedStyle(el).fontSize),
          ]);
          for (const [el, size] of sizes)
            if (Number.isFinite(size)) el.style.fontSize = size * 2 + "px";
          return {
            before,
            after: parseFloat(getComputedStyle(document.body).fontSize),
          };
        });
        await p.waitForFunction(
          (expected) =>
            parseFloat(getComputedStyle(document.body).fontSize) === expected,
          textScale.before * 2,
        );
        await p.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const rows = await p.locator(".matchup-card").evaluateAll((cards) =>
          cards.map((card) => {
            const rows = [...card.querySelectorAll(".match-team")];
            return {
              firstBottom: Math.max(
                ...[rows[0], ...rows[0].querySelectorAll("*")].map(
                  (el) => el.getBoundingClientRect().bottom,
                ),
              ),
              secondTop: rows[1].getBoundingClientRect().top,
            };
          }),
        );
        assert(
          rows.every((x) => x.firstBottom <= x.secondTop + 2),
          "enlarged matchup identities must not overlap the next team: " +
            JSON.stringify(rows),
        );
        await measure("text-doubled");
        await p.screenshot({
          path: path.join(
            output,
            `${engine}-${width}x${height}-large-text.png`,
          ),
          fullPage: true,
        });
        assert.equal(f.state.betCalls, 0, "no acceptance request made");
        assert.deepEqual(f.errors, []);
        await f.context.close();
      }
    } finally {
      await browser.close();
    }
  }
  fs.writeFileSync(
    path.join(output, webkitOnly ? "webkit.json" : "chromium.json"),
    JSON.stringify(
      {
        measurements,
        physical_device: false,
        screen_reader_user_verified: false,
        all_requests_intercepted: true,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `${webkitOnly ? "WebKit" : "Chromium"}: seven viewport sizes/orientations, both themes, reduced motion, visible keyboard focus/skip navigation, five-page modal focus/restore, reduced-height slip, league clearing and doubled-text reflow. Physical Safari/OS keyboard/screen reader remain owner checks.`,
  );
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
