export const INTAKE_CONTRACT = "sleeper-nfl-intake-v1";
export type IntakeTeam = {
  roster_id: number;
  team_name: string;
  owner_id: string | null;
  owner_name: string;
  co_owner_ids: string[];
  co_owner_names: string[];
  wins: number;
  losses: number;
  ties: number;
};
export type IntakeSource = {
  contract: typeof INTAKE_CONTRACT;
  provider: "sleeper";
  league_id: string;
  previous_league_id?: string;
  name: string;
  season: number;
  status: string;
  total_rosters: number;
  scoring: Record<string, number>;
  positions: string[];
  settings: Record<string, number>;
  teams: IntakeTeam[];
};
export type CapabilityReport = {
  contract: typeof INTAKE_CONTRACT;
  admission: "review_required";
  issues: { code: string; detail: string }[];
  families: {
    name: string;
    state: "input_compatible" | "blocked" | "review_required";
    reasons: string[];
  }[];
};
const object = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Provider object is incomplete.");
  return v as Record<string, any>;
};
const integer = (v: unknown, min: number, max: number) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    throw Error("Provider integer is outside the intake contract.");
  return v;
};
const text = (v: unknown, max = 80) => {
  if (typeof v !== "string" || !v.trim() || v.length > max || /\p{Cc}/u.test(v))
    throw Error("Provider text is outside the intake contract.");
  return v.trim();
};
export const sleeperLeagueId = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{1,32}$/.test(v))
    throw Error("Enter the numeric Sleeper league ID.");
  return v;
};
const publicId = (v: unknown) =>
  v === null || v === undefined ? null : sleeperLeagueId(v);
function numbers(v: unknown, maxWeight: number) {
  const raw = object(v),
    entries = Object.entries(raw);
  if (!entries.length || entries.length > 128)
    throw Error("Provider rule fields are incomplete or oversized.");
  return Object.fromEntries(
    entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, value]) => {
        if (
          !/^[a-z][a-z0-9_]{0,63}$/.test(k) ||
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          Math.abs(value) > maxWeight
        )
          throw Error("Provider numeric rule is unsupported.");
        return [k, value];
      }),
  );
}
export function normalizeSleeperIntake(
  leagueValue: unknown,
  rosterValue: unknown,
  userValue: unknown,
): IntakeSource {
  const league = object(leagueValue);
  if (league.sport !== "nfl" || league.season_type !== "regular")
    throw Error("Only NFL regular-season league intake is supported.");
  const id = sleeperLeagueId(league.league_id);
  if (typeof league.season !== "string" || !/^20\d{2}$/.test(league.season))
    throw Error("Provider season is unavailable.");
  const total = integer(league.total_rosters, 2, 32);
  if (
    !Array.isArray(rosterValue) ||
    rosterValue.length !== total ||
    !Array.isArray(userValue) ||
    userValue.length > 128
  )
    throw Error("Provider roster/user coverage is incomplete.");
  const users = new Map<string, Record<string, any>>();
  for (const u of userValue) {
    const user = object(u),
      key = sleeperLeagueId(user.user_id);
    if (users.has(key)) throw Error("Duplicate provider user.");
    users.set(key, user);
  }
  const ids = new Set<number>();
  const teams = rosterValue
    .map((v) => {
      const r = object(v),
        roster = integer(r.roster_id, 1, 1000);
      if (ids.has(roster)) throw Error("Duplicate provider roster.");
      ids.add(roster);
      if (r.league_id !== id)
        throw Error("Provider roster belongs to another league.");
      const owner = publicId(r.owner_id),
        u = owner ? users.get(owner) : undefined,
        metadata = u?.metadata ? object(u.metadata) : {};
      const co = r.co_owners ?? [];
      if (!Array.isArray(co) || co.length > 16)
        throw Error("Provider co-owner field is oversized.");
      const coIds = co.map(sleeperLeagueId);
      if (
        new Set(coIds).size !== coIds.length ||
        (owner !== null && coIds.includes(owner))
      )
        throw Error("Duplicate provider co-owner.");
      const stats = object(r.settings);
      return {
        roster_id: roster,
        team_name: metadata.team_name
          ? text(metadata.team_name)
          : "Team " + roster,
        owner_id: owner,
        owner_name: u?.display_name
          ? text(u.display_name)
          : owner
            ? "Unnamed Sleeper manager"
            : "Unclaimed",
        co_owner_ids: coIds,
        co_owner_names: coIds.map((key) =>
          users.get(key)?.display_name
            ? text(users.get(key)!.display_name)
            : "Unnamed Sleeper manager",
        ),
        wins: integer(stats.wins, 0, 100),
        losses: integer(stats.losses, 0, 100),
        ties: integer(stats.ties, 0, 100),
      };
    })
    .sort((a, b) => a.roster_id - b.roster_id);
  if (
    !Array.isArray(league.roster_positions) ||
    league.roster_positions.length < 1 ||
    league.roster_positions.length > 48
  )
    throw Error("Provider lineup positions are unavailable.");
  const source: IntakeSource = {
    contract: INTAKE_CONTRACT,
    provider: "sleeper",
    league_id: id,
    ...(league.previous_league_id
      ? { previous_league_id: sleeperLeagueId(league.previous_league_id) }
      : {}),
    name: text(league.name),
    season: Number(league.season),
    status: text(league.status, 24),
    total_rosters: total,
    scoring: numbers(league.scoring_settings, 1000),
    positions: league.roster_positions.map((p: unknown) => text(p, 24)),
    settings: numbers(league.settings, 1e9),
    teams,
  };
  if (new TextEncoder().encode(JSON.stringify(source)).length > 65536)
    throw Error("Normalized provider intake exceeds 64 KiB.");
  return source;
}
export function reviewIntake(source: IntakeSource): CapabilityReport {
  const issues: CapabilityReport["issues"] = [],
    add = (code: string, detail: string) => issues.push({ code, detail });
  if (
    source.total_rosters < 8 ||
    source.total_rosters > 16 ||
    source.total_rosters % 2
  )
    add(
      "scorer_partition",
      "Weekly scorer markets require an even 8–16-team field; odd fields/byes need reviewed support.",
    );
  const supported = new Set([
    "QB",
    "RB",
    "WR",
    "TE",
    "K",
    "DEF",
    "FLEX",
    "SUPER_FLEX",
    "REC_FLEX",
    "WRRB_FLEX",
    "BN",
    "IR",
    "TAXI",
  ]);
  if (source.positions.some((p) => !supported.has(p)))
    add(
      "lineup_slots",
      "IDP or unknown lineup slots require an adapter and full journey verification.",
    );
  if (
    source.positions.filter((p) => !["BN", "IR", "TAXI"].includes(p)).length >
    16
  )
    add(
      "starting_slots",
      "The lineup optimizer supports at most 16 starting slots.",
    );
  if ((source.settings.divisions ?? 0) > 0)
    add(
      "divisions",
      "Division seeding/qualification needs explicit support review.",
    );
  if ((source.settings.league_average_match ?? 0) > 0)
    add(
      "median_wins",
      "Extra median/average wins need qualification and settlement review.",
    );
  if ((source.settings.playoff_seed_type ?? 0) > 0)
    add("reseed", "Playoff reseeding needs explicit support review.");
  if ((source.settings.playoff_round_type ?? 0) > 0)
    add(
      "multiweek_rounds",
      "Multi-week fantasy playoff rounds need explicit support review.",
    );
  if (
    !Number.isInteger(source.settings.playoff_week_start) ||
    source.settings.playoff_week_start < 2 ||
    source.settings.playoff_week_start > 18
  )
    add("playoff_start", "A supported fantasy playoff start is required.");
  if (![4, 6, 8].includes(source.settings.playoff_teams))
    add(
      "playoff_field",
      "Playoff fields other than 4/6/8 need full bracket support review.",
    );
  add(
    "projection_coverage",
    "Verify scoring-key and projection/result coverage before market generation; numeric settings alone do not prove support.",
  );
  add(
    "draft_rules",
    "First-pick markets require reviewed draft-order, lottery and traded-pick rules.",
  );
  if (source.teams.some((t) => !t.owner_id))
    add(
      "unclaimed_rosters",
      "Unclaimed fantasy teams remain real teams; no sportsbook identity or wallet is inferred.",
    );
  return {
    contract: INTAKE_CONTRACT,
    admission: "review_required",
    issues,
    families: [
      {
        name: "Weekly matchups and player points",
        state: issues.some((i) =>
          ["lineup_slots", "starting_slots"].includes(i.code),
        )
          ? "blocked"
          : "input_compatible",
        reasons: [
          "Input compatibility is not approval to activate; verify scoring and settlement coverage.",
        ],
      },
      {
        name: "Weekly scorer specials",
        state: issues.some((i) => i.code === "scorer_partition")
          ? "blocked"
          : "input_compatible",
        reasons: ["Verify the eligible scorer field each week."],
      },
      {
        name: "Season and playoff futures",
        state: "review_required",
        reasons: [
          "Rules, seeding, ties and bracket behavior need end-to-end verification.",
        ],
      },
      {
        name: "First pick",
        state: "review_required",
        reasons: [
          "A public roster owner or team name never establishes sportsbook access or pick ownership.",
        ],
      },
    ],
  };
}
async function providerJson(url: string, fetcher: typeof fetch, limit: number) {
  const r = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok || !r.body)
    throw Error(
      "Sleeper intake is unavailable; retry without activating the league.",
    );
  const reader = r.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > limit)
        throw Error("Provider response exceeds its intake budget.");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
}
export async function fetchSleeperIntake(
  idValue: unknown,
  fetcher: typeof fetch = fetch,
) {
  const id = sleeperLeagueId(idValue),
    base = "https://api.sleeper.app/v1/league/" + id;
  const [league, rosters, users] = await Promise.all([
    providerJson(base, fetcher, 262144),
    providerJson(base + "/rosters", fetcher, 524288),
    providerJson(base + "/users", fetcher, 131072),
  ]);
  const source = normalizeSleeperIntake(league, rosters, users);
  if (source.league_id !== id) throw Error("Provider league identity changed.");
  return { source, capabilities: reviewIntake(source) };
}

export function validateCapabilityReport(value: unknown): CapabilityReport {
  const r = object(value);
  if (
    r.contract !== INTAKE_CONTRACT ||
    r.admission !== "review_required" ||
    !Array.isArray(r.issues) ||
    r.issues.length > 32 ||
    !Array.isArray(r.families) ||
    r.families.length < 1 ||
    r.families.length > 16
  )
    throw Error("Capability report is incomplete.");
  for (const issue of r.issues) {
    const i = object(issue);
    text(i.code, 64);
    text(i.detail, 400);
  }
  for (const family of r.families) {
    const f = object(family);
    text(f.name, 100);
    if (
      !["input_compatible", "blocked", "review_required"].includes(f.state) ||
      !Array.isArray(f.reasons) ||
      f.reasons.length > 8
    )
      throw Error("Capability family is incomplete.");
    for (const reason of f.reasons) text(reason, 400);
  }
  return r as CapabilityReport;
}

export type ProviderDriftReview = {
  contract: "provider-drift-review-v1";
  state: "unchanged" | "rules_changed" | "renewal_required";
  baseline_season: number;
  observed_season: number;
  changes: { section: string; count: number; keys: string[] }[];
  capabilities: CapabilityReport;
  approval: "still_required";
};
// Review only: names, standings and provider user identities never grant access.
// Compare bounded rule fields, retaining no new provider snapshot or archive.
export function compareProviderContract(
  value: unknown,
  storedTeams: unknown,
  current: IntakeSource,
): ProviderDriftReview {
  const contract = object(value),
    prior = object(contract.source);
  if (
    contract.version !== 1 ||
    prior.contract !== INTAKE_CONTRACT ||
    prior.provider !== "sleeper" ||
    (prior.league_id !== current.league_id &&
      !(
        current.previous_league_id === prior.league_id &&
        current.season === Number(prior.season) + 1
      )) ||
    new TextEncoder().encode(JSON.stringify(value)).length > 32768
  )
    throw Error("A matching retained imported provider contract is required.");
  const season = integer(prior.season, 2000, 2099),
    count = integer(prior.total_rosters, 2, 32);
  const priorScoring = numbers(prior.scoring, 1000),
    priorSettings = numbers(prior.settings, 1e9);
  if (
    !Array.isArray(prior.positions) ||
    prior.positions.length < 1 ||
    prior.positions.length > 48
  )
    throw Error("Retained lineup slots are incomplete.");
  const positions = prior.positions.map((p: unknown) => text(p, 24)).sort();
  if (!Array.isArray(storedTeams) || storedTeams.length !== count)
    throw Error("Retained provider roster coverage is incomplete.");
  const identities = (teams: unknown[], saved: boolean) =>
    teams
      .map((v) => {
        const t = object(v),
          co = t.co_owner_ids;
        if (!Array.isArray(co) || co.length > 16)
          throw Error("Provider co-owner coverage is incomplete.");
        const ids = co.map(sleeperLeagueId).sort();
        if (new Set(ids).size !== ids.length)
          throw Error("Duplicate provider co-owner.");
        return {
          id: integer(t.roster_id, 1, 1000),
          owner: publicId(saved ? t.sleeper_owner_id : t.owner_id),
          co: ids,
        };
      })
      .sort((a, b) => a.id - b.id);
  const before = identities(storedTeams, true),
    after = identities(current.teams, false);
  if (new Set(before.map((t) => t.id)).size !== before.length)
    throw Error("Duplicate retained provider roster.");
  const changes: ProviderDriftReview["changes"] = [];
  const add = (section: string, keys: string[]) => {
    if (keys.length)
      changes.push({ section, count: keys.length, keys: keys.slice(0, 32) });
  };
  const changedKeys = (
    a: Record<string, unknown>,
    b: Record<string, unknown>,
  ) =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .sort()
      .filter((k) => a[k] !== b[k]);
  add("scoring", changedKeys(priorScoring, current.scoring));
  add("provider_settings", changedKeys(priorSettings, current.settings));
  add(
    "lineup_slots",
    JSON.stringify(positions) !== JSON.stringify([...current.positions].sort())
      ? ["starting_and_reserve_slots"]
      : [],
  );
  add(
    "roster_field",
    JSON.stringify(before.map((t) => t.id)) !==
      JSON.stringify(after.map((t) => t.id)) || count !== current.total_rosters
      ? ["roster_ids_or_count"]
      : [],
  );
  add(
    "public_roster_ownership",
    before.length !== after.length ||
      before.some((t, i) => JSON.stringify(t) !== JSON.stringify(after[i]))
      ? ["owner_or_co_owner_mapping"]
      : [],
  );
  add("nfl_season", season !== current.season ? ["season"] : []);
  add(
    "provider_status",
    text(prior.status, 24) !== current.status ? ["status"] : [],
  );
  return {
    contract: "provider-drift-review-v1",
    state:
      season !== current.season
        ? "renewal_required"
        : changes.length
          ? "rules_changed"
          : "unchanged",
    baseline_season: season,
    observed_season: current.season,
    changes,
    capabilities: reviewIntake(current),
    approval: "still_required",
  };
}
