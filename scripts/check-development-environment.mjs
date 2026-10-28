import { pathToFileURL } from "node:url";

// Offline configuration preflight only. Runtime identity, RLS, delivery and
// deployment protection still need independent enforcement and hosted checks.
const productionRef = "bmvjcdgxwxqalaohpsnw";
const developmentRef = "whlcnlacueweaqpsupqs";
const developmentOrigin = "https://dev.sportsbook.coopergurrie.com";

function projectReference(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) return null;
    return /^([a-z]{20})\.supabase\.co$/.exec(url.hostname)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function checkDevelopmentEnvironment(env) {
  const errors = [];
  const expected = env.BOFF_EXPECTED_PROJECT_REF?.trim();
  if (env.BOFF_ENVIRONMENT !== "development")
    errors.push("BOFF_ENVIRONMENT must explicitly identify development.");
  if (expected !== developmentRef)
    errors.push("Expected project must be a separate hosted development project.");
  for (const name of ["SUPABASE_URL", "VITE_SUPABASE_URL"]) {
    const ref = projectReference(env[name]);
    if (!ref || ref === productionRef || ref !== expected)
      errors.push(`${name} must identify the expected non-production project.`);
  }
  if (env.BOFF_APP_ORIGIN !== developmentOrigin)
    errors.push("BOFF_APP_ORIGIN must identify the approved development origin.");
  if (env.BOFF_MAIL_MODE !== "capture")
    errors.push("Initial development mail mode must be capture.");
  if (env.RESEND_API_KEY)
    errors.push("Initial development must not have a live mail delivery key.");
  if (env.BOFF_AUTOMATION_MODE !== "manual")
    errors.push("Initial development automation mode must be manual.");
  for (const suffix of ["ENVIRONMENT", "EXPECTED_PROJECT_REF", "APP_ORIGIN"])
    if (env[`VITE_BOFF_${suffix}`] !== env[`BOFF_${suffix}`])
      errors.push(`VITE_BOFF_${suffix} must match its server setting.`);
  if (env.VITE_BOFF_DEPLOYMENT_SCOPE !== "preview" ||
      (env.VERCEL_ENV && env.VERCEL_ENV !== "preview"))
    errors.push("Hosted development requires Preview scope.");
  if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(env.BOFF_DEV_OWNER_ID ?? "") ||
      env.BOFF_DEV_OWNER_ID !== env.VITE_BOFF_DEV_OWNER_ID)
    errors.push("Independent development owner IDs must be valid and agree.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.VITE_BOFF_DEV_OWNER_EMAIL ?? ""))
    errors.push("Development owner sign-in email is required.");
  for (const name of [
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "WEEKLY_WORKER_SECRET",
  ]) {
    if (!env[name]?.trim() || /^(replace|example|fixture|test-only)/i.test(env[name]))
      errors.push(`${name} needs its development-only value before hosted setup.`);
  }
  if (
    env.VITE_SUPABASE_PUBLISHABLE_KEY &&
    env.SUPABASE_ANON_KEY &&
    env.VITE_SUPABASE_PUBLISHABLE_KEY !== env.SUPABASE_ANON_KEY
  ) errors.push("Frontend and server public keys must match for initial setup.");
  if (env.WEEKLY_WORKER_SECRET && env.WEEKLY_WORKER_SECRET.length < 32)
    errors.push("Development worker secret must contain at least 32 characters.");
  for (const name of Object.keys(env)) {
    if (/^VITE_.*(SERVICE_ROLE|SECRET|PRIVATE|RESEND)/i.test(name) && env[name])
      errors.push("A server secret must never be exposed as a VITE variable.");
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = checkDevelopmentEnvironment(process.env);
  if (errors.length) {
    console.error("Development preflight failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Offline development configuration checks passed. Hosted runtime isolation, database identity, mail capture and access protection still require verification.");
  }
}
