import fixture from "./data.json";
const leagueId = fixture.leagueId;
const scoped = new Set([
  "matchups",
  "futures",
  "my-bets",
  "all-bets",
  "league",
  "profile",
  "commissioner",
]);
export function routeUrl(route: string) {
  const value = route.replace(/^#/, "");
  if (value === "home" || !value) return "/";
  if (value === "platform") return "/platform";
  if (value === "access") return "/sign-in";
  if (value === "setup") return "/leagues/new";
  return "/" + leagueId + "/" + value;
}
export function currentRoute() {
  const parts = location.pathname.split("/").filter(Boolean);
  if (!parts.length) return "home";
  if (parts[0] === "t" && parts.length === 2) return "shared-ticket";
  if (location.pathname === "/platform") return "platform";
  if (location.pathname === "/sign-in") return "access";
  if (location.pathname === "/leagues/new") return "setup";
  if (parts[0] !== leagueId)
    return /^\d+$/.test(parts[0]) ? "league-unavailable" : "not-found";
  if (parts.length === 1) return "matchups";
  if (parts[1] === "matchup" && parts.length === 3)
    return fixture.markets.some((m) => m.matchup === parts[2])
      ? "matchup/" + parts[2]
      : "not-found";
  return parts.length === 2 && scoped.has(parts[1]) ? parts[1] : "not-found";
}
export const routeQuery = () => new URLSearchParams(location.search);
export function navigate(route: string, replace = false) {
  const url = routeUrl(route);
  if (location.pathname + location.search === url) return;
  history[replace ? "replaceState" : "pushState"]({}, "", url);
  window.dispatchEvent(new Event("boff-navigation"));
}
export function installRouting() {
  const migrate = () => {
    if (location.hash && location.hash !== "#main-content")
      navigate(decodeURI(location.hash.slice(1)), true);
  };
  if(location.pathname===`/${leagueId}/offers`){
    const query=routeQuery();
    if(!query.has("offer"))query.set("boosts","1");
    navigate("matchups?"+query,true);
  }
  migrate();
  window.addEventListener("hashchange", migrate);
  document.addEventListener("click", (e) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      e.shiftKey
    )
      return;
    const a = (e.target as HTMLElement).closest("a");
    if (!a || a.target || a.hasAttribute("download")) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || u.hash) return;
    e.preventDefault();
    history.pushState({}, "", u.pathname + u.search);
    window.dispatchEvent(new Event("boff-navigation"));
  });
  window.addEventListener("popstate", () =>
    window.dispatchEvent(new Event("boff-navigation")),
  );
}

export function sharedTicketPath(id: string) {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return "";
  const bytes = id.replaceAll("-", "").match(/../g)!.map(byte => parseInt(byte, 16));
  return "/t/" + btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
export function sharedTicketId() {
  const code=location.pathname.split("/").at(-1) ?? "";
  if(!/^[A-Za-z0-9_-]{22}$/.test(code))return "";
  const raw=atob(code.replaceAll("-", "+").replaceAll("_", "/")+"==");
  const id=[...raw].map(byte=>byte.charCodeAt(0).toString(16).padStart(2,"0")).join("");
  return [id.slice(0,8),id.slice(8,12),id.slice(12,16),id.slice(16,20),id.slice(20)].join("-");
}
