const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { setup, menu, A, B, boards, quotes } = require("./test-ux.cjs");
const { validatePng } = require("../api/_lib/promo-image.ts");
const output = path.resolve(process.env.PROMO_UX_OUTPUT || "work/promo-ux");
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const evidence = [];
    for (const width of [390, 1440])
      for (const theme of ["dark", "light"]) {
        const f = await setup(browser, width, 900);
        const artwork = await f.page.evaluate(() => {
          const c = document.createElement("canvas");
          c.width = 1200;
          c.height = 522;
          const x = c.getContext("2d");
          const g = x.createLinearGradient(0, 0, 1200, 522);
          g.addColorStop(0, "#11253f");
          g.addColorStop(1, "#305e69");
          x.fillStyle = g;
          x.fillRect(0, 0, 1200, 522);
          x.fillStyle = "#f8ce63";
          x.font = "bold 76px sans-serif";
          x.fillText("WEEKLY EXCLUSIVES", 65, 170);
          x.fillStyle = "#fff";
          x.font = "34px sans-serif";
          x.fillText("YOUR LEAGUE. YOUR EDGE.", 70, 245);
          x.strokeStyle = "#f8ce63";
          x.lineWidth = 8;
          x.beginPath();
          x.ellipse(920, 235, 155, 92, -0.55, 0, Math.PI * 2);
          x.stroke();
          return c.toDataURL("image/png").split(",")[1];
        });
        assert.equal(validatePng(artwork), artwork);
        const damaged = Buffer.from(artwork, "base64");
        damaged[20] ^= 1;
        assert.throws(
          () => validatePng(damaged.toString("base64")),
          /checksum/,
        );
        assert.throws(
          () =>
            validatePng(
              Buffer.concat([
                Buffer.from(artwork, "base64"),
                Buffer.from("<script>"),
              ]).toString("base64"),
            ),
          /ending/,
        );
        const b = boards[0];
        const points = Array.from({ length: 6 }, (_, i) => ({
          ...quotes(b)[0],
          id: "point-" + i,
          kind: "player_points",
          market_key: "point:" + i,
          subject: "Fixture Player " + i,
          label: "Player " + i + " Over " + (15.5 + i),
          line: 15.5 + i,
          side: "over",
          odds: 100,
          featured: "",
          metadata: {
            player_id: "p" + i,
            position: "WR",
            nfl_team: "TST",
            projection: 20,
          },
        }));
        const o = {
          id: "boost-fixture",
          league_id: A,
          nfl_season: 2026,
          market_week: 5,
          slot: 1,
          kind: "boost",
          title: "50% Player Points boost",
          description:
            "At least five distinct players. All legs Player Points.",
          image_id: "image-fixture",
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          status: "scheduled",
          activated_at: new Date(Date.now() - 1000).toISOString(),
          version: 1,
          terms: {
            criterion: "points_min",
            count: 5,
            percent: 50,
            max_stake: 20,
          },
          claimed: false,
          used: false,
        };
        const fixed = {
          ...o,
          id: "fixed-fixture",
          slot: 2,
          kind: "fixed",
          title: "The locked double",
          description: "Two saved selections. Choose your wager.",
          terms: {
            legs: points
              .slice(0, 2)
              .map((p) => ({ ...p, line: 12.5, odds: 200 })),
            fixed_stake: null,
          },
        };
        const list = [
          o,
          fixed,
          { ...o, id: "other-fixture", slot: 3, title: "Another weekly offer" },
        ];
        let calls = 0,
          received,
          saved;
        await f.context.route("**/rest/v1/rpc/**", async (route) => {
          const endpoint = new URL(route.request().url()).pathname
            .split("/")
            .at(-1);
          const body = route.request().postDataJSON();
          const json = (data) =>
            route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify(data),
            });
          if (endpoint === "list_promos")
            return json(body.p_league === A ? list : []);
          if (endpoint === "read_promo_image") return json(artwork);
          if (endpoint === "claim_promo") {
            list.find((o) => o.id === body.p_offer).claimed = true;
            return json(null);
          }
          if (endpoint === "sportsbook_quote_snapshot" && body.p_board === b.id)
            return json({ board: b, markets: [...quotes(b), ...points] });
          if (endpoint === "promo_offers") return json([]);
          if (endpoint === "promo_usage") return json([]);
          if (endpoint === "save_promo") {
            saved = body.p_offer;
            return json("draft-fixture");
          }
          return route.fallback();
        });
        await f.context.route("**/api/place-bet", async (route) => {
          calls++;
          received = route.request().postDataJSON();
          o.used = true;
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              ticket_id: "fixture-ticket",
              balance: 90,
              email_status: "pending",
            }),
          });
        });
        await f.page.reload();
        await f.page.locator(".promo-card").first().waitFor();
        await f.page.evaluate(
          (t) => (document.documentElement.dataset.theme = t),
          theme,
        );
        assert.equal(await f.page.locator(".promo-card").count(), 3);
        assert.equal(await f.page.locator(".promo-body button").count(), 0);
        assert.match(
          await f.page.locator(".promo-body").first().innerText(),
          /Claim by/,
        );
        assert.equal(
          await f.page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        await f.page.screenshot({
          path: path.join(output, `home-${width}-${theme}.png`),
          fullPage: true,
        });
        if (width === 390) {
          await f.page.getByRole("button", { name: /Show offer 2:/ }).click();
          await f.page.waitForFunction(
            () =>
              document
                .querySelector(".promo-pagination button:nth-child(2)")
                .getAttribute("aria-current") === "true",
          );
        }
        await f.page
          .getByRole("button", {
            name: "Claim 50% Player Points boost",
            exact: true,
          })
          .click();
        await f.page
          .getByRole("button", { name: "Player Points", exact: true })
          .click();
        await f.page.locator(".player-market-card").first().waitFor();
        for (let i = 0; i < 5; i++)
          await f.page
            .locator(".player-market-card")
            .nth(i)
            .locator(".market-quote")
            .click();
        await f.page.locator(".slip-banner").click();
        await f.page.getByLabel("Wager", { exact: true }).fill("10");
        const toggle = f.page.getByLabel("Apply 50% Player Points boost", {
          exact: true,
        });
        await toggle.waitFor();
        assert.equal(await toggle.isChecked(), false);
        await toggle.check();
        assert.match(
          await f.page
            .locator('[aria-label="Boost payout breakdown"]')
            .innerText(),
          /\$310\.00.*\$155\.00/s,
        );
        assert.match(await f.page.locator(".place-bet").innerText(), /475\.00/);
        await f.page.getByLabel("Wager", { exact: true }).fill("21");
        assert(await f.page.locator(".place-bet").isDisabled());
        await f.page.getByLabel("Wager", { exact: true }).fill("10");
        await f.page.screenshot({
          path: path.join(output, `boost-${width}-${theme}.png`),
          fullPage: true,
        });
        await f.page.locator(".slip-legs").evaluate((el) => (el.scrollTop = 0));
        await f.page.locator(".slip-leg button").first().click();
        assert.equal(await toggle.count(), 0);
        await f.page.keyboard.press("Escape");
        await f.page
          .getByRole("button", { name: "Matchups", exact: true })
          .click();
        await f.page
          .getByRole("button", { name: "Claim The locked double", exact: true })
          .click();
        await f.page
          .getByRole("heading", { name: "Replace your current slip?" })
          .waitFor();
        await f.page
          .getByRole("button", { name: "Keep current slip", exact: true })
          .click();
        await f.page
          .getByRole("button", { name: "Claim The locked double", exact: true })
          .click();
        await f.page
          .getByRole("button", { name: "Replace with promo", exact: true })
          .click();
        assert.equal(
          await f.page.locator(".slip-leg button:visible").count(),
          0,
        );
        assert.equal(await f.page.locator(".slip-leg").count(), 2);
        assert.match(await f.page.locator(".place-bet").innerText(), /90\.00/);
        await f.page.screenshot({
          path: path.join(output, `fixed-${width}-${theme}.png`),
          fullPage: true,
        });
        await f.page
          .getByRole("button", { name: "Discard promo", exact: true })
          .click();
        await f.page.keyboard.press("Escape");
        await f.page
          .getByRole("button", { name: "Player Points", exact: true })
          .click();
        for (let i = 0; i < 5; i++)
          await f.page
            .locator(".player-market-card")
            .nth(i)
            .locator(".market-quote")
            .click();
        await f.page.locator(".slip-banner").click();
        await toggle.check();
        await f.page.getByLabel("Wager", { exact: true }).fill("10");
        await f.page.locator(".place-bet").click();
        await f.page.waitForFunction(
          () => !document.querySelector(".bet-slip-dialog").open,
        );
        assert.equal(calls, 1);
        assert.equal(received.offer_id, o.id);
        assert.equal(received.offer_kind, "boost");
        assert.equal(o.used, true);
        await f.page.getByLabel("League", { exact: true }).selectOption(B);
        await menu(f.page, "Home");
        await f.page.getByRole("heading", { name: /SEASON 9/ }).waitFor();
        assert.equal(await f.page.locator(".promo-card").count(), 0);
        assert.equal(await f.page.locator(".slip-banner").count(), 0);
        await f.page.getByLabel("League", { exact: true }).selectOption(A);
        const adminMarkets = [
          ...quotes(b),
          ...points.map((p, i) =>
            i < 3
              ? p
              : {
                  ...p,
                  matchup_key: "second-matchup",
                  home_team_id: p.away_team_id,
                  away_team_id: p.home_team_id,
                },
          ),
          ...quotes(b)
            .filter((p) => p.kind === "moneyline")
            .map((p, i) => ({
              ...p,
              id: "admin-moneyline-" + i,
              boost_pct: 0,
              odds: i ? 150 : -150,
              label: "Win · " + p.label,
            })),
          {
            ...points[0],
            id: "weekly-selection",
            kind: "weekly_high",
            label: "Weekly high scorer",
          },
          ...["over", "under"].map((side) => ({
            ...quotes(b)[0],
            id: "team-total-" + side,
            kind: "team_total",
            side,
            line: 163,
            label: "Legacy team total label",
          })),
          ...quotes(b)
            .filter((p) => p.kind === "match_total")
            .map((p) => ({
              ...p,
              id: p.id + "-second",
              matchup_key: "second-matchup",
              home_team_id: p.away_team_id,
              away_team_id: p.home_team_id,
              line: 280.5,
            })),
          {
            ...quotes(b)[2],
            id: "inactive-moneyline",
            active: false,
            boost_pct: 0,
            odds: -390,
            label: "Win · Old price",
          },
          {
            ...quotes(b)[0],
            id: "inactive-team-total",
            active: false,
            kind: "team_total",
            side: "over",
            line: 71.5,
            label: "Old total",
          },
          {
            ...quotes(b)[4],
            id: "inactive-match-total",
            active: false,
            line: 77.5,
            label: "Old match total",
          },
          {
            ...points[0],
            id: "inactive-player",
            active: false,
            matchup_key: "retired-matchup",
          },
        ];
        await f.context.route("**/rest/v1/sportsbook_boards**", (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([b]),
          }),
        );
        await f.context.route("**/rest/v1/sportsbook_markets**", (route) => {
          assert.equal(
            new URL(route.request().url()).searchParams.get("active"),
            "eq.true",
          );
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(adminMarkets),
          });
        });
        await menu(f.page, "Admin");
        await f.page.getByRole("button", { name: /Promos & Boosts/ }).click();
        await f.page
          .getByRole("heading", { name: "Offer details", exact: true })
          .waitFor();
        await f.context.route("**/api/promo-image", async (route) => {
          const body = route.request().postDataJSON();
          assert.equal(body.league_id, A);
          validatePng(body.png);
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ id: "image-fixture" }),
          });
        });
        await f.page
          .getByLabel("Title", { exact: true })
          .fill("50% Player Points boost");
        await f.page
          .getByLabel("Readable offer terms", { exact: true })
          .fill(o.description);
        await f.page.locator('input[type="file"]').setInputFiles({
          name: "fixture.png",
          mimeType: "image/png",
          buffer: Buffer.from(artwork, "base64"),
        });
        await f.page
          .getByRole("button", { name: "Save draft", exact: true })
          .click();
        await f.page
          .getByText("Draft saved. It is not public.", { exact: true })
          .waitFor();
        assert.equal(saved.terms.max_stake, 20);
        assert.equal(saved.terms.criterion, "points_min");
        assert.equal(saved.terms.count, 5);
        assert.equal(saved.status, "draft");
        assert(
          !Object.keys(saved.terms).some((k) => /cap|profit_limit/.test(k)),
        );
        assert.equal(await f.page.getByText(/extra profit cap/i).count(), 0);
        assert.equal(
          await f.page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        await f.page.screenshot({
          path: path.join(output, `admin-${width}-${theme}.png`),
          fullPage: true,
        });
        await f.page
          .getByRole("button", { name: "Schedule offer", exact: true })
          .click();
        await f.page.getByText(/Offer scheduled. It appears/).waitFor();
        assert.equal(saved.status, "scheduled");
        await f.page
          .getByLabel("Offer type", { exact: true })
          .selectOption("fixed");
        const categoryPicker = f.page.getByLabel("Selection category", {
          exact: true,
        });
        const selectionPicker = f.page.getByLabel("Add an existing selection", {
          exact: true,
        });
        assert.equal(await selectionPicker.count(), 0);
        assert.deepEqual(
          await categoryPicker
            .locator("optgroup")
            .evaluateAll((nodes) => nodes.map((n) => n.label)),
          ["Matchups", "Player Projections", "Weekly Specials"],
        );
        assert.deepEqual(
          await categoryPicker
            .locator("optgroup")
            .first()
            .locator("option")
            .evaluateAll((nodes) => nodes.map((n) => n.value)),
          ["moneyline", "spread", "match_total", "team_total"],
        );
        await categoryPicker.selectOption("moneyline");
        await f.page.waitForFunction(() =>
          document.querySelector('option[value="admin-moneyline-0"]'),
        );
        const moneylines = await selectionPicker
          .locator("option")
          .allTextContents();
        assert.equal(moneylines.length, 3);
        assert.equal(
          await selectionPicker
            .locator('option[value="inactive-moneyline"]')
            .count(),
          0,
        );
        assert.equal(await selectionPicker.locator("optgroup").count(), 1);
        assert.deepEqual(
          await selectionPicker
            .locator("optgroup option")
            .evaluateAll((nodes) => nodes.map((n) => n.value)),
          ["admin-moneyline-0", "admin-moneyline-1"],
        );
        for (const label of moneylines.slice(1)) {
          assert.match(label, / vs\. .*\([+-]150\)$/);
          assert(!label.startsWith("Win"));
        }
        await categoryPicker.selectOption("spread");
        await f.page.waitForFunction(() =>
          document.querySelector('option[value="board-0-q0"]'),
        );
        assert.equal(await selectionPicker.locator("option").count(), 3);
        for (const label of (
          await selectionPicker.locator("option").allTextContents()
        ).slice(1))
          assert.match(label, /\(-110\)$/);
        await selectionPicker.selectOption("board-0-q0");
        await categoryPicker.selectOption("player_points");
        assert.equal(await selectionPicker.count(), 0);
        const matchupPicker = f.page.getByLabel("Player Points matchup", {
          exact: true,
        });
        assert.equal(await matchupPicker.locator("option").count(), 3);
        await matchupPicker.selectOption("same-roster-numbers");
        assert.equal(await selectionPicker.inputValue(), "");
        assert(
          await f.page
            .getByRole("button", { name: "Add selection", exact: true })
            .isDisabled(),
        );
        assert.equal(await selectionPicker.locator("option").count(), 4);
        assert.equal(
          await selectionPicker.locator('option[value="point-3"]').count(),
          0,
        );
        assert.match(
          await selectionPicker.locator('option[value="point-0"]').innerText(),
          /\(\+100\)$/,
        );
        await selectionPicker.selectOption("point-0");
        await matchupPicker.selectOption("second-matchup");
        assert.equal(await selectionPicker.inputValue(), "");
        assert.equal(
          await selectionPicker.locator('option[value="point-0"]').count(),
          0,
        );
        assert.equal(
          await selectionPicker.locator('option[value="point-3"]').count(),
          1,
        );
        await matchupPicker.selectOption("same-roster-numbers");
        await selectionPicker.selectOption("point-0");
        await f.page
          .getByRole("button", { name: "Add selection", exact: true })
          .click();
        assert.equal(await f.page.locator(".promo-fixed-leg").count(), 1);
        assert.equal(
          await selectionPicker.locator('option[value="point-0"]').count(),
          0,
        );
        await categoryPicker.selectOption("weekly_high");
        assert.equal(await selectionPicker.locator("option").count(), 2);
        assert.equal(
          await selectionPicker.locator("option").last().getAttribute("value"),
          "weekly-selection",
        );
        assert.match(
          await selectionPicker.locator("option").last().innerText(),
          /\(\+100\)$/,
        );
        await categoryPicker.selectOption("match_total");
        assert.equal(await selectionPicker.locator("optgroup").count(), 2);
        for (const group of await selectionPicker.locator("optgroup").all()) {
          assert.match(await group.getAttribute("label"), / vs\. /);
          const labels = await group.locator("option").allTextContents();
          assert.equal(labels.length, 2);
          assert.match(labels[0], / vs\. .* — Over /);
          assert.match(labels[1], / vs\. .* — Under /);
        }
        assert.equal(
          await selectionPicker
            .locator('option[value="inactive-match-total"]')
            .count(),
          0,
        );
        await categoryPicker.selectOption("team_total");
        const totals = await selectionPicker
          .locator("optgroup option")
          .allTextContents();
        assert.equal(totals.length, 2);
        assert.match(totals[0], / — Over 163 \(-110\)/);
        assert.match(totals[1], / — Under 163 \(-110\)/);
        assert.equal(
          await selectionPicker
            .locator('option[value="inactive-team-total"]')
            .count(),
          0,
        );
        await categoryPicker.selectOption("weekly_low");
        assert(await selectionPicker.isDisabled());
        await categoryPicker.selectOption("player_points");
        assert.equal(await matchupPicker.inputValue(), "");
        await matchupPicker.selectOption("same-roster-numbers");
        await f.page.screenshot({
          path: path.join(output, `category-picker-${width}-${theme}.png`),
          fullPage: true,
        });
        assert.equal(
          await f.page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        await f.page.getByLabel("Week", { exact: true }).fill("6");
        assert.equal(await selectionPicker.count(), 0);
        assert.deepEqual(f.errors, []);
        evidence.push({
          width,
          height: 900,
          theme,
          checked: [
            "home placement",
            "dots",
            "claim",
            "eligibility transitions",
            "profit math",
            "wager limit",
            "replacement",
            "fixed immutability",
            "fixture acceptance",
            "league isolation",
            "categorized admin selection picker",
          ],
        });
        await f.context.close();
      }
    fs.writeFileSync(
      path.join(output, "integrated-checks.json"),
      JSON.stringify(evidence, null, 2),
    );
    console.log(
      "Integrated promo journeys passed at desktop/mobile in both themes. All network writes intercepted; no live bets or emails.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
