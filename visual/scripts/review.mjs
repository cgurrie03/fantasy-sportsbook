import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
const output = path.resolve("../work/boff-visual-refinement");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const errors = [],
  apiRequests = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (/\/api\/|supabase\.co|resend\.com/.test(r.url()))
    apiRequests.push(r.url());
});
const check = (name, value) => {
  assert.ok(value, name);
  checks.push(name);
};
async function visit(route) {
  await page.goto("http://127.0.0.1:5180/#" + route);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}
async function screen(name, fullPage = false) {
  await page.screenshot({ path: path.join(output, name + ".png"), fullPage });
}
async function clear() {
  const b = page
    .locator(".desktop-slip .slip-title")
    .getByRole("button", { name: "Clear", exact: true });
  if (await b.count()) await b.click();
}
try {
  await visit("matchups");
  check("Six real matchups", (await page.locator(".matchup").count()) === 6);
  check(
    "Imported league image loaded",
    await page
      .locator(".header-league .league-avatar img")
      .evaluate((e) => e.complete && e.naturalWidth > 0),
  );
  check(
    "No marketing slogans on the board",
    await page
      .locator("body")
      .innerText()
      .then(
        (t) =>
          ![
            "Got a feeling",
            "More than the",
            "A little more on the line",
            "Plenty to play for",
            "Made for your league",
          ].some((s) => t.includes(s)),
      ),
  );
  check(
    "No repeated projection explanations",
    (await page.getByText("How projections work", { exact: true }).count()) ===
      0 &&
      (await page.getByText("About these lines", { exact: true }).count()) ===
        0,
  );
  const scores = await page
    .locator(".matchup")
    .evaluateAll((els) => els.map((e) => Number(e.dataset.rankScore)));
  check(
    "Best-to-worst ranked matchups",
    scores.every((n, i) => i === 0 || scores[i - 1] >= n),
  );
  check(
    "Game of the week automatically selected",
    await page
      .locator(".matchup")
      .first()
      .innerText()
      .then((t) => t.includes("Game Of The Week")),
  );
  const fixture = JSON.parse(await fs.readFile("src/data.json", "utf8"));
  const tankIds = await page
    .locator(".matchup")
    .evaluateAll((els) =>
      els
        .filter((e) => e.textContent.includes("Tank Bowl"))
        .map((e) => e.dataset.matchupId),
    );
  check(
    "Tank Bowl uses only qualifying teams",
    tankIds.length <= 1 &&
      tankIds.every((id) => {
        const m = fixture.markets.find((x) => x.matchup === id);
        return [m.away, m.home].every((id) => {
          const t = fixture.teams.find((t) => t.id === id);
          return (
            (t.wins + t.ties * 0.5) / (t.wins + t.losses + t.ties) <= 0.375
          );
        });
      }),
  );
  check(
    "Compact offers on main Matchups",
    (await page.locator(".compact-offers .offer-card").count()) === 3,
  );
  await screen("desktop-light");
  await page.getByRole("button", { name: "Open Guide", exact: true }).click();
  await page.getByRole("button", { name: "Projections", exact: true }).click();
  check(
    "Projection guide includes top-three fallback",
    await page
      .locator("dialog")
      .innerText()
      .then((t) => t.includes("top three eligible available free agents")),
  );
  await screen("guide-projections");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Report A Bug Or Give Feedback", exact: true })
    .click();
  check(
    "Feedback icon opens visual form",
    await page
      .locator("dialog")
      .getByRole("button", { name: "Submit Feedback" })
      .isDisabled(),
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("tab", { name: "Player Head-To-Head", exact: true })
    .click();
  await page.waitForLoadState("networkidle");
  check(
    "Player filter defaults to own team",
    await page
      .getByRole("combobox", { name: "Player Team Filter" })
      .inputValue()
      .then((v) => v.startsWith("team:")),
  );
  const ownRows = await page.locator(".h2h-line").count();
  check("Own-matchup H2H rows available", ownRows > 0);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".player-headshot img")].some(
        (e) => e.complete && e.naturalWidth > 0,
      ),
    undefined,
    { timeout: 15000 },
  );
  check(
    "Player headshots loaded",
    await page
      .locator(".player-headshot img")
      .evaluateAll(
        (els) => els.filter((e) => e.complete && e.naturalWidth > 0).length > 0,
      ),
  );
  check(
    "Season averages displayed",
    await page
      .locator(".player-context")
      .first()
      .innerText()
      .then((t) => t.includes("Avg ")),
  );
  check(
    "Opponent and kickoff context displayed",
    (await page.locator(".player-context time").count()) > 0,
  );
  await screen("players-h2h");
  await page
    .getByRole("textbox", { name: "Find A Player" })
    .fill("zzzz-nonexistent-player");
  check(
    "H2H search has a recoverable empty state",
    await page
      .getByRole("heading", { name: "No Matching Players", exact: true })
      .isVisible(),
  );
  await page
    .getByRole("button", { name: "Clear Filters", exact: true })
    .click();
  check(
    "Clearing H2H filters restores rows",
    (await page.locator(".h2h-line").count()) > 0,
  );
  await page
    .getByRole("combobox", { name: "Player Team Filter" })
    .selectOption("all");
  check(
    "All-team filter expands H2H list",
    (await page.locator(".h2h-line").count()) > ownRows,
  );
  await page
    .getByRole("combobox", { name: "Player Position Filter" })
    .selectOption("RB");
  check(
    "Position filter applied",
    await page
      .locator(".position-tag")
      .allInnerTexts()
      .then((t) => t.length > 0 && t.every((v) => v === "RB")),
  );
  await page
    .getByRole("tab", { name: "Player Points & Milestones", exact: true })
    .click();
  await page.waitForLoadState("networkidle");
  check(
    "Compact prop rows include headshots",
    (await page.locator(".extra-player-row .player-headshot").count()) > 0,
  );
  await screen("players-points");
  await page.getByRole("tab", { name: "Weekly Specials", exact: true }).click();
  check(
    "All eight specials in one continuous list",
    (await page.locator(".continuous-markets .anchored-market").count()) === 8,
  );
  await page
    .getByRole("navigation", { name: "Weekly Special Navigation" })
    .getByRole("button", { name: "League Average", exact: true })
    .click();
  const weeklySticky = await page.locator(".weekly-jump").boundingBox();
  check(
    "Weekly navigation remains visible after jumping",
    weeklySticky.y >= 109 && weeklySticky.y < 190,
  );
  check(
    "Jump reaches League Average",
    await page
      .locator("#weekly-6")
      .boundingBox()
      .then((b) => b.y >= 190 && b.y < 850),
  );
  await screen("weekly-average");
  await page
    .getByRole("navigation", { name: "Weekly Special Navigation" })
    .getByRole("button", { name: "Teams Scoring 150+", exact: true })
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".weekly-jump button")].some(
      (b) =>
        b.textContent === "Teams Scoring 150+" &&
        b.getAttribute("aria-current") === "location",
    ),
  );
  check(
    "Weekly highlight matches clicked section",
    (await page
      .getByRole("navigation", { name: "Weekly Special Navigation" })
      .getByRole("button", { name: "Teams Scoring 150+", exact: true })
      .getAttribute("aria-current")) === "location",
  );
  await screen("weekly-count");
  await visit("futures");
  check(
    "Four futures sections in one continuous list",
    (await page.locator(".futures-page .anchored-market").count()) === 4,
  );
  await page
    .getByRole("navigation", { name: "Futures Navigation" })
    .getByRole("button", { name: "Last Place", exact: true })
    .click();
  check(
    "Futures navigation sticks",
    await page
      .locator(".jump-nav")
      .boundingBox()
      .then((b) => b.y >= 109 && b.y < 130),
  );
  check(
    "Last-place outcomes correctly labeled",
    await page
      .locator("#future-3 .odds-button")
      .first()
      .innerText()
      .then((t) => t.includes("To Finish Last")),
  );
  await screen("futures-last");
  await visit("offers");
  check(
    "Full parlay legs shown inline",
    (await page.locator(".inline-parlay li").count()) === 7,
  );
  check(
    "No view-selections step",
    (await page
      .getByRole("button", { name: "View selections", exact: true })
      .count()) === 0,
  );
  check(
    "All offers have specific cutoffs",
    await page
      .locator(".offer-expiry")
      .allInnerTexts()
      .then(
        (t) =>
          t.length === 3 &&
          t.every((v) => /Closes.*\d{1,2}:\d{2}.*[AP]M/.test(v)),
      ),
  );
  await screen("offers");
  await page.getByRole("button", { name: "Claim Boost", exact: true }).click();
  check(
    "Boost claim confirmation visible",
    await page
      .locator("dialog")
      .getByRole("heading", { name: "Boost Claimed", exact: true })
      .isVisible(),
  );
  await screen("boost-claimed");
  await page
    .locator("dialog")
    .getByRole("button", { name: "Go To Player H2H", exact: true })
    .click();
  check(
    "Claim-to-player shortcut works",
    (await page
      .getByRole("tab", { name: "Player Head-To-Head", exact: true })
      .getAttribute("aria-selected")) === "true",
  );
  await visit("offers");
  check(
    "Claimed state persists on offers",
    (await page.locator(".offer-2 .claim-state").innerText()) === "Claimed",
  );
  await visit("matchups");
  await clear();
  await page
    .locator(".matchup")
    .first()
    .locator(".team-market-row .odds-button")
    .first()
    .click();
  await page
    .locator(".matchup")
    .first()
    .locator(".team-market-row .odds-button")
    .nth(2)
    .click();
  check(
    "Same-game selections share one header",
    (await page.locator(".desktop-slip .slip-game").count()) === 1 &&
      (await page.locator(".desktop-slip .slip-selection").count()) === 2,
  );
  await page
    .locator(".matchup")
    .nth(1)
    .locator(".team-market-row .odds-button")
    .first()
    .click();
  check(
    "Second matchup gets separate header",
    (await page.locator(".desktop-slip .slip-game").count()) === 2,
  );
  await screen("grouped-slip");
  await page.locator("#stake").fill("251");
  check(
    "Insufficient-credit state still works",
    await page
      .getByRole("button", { name: "Review Preview Ticket", exact: true })
      .isDisabled(),
  );
  await page.locator("#stake").fill("25");
  await page
    .getByRole("button", { name: "Review Preview Ticket", exact: true })
    .click();
  check(
    "Confirmation preserves matchup groups",
    (await page.locator("dialog .slip-game").count()) === 2,
  );
  await page
    .getByRole("button", { name: "Create Preview Ticket", exact: true })
    .click();
  check(
    "Receipt keeps integrated sharing",
    await page
      .getByRole("button", { name: "Copy Ticket Summary", exact: true })
      .isVisible(),
  );
  await page.keyboard.press("Escape");
  await visit("league");
  check(
    "Sleeper standings expanded",
    (await page.locator("thead th").count()) === 12 &&
      (await page.locator("tbody tr").count()) === 12,
  );
  await screen("sleeper-standings");
  await page.getByRole("tab", { name: "boff Standings", exact: true }).click();
  check(
    "13 independent participants with expanded betting stats",
    (await page.locator("tbody tr").count()) === 13 &&
      (await page.locator("thead th").count()) === 11,
  );
  await screen("boff-standings");
  await visit("commissioner");
  await page.getByRole("tab", { name: "League Identity", exact: true }).click();
  check(
    "League identity is read-only",
    (await page
      .locator(".readonly-identity input,.readonly-identity select")
      .count()) === 0,
  );
  await screen("league-identity");
  await page
    .getByRole("tab", { name: "Featured Matchups", exact: true })
    .click();
  check(
    "Automated selection is default",
    (await page
      .getByRole("combobox", { name: "Selection Rule", exact: true })
      .inputValue()) === "automatic",
  );
  check(
    "Tank Bowl availability follows eligible matchups",
    (await page.locator("option[value=tank]").isDisabled()) ===
      (tankIds.length === 0),
  );
  await page
    .getByRole("combobox", { name: "Selection Rule", exact: true })
    .selectOption("none");
  await page
    .getByRole("button", { name: "Save Preview Choice", exact: true })
    .click();
  await visit("matchups");
  check(
    "Commissioner preview rule updates board",
    (await page.locator(".matchup .badge").count()) === 0,
  );
  await visit("commissioner");
  await page
    .getByRole("tab", { name: "Featured Matchups", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Selection Rule", exact: true })
    .selectOption("automatic");
  await page
    .getByRole("button", { name: "Save Preview Choice", exact: true })
    .click();
  await screen("featured-settings");
  await visit("profile");
  check(
    "Additional notification categories",
    (await page.locator(".toggle-row input[type=checkbox]").count()) === 9,
  );
  await page
    .getByRole("checkbox", { name: "Quiet Hours", exact: true })
    .check();
  check(
    "Quiet-hour controls available",
    (await page.getByLabel("From", { exact: true }).isVisible()) &&
      (await page.getByLabel("Until", { exact: true }).isVisible()),
  );
  await page
    .getByRole("combobox", { name: "Odds Format", exact: true })
    .selectOption("decimal");
  await page
    .getByRole("button", { name: "Save Preferences", exact: true })
    .click();
  await visit("matchups");
  check(
    "Odds preference changes displayed odds",
    (await page.locator(".matchup .odds-button strong").first().innerText()) ===
      "1.91",
  );
  await visit("profile");
  await page
    .getByRole("combobox", { name: "Odds Format", exact: true })
    .selectOption("american");
  await page
    .getByRole("button", { name: "Save Preferences", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save Communications", exact: true })
    .click();
  await page.reload();
  check(
    "Profile settings survive reload",
    await page
      .getByRole("checkbox", { name: "Quiet Hours", exact: true })
      .isChecked(),
  );
  await screen("profile");
  for (const route of ["my-bets", "all-bets", "platform", "setup", "access"]) {
    await visit(route);
    check(
      "Route " + route + " renders",
      await page
        .locator(route === "access" ? ".access-form" : "main")
        .innerText()
        .then((t) => t.length > 70),
    );
  }
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await visit("matchups");
    check(
      "No page overflow at " + width + "px",
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await visit("matchups");
  await screen("desktop-light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await screen("desktop-dark");
  await page
    .getByRole("tab", { name: "Player Head-To-Head", exact: true })
    .click();
  await page.waitForLoadState("networkidle");
  await screen("players-dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await visit("matchups");
  await screen("mobile-dark");
  await page
    .getByRole("navigation", { name: "Mobile Navigation" })
    .getByRole("button", { name: "More", exact: true })
    .click();
  check(
    "Mobile More menu has a clear title",
    await page
      .locator("dialog")
      .getByRole("heading", { name: "Menu", exact: true })
      .isVisible(),
  );
  check(
    "Mobile Futures and All Bets are reachable",
    (await page
      .locator("dialog")
      .getByRole("link", { name: "Futures", exact: true })
      .isVisible()) &&
      (await page
        .locator("dialog")
        .getByRole("link", { name: "All Bets", exact: true })
        .isVisible()),
  );
  await screen("mobile-menu");
  await page
    .locator("dialog")
    .getByRole("link", { name: "Futures", exact: true })
    .click();
  check(
    "Mobile Futures navigation works",
    await page
      .getByRole("heading", { name: "Futures", exact: true })
      .isVisible(),
  );
  await page
    .getByRole("navigation", { name: "Mobile Navigation" })
    .getByRole("button", { name: "More", exact: true })
    .click();
  await page
    .locator("dialog")
    .getByRole("button", { name: "Guide", exact: true })
    .click();
  check(
    "Mobile Guide is accessible",
    await page
      .locator("dialog")
      .getByRole("heading", { name: "Guide & Walkthrough", exact: true })
      .isVisible(),
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation", { name: "Mobile Navigation" })
    .getByRole("button", { name: "More", exact: true })
    .click();
  await page
    .locator("dialog")
    .getByRole("button", { name: "Feedback", exact: true })
    .click();
  check(
    "Mobile Feedback is accessible",
    await page
      .locator("dialog")
      .getByRole("heading", { name: "Report A Bug / Feedback", exact: true })
      .isVisible(),
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation", { name: "Mobile Navigation" })
    .getByRole("button", { name: "More", exact: true })
    .click();
  check(
    "Mobile Updates utility is present",
    await page
      .locator("dialog")
      .getByRole("button", { name: "Updates", exact: true })
      .isVisible(),
  );
  await page.keyboard.press("Escape");
  check("No JavaScript page errors", errors.length === 0);
  check("No backend requests", apiRequests.length === 0);
  await fs.writeFile(
    path.join(output, "review-results.json"),
    JSON.stringify(
      { passed: checks.length, checks, errors, apiRequests },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, errors, apiRequests }));
} finally {
  await browser.close();
}
