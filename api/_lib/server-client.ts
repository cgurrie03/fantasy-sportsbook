import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertKeyProject, environmentIdentity } from "./environment-policy.js";

// Every server entry point must use this factory. Check the target before even
// constructing an auth client, and verify the independent DB marker before use.
export async function createServerClient(
  url: string,
  key: string,
  options: Parameters<typeof createClient>[2] = {},
): Promise<SupabaseClient> {
  const env = process.env;
  if (env.BOFF_ENVIRONMENT === "test") {
    if (env.NODE_ENV !== "test" || env.VERCEL || env.VERCEL_ENV ||
        !new URL(url).hostname.endsWith(".invalid"))
      throw new Error("Synthetic runtime clients require a local .invalid test target.");
    return createClient(url, key, options);
  }
  const identity = environmentIdentity(env);
  if (url !== env.SUPABASE_URL) throw new Error("Database target mismatch.");
  assertKeyProject(key, identity.project_ref);
  const db = createClient(url, key, options);
  const marker = await db.rpc("application_environment_identity");
  if (marker.error || !marker.data ||
      marker.data.environment !== identity.environment ||
      marker.data.project_ref !== identity.project_ref ||
      marker.data.app_origin !== identity.app_origin)
    throw new Error("Database environment marker is missing or mismatched.");
  if (identity.environment === "development") {
    const owner = env.BOFF_DEV_OWNER_ID;
    if (!owner || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(owner))
      throw new Error("Development owner identity is required.");
    // Service clients remain protected by the caller's user/worker authorization.
    if (key !== env.SUPABASE_SERVICE_ROLE_KEY) {
      const auth = await db.auth.getUser();
      if (auth.error || auth.data.user?.id !== owner)
        throw new Error("Development access is restricted to its owner.");
    }
  }
  return db;
}
