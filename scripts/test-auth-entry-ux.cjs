// All Auth/REST requests intercepted; no real email, account or hosted session.
const { chromium, webkit } = require("playwright");
const assert = require("node:assert/strict");
const { setup } = require("./test-ux.cjs");
(async () => {
  for (const [engine, width] of [
    [chromium, 1440],
    [webkit, 390],
  ]) {
    const browser = await engine.launch({ headless: true });
    try {
      const f = await setup(browser, width, 844, false),
        p = f.page;
      await p.clock.install();
      const peer = await f.context.newPage();
      peer.setDefaultTimeout(5000);
      await peer.goto("http://127.0.0.1:5185/");
      await peer.getByLabel("Email Address", { exact: true }).waitFor();
      let calls = 0,
        last,
        redirect,
        limited = false,
        neutral = false;
      await f.context.route("**/auth/v1/otp**", async (r) => {
        calls++;
        last = r.request().postDataJSON();
        redirect = new URL(r.request().url()).searchParams.get("redirect_to");
        await new Promise((resolve) => setTimeout(resolve, 120));
        return r.fulfill(
          limited
            ? {
                status: 429,
                headers: {
                  "x-supabase-api-version": "2024-01-01",
                  "access-control-expose-headers": "x-supabase-api-version",
                },
                json: {
                  code: "over_email_send_rate_limit",
                  msg: "private provider diagnostic",
                },
              }
            : neutral
              ? {
                  status: 422,
                  headers: {
                    "x-supabase-api-version": "2024-01-01",
                    "access-control-expose-headers": "x-supabase-api-version",
                  },
                  json: {
                    code: "user_not_found",
                    msg: "private user diagnostic",
                  },
                }
              : { json: { user: null, session: null } },
        );
      });
      await p
        .getByLabel("Email Address", { exact: true })
        .fill("fixture@example.test");
      await p.locator("form").evaluate((form) => {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      });
      await p.getByRole("heading", { name: "Check Your Email" }).waitFor();
      assert.equal(calls, 1, "same-turn duplicate submit issues one request");
      assert.equal(
        last.create_user,
        false,
        "closed Development signs in its existing owner",
      );
      assert.equal(redirect, "http://127.0.0.1:5185/");
      assert.match(
        await p.locator(".signin-card").innerText(),
        /If fixture@example.test can sign in/,
      );
      await peer.getByRole("button", { name: /Resend In/ }).waitFor();
      await p.reload();
      await p.getByRole("button", { name: /Resend In/ }).waitFor();
      assert.equal(calls, 1, "reload and cross-tab sync do not issue requests");
      await p.clock.fastForward(61000);
      await p
        .getByRole("button", { name: "Email Me A Sign-In Link", exact: true })
        .waitFor();
      await p
        .getByLabel("Email Address", { exact: true })
        .fill("fixture@example.test");
      limited = true;
      await p
        .getByRole("button", { name: "Email Me A Sign-In Link", exact: true })
        .click();
      await p
        .getByRole("alert")
        .filter({ hasText: /Too many sign-in requests/ })
        .waitFor();
      assert.equal(calls, 2);
      await p.getByRole("button", { name: /Resend In/ }).waitFor();
      assert(
        !(await p.locator(".signin-card").innerText()).includes(
          "private provider diagnostic",
        ),
      );
      await p.reload();
      await p.getByRole("button", { name: /Resend In/ }).waitFor();
      await p.clock.fastForward(61000);
      await p
        .getByRole("button", { name: "Email Me A Sign-In Link", exact: true })
        .waitFor();
      await p
        .getByLabel("Email Address", { exact: true })
        .fill("fixture@example.test");
      limited = false;
      neutral = true;
      await p
        .getByRole("button", { name: "Email Me A Sign-In Link", exact: true })
        .click();
      await p.getByRole("heading", { name: "Check Your Email" }).waitFor();
      assert.match(
        await p.locator(".signin-card").innerText(),
        /If fixture@example.test can sign in/,
      );
      assert(
        !(await p.locator(".signin-card").innerText()).includes(
          "private user diagnostic",
        ),
      );
      assert.equal(calls, 3);
      await p
        .getByRole("button", { name: "Use Another Email", exact: true })
        .click();
      await p.getByRole("button", { name: /Resend In/ }).waitFor();
      assert.deepEqual(f.errors, []);
      assert.equal(f.state.betCalls, 0);
      await f.context.close();
    } finally {
      await browser.close();
    }
  }
  console.log(
    "Auth entry: Chromium/desktop and WebKit/phone; synchronous duplicate guard, existing-user Development request, neutral identity response, cross-tab/reload cooldown, expiry/retry, 429 backoff and no diagnostic disclosure. All requests intercepted; no actual Auth limit or email delivery claim.",
  );
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
