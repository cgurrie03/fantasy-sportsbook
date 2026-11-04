// One timestamp per application origin; no email, token or request history.
export const AUTH_RESEND_SECONDS = 60;
export const AUTH_COOLDOWN_KEY = "sportsbook-auth-retry-until-v1";
export function cooldownSeconds(until: number, now = Date.now()): number {
  if (!Number.isFinite(until) || until > now + (AUTH_RESEND_SECONDS + 1) * 1000)
    return 0;
  return Math.max(
    0,
    Math.min(AUTH_RESEND_SECONDS, Math.ceil((until - now) / 1000)),
  );
}
export function readAuthCooldown(now = Date.now()): number {
  try {
    const until = Number(localStorage.getItem(AUTH_COOLDOWN_KEY));
    if (cooldownSeconds(until, now) > 0) return until;
    localStorage.removeItem(AUTH_COOLDOWN_KEY);
  } catch {
    /* Storage is optional; the current tab retains its own deadline. */
  }
  return 0;
}
export function beginAuthCooldown(now = Date.now()): number {
  const until = now + AUTH_RESEND_SECONDS * 1000;
  try {
    localStorage.setItem(AUTH_COOLDOWN_KEY, String(until));
  } catch {
    /* Keep the in-memory cooldown if browser storage is unavailable. */
  }
  return until;
}
export function authRequestFailure(error: unknown): {
  limited: boolean;
  neutral: boolean;
  message: string;
} {
  const value =
    error && typeof error === "object"
      ? (error as { status?: number; code?: string })
      : {};
  const limited =
    value.status === 429 ||
    ["over_email_send_rate_limit", "over_request_rate_limit"].includes(
      value.code ?? "",
    );
  const neutral = [
    "user_not_found",
    "user_banned",
    "signup_disabled",
    "email_not_confirmed",
  ].includes(value.code ?? "");
  return {
    limited,
    neutral,
    message: limited
      ? "Too many sign-in requests. Wait at least one minute before trying again. If the service is still limited, try later."
      : "Unable to request a sign-in link. Check your connection and try again, or contact your league administrator.",
  };
}
