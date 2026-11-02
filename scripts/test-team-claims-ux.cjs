// Isolated localhost fixtures: no owner session, hosted writes or mail.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
const { setup, A, B, teams } = require("./test-ux.cjs");
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [390, 1440]) {
      const f = await setup(browser, width, 900),
        p = f.page;
      let owner = false,
        issues = 0,
        submits = 0,
        reviews = 0,
        invites = [],
        claims = [],
        body;
      const target = teams.find((t) => t.league_id === A).id,
        code = "ab".repeat(32);
      await p.route("**/rpc/account_access", (r) =>
        r.fulfill({
          json: [A, B].map((id) => ({
            league_id: id,
            view: true,
            admin: id === A,
            configure: owner,
            platform_owner: owner,
            bet: false,
            team_id: null,
            wallet_model: "legacy",
          })),
        }),
      );
      await p.route("**/rpc/team_claim_directory", (r) => {
        const b = r.request().postDataJSON();
        assert(b.p_league === A || b.p_league === null);
        return r.fulfill({
          json: { claims, invitations: b.p_league ? invites : [] },
        });
      });
      await p.route("**/rpc/issue_team_invitation", (r) => {
        body = r.request().postDataJSON();
        assert.equal(body.p_league, A);
        assert.equal(body.p_team, null);
        assert.equal(body.p_email, null);
        assert.match(body.p_digest, /^[0-9a-f]{64}$/);
        assert(!("p_token" in body));
        issues++;
        invites = [
          {
            id: "invite-1",
            revision: 1,
            team_id: null,
            invited_email: null,
            state: "open",
            expires_at: "2099-01-01T00:00:00Z",
          },
        ];
        return r.fulfill({ json: { id: "invite-1" } });
      });
      await p.route("**/rpc/team_invitation_preview", (r) => {
        const b = r.request().postDataJSON();
        assert.equal(b.p_token, code);
        return r.fulfill({
          json: {
            league_name: "Synthetic league",
            teams: [{ id: target, name: "Claim fixture team" }],
          },
        });
      });
      await p.route("**/rpc/submit_team_claim", (r) => {
        const b = r.request().postDataJSON();
        assert.equal(b.p_token, code);
        assert.equal(b.p_team, target);
        assert.equal(b.p_name, "Co-owner fixture");
        submits++;
        claims = [
          {
            id: "claim-1",
            league_id: A,
            team_id: target,
            display_name: "Co-owner fixture",
            verified_email: "fixture@example.invalid",
            state: "pending",
            revision: 1,
            league_name: "Synthetic league",
            team_name: "Claim fixture team",
          },
        ];
        return r.fulfill({ json: { id: "claim-1", state: "pending" } });
      });
      await p.route("**/rpc/review_team_claim", (r) => {
        const b = r.request().postDataJSON();
        assert.equal(b.p_claim, "claim-1");
        assert.equal(b.p_expected, 1);
        assert.equal(b.p_action, "approve");
        assert(b.p_reason.length >= 8);
        reviews++;
        claims[0] = { ...claims[0], revision: 2, state: "approved" };
        return r.fulfill({
          json: { state: "approved", wallet_id: "wallet-1" },
        });
      });
      await p.goto("http://127.0.0.1:5185/#/admin/settings");
      assert.equal(
        await p
          .getByRole("heading", {
            name: "Invitations and team claims",
            exact: true,
          })
          .count(),
        0,
      );
      owner = true;
      await p.reload();
      await p
        .getByRole("heading", {
          name: "Invitations and team claims",
          exact: true,
        })
        .waitFor();
      const create = p.getByRole("button", {
        name: "Create signup link",
        exact: true,
      });
      assert(await create.isDisabled());
      await p
        .getByLabel("Claim review reason", { exact: true })
        .fill("Reviewed shared league invitation");
      await create.click();
      const link = await p
        .getByLabel("Copy invitation link", { exact: true })
        .inputValue();
      assert.match(link, /^http:\/\/127\.0\.0\.1:5185\/#\/join\/[0-9a-f]{64}$/);
      assert.equal(issues, 1);
      assert.equal(
        require("node:crypto")
          .createHash("sha256")
          .update(link.split("/").at(-1))
          .digest("hex"),
        body.p_digest,
      );
      // A verified participant needs no pre-existing team or league directory.
      owner = false;
      await p.goto("http://127.0.0.1:5185/#/join/" + code);
      await p
        .getByRole("heading", { name: "Request team access", exact: true })
        .waitFor();
      assert.equal(new URL(p.url()).hash, "#/join");
      await p.reload();
      assert.equal(
        await p
          .getByLabel("Invitation code or link", { exact: true })
          .inputValue(),
        code,
      );
      await p
        .getByRole("button", { name: "Review invitation", exact: true })
        .click();
      await p
        .getByLabel("Participant display name", { exact: true })
        .fill("Co-owner fixture");
      await p
        .getByRole("button", { name: "Request owner approval", exact: true })
        .click();
      await p
        .getByText("Synthetic league · Claim fixture team · pending", {
          exact: true,
        })
        .waitFor();
      assert.equal(submits, 1);
      assert.equal(
        await p.evaluate(() =>
          sessionStorage.getItem("sportsbook-pending-invitation-v1"),
        ),
        null,
      );
      assert.equal(
        await p
          .getByLabel("Invitation code or link", { exact: true })
          .inputValue(),
        "",
      );
      owner = true;
      await p.goto("http://127.0.0.1:5185/#/admin/settings");
      await p
        .getByLabel("Claim review reason", { exact: true })
        .fill("Reviewed verified account and co-owner claim");
      await p
        .getByRole("button", {
          name: "Approve claim for Co-owner fixture",
          exact: true,
        })
        .click();
      await p
        .getByText(
          "Claim approved. Independent wallet funding remains pending.",
          { exact: true },
        )
        .waitFor();
      assert.equal(reviews, 1);
      assert.equal(f.state.betCalls, 0);
      assert.deepEqual(f.errors, []);
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 2,
        ),
      );
      await p.screenshot({
        path: `work/team-claims-${width}.png`,
        fullPage: true,
      });
      await f.context.close();
    }
    console.log(
      "Phone/desktop: owner-only shared signup links, digest-only issuance, token stripped from URL, verified pending team request, explicit owner review and independent pending funding. All traffic intercepted.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
