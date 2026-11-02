// This short-lived browser-tab hint carries no authority. The server rechecks
// the invitation, verified identity, expiry and owner approval on every action.
const key = "sportsbook-pending-invitation-v1";
export function captureTeamInvitation(): string {
  const token = /^#\/join\/([0-9a-f]{64})$/.exec(window.location.hash)?.[1];
  if (token) {
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({ token, expires: Date.now() + 3600000 }),
      );
    } catch {
      /* The user can reopen their invitation if tab storage is disabled. */
    }
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search + "#/join",
    );
    return token;
  }
  try {
    const raw = sessionStorage.getItem(key);
    if (raw && raw.length <= 200) {
      const value = JSON.parse(raw);
      if (
        /^[0-9a-f]{64}$/.test(value.token) &&
        typeof value.expires === "number" &&
        value.expires > Date.now() &&
        value.expires <= Date.now() + 3600000
      )
        return value.token;
    }
    sessionStorage.removeItem(key);
  } catch {
    /* Invitation entry remains available without browser storage. */
  }
  return "";
}
export function forgetTeamInvitation() {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* No persistent state to clear. */
  }
}
