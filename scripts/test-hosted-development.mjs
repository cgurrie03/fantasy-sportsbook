import assert from "node:assert/strict";
import { verifyHostedDevelopment } from "./verify-hosted-development.mjs";

const ref = "whlcnlacueweaqpsupqs";
const origin = "https://dev.sportsbook.coopergurrie.com";
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const env = {
  VERCEL: "1", VERCEL_ENV: "preview", BOFF_ENVIRONMENT: "development",
  BOFF_EXPECTED_PROJECT_REF: ref, BOFF_APP_ORIGIN: origin,
  BOFF_MAIL_MODE: "capture", BOFF_AUTOMATION_MODE: "manual",
  BOFF_DEV_OWNER_ID: owner, VITE_BOFF_DEV_OWNER_ID: owner,
  VITE_BOFF_DEV_OWNER_EMAIL: "owner@example.test",
  VITE_BOFF_ENVIRONMENT: "development", VITE_BOFF_EXPECTED_PROJECT_REF: ref,
  VITE_BOFF_APP_ORIGIN: origin, VITE_BOFF_DEPLOYMENT_SCOPE: "preview",
  SUPABASE_URL: `https://${ref}.supabase.co`, VITE_SUPABASE_URL: `https://${ref}.supabase.co`,
  VITE_SUPABASE_PUBLISHABLE_KEY: "synthetic-public-key", SUPABASE_ANON_KEY: "synthetic-public-key",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-only-key",
  WEEKLY_WORKER_SECRET: "synthetic-development-secret-for-fixtures",
};
function mock(overrides = {}) {
  const calls = [];
  const fetcher = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.equal(url.hostname, `${ref}.supabase.co`);
    calls.push(url.pathname);
    const routes = {
      "/rest/v1/rpc/application_environment_identity": { environment: "development", project_ref: ref, app_origin: origin },
      [`/auth/v1/admin/users/${owner}`]: { id: owner, email: "owner@example.test", email_confirmed_at: "2026-10-28T00:00:00Z" },
      "/auth/v1/settings": { disable_signup: true, external: { anonymous_users: false } },
      ...overrides,
    };
    assert.ok(Object.hasOwn(routes, url.pathname), "Unexpected hosted request");
    return Response.json(routes[url.pathname]);
  };
  return { calls, fetcher };
}
const valid = mock();
assert.deepEqual(await verifyHostedDevelopment(env, valid.fetcher), { verified: true });
assert.equal(valid.calls.length, 3);
for (const overrides of [
  { "/rest/v1/rpc/application_environment_identity": { environment: "production", project_ref: "bmvjcdgxwxqalaohpsnw", app_origin: origin } },
  { [`/auth/v1/admin/users/${owner}`]: { id: owner, email: "wrong@example.test", email_confirmed_at: "2026-10-28" } },
  { [`/auth/v1/admin/users/${owner}`]: { id: owner, email: "owner@example.test" } },
  { "/auth/v1/settings": { disable_signup: false, external: { anonymous_users: false } } },
  { "/auth/v1/settings": { disable_signup: true, external: { anonymous_users: true } } },
]) await assert.rejects(verifyHostedDevelopment(env, mock(overrides).fetcher));
const unsafe = mock();
await assert.rejects(verifyHostedDevelopment({ ...env, SUPABASE_URL: "https://bmvjcdgxwxqalaohpsnw.supabase.co" }, unsafe.fetcher));
assert.equal(unsafe.calls.length, 0, "Reject production configuration before network access");
assert.deepEqual(await verifyHostedDevelopment({}, unsafe.fetcher), { skipped: true });
console.log("Hosted development checks reject wrong targets, owner mismatches and open signup without mutations.");
