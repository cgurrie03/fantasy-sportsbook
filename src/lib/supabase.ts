import { createClient } from "@supabase/supabase-js";
import { assertKeyProject, environmentIdentity } from "../../api/_lib/environment-policy";
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const mode = import.meta.env.VITE_BOFF_ENVIRONMENT;
const identity = url && publishableKey ? environmentIdentity({
  BOFF_ENVIRONMENT: mode,
  BOFF_EXPECTED_PROJECT_REF: import.meta.env.VITE_BOFF_EXPECTED_PROJECT_REF,
  BOFF_APP_ORIGIN: import.meta.env.VITE_BOFF_APP_ORIGIN,
  SUPABASE_URL: url,
  BOFF_MAIL_MODE: mode === "development" ? "capture" : "delivery",
  BOFF_AUTOMATION_MODE: mode === "development" ? "manual" : "scheduled",
  VERCEL_ENV: import.meta.env.VITE_BOFF_DEPLOYMENT_SCOPE === "development"
    ? undefined : import.meta.env.VITE_BOFF_DEPLOYMENT_SCOPE,
}) : null;
if (identity && publishableKey) assertKeyProject(publishableKey, identity.project_ref);
const browserLocation = (globalThis as unknown as {
  location: { origin: string; hostname: string };
}).location;
if (identity && browserLocation.origin !== identity.app_origin &&
    !(identity.environment === "development" &&
      ["localhost", "127.0.0.1"].includes(browserLocation.hostname)))
  throw new Error("This application origin is not approved for its environment.");

let verified: Promise<void> | undefined;
async function guardedFetch(...[input, init]: Parameters<typeof fetch>) {
  if (!identity) throw new Error("Application environment is not configured.");
  // Keep this bounded to one small check per page, shared by parallel requests.
  verified ??= (async () => {
    const r = await fetch(`${url}/rest/v1/rpc/application_environment_identity`, {
      method: "POST", headers: { apikey: publishableKey!, Authorization: `Bearer ${publishableKey}`,
        "Content-Type": "application/json" }, body: "{}",
      signal: AbortSignal.timeout(8000),
    });
    const marker = r.ok ? await r.json() as typeof identity : null;
    if (!marker || marker.environment !== identity.environment ||
        marker.project_ref !== identity.project_ref || marker.app_origin !== identity.app_origin)
      throw new Error("Database environment verification failed.");
  })().catch((error) => { verified = undefined; throw error; });
  await verified;
  if (identity.environment === "development") {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.pathname === "/auth/v1/otp") {
      const body = input instanceof Request ? await input.clone().text() : init?.body;
      const email = typeof body === "string" ? JSON.parse(body).email : null;
      if (!email || email.toLowerCase() !== import.meta.env.VITE_BOFF_DEV_OWNER_EMAIL?.toLowerCase())
        throw new Error("Development sign-in is restricted to its owner.");
    }
  }
  return fetch(input, init);
}

export function developmentUserAllowed(userId: string) {
  return !identity || identity.environment !== "development" ||
    userId === import.meta.env.VITE_BOFF_DEV_OWNER_ID;
}
export const supabase =
  url && publishableKey ? createClient(url, publishableKey, {
    global: { fetch: guardedFetch },
    auth: { storageKey: `sportsbook-${identity!.environment}-${identity!.project_ref}` },
  }) : null;
