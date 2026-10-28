import { spawnSync } from "node:child_process";
if (!process.env.npm_execpath || process.env.VERCEL || process.env.VERCEL_ENV)
  throw new Error("Run npm run build:fixture locally or in CI; never on hosting.");
const ref = "whlcnlacueweaqpsupqs";
const env = { ...process.env };
for (const key of Object.keys(env))
  if (/^(BOFF_|VITE_|SUPABASE_|RESEND_|WEEKLY_WORKER_SECRET)/.test(key)) delete env[key];
Object.assign(env, {
  BOFF_ENVIRONMENT: "development", BOFF_EXPECTED_PROJECT_REF: ref,
  BOFF_APP_ORIGIN: "https://dev.sportsbook.coopergurrie.com",
  BOFF_MAIL_MODE: "capture", BOFF_AUTOMATION_MODE: "manual",
  BOFF_DEV_OWNER_ID: "cccccccc-3333-4333-8333-333333333333",
  SUPABASE_URL: `https://${ref}.supabase.co`, VITE_SUPABASE_URL: `https://${ref}.supabase.co`,
  VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-only-not-a-real-key",
  VITE_BOFF_ENVIRONMENT: "development", VITE_BOFF_EXPECTED_PROJECT_REF: ref,
  VITE_BOFF_APP_ORIGIN: "https://dev.sportsbook.coopergurrie.com",
  VITE_BOFF_DEPLOYMENT_SCOPE: "development",
  VITE_BOFF_DEV_OWNER_ID: "cccccccc-3333-4333-8333-333333333333",
  VITE_BOFF_DEV_OWNER_EMAIL: "fixture@example.test",
});
const child = spawnSync(process.execPath, [process.env.npm_execpath, "run", "build"], {
  env, stdio: "inherit",
});
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
