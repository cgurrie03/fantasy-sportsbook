type Account = { id: string; name?: string; email?: string };
const legacyProfileKey = "boff-visual-profile";
export const accountStorageKey = (kind: string, id: string) => `boff-${kind}:${id}`;

export function accountProfile(account?: Account | null) {
  // Never migrate the shared record: its owner cannot be established.
  try { localStorage.removeItem(legacyProfileKey); } catch {}
  let name = account?.name || "";
  if (account?.id) {
    try {
      const saved = JSON.parse(localStorage.getItem(accountStorageKey("profile", account.id)) || "{}");
      if (typeof saved.name === "string" && saved.name.trim()) name = saved.name;
    } catch {}
  }
  return { name, email: account?.email || "" };
}

export function saveAccountProfile(account: Account, name: string) {
  localStorage.setItem(accountStorageKey("profile", account.id), JSON.stringify({ name: name.trim() }));
}

export function clearAccountState(id?: string) {
  try {
    localStorage.removeItem(legacyProfileKey);
    localStorage.removeItem("boff-visual-settings");
    if (id) localStorage.removeItem(accountStorageKey("profile", id));
  } catch {}
}
