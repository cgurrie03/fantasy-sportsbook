import assert from "node:assert/strict";
import { checkDevelopmentEnvironment } from "./check-development-environment.mjs";

const ref = "whlcnlacueweaqpsupqs";
const fixture = {
  BOFF_ENVIRONMENT: "development",
  BOFF_EXPECTED_PROJECT_REF: ref,
  BOFF_APP_ORIGIN: "https://dev.sportsbook.coopergurrie.com",
  BOFF_MAIL_MODE: "capture",
  BOFF_AUTOMATION_MODE: "manual",
  BOFF_DEV_OWNER_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  VITE_BOFF_DEV_OWNER_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  VITE_BOFF_DEV_OWNER_EMAIL: "owner@example.test",
  VITE_BOFF_ENVIRONMENT: "development",
  VITE_BOFF_EXPECTED_PROJECT_REF: ref,
  VITE_BOFF_APP_ORIGIN: "https://dev.sportsbook.coopergurrie.com",
  VITE_BOFF_DEPLOYMENT_SCOPE: "preview",
  SUPABASE_URL: `https://${ref}.supabase.co`,
  VITE_SUPABASE_URL: `https://${ref}.supabase.co`,
  VITE_SUPABASE_PUBLISHABLE_KEY: "synthetic-public-key",
  SUPABASE_ANON_KEY: "synthetic-public-key",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-only-key",
  WEEKLY_WORKER_SECRET: "synthetic-development-secret-for-fixtures",
};
assert.deepEqual(checkDevelopmentEnvironment(fixture), []);
const unsafeCases = [
  {},
  { ...fixture, BOFF_ENVIRONMENT: "production" },
  { ...fixture, BOFF_EXPECTED_PROJECT_REF: "bmvjcdgxwxqalaohpsnw" },
  { ...fixture, SUPABASE_URL: "https://bmvjcdgxwxqalaohpsnw.supabase.co" },
  { ...fixture, VITE_SUPABASE_URL: "https://bmvjcdgxwxqalaohpsnw.supabase.co" },
  { ...fixture, SUPABASE_URL: "https://differentdevelopment.supabase.co" },
  { ...fixture, SUPABASE_URL: `http://${ref}.supabase.co` },
  { ...fixture, SUPABASE_URL: `https://${ref}.supabase.co?token=sensitive` },
  { ...fixture, SUPABASE_URL: `https://user:password@${ref}.supabase.co` },
  { ...fixture, SUPABASE_URL: `https://${ref}.supabase.co/path` },
  { ...fixture, BOFF_APP_ORIGIN: "https://sportsbook.coopergurrie.com" },
  { ...fixture, BOFF_MAIL_MODE: "deliver" },
  { ...fixture, RESEND_API_KEY: "synthetic-delivery-key" },
  { ...fixture, BOFF_AUTOMATION_MODE: "scheduled" },
  { ...fixture, SUPABASE_SERVICE_ROLE_KEY: "" },
  { ...fixture, WEEKLY_WORKER_SECRET: "short" },
  { ...fixture, SUPABASE_ANON_KEY: "another-public-key" },
  { ...fixture, VITE_SERVICE_ROLE_KEY: "synthetic-private-value" },
  { ...fixture, VITE_BOFF_EXPECTED_PROJECT_REF: "bmvjcdgxwxqalaohpsnw" },
  { ...fixture, VITE_BOFF_ENVIRONMENT: "production" },
  { ...fixture, VITE_BOFF_APP_ORIGIN: "https://wrong.example" },
  { ...fixture, VITE_BOFF_DEPLOYMENT_SCOPE: "production" },
  { ...fixture, BOFF_DEV_OWNER_ID: "" },
  { ...fixture, VITE_BOFF_DEV_OWNER_ID: "wrong" },
  { ...fixture, VITE_BOFF_DEV_OWNER_EMAIL: "" },
  { ...fixture, VERCEL_ENV: "production" },
];
for (const unsafe of unsafeCases) {
  const errors = checkDevelopmentEnvironment(unsafe);
  assert.ok(errors.length, "Unsafe configuration must fail closed.");
  assert.ok(!errors.join(" ").includes("sensitive"));
  assert.ok(!errors.join(" ").includes("synthetic-private-value"));
}
console.log(`Development preflight: valid fixture and ${unsafeCases.length} unsafe configurations checked.`);
