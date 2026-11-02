export interface EditorialFacts {
  contract: "opening-editorial-facts-v1";
  league_id: string;
  nfl_season: number;
  league_season: number;
  market_week: number;
  board_id: string;
  board_revision: number;
  window_key: string;
  prepared_at: string;
  team_ids: string[];
  teams: { id: string; name: string; projected: number }[];
  matchups: {
    id: string;
    home: string;
    away: string;
    home_projected: number;
    away_projected: number;
    featured: string | null;
  }[];
  championship: { id: string; team: string; owner: string; odds: number }[];
}
export interface EditorialStory {
  key: string;
  group: string;
  title: string;
  text: string;
  evidence: string[];
}
export interface EditorialEdition {
  contract: "opening-editorial-edition-v1";
  facts: EditorialFacts;
  stories: EditorialStory[];
}
const bytes = (s: string) => new TextEncoder().encode(s).length;
export function editorialLabel(value: unknown, limit = 160): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\r\n\t]/g, " ").trim();
  let out = "";
  for (const ch of text) {
    if (bytes(out + ch) > limit - 3) return out + "…";
    out += ch;
  }
  return out;
}
const price = (n: number) => (n > 0 ? "+" : "") + n;
const implied = (n: number) => (n > 0 ? 100 / (n + 100) : -n / (-n + 100));
const hash = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
export function comparableEdition(
  now: EditorialFacts,
  old: EditorialEdition | null | undefined,
): old is EditorialEdition {
  return (
    !!old &&
    old.contract === "opening-editorial-edition-v1" &&
    old.facts.contract === now.contract &&
    old.facts.league_id === now.league_id &&
    old.facts.nfl_season === now.nfl_season &&
    old.facts.league_season === now.league_season &&
    old.facts.market_week === now.market_week - 1 &&
    JSON.stringify([...old.facts.team_ids].sort()) ===
      JSON.stringify([...now.team_ids].sort())
  );
}
export function selectEditorialStories(
  facts: EditorialFacts,
  previous?: EditorialEdition | null,
): EditorialEdition {
  if (
    facts.contract !== "opening-editorial-facts-v1" ||
    facts.team_ids.length > 128 ||
    facts.teams.length > 128 ||
    facts.matchups.length > 64 ||
    facts.championship.length > 16 ||
    new Set(facts.team_ids).size !== facts.team_ids.length ||
    facts.market_week < 1 ||
    facts.market_week > 18 ||
    !Number.isFinite(Date.parse(facts.prepared_at))
  )
    throw Error("Editorial facts exceed their scope or budget.");
  const ids = new Set(facts.team_ids),
    teams = new Map(facts.teams.map((t) => [t.id, t]));
  if (
    teams.size !== facts.teams.length ||
    facts.teams.some(
      (t) =>
        !ids.has(t.id) ||
        !t.name ||
        !Number.isFinite(t.projected) ||
        t.projected <= 0 ||
        t.projected > 1000,
    ) ||
    facts.championship.some(
      (t) =>
        !ids.has(t.id) ||
        !t.team ||
        !Number.isInteger(t.odds) ||
        !t.odds ||
        Math.abs(t.odds) > 1000000,
    )
  )
    throw Error("Editorial evidence is incomplete or outside this league.");
  const ranked = [...teams.values()].sort(
    (a, b) => b.projected - a.projected || a.id.localeCompare(b.id),
  );
  const matchups = facts.matchups.filter(
    (m) =>
      m.home !== m.away &&
      teams.has(m.home) &&
      teams.has(m.away) &&
      Number.isFinite(m.home_projected) &&
      m.home_projected > 0 &&
      Number.isFinite(m.away_projected) &&
      m.away_projected > 0,
  );
  const validPrior = comparableEdition(facts, previous) ? previous : null;
  const candidates: (EditorialStory & { score: number })[] = [];
  const add = (
    key: string,
    group: string,
    title: string,
    text: string,
    evidence: string[],
    score: number,
  ) => {
    if (bytes(text) <= 4096 && bytes(title) <= 160)
      candidates.push({
        key,
        group,
        title,
        text,
        evidence: [...new Set(evidence)].sort(),
        score,
      });
  };
  if (ranked.length) {
    const leaders = ranked
      .filter((t) => Math.abs(t.projected - ranked[0].projected) < 0.05)
      .slice(0, 3);
    add(
      "forecast-leaders",
      "forecast",
      "This week’s projection leaders",
      leaders
        .map((t) => `${t.name}: ${t.projected.toFixed(1)} projected points`)
        .join("\n") +
        "\nAmong the available published forecasts. Projections are not results.",
      leaders.map((t) => t.id),
      62,
    );
    if (ranked.length >= 4) {
      const lo = ranked.at(-1)!,
        hi = ranked[0];
      add(
        "forecast-range",
        "forecast",
        "The published forecast range",
        `Among ${ranked.length} available team forecasts, ${lo.name} is at ${lo.projected.toFixed(1)} and ${hi.name} at ${hi.projected.toFixed(1)} projected points. The ${(hi.projected - lo.projected).toFixed(1)}-point range describes this snapshot, not the final scores.`,
        [lo.id, hi.id],
        60,
      );
    }
  }
  if (ranked.length < facts.team_ids.length)
    add(
      "forecast-coverage",
      "coverage",
      "Some forecasts are unavailable",
      `${ranked.length} of ${facts.team_ids.length} teams have a usable positive forecast in this published snapshot. Rankings include only these available positive forecasts.`,
      [],
      ranked.length === 0 ? 90 : 72,
    );
  if (matchups.length) {
    const close = [...matchups].sort(
      (a, b) =>
        Math.abs(a.home_projected - a.away_projected) -
          Math.abs(b.home_projected - b.away_projected) ||
        a.id.localeCompare(b.id),
    )[0];
    add(
      "closest-matchup",
      "matchup",
      "A close forecast to watch",
      `${teams.get(close.home)!.name} (${close.home_projected.toFixed(1)}) and ${teams.get(close.away)!.name} (${close.away_projected.toFixed(1)}) are separated by ${Math.abs(close.home_projected - close.away_projected).toFixed(1)} projected points. That is the closest available paired forecast on this board.`,
      [close.home, close.away],
      70,
    );
    const featured = matchups
      .filter(
        (m) => m.featured === "Game of the Week" || m.featured === "Tank Bowl",
      )
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (featured)
      add(
        "featured-matchup",
        "matchup",
        "The board’s featured pairing",
        `${featured.featured}: ${teams.get(featured.home)!.name} versus ${teams.get(featured.away)!.name}. Published forecasts are ${featured.home_projected.toFixed(1)} and ${featured.away_projected.toFixed(1)} points. Check the board for the exact featured prices and terms.`,
        [featured.home, featured.away],
        68,
      );
    const total = [...matchups].sort(
      (a, b) =>
        b.home_projected +
          b.away_projected -
          (a.home_projected + a.away_projected) || a.id.localeCompare(b.id),
    )[0];
    add(
      "highest-paired-forecast",
      "matchup",
      "The highest paired forecast",
      `${teams.get(total.home)!.name} and ${teams.get(total.away)!.name} combine for ${(total.home_projected + total.away_projected).toFixed(1)} projected points, the highest among the available paired forecasts. This forecast sum is separate from any offered total line.`,
      [total.home, total.away],
      65,
    );
  }
  const prices = [...facts.championship].sort(
    (a, b) => implied(b.odds) - implied(a.odds) || a.id.localeCompare(b.id),
  );
  if (prices.length)
    add(
      "championship-prices",
      "championship",
      "Saved championship prices",
      prices
        .slice(0, 4)
        .map(
          (t) => `${t.owner ? t.owner + " · " : ""}${t.team}: ${price(t.odds)}`,
        )
        .join("\n") +
        "\nSaved base odds from the published season snapshot. Check the sportsbook for current availability and any applicable boosts.",
      prices.slice(0, 4).map((t) => t.id),
      64,
    );
  if (validPrior) {
    const priorPrices = new Map(
      validPrior.facts.championship.map((t) => [t.id, t.odds]),
    );
    const moved = prices
      .filter((t) => priorPrices.has(t.id) && priorPrices.get(t.id) !== t.odds)
      .sort(
        (a, b) =>
          Math.abs(implied(b.odds) - implied(priorPrices.get(b.id)!)) -
            Math.abs(implied(a.odds) - implied(priorPrices.get(a.id)!)) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 3);
    if (moved.length)
      add(
        "championship-price-movement",
        "championship",
        "Saved championship prices changed",
        moved
          .map(
            (t) =>
              `${t.team}: ${price(priorPrices.get(t.id)!)} in Week ${validPrior.facts.market_week} → ${price(t.odds)} in this edition.`,
          )
          .join("\n") +
          "\nComparing matching team outcomes in the two saved editions. Conditions may have changed; check the sportsbook for current availability.",
        moved.map((t) => t.id),
        78,
      );
  }
  const previousKeys = new Set(validPrior?.stories.map((s) => s.key) ?? []);
  const seed = `${facts.league_id}:${facts.nfl_season}:${facts.league_season}:${facts.market_week}`;
  candidates.sort(
    (a, b) =>
      b.score -
        (previousKeys.has(b.key) ? 30 : 0) +
        (hash(seed + b.key) % 7) -
        (a.score -
          (previousKeys.has(a.key) ? 30 : 0) +
          (hash(seed + a.key) % 7)) || a.key.localeCompare(b.key),
  );
  const chosen: EditorialStory[] = [],
    groups = new Set<string>();
  for (const { score: _, ...story } of candidates) {
    if (groups.has(story.group)) continue;
    chosen.push(story);
    groups.add(story.group);
    if (chosen.length === 3) break;
  }
  const edition: EditorialEdition = {
    contract: "opening-editorial-edition-v1",
    facts,
    stories: chosen,
  };
  if (bytes(JSON.stringify(edition)) > 65536)
    throw Error("Editorial edition exceeds its 64 KiB budget.");
  return edition;
}
