import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { checkDevelopmentEnvironment } from "./check-development-environment.mjs";
import { assertKeyProject } from "../api/_lib/environment-policy.ts";

export async function verifyHostedDevelopment(env = process.env, fetcher = fetch) {
  if (!env.VERCEL || env.BOFF_ENVIRONMENT !== "development") return { skipped: true };
  const errors = checkDevelopmentEnvironment(env);
  if (errors.length) throw new Error(errors.join(" "));
  assertKeyProject(env.SUPABASE_SERVICE_ROLE_KEY, env.BOFF_EXPECTED_PROJECT_REF);
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher },
  });
  const marker = await db.rpc("application_environment_identity");
  if (marker.error || marker.data?.environment !== "development" ||
      marker.data?.project_ref !== env.BOFF_EXPECTED_PROJECT_REF ||
      marker.data?.app_origin !== env.BOFF_APP_ORIGIN)
    throw new Error("Hosted development database verification failed.");
  const user = await db.auth.admin.getUserById(env.BOFF_DEV_OWNER_ID);
  if (user.error || user.data.user?.id !== env.BOFF_DEV_OWNER_ID ||
      user.data.user?.email?.toLowerCase() !== env.VITE_BOFF_DEV_OWNER_EMAIL.toLowerCase() ||
      !user.data.user?.email_confirmed_at)
    throw new Error("The independent development owner is not verified.");
  const response = await fetcher(`${env.SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: env.SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(8000),
  });
  const settings = response.ok ? await response.json() : null;
  if (!settings?.disable_signup || settings.external?.anonymous_users)
    throw new Error("Development public signup and anonymous sign-in must be disabled.");
  return { verified: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyHostedDevelopment();
    if (result.verified) console.log("Verified development target, server key, independent owner, closed signup, captured mail and manual automation. No data changed or messages sent.");
  } catch {
    console.error("Hosted development verification failed. Check the development-only configuration and owner account; no credential values are logged.");
    process.exitCode = 1;
  }
}
