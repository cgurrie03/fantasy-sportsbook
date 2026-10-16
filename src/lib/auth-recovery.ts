// Verified in the hosted project's Email provider settings on 2026-10-16.
export { SIGN_IN_LINK_MINUTES } from "../../api/_lib/auth-policy";
export function authRecoveryMessage(hash = window.location.hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (params.has("error") || params.has("error_code"))
    return "This sign-in link is invalid, expired, or already used. Request a new link below and open the newest email in the browser you want to use.";
  return "";
}
