import type { EmailContent, EmailTeamWatch } from "./email-templates.ts";
import { fetchGameStatus, scoreboardWindow } from "./game-status.js";
import { score } from "./line-model.js";
import { settleLeg } from "./settlement.js";
import { legProgress } from "./ticket-progress.js";
import {
  elapsedMinutes,
  remainingForecast,
  sameGameDate,
} from "./live-model.js";
import type { LiveGame } from "./live-model.ts";

type Snapshot = {
  checkedAt: string;
  games: LiveGame[];
  teams: Record<string, { name: string; points: number }>;
  players: Record<string, { played: boolean; points: number }>;
  teamPlayers: Record<string, string[]>;
  catalog: Record<string, { full_name?: string; team?: string }>;
  forecasts?: Record<
    string,
    {
      projected: number | null;
      sd: number;
      remaining: string[];
      finished: boolean;
    }
  >;
};
const nflTeam = (v: string) => ({ WAS: "WSH", JAC: "JAX", LA: "LAR" })[v] ?? v;
const playerGame = (s: Snapshot, id: string) => {
  const team = s.catalog[id]?.team ?? (/^[A-Z]{2,3}$/.test(id) ? id : "");
  return s.games.find((g) => g.teams.some((t) => nflTeam(t) === nflTeam(team)));
};
const playerName = (s: Snapshot, id: string) =>
  s.catalog[id]?.full_name ?? `Player ${id}`;

// A broad forecast comparison selects the main contenders, not an impossible/guaranteed outcome.
// Always retain the current leaders (including ties) and the bettor's selected team.
export function scoreContenders(
  s: Snapshot,
  highest: boolean,
  selected?: string,
): EmailTeamWatch[] {
  const rows = Object.entries(s.teams).map(([id, t]) => {
    const f = s.forecasts?.[id];
    const remaining =
      f?.remaining ??
      (s.teamPlayers[id] ?? [])
        .filter((p) => playerGame(s, p)?.state !== "final")
        .map((p) => playerName(s, p));
    const finished =
      f?.finished ??
      ((s.teamPlayers[id]?.length ?? 0) > 0 &&
        s.teamPlayers[id].every((p) => playerGame(s, p)?.state === "final"));
    return {
      id,
      name: t.name,
      current: t.points,
      projected: f?.projected ?? (finished ? t.points : null),
      sd: f?.sd ?? 0,
      remaining,
      finished,
      selected: id === selected,
    };
  });
  const extreme = (highest ? Math.max : Math.min)(
    ...rows.map((t) => t.current),
  );
  const known = rows
    .filter((t) => t.projected !== null)
    .sort((a, b) =>
      highest ? b.projected! - a.projected! : a.projected! - b.projected!,
    );
  const favorite = known[0];
  return rows
    .filter((t) => {
      if (t.current === extreme || t.selected) return true;
      if (
        highest &&
        t.finished &&
        t.current < extreme &&
        rows.some((leader) => leader.current === extreme && leader.finished)
      )
        return false;
      // A completed non-leading lineup cannot change its score, but can become the lowest
      // if the current low scorer rises above it. Compare its finish to the projected favorite.
      if (!favorite || t.projected === null) return true;
      const gap = highest
        ? favorite.projected! - t.projected
        : t.projected - favorite.projected!;
      return gap <= 2.5 * Math.hypot(t.sd, favorite.sd);
    })
    .sort(
      (a, b) =>
        Number(b.current === extreme) - Number(a.current === extreme) ||
        (highest
          ? (b.projected ?? b.current) - (a.projected ?? a.current)
          : (a.projected ?? a.current) - (b.projected ?? b.current)) ||
        a.name.localeCompare(b.name),
    )
    .map(({ id, sd, ...t }) => ({ ...t, leader: t.current === extreme }));
}

// Classify without changing official ticket results or wallets. Incomplete evidence stays OPEN.
export function mondayTickets(
  tickets: any[],
  legs: any[],
  s: Snapshot,
): NonNullable<EmailContent["tickets"]> {
  const progress = {
    teams: Object.fromEntries(
      Object.entries(s.teams).map(([id, t]) => [id, t.points]),
    ),
    players: Object.fromEntries(
      Object.entries(s.players)
        .filter(([, p]) => p.played)
        .map(([id, p]) => [id, p.points]),
    ),
  };
  const evaluate = (leg: any) => {
    const c = leg.settlement_context;
    const scoreMarket =
      c &&
      [
        "weekly_high",
        "weekly_low",
        "weekly_highest_score",
        "weekly_any_200",
        "weekly_any_below_100",
      ].includes(c.kind);
    const contenders = scoreMarket
      ? scoreContenders(
          s,
          c.kind !== "weekly_low" && c.kind !== "weekly_any_below_100",
          c.team_id ?? undefined,
        )
      : undefined;
    if (leg.status && ["WON", "LOST", "PUSH", "VOIDED"].includes(leg.status))
      return {
        status: leg.status,
        evidence: leg.result_evidence ?? "Official leg result.",
        teams: undefined,
      };
    if (!c)
      return {
        status: "OPEN",
        evidence: "Accepted market details need admin review.",
      };
    const finishedScores = Object.entries(s.teams).filter(
      ([id]) => s.forecasts?.[id]?.finished === true,
    );
    const accepted =
      leg.accepted_line == null ? null : Number(leg.accepted_line);
    const proved = (won: boolean, evidence: string) => ({
      status: won ? "WON" : "LOST",
      evidence,
      teams: undefined,
    });
    if (
      ["weekly_high", "weekly_low"].includes(c.kind) &&
      s.forecasts?.[c.team_id]?.finished
    ) {
      const selected = s.teams[c.team_id];
      const better = finishedScores.find(
        ([id, t]) =>
          id !== c.team_id &&
          (c.kind === "weekly_high"
            ? t.points > selected.points
            : t.points < selected.points),
      );
      if (better)
        return proved(
          false,
          `${selected.name} finished at ${selected.points.toFixed(1)}; ${better[1].name} already finished ${c.kind === "weekly_high" ? "higher" : "lower"} at ${better[1].points.toFixed(1)}.`,
        );
    }
    if (
      c.kind === "weekly_highest_score" &&
      accepted !== null &&
      ["over", "under"].includes(c.side)
    ) {
      const exceeded = finishedScores.find(([, t]) => t.points > accepted);
      if (exceeded)
        return proved(
          c.side === "over",
          `${exceeded[1].name} finished at ${exceeded[1].points.toFixed(1)}, above your accepted ${accepted} line.`,
        );
    }
    if (
      ["weekly_any_200", "weekly_any_below_100"].includes(c.kind) &&
      ["yes", "no"].includes(c.side)
    ) {
      const qualified = finishedScores.find(([, t]) =>
        c.kind === "weekly_any_200" ? t.points >= 200 : t.points < 100,
      );
      if (qualified)
        return proved(
          c.side === "yes",
          `${qualified[1].name} finished at ${qualified[1].points.toFixed(1)}; the ${c.kind === "weekly_any_200" ? "200+" : "below 100"} outcome has occurred.`,
        );
    }
    const playerMarket = [
      "player_points",
      "player_milestone",
      "player_h2h",
    ].includes(c.kind);
    const teamIds = c.kind.startsWith("weekly_")
      ? Object.keys(s.teamPlayers)
      : ["team_total", "team_milestone"].includes(c.kind)
        ? [c.team_id]
        : [c.home_team_id, c.away_team_id];
    const ids: string[] = playerMarket
      ? [
          c.metadata?.player_id,
          ...(c.kind === "player_h2h" ? [c.metadata?.opponent_player_id] : []),
        ].filter(Boolean)
      : [
          ...new Set(
            teamIds.flatMap((id: string) => s.teamPlayers[id] ?? ["unknown"]),
          ),
        ];
    const missing = !ids.length || ids.some((id) => !playerGame(s, id));
    const pending = ids.filter((id) => playerGame(s, id)?.state !== "final");
    let info = legProgress(leg, progress);
    if (c.kind.startsWith("weekly_")) {
      const rows = Object.values(s.teams);
      const high = [...rows].sort((a, b) => b.points - a.points)[0];
      const low = [...rows].sort((a, b) => a.points - b.points)[0];
      if (
        ["weekly_high", "weekly_any_200", "weekly_highest_score"].includes(
          c.kind,
        ) &&
        high
      )
        info = `Highest score so far: ${high.name} · ${high.points.toFixed(1)}.`;
      if (["weekly_low", "weekly_any_below_100"].includes(c.kind) && low)
        info = `Lowest score so far: ${low.name} · ${low.points.toFixed(1)}.`;
      if (c.kind === "weekly_count_150")
        info = `Currently ${rows.filter((t) => t.points >= 150).length} teams have scored 150+.`;
      if (c.kind === "weekly_average" && rows.length)
        info = `League average so far: ${(rows.reduce((n, t) => n + t.points, 0) / rows.length).toFixed(1)} points.`;
      if (
        c.kind === "weekly_count_projection" &&
        c.metadata?.projection_targets
      )
        info = `Currently ${Object.entries(s.teams).filter(([id, t]) => Number.isFinite(c.metadata.projection_targets[id]) && t.points > c.metadata.projection_targets[id]).length} teams are above their accepted projections.`;
    }
    if (scoreMarket) info = null; // The team cards carry the leader, scores and relevant starters.
    if (missing || pending.length)
      return {
        status: "OPEN",
        evidence: [
          info,
          pending.length && !scoreMarket
            ? `Still to finish: ${pending.map((id) => playerName(s, id)).join(", ")}.`
            : null,
          missing
            ? "Some game or lineup evidence is unavailable; result remains unconfirmed."
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
        teams: contenders,
      };
    return settleLeg(leg, { final: true, teams: s.teams, players: s.players });
  };
  const cards = tickets.map((ticket) => {
    const ticketLegs = legs
      .filter((l) => l.ticket_id === ticket.id)
      .sort((a, b) => a.leg_number - b.leg_number);
    const results = ticketLegs.map((l) =>
      evaluate(ticket.status === "VOIDED" ? { ...l, status: "VOIDED" } : l),
    );
    const lost = results.some((r) => r.status === "LOST");
    const complete =
      results.length > 0 &&
      results.every((r) => ["WON", "PUSH"].includes(r.status));
    const official = ticket.status !== "OPEN";
    const status = official
      ? ticket.status
      : lost
        ? "LOST"
        : complete
          ? results.every((r) => r.status === "PUSH")
            ? "PUSH"
            : "WON"
          : "OPEN";
    const heading =
      {
        OPEN: "🏈 Monday Watch",
        WON: "✅ Appears Won · Awaiting Settlement",
        LOST: "❌ Already Lost · Awaiting Settlement",
        PUSH: "↩ Appears Pushed · Awaiting Settlement",
        VOIDED: "↩ Voided · Refunded",
      }[status as string] ?? "Result Review";
    const money = (v: number | string) => "$" + Number(v).toFixed(2);
    return {
      id: String(ticket.id).slice(0, 8),
      status:
        official && ["WON", "LOST", "PUSH"].includes(status)
          ? `Official ${status === "WON" ? "Win" : status === "LOST" ? "Loss" : "Push"}`
          : heading,
      tone: (status === "OPEN"
        ? "watch"
        : status === "WON"
          ? "won"
          : status === "LOST"
            ? "lost"
            : "neutral") as "watch" | "won" | "lost" | "neutral",
      summary: `${money(ticket.stake)} wager${official && ticket.actual_payout !== null && ticket.actual_payout !== undefined && Number.isFinite(Number(ticket.actual_payout)) ? ` · ${money(ticket.actual_payout)} ${status === "VOIDED" || status === "PUSH" ? "returned" : "paid"}` : status === "OPEN" || status === "WON" ? ` · ${money(ticket.accepted_potential_payout)} original potential payout` : ""}`,
      legs: ticketLegs.map((l, i) => ({
        selection: l.selection,
        detail: `${l.matchup ? l.matchup + "\n" : ""}${l.accepted_line !== null && l.accepted_line !== undefined ? `Accepted ${/count/.test(l.settlement_context?.kind ?? "") ? (/\+$/.test(l.settlement_context?.side ?? "") ? "count: At least " : "count: Exactly ") : "line: "}${["over", "under"].includes(l.settlement_context?.side) ? `${l.settlement_context.side === "over" ? "Over" : "Under"} ` : ""}${l.accepted_line}\n` : ""}${results[i].status === "OPEN" ? (lost ? "Remaining Leg · Ticket Already Lost" : "Still Open") : results[i].status}${results[i].evidence ? " · " + results[i].evidence : ""}`,
        teams: "teams" in results[i] ? results[i].teams : undefined,
      })),
    };
  });
  return cards.sort(
    (a, b) =>
      ({ watch: 0, won: 1, lost: 2, neutral: 3 })[a.tone] -
      { watch: 0, won: 1, lost: 2, neutral: 3 }[b.tone],
  );
}

async function source(url: string): Promise<any> {
  const r = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Monday ticket evidence returned ${r.status}.`);
  return r.json();
}
// One catalog read per warm worker per day; never cache live scores or ticket selections.
let catalogCache: { fetched: number; data: Snapshot["catalog"] } | undefined;
async function catalog() {
  if (catalogCache && catalogCache.fetched > Date.now() - 86400000)
    return catalogCache.data;
  const data = await source("https://api.sleeper.app/v1/players/nfl");
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Player names unavailable.");
  catalogCache = { fetched: Date.now(), data };
  return data;
}
export async function mondayEmail(
  db: any,
  row: any,
  league: any,
  teams: any[],
  base: any,
): Promise<EmailContent> {
  // A personal query, including voided tickets, and excluding season futures.
  const personal = await db
    .from("tickets")
    .select("*")
    .eq("league_id", row.league_id)
    .eq("team_id", row.team_id)
    .eq("nfl_season", league.nfl_season)
    .eq("market_week", row.market_week)
    .neq("ticket_type", "future")
    .order("placed_at", { ascending: false });
  if (personal.error) throw new Error(personal.error.message);
  const tickets = personal.data ?? [];
  const common = {
    ...base,
    subject: `Your Monday Night Ticket Watch · Week ${row.market_week}`,
    heading: "Monday Night. Your Tickets. 🏈",
    button: "Follow Your Tickets",
    details: [
      ["Week", `Season ${league.league_season} • Week ${row.market_week}`],
    ] as [string, string][],
  };
  if (!tickets.length)
    return {
      ...common,
      heading: "No Bets This Week 😢",
      paragraphs: [
        "You didn’t place any weekly bets this week. No tickets to sweat tonight—just football and a little FOMO.",
        "Check the sportsbook for your next opportunity. Season futures are tracked separately.",
      ],
    };
  const ticketIds = tickets.map((t: any) => t.id);
  const legRows = await db
    .from("ticket_legs")
    .select("*")
    .in("ticket_id", ticketIds)
    .order("leg_number");
  if (legRows.error) throw new Error(legRows.error.message);
  if (
    tickets.some(
      (t: any) => !(legRows.data ?? []).some((l: any) => l.ticket_id === t.id),
    )
  )
    throw new Error(
      "Accepted ticket legs unavailable. Monday email held for retry.",
    );
  if (tickets.every((t: any) => t.status !== "OPEN"))
    return {
      ...common,
      paragraphs: [
        "Your weekly tickets have already been settled. Here are your official results.",
      ],
      tickets: mondayTickets(tickets, legRows.data, {
        checkedAt: new Date().toISOString(),
        games: [],
        teams: {},
        players: {},
        teamPlayers: {},
        catalog: {},
      }),
    };
  const [settings, matchups, stats, names, observation, projections, history] =
    await Promise.all([
      source(`https://api.sleeper.app/v1/league/${league.sleeper_league_id}`),
      source(
        `https://api.sleeper.app/v1/league/${league.sleeper_league_id}/matchups/${row.market_week}`,
      ),
      source(
        `https://api.sleeper.com/stats/nfl/${league.nfl_season}/${row.market_week}?season_type=regular`,
      ),
      catalog(),
      fetchGameStatus(),
      source(
        `https://api.sleeper.com/projections/nfl/${league.nfl_season}/${row.market_week}?season_type=regular`,
      ).catch(() => []),
      Promise.all(
        Array.from({ length: Math.min(4, row.market_week - 1) }, (_, i) =>
          source(
            `https://api.sleeper.app/v1/league/${league.sleeper_league_id}/matchups/${row.market_week - i - 1}`,
          ).catch(() => []),
        ),
      ),
    ]);
  if (
    Number(settings.season) !== league.nfl_season ||
    observation.season_year !== league.nfl_season ||
    observation.season_type !== 2 ||
    observation.reason ||
    !Array.isArray(matchups) ||
    !Array.isArray(stats) ||
    !Array.isArray(projections) ||
    history.some((h) => !Array.isArray(h))
  )
    throw new Error(
      "Monday evidence is incomplete or season does not match. Email held for retry.",
    );
  const [start, end] = scoreboardWindow(new Date()).split("-");
  const games = observation.games.filter((g) => {
    const day = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/New_York",
    })
      .format(new Date(g.starts_at))
      .replaceAll("-", "");
    return day >= start && day <= end;
  });
  const snapshot: Snapshot = {
    checkedAt: new Date().toISOString(),
    games,
    teams: {},
    players: {},
    teamPlayers: {},
    catalog: { ...names },
    forecasts: {},
  };
  // The week's provider mapping takes precedence over a catalog changed by a later trade.
  for (const p of [...projections, ...stats])
    if (p.player_id && typeof p.team === "string")
      snapshot.catalog[p.player_id] = {
        ...snapshot.catalog[p.player_id],
        team: p.team,
      };
  for (const t of teams) {
    const m = matchups.find((m: any) => m.roster_id === t.roster_id);
    const points = m?.custom_points ?? m?.points;
    if (!m || !Number.isFinite(points) || !Array.isArray(m.starters))
      throw new Error(
        "Monday lineup or team scores unavailable. Email held for retry.",
      );
    snapshot.teams[t.id] = {
      name: String(t.team_name ?? t.name ?? `Team ${t.roster_id}`),
      points,
    };
    snapshot.teamPlayers[t.id] = m.starters.filter(
      (id: string) => id && id !== "0",
    );
  }
  for (const p of stats) {
    if (!p.player_id || !p.stats || !Number.isFinite(p.stats.gp)) continue;
    const points = score(p.stats, settings.scoring_settings);
    if (Number.isFinite(points))
      snapshot.players[p.player_id] = { played: p.stats.gp > 0, points };
  }
  for (const t of teams) {
    const m = matchups.find((m: any) => m.roster_id === t.roster_id);
    let projected = snapshot.teams[t.id].points,
      sd = 0,
      complete = true;
    const remaining: string[] = [];
    const finished = snapshot.teamPlayers[t.id].every(
      (id) => playerGame(snapshot, id)?.state === "final",
    );
    for (const id of snapshot.teamPlayers[t.id]) {
      const game = playerGame(snapshot, id);
      if (game?.state === "final") continue;
      remaining.push(playerName(snapshot, id));
      try {
        const prior = projections.find((p: any) => p.player_id === id);
        if (!game || !prior?.stats || !sameGameDate(prior.date, game.starts_at))
          throw new Error("Projection unavailable.");
        const observed = m.starters_points?.[m.starters.indexOf(id)];
        if (
          !Number.isFinite(observed) ||
          (game.state === "scheduled" && observed !== 0)
        )
          throw new Error("Player score unavailable.");
        const past = history.flatMap((week: any[]) =>
          week.flatMap((r) =>
            Number.isFinite(r.players_points?.[id])
              ? [r.players_points[id]]
              : [],
          ),
        );
        const estimate = remainingForecast(
          observed,
          Math.max(0, score(prior.stats, settings.scoring_settings)),
          elapsedMinutes(game),
          past,
        );
        projected += estimate.remaining;
        // Sum deviations conservatively rather than assuming independent teammates.
        sd += estimate.sd;
      } catch {
        complete = false;
      }
    }
    snapshot.forecasts![t.id] = {
      projected: complete ? projected : null,
      sd,
      remaining,
      finished,
    };
  }
  const clock = (v: string) =>
    new Date(v).toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  const tonight = games
    .filter((g) => g.state !== "final")
    .map((g) => `${g.teams.join(" vs. ")} · ${clock(g.starts_at)} Eastern`)
    .join("; ");
  return {
    ...common,
    paragraphs: [
      "One more game, one more chance. Here’s what to watch in your weekly tickets.",
      "Apparent wins and losses await official settlement and stat corrections. Original potential payouts may change if a leg pushes. Existing tickets keep their accepted lines and odds.",
      "Projected finishes use current scores plus forecasts for actual remaining starters. Main contenders are shown; longshots may still surprise. Missing projections stay unconfirmed.",
    ],
    details: [
      ...common.details,
      ["Still to play", tonight || "No remaining games confirmed"],
      ["Scores checked", clock(snapshot.checkedAt) + " Eastern"],
    ],
    tickets: mondayTickets(tickets, legRows.data ?? [], snapshot),
  };
}
