// Public environment identities only. Never put credentials in this module.
export const PROJECTS = {
  development: "whlcnlacueweaqpsupqs",
  production: "bmvjcdgxwxqalaohpsnw",
} as const;
export const ORIGINS = {
  development: "https://dev.sportsbook.coopergurrie.com",
  production: "https://sportsbook.coopergurrie.com",
} as const;
export type EnvironmentValues = Record<string, string | undefined>;

export function projectReference(value: string | undefined) {
  try {
    const u = new URL(value ?? "");
    if (u.protocol !== "https:" || u.username || u.password || u.port ||
        u.search || u.hash || u.pathname !== "/") return null;
    return /^([a-z]{20})\.supabase\.co$/.exec(u.hostname)?.[1] ?? null;
  } catch { return null; }
}

export function environmentIdentity(env: EnvironmentValues) {
  const mode = env.BOFF_ENVIRONMENT;
  if (mode !== "development" && mode !== "production")
    throw new Error("An explicit application environment is required.");
  const ref = PROJECTS[mode];
  if (env.BOFF_EXPECTED_PROJECT_REF !== ref ||
      projectReference(env.SUPABASE_URL) !== ref ||
      (env.VITE_SUPABASE_URL && projectReference(env.VITE_SUPABASE_URL) !== ref) ||
      env.BOFF_APP_ORIGIN !== ORIGINS[mode])
    throw new Error("Application and database environment identities disagree.");
  if (env.VERCEL_ENV && env.VERCEL_ENV !== (mode === "production" ? "production" : "preview"))
    throw new Error("Deployment scope disagrees with the application environment.");
  if (mode === "production" && env.VERCEL_ENV !== "production")
    throw new Error("Production initialization requires a production deployment.");
  if (mode === "development" && (env.BOFF_MAIL_MODE !== "capture" ||
      env.BOFF_AUTOMATION_MODE !== "manual" || env.RESEND_API_KEY))
    throw new Error("Development requires captured mail and manual automation.");
  return { environment: mode, project_ref: ref, app_origin: ORIGINS[mode] };
}

export function assertKeyProject(key: string, ref: string) {
  // Legacy JWTs carry a project reference. New opaque keys are checked by the
  // database marker; decoding a JWT here is an identity check, not authentication.
  if (!key.includes(".")) return;
  try {
    const part = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(part));
    if (claims.ref !== ref) throw new Error();
  } catch { throw new Error("Database key does not identify the expected project."); }
}
