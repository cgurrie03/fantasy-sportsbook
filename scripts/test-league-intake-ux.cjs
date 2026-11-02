// Fully intercepted localhost owner intake; no provider, Auth or hosted writes.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
const { setup, A, B } = require("./test-ux.cjs");
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [390, 1440]) {
      const f = await setup(browser, width, 900),
        p = f.page;
      let owner = false,
        drafts = [],
        imports = 0,
        previews = 0;
      const access = (id) => ({
        league_id: id,
        view: true,
        admin: id === A,
        configure: owner,
        platform_owner: owner,
        bet: false,
        team_id: null,
        wallet_model: "legacy",
      });
      await p.route("**/rpc/account_access", (r) =>
        r.fulfill({ json: [access(A), access(B)] }),
      );
      await p.route("**/leagues?*", (r) =>
        new URL(r.request().url()).searchParams.get("select") ===
        "provider_contract"
          ? r.fulfill({
              json: [
                {
                  provider_contract: {
                    version: 1,
                    capabilities: {
                      contract: "sleeper-nfl-intake-v1",
                      admission: "review_required",
                      families: [
                        {
                          name: "Season futures",
                          state: "review_required",
                          reasons: [],
                        },
                      ],
                      issues: [
                        {
                          code: "draft_rules",
                          detail: "Draft-order rules need owner review.",
                        },
                      ],
                    },
                  },
                },
              ],
            })
          : r.fallback(),
      );
      await p.route("**/league_intake_drafts?*", (r) =>
        r.fulfill({ json: drafts }),
      );
      await p.route("**/api/league-intake", (r) => {
        const b = r.request().postDataJSON();
        assert.equal(b.sleeper_league_id, "1234567890123456789");
        assert(b.request_key);
        previews++;
        const d = {
          id: "draft-1",
          revision: 1,
          state: "draft",
          created_at: new Date().toISOString(),
          expires_at: "2099-01-01T00:00:00Z",
          source_league_id: b.sleeper_league_id,
          imported_league_id: null,
          source: {
            name: "Separate intake fixture",
            contract: "sleeper-nfl-intake-v1",
            season: 2026,
            total_rosters: 8,
          },
          capabilities: {
            contract: "sleeper-nfl-intake-v1",
            admission: "review_required",
            families: [
              { name: "Season futures", state: "review_required", reasons: [] },
            ],
            issues: [
              {
                code: "draft_rules",
                detail: "Draft-order rules need owner review.",
              },
            ],
          },
        };
        drafts = [d];
        return r.fulfill({ json: d });
      });
      await p.route("**/rpc/import_league_intake_draft", (r) => {
        const b = r.request().postDataJSON();
        assert.equal(b.p_draft, "draft-1");
        assert.equal(b.p_expected, 1);
        assert.equal(b.p_league_season, 2);
        imports++;
        drafts[0] = {
          ...drafts[0],
          revision: 2,
          state: "imported",
          source: {},
          capabilities: {},
          imported_league_id: "new-league",
        };
        return r.fulfill({
          json: {
            league_id: "new-league",
            operations_enabled: false,
            duplicate: false,
          },
        });
      });
      let reviews = 0,
        comparisonState = "rules_changed";
      await p.route("**/api/provider-review?*", (r) => {
        reviews++;
        assert.equal(
          new URL(r.request().url()).searchParams.get("league_id"),
          A,
        );
        assert.equal(r.request().method(), "POST");
        assert.equal(r.request().postData(), null);
        return comparisonState === "error"
          ? r.fulfill({
              status: 409,
              json: {
                error:
                  "This league has no retained imported provider contract to compare.",
              },
            })
          : r.fulfill({
              json: {
                contract: "provider-drift-review-v1",
                league_id: A,
                state: comparisonState,
                baseline_season: 2026,
                observed_season:
                  comparisonState === "renewal_required" ? 2027 : 2026,
                checked_at: "2026-11-02T21:00:00Z",
                approval: "still_required",
                changes: [{ section: "scoring", count: 1, keys: ["rec"] }],
                note: "Read-only comparison. No settings changed.",
              },
            });
      });
      await p.goto("http://127.0.0.1:5185/#/admin/settings");
      await p.reload();
      assert.equal(
        await p.getByLabel("Sleeper league ID", { exact: true }).count(),
        0,
      );
      assert.equal(
        await p
          .getByRole("button", {
            name: "Compare current provider rules",
            exact: true,
          })
          .count(),
        0,
      );
      owner = true;
      await p.reload();
      await p.getByLabel("Sleeper league ID", { exact: true }).waitFor();
      const compare = p.getByRole("button", {
        name: "Compare current provider rules",
        exact: true,
      });
      await compare.waitFor();
      assert.equal(reviews, 0);
      await compare.click();
      await p
        .getByRole("heading", {
          name: "Provider changes require review",
          exact: true,
        })
        .waitFor();
      assert(
        await p
          .getByText(
            "Approval is still required, including when no changes are found.",
            { exact: true },
          )
          .isVisible(),
      );
      comparisonState = "renewal_required";
      await compare.click();
      await p
        .getByRole("heading", {
          name: "Season renewal review required",
          exact: true,
        })
        .waitFor();
      comparisonState = "unchanged";
      await compare.click();
      await p
        .getByRole("heading", {
          name: "No compared rule changes found",
          exact: true,
        })
        .waitFor();
      comparisonState = "error";
      await compare.click();
      await p
        .getByText(
          "This league has no retained imported provider contract to compare.",
          { exact: true },
        )
        .waitFor();
      assert.equal(reviews, 4);
      assert.equal(imports, 0);

      await p
        .getByLabel("Sleeper league ID", { exact: true })
        .fill("1234567890123456789");
      await p
        .getByRole("button", { name: "Preview league import", exact: true })
        .click();
      await p
        .getByText("Draft-order rules need owner review.", { exact: true })
        .waitFor();
      assert.equal(previews, 1);
      assert.equal(imports, 0);
      await p.reload();
      await p
        .getByText("Draft-order rules need owner review.", { exact: true })
        .waitFor();
      await p.getByLabel("Sportsbook league season", { exact: true }).fill("2");
      await p
        .getByLabel("Import review reason", { exact: true })
        .fill("Reviewed synthetic paused league intake");
      const save = p.getByRole("button", {
        name: "Import inactive league draft",
        exact: true,
      });
      assert(await save.isDisabled());
      await p
        .getByLabel("Confirm inactive draft import", { exact: true })
        .check();
      await save.click();
      await p
        .getByText(
          "Draft league imported. Settings approval and verified participant claims remain pending.",
          { exact: true },
        )
        .waitFor();
      await p
        .getByRole("button", {
          name: "View imported capability report",
          exact: true,
        })
        .click();
      await p
        .getByText("Draft-order rules need owner review.", { exact: true })
        .waitFor();
      assert.equal(imports, 1);
      assert.equal(f.state.betCalls, 0);
      assert.deepEqual(f.errors, []);
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 2,
        ),
      );
      await f.context.close();
    }
    console.log(
      "Phone/desktop owner-only intake previews and resumes a scoped capability draft; explicit acknowledgement imports only an inactive league. All requests intercepted.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
