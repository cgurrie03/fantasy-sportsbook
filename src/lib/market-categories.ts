export const marketCategories = [
  "Matchups",
  "Player Points",
  "Head to Head",
  "Weekly Specials",
  "Season Futures",
] as const;
export type MarketCategory = (typeof marketCategories)[number];
export function marketCategory(kind: string): MarketCategory {
  if (kind.startsWith("future_")) return "Season Futures";
  if (kind === "player_points" || kind === "player_milestone")
    return "Player Points";
  if (kind === "player_h2h") return "Head to Head";
  if (kind.startsWith("weekly_")) return "Weekly Specials";
  return "Matchups";
}
export function requiredCategories(
  category: MarketCategory,
  home: boolean,
  picks: { kind: string }[],
  fixed = false,
): MarketCategory[] {
  const needed = new Set<MarketCategory>();
  if (home) {
    needed.add(category);
    if (category === "Player Points" || category === "Head to Head")
      needed.add("Matchups");
  }
  if (!fixed) for (const pick of picks) needed.add(marketCategory(pick.kind));
  return marketCategories.filter((c) => needed.has(c));
}
