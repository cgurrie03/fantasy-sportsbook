import { parseSportsbookPolicy } from "./_lib/sportsbook-policy.js";
import {
  isPromotional,
  currentNotificationWindow,
} from "./_lib/notification-window.js";
import { participantMailAudience } from "./_lib/league-communications.js";
import { retireRoutinePayloads } from "./_lib/routine-retention.js";
import { createServerClient } from "./_lib/server-client.js";
import { isWorker } from "./_lib/worker-auth.js";
import { POST as generate } from "./generate-markets.js";
import { POST as execution } from "./weekly-execution.js";
import { deliverEmails, queueEmail } from "./_lib/mail.js";
import { queueStaffAttention } from "./_lib/staff-alerts.js";
import { randomUUID } from "node:crypto";
import { fetchGameStatus } from "./_lib/game-status.js";
import { collectLiveShadow, reviewLiveWeek } from "./_lib/live-pipeline.js";
import { reviewModelWeek } from "./_lib/model-pipeline.js";
import { refreshTicketProgress } from "./_lib/ticket-progress.js";
export const maxDuration = 120;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
export function easternTime(date: string, time: string) {
  const desired = new Date(`${date}T${time}:00Z`).getTime();
  let instant = desired;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(new Date(instant));
    instant += desired - new Date(parts.replace(" ", "T") + "Z").getTime();
  }
  return new Date(instant).toISOString();
}
export function boardWindow(now: Date, opening: string, cutoff: string) {
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const tuesday = new Date(local + "T12:00:00Z");
  tuesday.setUTCDate(tuesday.getUTCDate() - ((tuesday.getUTCDay() + 5) % 7));
  const day = (offset: number) => {
    const d = new Date(tuesday);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  return {
    opens: easternTime(day(1), opening.slice(0, 5)),
    closes: easternTime(day(2), cutoff.slice(0, 5)),
  };
}
export function retainPublishedBoard(
  status: string | undefined,
  operation: string,
) {
  return status === "published" && !operation.startsWith("refresh_");
}
export function publicationRefreshComplete(
  jobs: {
    operation: string;
    status: string;
    created_at?: string;
    completed_at?: string;
  }[],
) {
  return [
    "refresh_matchups",
    "refresh_players",
    "refresh_specials",
    "refresh_futures",
  ].every((operation) => {
    const latest = jobs
      .filter((job) => job.operation === operation)
      .sort((a, b) =>
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
      )[0];
    const finished = latest?.completed_at ?? latest?.created_at;
    return (
      latest?.status === "done" &&
      !!finished &&
      Date.parse(finished) > Date.now() - 130 * 60000
    );
  });
}
export const refreshPriorColumns =
  "id,market_key,side,matchup_key,featured,active,projection_targets:metadata->projection_targets";
export function weeklyResultsPending(
  operation: string,
  week: number,
  result: any,
) {
  return (
    result.tickets.some(
      (t: any) =>
        t.ticket_type !== "future" &&
        t.pending &&
        !t.final &&
        (operation === "replenishment"
          ? t.market_week < week
          : t.market_week <= week),
    ) ||
    (operation === "replenishment" &&
      result.balances.some((b: any) =>
        /unresolved|unavailable/i.test(b.reason),
      ))
  );
}
export function preserveRefreshQuote(
  quote: any,
  prior: any[],
  category: string,
) {
  const q = { ...quote, metadata: { ...quote.metadata } };
  const old = prior.find(
    (p) => p.market_key === q.market_key && p.side === q.side,
  );
  const featured = prior.find(
    (p) => p.matchup_key === q.matchup_key && p.featured && p.active,
  )?.featured;
  if (category === "Matchups" && featured) {
    q.featured = featured;
    q.boost_pct =
      (featured === "Game of the Week" && q.kind === "moneyline") ||
      (featured === "Tank Bowl" &&
        (q.kind === "moneyline" ||
          (q.kind === "match_total" && q.side === "over")))
        ? 25
        : 0;
  }
  if (old?.projection_targets)
    q.metadata.projection_targets = old.projection_targets;
  return { ...q, id: old?.id ?? q.id };
}
export async function POST(request: Request) {
  if (!isWorker(request))
    return json({ error: "Scheduled worker authentication required." }, 401);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return json({ error: "Worker database credentials missing." }, 503);
  const db = await createServerClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  let job: any;
  const read = async (q: any) => {
    const r = await q;
    if (r.error) throw new Error(r.error.message);
    return r.data ?? [];
  };
  const internal = (path: string, body: unknown) =>
    new Request(new URL("/api/" + path, request.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-worker-secret": process.env.WEEKLY_WORKER_SECRET!,
        ...(process.env.BOFF_ENVIRONMENT === "development"
          ? { "x-boff-manual-run": "true" }
          : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    const input = (await request.json().catch(() => ({}))) as {
      check?: boolean;
    };
    if (input.check) {
      const ready = await db
        .from("weekly_schedule")
        .select("league_id,automation_enabled")
        .limit(1);
      if (ready.error) throw new Error(ready.error.message);
      return json({
        ready: true,
        email_configured: Boolean(process.env.RESEND_API_KEY),
        schedules: ready.data,
      });
    }
    // Maintenance failure must not starve settlement or replenishment.
    const cleanup = await db.rpc("cleanup_terminal_refresh_payloads", {
      p_limit: 5,
    });
    if (cleanup.error)
      console.error("Refresh cleanup failed", { code: cleanup.error.code });
    const evaluationCleanup = await db.rpc("cleanup_evaluated_samples", {
      p_limit: 2,
    });
    if (evaluationCleanup.error)
      console.error("Evaluation cleanup failed", {
        code: evaluationCleanup.error.code,
      });
    // Cadence detection never waits for the next two-hour pricing interval.
    // A source outage suspends refresh/acceptance, but must not starve settlement.
    let statusError: string | null = null;
    try {
      const observed = await fetchGameStatus();
      // Read-only score observations never alter settlement, accepted quotes or wallets.
      const activeLeagues = await read(
        db
          .from("leagues")
          .select("id,sleeper_league_id,nfl_season")
          .eq("operations_enabled", true),
      );
      await Promise.all(
        activeLeagues.map(async (league: any) => {
          try {
            await refreshTicketProgress(db, league, observed);
          } catch {
            /* Retain the previous observation; clients mark it delayed. */
          }
        }),
      );
      const saved = await db.rpc("observe_line_refresh", {
        p_status: observed,
      });
      if (saved.error) statusError = saved.error.message;
    } catch (error) {
      statusError =
        error instanceof Error ? error.message : "NFL status unavailable.";
      await db.rpc("observe_line_refresh", {
        p_status: {},
        p_error: statusError,
      });
    }
    const claimed = await db.rpc("claim_automation_job");
    if (claimed.error) throw new Error(claimed.error.message);
    job = claimed.data?.[0];
    if (job) {
      const schedule = (
        await read(
          db.from("weekly_schedule").select("*").eq("league_id", job.league_id),
        )
      )[0];
      const league = (
        await read(db.from("leagues").select("*").eq("id", job.league_id))
      )[0];
      if (!league?.operations_enabled)
        throw new Error(
          "League operations are disabled pending verified rollout.",
        );
      const family = job.operation.match(
        /^(?:generate|refresh|interval)_(matchups|players|specials|futures)$/,
      )?.[1];
      if (family) {
        const checked = await db.rpc("sportsbook_policy", {
          p_league: job.league_id,
          p_season: league.nfl_season,
          p_week: job.market_week,
        });
        if (checked.error) throw Error("Effective market policy unavailable.");
        const policy = parseSportsbookPolicy(checked.data);
        if (
          !policy.values[(family + "_enabled") as keyof typeof policy.values]
        ) {
          if (job.operation.startsWith("interval_")) {
            const staged = await db.rpc("stage_line_refresh", {
              p_job: job.id,
              p_attempt: job.attempts,
              p_quotes: [],
            });
            if (staged.error)
              throw Error("Disabled family stage could not be fenced.");
          }
          const done = await db
            .from("automation_jobs")
            .update({
              status: "done",
              completed_at: new Date().toISOString(),
              summary: {
                skipped: true,
                reason: "Market family disabled by effective policy",
                policy_revision: policy.revision,
              },
            })
            .eq("id", job.id)
            .eq("attempts", job.attempts)
            .eq("status", "running");
          if (done.error)
            throw Error("Disabled family job could not be completed.");
          return json({
            job: job.operation,
            skipped: true,
            policy_revision: policy.revision,
          });
        }
      }
      const recipients = await read(
        db
          .from("league_memberships")
          .select("*")
          .eq("league_id", job.league_id),
      );
      const enqueue = async (kind: string, week: number) => {
        const window = isPromotional(kind)
          ? await currentNotificationWindow(
              db,
              { league_id: job.league_id, market_week: week, kind },
              league.nfl_season,
            )
          : null;
        if (window && !window.eligible) return;
        if (kind === "reminder" && window) {
          const expected = `relative-reminder-v1:${job.league_id}:${league.nfl_season}:${week}:${window.window_key}`;
          if (
            job.event_key !== expected ||
            !window.send_after ||
            Date.parse(window.send_after) > Date.now()
          )
            return;
        }
        const audience = await participantMailAudience(
          db,
          job.league_id,
          recipients,
        );
        for (const m of audience) {
          if (kind === "reminder" && window) {
            const queued = await db.rpc("queue_relative_reminder", {
              p_league: job.league_id,
              p_week: week,
              p_team: m.team_id,
              p_recipient: m.invited_email,
              p_key: window.window_key,
            });
            if (queued.error)
              throw Error("Relative reminder could not be queued.");
          } else
            await queueEmail(db, {
              league_id: job.league_id,
              event_key: `${league.nfl_season}:${week}:${kind}:${m.id}`,
              kind,
              recipient: m.invited_email,
              team_id: m.team_id,
              market_week: week,
              ...(window ? { notification_context: window } : {}),
            });
        }
      };
      let summary: unknown = {};
      if (job.operation.startsWith("interval_")) {
        const category = (
          {
            interval_matchups: "Matchups",
            interval_players: "Player Points",
            interval_specials: "Weekly Specials",
            interval_futures: "Season Futures",
          } as Record<string, string>
        )[job.operation];
        if (!category) throw new Error("Unknown interval market family.");
        const runtime = (
          await read(
            db
              .from("line_refresh_runtime")
              .select("*")
              .eq("league_id", job.league_id),
          )
        )[0];
        const cycle = (
          await read(
            db
              .from("line_refresh_cycles")
              .select("*")
              .eq("id", job.refresh_cycle_id),
          )
        )[0];
        let quotes: any[] = [];
        const boardId =
          category === "Season Futures"
            ? cycle.future_board
            : cycle.weekly_board;
        const target = boardId
          ? (
              await read(
                db.from("sportsbook_boards").select("*").eq("id", boardId),
              )
            )[0]
          : null;
        if (!runtime) throw new Error("Refresh status unavailable.");
        let liveShadow: unknown = null;
        if (
          job.operation === "interval_matchups" &&
          runtime.week_started &&
          !target?.reopening_id &&
          cycle.status === "staging"
        ) {
          liveShadow = await collectLiveShadow(
            db,
            job,
            league,
            await read(
              db
                .from("teams")
                .select("id,roster_id,team_name")
                .eq("league_id", job.league_id),
            ),
          );
        }
        if (
          cycle.status === "staging" &&
          (!runtime.week_started || Boolean(target?.reopening_id)) &&
          !runtime.last_error &&
          target?.status === "published" &&
          Date.parse(target.closes_at) > Date.now() &&
          !schedule.publication_paused
        ) {
          const response = await generate(
            internal("generate-markets", {
              league_id: job.league_id,
              week: job.market_week,
              nfl_season: league.nfl_season,
              category,
              source_cycle_id: job.refresh_cycle_id,
              ...(target?.reopening_id
                ? { reopening_id: target.reopening_id }
                : {}),
            }),
          );
          const result: any = await response.json();
          if (!response.ok) throw new Error(result.error);
          if (!result.quotes?.length)
            throw new Error(`${category} returned no complete pricing inputs.`);
          const prior = await read(
            db
              .from("sportsbook_markets")
              .select(refreshPriorColumns)
              .eq("board_id", boardId),
          );
          quotes = result.quotes.map((q: any) =>
            preserveRefreshQuote(q, prior, category),
          );
        }
        const staged = await db.rpc("stage_line_refresh", {
          p_job: job.id,
          p_attempt: job.attempts,
          p_quotes: quotes,
        });
        if (staged.error) throw new Error(staged.error.message);
        summary = { ...staged.data, live_shadow: liveShadow };
      } else if (job.operation === "model_review") {
        // Live review errors must not prevent the broader completed-week review.
        let live: unknown;
        try {
          live = await reviewLiveWeek(db, job, league);
        } catch (error) {
          live = {
            error:
              error instanceof Error ? error.message : "Live review deferred.",
          };
        }
        summary = { live, weekly: await reviewModelWeek(db, job, league) };
      } else if (
        ["settlement", "recheck", "replenishment"].includes(job.operation)
      ) {
        const r = await execution(
          internal("weekly-execution", {
            league_id: job.league_id,
            apply: true,
            replenish: job.operation === "replenishment",
          }),
        );
        const result: any = await r.json();
        if (!r.ok) throw new Error(result.error);
        summary = result;
        const waiting = weeklyResultsPending(
          job.operation,
          job.market_week,
          result,
        );
        if (waiting) {
          const deferred = await db
            .from("automation_jobs")
            .update({
              status: "pending",
              summary: result,
              lease_until: new Date(Date.now() + 15 * 60000).toISOString(),
              last_error:
                "Waiting for verified results; automatic retry is scheduled.",
            })
            .eq("id", job.id)
            .eq("attempts", job.attempts)
            .eq("status", "running");
          if (deferred.error) throw new Error(deferred.error.message);
          return json({
            job: job.operation,
            waiting_for_results: true,
            ...(await deliverEmails(db)),
          });
        }
        if (
          job.operation === "recheck" &&
          result.tickets.some(
            (t: any) =>
              t.pending &&
              t.ticket_type !== "future" &&
              t.market_week <= job.market_week,
          )
        )
          await queueStaffAttention(db, job.id, "results");
        if (
          job.operation === "recheck" &&
          result.tickets.some(
            (t: any) => t.ticket_type === "future" && t.pending && t.final,
          )
        )
          await queueStaffAttention(db, job.id, "futures");
      } else if (
        job.operation === "generate_futures" ||
        job.operation === "refresh_futures"
      ) {
        const board = (
          await read(
            db
              .from("sportsbook_boards")
              .select("*")
              .eq("league_id", job.league_id)
              .eq("nfl_season", league.nfl_season)
              .eq("board_type", "future"),
          )
        )[0];
        if (!board)
          summary = {
            skipped: true,
            reason: "Season Futures have not been enabled.",
          };
        else {
          const r = await generate(
            internal("generate-markets", {
              league_id: job.league_id,
              week: job.market_week,
              nfl_season: league.nfl_season,
              category: "Season Futures",
            }),
          );
          const result: any = await r.json();
          if (!r.ok) throw new Error(result.error);
          const prior = await read(
            db.from("sportsbook_markets").select("*").eq("board_id", board.id),
          );
          const quotes = result.quotes.map((q: any) => ({
            ...q,
            id:
              prior.find(
                (m: any) => m.market_key === q.market_key && m.side === q.side,
              )?.id ?? q.id,
          }));
          const saved = await db.rpc("worker_operation", {
            p_league: job.league_id,
            p_operation: "save_future_board",
            p_args: {
              board: board.id,
              quotes,
              status: quotes.length ? board.status : "closed",
            },
          });
          if (saved.error) throw new Error(saved.error.message);
          summary = {
            category: "Season Futures",
            markets: quotes.length,
            status: board.status,
            accepted_odds_preserved: true,
          };
        }
      } else if (
        job.operation.startsWith("generate_") ||
        job.operation.startsWith("refresh_")
      ) {
        if (
          ![
            "generate_matchups",
            "generate_players",
            "generate_specials",
            "refresh_matchups",
            "refresh_players",
            "refresh_specials",
          ].includes(job.operation)
        )
          throw new Error("Unknown scheduled market operation.");
        const category = job.operation.endsWith("matchups")
          ? "Matchups"
          : job.operation.endsWith("players")
            ? "Player Points"
            : "Weekly Specials";
        // Refresh standings used by featured selections and opening-email records.
        const rostersResponse = await fetch(
          `https://api.sleeper.com/v1/league/${league.sleeper_league_id}/rosters`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!rostersResponse.ok)
          throw new Error("Sleeper standings unavailable.");
        for (const r of (await rostersResponse.json()) as any[]) {
          const update = await db
            .from("teams")
            .update({
              wins: r.settings.wins,
              losses: r.settings.losses,
              ties: r.settings.ties,
            })
            .eq("league_id", job.league_id)
            .eq("roster_id", r.roster_id);
          if (update.error) throw new Error(update.error.message);
        }
        const board = (
          await read(
            db
              .from("sportsbook_boards")
              .select("*")
              .eq("board_type", "weekly")
              .eq("league_id", job.league_id)
              .eq("nfl_season", league.nfl_season)
              .eq("market_week", job.market_week),
          )
        )[0];
        if (retainPublishedBoard(board?.status, job.operation)) {
          const retained = await db
            .from("automation_jobs")
            .update({
              status: "done",
              completed_at: new Date().toISOString(),
              summary: { retained_published_board: true },
              last_error: null,
            })
            .eq("id", job.id);
          if (retained.error) throw new Error(retained.error.message);
          return json({ job: job.operation, retained_published_board: true });
        }
        if (board && !["draft", "published"].includes(board.status))
          throw new Error(
            "Automatic regeneration will not reopen a manually closed board.",
          );
        const response = await generate(
          internal("generate-markets", {
            league_id: job.league_id,
            week: job.market_week,
            nfl_season: league.nfl_season,
            category,
          }),
        );
        const result: any = await response.json();
        if (!response.ok) throw new Error(result.error);
        const existing = board
          ? await read(
              db
                .from("sportsbook_markets")
                .select("*")
                .eq("board_id", board.id),
            )
          : [];
        const kinds =
          category === "Matchups"
            ? [
                "spread",
                "moneyline",
                "match_total",
                "team_total",
                "team_milestone",
                "winning_margin",
              ]
            : category === "Player Points"
              ? ["player_points", "player_milestone", "player_h2h"]
              : [
                  "weekly_high",
                  "weekly_low",
                  "weekly_count_150",
                  "weekly_any_below_100",
                  "weekly_any_200",
                  "weekly_count_projection",
                  "weekly_average",
                  "weekly_highest_score",
                ];
        const featured = new Map(
          existing
            .filter((m: any) => m.active && m.featured)
            .map((m: any) => [m.matchup_key, m.featured]),
        );
        const generated = result.quotes.map((q: any) => {
          const prior = existing.find(
            (m: any) => m.market_key === q.market_key && m.side === q.side,
          );
          const f = featured.get(q.matchup_key);
          if (category === "Matchups" && featured.size) {
            q.featured = f ?? "";
            q.boost_pct =
              (f === "Game of the Week" && q.kind === "moneyline") ||
              (f === "Tank Bowl" &&
                (q.kind === "moneyline" ||
                  (q.kind === "match_total" && q.side === "over")))
                ? 25
                : 0;
          }
          return { ...q, id: prior?.id ?? q.id };
        });
        const quotes = [
          ...existing.filter((q: any) => q.active && !kinds.includes(q.kind)),
          ...generated,
        ];
        const window = boardWindow(
          new Date(),
          schedule.opening_time,
          schedule.job_times.cutoff,
        );
        const saved = await db.rpc("worker_operation", {
          p_league: job.league_id,
          p_operation: "save_board",
          p_args: {
            board: board?.id ?? randomUUID(),
            week: job.market_week,
            ...window,
            quotes,
            status: "draft",
          },
        });
        if (saved.error) throw new Error(saved.error.message);
        summary = {
          category,
          markets: generated.length,
          warnings: result.warnings,
          accepted_tickets_preserved: true,
        };
        if (job.operation === "refresh_specials") {
          const reasons = [
            ...new Set<string>(
              generated
                .filter((q: any) => q.metadata?.lineup_locked)
                .map((q: any) => String(q.metadata.lock_reason)),
            ),
          ];
          if (reasons.length) await queueStaffAttention(db, job.id, "lineup");
        }
      } else if (job.operation === "publish") {
        if (schedule.publication_paused) {
          await db
            .from("automation_jobs")
            .update({
              status: "pending",
              attempts: 0,
              lease_until: new Date(Date.now() + 60000).toISOString(),
              summary: { paused: true },
            })
            .eq("id", job.id);
          return json({ paused: true, ...(await deliverEmails(db)) });
        }
        const board = (
          await read(
            db
              .from("sportsbook_boards")
              .select("*")
              .eq("board_type", "weekly")
              .eq("league_id", job.league_id)
              .eq("nfl_season", league.nfl_season)
              .eq("market_week", job.market_week),
          )
        )[0];
        const fresh = await read(
          db
            .from("automation_jobs")
            .select("operation,status,created_at,completed_at")
            .eq("league_id", job.league_id)
            .eq("market_week", job.market_week)
            .gte(
              "created_at",
              new Date(Date.now() - 7 * 86400000).toISOString(),
            )
            .in("operation", [
              "refresh_matchups",
              "refresh_players",
              "refresh_specials",
              "refresh_futures",
            ]),
        );
        if (!publicationRefreshComplete(fresh))
          throw new Error(
            "Publication held: all four categories need a successful fresh opening refresh.",
          );
        if (
          !board ||
          board.status === "closed" ||
          new Date(board.closes_at).getTime() <= Date.now()
        )
          throw new Error("Publication held: no eligible draft board.");
        const quotes = await read(
          db
            .from("sportsbook_markets")
            .select("*")
            .eq("board_id", board.id)
            .eq("active", true),
        );
        if (board.status === "draft") {
          const r = await db.rpc("worker_operation", {
            p_league: job.league_id,
            p_operation: "save_board",
            p_args: {
              board: board.id,
              week: job.market_week,
              opens: board.opens_at,
              closes: board.closes_at,
              quotes,
              status: "published",
            },
          });
          if (r.error) throw new Error(r.error.message);
        }
        const future = (
          await read(
            db
              .from("sportsbook_boards")
              .select("id,status")
              .eq("league_id", job.league_id)
              .eq("nfl_season", league.nfl_season)
              .eq("board_type", "future"),
          )
        )[0];
        if (future?.status === "published") {
          const futureConfirmed = await db.rpc(
            "confirm_scheduled_publication",
            { p_board: future.id },
          );
          if (futureConfirmed.error)
            throw new Error(futureConfirmed.error.message);
          if (!futureConfirmed.data)
            throw new Error(
              "Publication held: refreshed futures are not verified yet.",
            );
        }
        const confirmed = await db.rpc("confirm_scheduled_publication", {
          p_board: board.id,
        });
        if (confirmed.error) throw new Error(confirmed.error.message);
        if (!confirmed.data)
          throw new Error(
            "Publication held: current pregame source and complete fresh quotes are required.",
          );
        if (schedule.opening_email) await enqueue("opening", job.market_week);
        summary = { published: true };
      } else if (job.operation === "cutoff") {
        const result = await db
          .from("sportsbook_boards")
          .update({ status: "closed" })
          .eq("board_type", "weekly")
          .eq("league_id", job.league_id)
          .eq("nfl_season", league.nfl_season)
          .eq("market_week", job.market_week)
          .eq("status", "published")
          .lte("closes_at", new Date().toISOString());
        if (result.error) throw new Error(result.error.message);
        summary = { closed: true };
      } else if (job.operation === "reminder") {
        const boards = await read(
          db
            .from("sportsbook_boards")
            .select("id")
            .eq("board_type", "weekly")
            .eq("league_id", job.league_id)
            .eq("market_week", job.market_week)
            .eq("nfl_season", league.nfl_season)
            .eq("status", "published")
            .lte("opens_at", new Date().toISOString())
            .gt("closes_at", new Date().toISOString()),
        );
        if (
          schedule.reminder_email &&
          boards.length &&
          !schedule.publication_paused
        )
          await enqueue("reminder", job.market_week);
      } else if (job.operation === "monday_watch") {
        await enqueue("monday_watch", job.market_week);
        summary = {
          message: "Personal Monday ticket watch queued for league members.",
          week: job.market_week,
        };
      } else if (job.operation === "final_recap" && schedule.recap_email) {
        const check = await db.rpc("final_recap_ready", {
          p_league: job.league_id,
          p_season: league.nfl_season,
        });
        if (check.error || check.data !== true)
          throw Error("Final recap waits for the current final-week closeout.");
        await enqueue("recap", 18);
      } else if (
        job.operation === "recap" &&
        schedule.recap_email &&
        job.market_week > 1
      ) {
        const reset = await read(
          db
            .from("automation_jobs")
            .select("status")
            .eq("league_id", job.league_id)
            .eq("market_week", job.market_week)
            .eq("operation", "replenishment")
            .gte(
              "created_at",
              new Date(Date.now() - 7 * 86400000).toISOString(),
            ),
        );
        if (!reset.some((j: any) => j.status === "done"))
          throw new Error("Recap held until replenishment completes.");
        await enqueue("recap", job.market_week - 1);
      }
      const save = await db
        .from("automation_jobs")
        .update({
          status: "done",
          summary,
          completed_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", job.id)
        .eq("attempts", job.attempts)
        .eq("status", "running");
      if (save.error) throw new Error(save.error.message);
      if (job.operation === "refresh_futures") {
        const futures = await read(
          db
            .from("sportsbook_boards")
            .select("id")
            .eq("league_id", job.league_id)
            .eq("nfl_season", league.nfl_season)
            .eq("board_type", "future"),
        );
        for (const board of futures) {
          const confirmed = await db.rpc("confirm_scheduled_publication", {
            p_board: board.id,
          });
          if (confirmed.error)
            console.error(
              "Futures availability confirmation failed",
              confirmed.error,
            );
        }
      }
    }
    const delivery =
      job && /^(generate|refresh)_/.test(job.operation)
        ? { delivery_deferred: true }
        : await deliverEmails(db);
    const routineRetention = await retireRoutinePayloads(db);
    return json({
      job: job?.operation ?? null,
      cleanup: cleanup.error ? { failed: true } : cleanup.data,
      status_source_error: statusError,
      ...delivery,
      routine_retention: routineRetention,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Scheduled execution failed";
    try {
      if (job)
        await db
          .from("automation_jobs")
          .update({
            status: "failed",
            last_error: error,
            lease_until: new Date(Date.now() + 300000).toISOString(),
          })
          .eq("id", job.id)
          .eq("attempts", job.attempts)
          .eq("status", "running");
      if (
        job &&
        !job.operation.startsWith("interval_") &&
        job.operation !== "model_review"
      ) {
        await queueStaffAttention(db, job.id, "automation");
      }
    } catch {
      /* Return the original error if logging is unavailable. */
    }
    return json({ error }, 503);
  }
}
