// Fully intercepted local fixtures: no production tickets, emails or messages.
const { chromium } = require("playwright");
const { setup, A } = require("./test-ux.cjs");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const output = path.resolve("work/receipt-ux");
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [390, 1440])
      for (const theme of ["dark", "light"]) {
        const f = await setup(browser, width, 1000);
        await f.context.route("**/rest/v1/ticket_promotions*", (route) =>
          route.fulfill({
            json: [
              {
                ticket_id: "receipt-open",
                kind: "boost",
                boost_pct: 50,
                base_decimal: 3.64,
              },
            ],
          }),
        );
        const base = {
          league_id: A,
          team_id: "aaaaaaaa-0000-4000-8000-000000000001",
          nfl_season: 2026,
          placement_week: 5,
          market_week: 5,
          placed_at: "2026-10-11T16:30:00Z",
          settled_at: null,
          stake: 25,
          accepted_combined_odds: 264,
          accepted_potential_payout: 91,
          actual_payout: 0,
        };
        f.state.tickets.push(
          {
            ...base,
            id: "receipt-open",
            legacy_ticket_id: "RECEIPT-OPEN",
            status: "OPEN",
          },
          {
            ...base,
            id: "receipt-won",
            legacy_ticket_id: "RECEIPT-WON",
            status: "WON",
            settled_at: "2026-10-13T10:00:00Z",
            actual_payout: 91,
          },
          {
            ...base,
            id: "receipt-future",
            legacy_ticket_id: "RECEIPT-FUTURE",
            ticket_type: "future",
            status: "OPEN",
          },
        );
        for (let i = 1; i <= 8; i++)
          f.state.legs.push({
            id: `open-${i}`,
            ticket_id: "receipt-open",
            leg_number: i,
            selection: `Player ${i} Over ${10 + i} — Long Team Selection`,
            market_type: "Player Points",
            matchup:
              "A Very Long Matchup Name vs. Another Very Long Matchup Name",
            status: "OPEN",
          });
        f.state.legs.push(
          {
            id: "won-leg",
            ticket_id: "receipt-won",
            leg_number: 1,
            selection: "Team total Over 125.5",
            market_type: "Team Total",
            status: "WON",
            actual_value: 150.25,
          },
          {
            id: "future-leg",
            ticket_id: "receipt-future",
            leg_number: 1,
            selection: "Opponent Over 6.5 wins",
            market_type: "Regular-season Wins",
            market_kind: "future_win_total",
            subject_team_id: "aaaaaaaa-0000-4000-8000-000000000002",
            status: "OPEN",
          },
        );
        await f.page.reload();
        await f.page.waitForLoadState("networkidle");
        await f.page.evaluate(
          (t) => (document.documentElement.dataset.theme = t),
          theme,
        );
        await f.page
          .getByRole("button", { name: "My Bets", exact: true })
          .click();
        const ticket = f.page
          .locator("details.history-ticket")
          .filter({ hasText: "RECEIPT-OPEN" });
        await ticket.locator("summary").first().click();
        await ticket
          .getByRole("button", { name: "Share Ticket", exact: true })
          .click();
        const dialog = f.page.getByRole("dialog", {
          name: "Share Ticket",
          exact: true,
        });
        await dialog.waitFor();
        await dialog
          .getByText("Receipt ready to share.", { exact: true })
          .waitFor();
        assert.equal(await dialog.locator(".receipt-leg").count(), 8);
        assert.match(
          await dialog.locator(".receipt-values").innerText(),
          /Potential payout/,
        );
        await f.page.evaluate(() => {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: async (text) => {
                window.__receiptCopied = text;
              },
            },
          });
          Object.defineProperty(navigator, "canShare", {
            configurable: true,
            value: () => true,
          });
          Object.defineProperty(navigator, "share", {
            configurable: true,
            value: async (payload) => {
              window.__receiptShared = {
                names: payload.files.map((f) => f.name),
                types: payload.files.map((f) => f.type),
                text: payload.text,
                url: payload.url,
              };
            },
          });
        });
        await dialog
          .getByRole("button", { name: "Copy text", exact: true })
          .click();
        const text = await f.page.evaluate(() => window.__receiptCopied);
        assert.match(text, /8 Pick Parlay/);
        assert.match(text, /8\. Player 8/);
        assert.match(text, /Odds \+264/);
        assert.match(text, /50% profit boost included/);
        assert(!/Balance|fixture@example|auth-token/.test(text));
        await dialog
          .getByRole("button", { name: "Message receipt", exact: true })
          .click();
        const shared = await f.page.evaluate(() => window.__receiptShared);
        assert.equal(shared.types[0], "image/png");
        assert.match(shared.text, /Follow the action/);
        assert.equal(shared.url, "https://fixture.example.test/");
        const downloadEvent = f.page.waitForEvent("download");
        await dialog
          .getByRole("button", { name: "Save image", exact: true })
          .click();
        const image = await downloadEvent,
          imagePath = path.join(output, `receipt-${width}-${theme}.png`);
        try {
          await image.saveAs(imagePath);
        } catch (e) {
          console.error(
            "Download failure:",
            await image.failure(),
            image.url(),
          );
          throw e;
        }
        const png = fs.readFileSync(imagePath);
        assert.equal(png.toString("hex", 0, 8), "89504e470d0a1a0a");
        assert(png.readUInt32BE(16) > 500);
        assert(
          png.readUInt32BE(20) > 1000,
          "Long receipt must include all legs",
        );
        await f.page.evaluate(() =>
          Object.defineProperty(navigator, "canShare", {
            configurable: true,
            value: () => false,
          }),
        );
        await dialog
          .getByRole("button", { name: "Message receipt", exact: true })
          .click();
        await dialog.getByText(/Image messaging is unavailable/).waitFor();
        const dimensions = await f.page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          dialog: document
            .querySelector(".ticket-share-dialog")
            .getBoundingClientRect().width,
        }));
        assert(dimensions.scroll <= dimensions.width);
        assert(dimensions.dialog <= width);
        await f.page.screenshot({
          path: path.join(output, `share-${width}-${theme}.png`),
        });
        await dialog.getByLabel("Close sharing").click();
        const won = f.page
          .locator("details.history-ticket")
          .filter({ hasText: "RECEIPT-WON" });
        await won.locator("summary").first().click();
        await won
          .getByRole("button", { name: "Share Ticket", exact: true })
          .click();
        await dialog.waitFor();
        assert.match(
          await dialog.locator(".receipt-profit").innerText(),
          /66\.00/,
        );
        assert(
          !/Potential payout/.test(
            await dialog.locator(".share-receipt").innerText(),
          ),
        );
        await f.page.keyboard.press("Escape");
        const future = f.page
          .locator("details.history-ticket")
          .filter({ hasText: "RECEIPT-FUTURE" });
        await future.locator("summary").first().click();
        assert.equal(
          await future.locator(".leg-progress").innerText(),
          "Current wins: 2",
        );
        assert.deepEqual(f.errors, []);
        assert.equal(f.state.betCalls, 0);
        await f.context.close();
      }
    const placed = await setup(browser, 390, 844);
    await placed.page.locator(".market-quote").nth(0).click();
    await placed.page.locator(".market-quote").nth(1).click();
    await placed.page.getByRole("button", { name: /Bet Slip/ }).click();
    await placed.page.getByLabel("Wager", { exact: true }).fill("10");
    await placed.page.locator(".place-bet").click();
    await placed.page.getByRole("button", { name: /Approve/ }).click();
    await placed.page.locator(".place-bet").click();
    await placed.page
      .locator(".receipt-placement")
      .getByRole("button", { name: "Share Ticket", exact: true })
      .click();
    await placed.page.locator(".ticket-share-dialog").waitFor();
    assert.match(
      await placed.page
        .locator(".ticket-share-dialog .receipt-values")
        .innerText(),
      /\$10\.00/,
    );
    assert.match(
      await placed.page
        .locator(".ticket-share-dialog .receipt-title")
        .innerText(),
      /2 Pick Parlay/,
    );
    assert.deepEqual(placed.errors, []);
    await placed.context.close();
    console.log(
      "Passed mobile/desktop dark/light receipt export: complete eight-leg PNG, native-share fixture, copy privacy, unsupported-image fallback, settled payout/net profit and subject-team win counter. No messages or production bets sent.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
