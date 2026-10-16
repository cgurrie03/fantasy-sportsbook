import { useEffect, useState } from "react";
export const readRoute = () =>
  window.location.hash.startsWith("#/")
    ? window.location.hash.slice(1)
    : "/home";
export function navigate(path: string) {
  window.location.hash = path;
}
export function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}
export const tabRoutes: Record<string, string> = {
  Home: "/home",
  "My Bets": "/bets",
  "All Bets": "/all-bets",
  Leaderboard: "/leaderboard",
};
export const routeTab = (route: string) =>
  Object.keys(tabRoutes).find(
    (tab) => tabRoutes[tab] === route.split("?")[0],
  ) ?? "Home";
