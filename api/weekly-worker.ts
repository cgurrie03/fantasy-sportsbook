import { communicationIdentity } from "./_lib/league-communications.js";
import { createClient } from "@supabase/supabase-js";
import { isWorker } from "./_lib/worker-auth.js";
import { POST as generate } from "./generate-markets.js";
import { POST as execution } from "./weekly-execution.js";
import { deliverEmails, queueEmail } from "./_lib/mail.js";
import { renderEmail } from "./_lib/email-templates.js";
import { randomUUID } from "node:crypto";
import { fetchGameStatus } from "./_lib/game-status.js";
import { collectLiveShadow, reviewLiveWeek } from "./_lib/live-pipeline.js";
import { reviewModelWeek } from "./_lib/model-pipeline.js";
import { refreshTicketProgress } from "./_lib/ticket-progress.js";
export const maxDuration = 60;
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
  jobs: { operation: string; status: string }[],
) {
  return ["refresh_matchups", "refresh_players", "refresh_specials"].every(
    (operation) =>
      jobs.some((job) => job.operation === operation && job.status === "done"),
  );
}
export async function POST(request: Request) {
  if (!isWorker(request))
    return json({ error: "Scheduled worker authentication required." }, 401);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return json({ error: "Worker database credentials missing." }, 503);
  const db = createClient(
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
      const identity = communicationIdentity(league);
      const recipients = await read(
        db
          .from("league_memberships")
          .select("*")
          .eq("league_id", job.league_id),
      );
      const enqueue = async (kind: string, week: number, onlyAdmin = false) => {
        for (const m of recipients.filter(
          (m: any) => !onlyAdmin || m.role === "admin",
        ))
          await queueEmail(db, {
            league_id: job.league_id,
            event_key: `${league.nfl_season}:${week}:${kind}:${m.id}`,
            kind,
            recipient: m.invited_email,
            team_id: m.team_id,
            market_week: week,
          });
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
          !runtime.week_started &&
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
            }),
          );
          const result: any = await response.json();
          if (!response.ok) throw new Error(result.error);
          if (!result.quotes?.length)
            throw new Error(`${category} returned no complete pricing inputs.`);
          const prior = await read(
            db.from("sportsbook_markets").select("*").eq("board_id", boardId),
          );
          quotes = result.quotes.map((q: any) => {
            const old = prior.find(
              (p: any) => p.market_key === q.market_key && p.side === q.side,
            );
            const featured = prior.find(
              (p: any) =>
                p.matchup_key === q.matchup_key && p.featured && p.active,
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
            // Count-over-projection and season win benchmarks keep their
            // original contract. Refreshing prices never changes that target.
            if (old?.metadata.projection_targets)
              q.metadata.projection_targets = old.metadata.projection_targets;
            return { ...q, id: old?.id ?? q.id };
          });
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
        if (job.operation === "recheck")
          for (const week of new Set<number>(
            result.tickets
              .filter(
                (t: any) =>
                  t.pending &&
                  t.ticket_type !== "future" &&
                  t.market_week <= job.market_week,
              )
              .map((t: any) => t.market_week),
          ))
            await enqueue("attention", week, true);
        const unresolvedFutures = result.tickets.filter(
          (t: any) => t.ticket_type === "future" && t.pending && t.final,
        );
        if (job.operation === "recheck" && unresolvedFutures.length) {
          const content = {
            subject: "Season Futures Need Review",
            heading: "A Final Season Result Needs Your Attention",
            greeting: "Hi league administrator,",
            paragraphs: [
              "These season tickets have a final-result ambiguity. Their stakes remain committed; the normal futures cash-floor rule still applies.",
            ],
            details: unresolvedFutures.map(
              (t: any) =>
                [
                  "Ticket " + t.ticket_id.slice(0, 8),
                  t.legs
                    .filter((l: any) => l.status === "OPEN")
                    .map((l: any) => l.evidence)
                    .join(" "),
                ] as [string, string],
            ),
            button: "Review Weekly Execution",
            url: identity.url,
            brand: identity.brand,
          };
          for (const m of recipients.filter((m: any) => m.role === "admin"))
            await queueEmail(db, {
              league_id: job.league_id,
              event_key: `${league.nfl_season}:${job.market_week}:future-attention:${m.id}`,
              kind: "attention",
              recipient: m.invited_email,
              team_id: m.team_id,
              market_week: job.market_week,
              payload: {
                from: identity.from,
                to: [m.invited_email],
                subject: content.subject,
                html: renderEmail(content),
                text:
                  content.subject +
                  "\n" +
                  content.paragraphs.join("\n") +
                  "\n" +
                  content.details
                    .map((d: [string, string]) => d.join(": "))
                    .join("\n") +
                  "\n" +
                  content.url,
              },
            });
        }
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
          if (reasons.length) {
            for (const admin of recipients.filter(
              (m: any) => m.role === "admin",
            )) {
              const content = {
                subject: `Incomplete Projected Lineups · Week ${job.market_week}`,
                heading: "The Morning Refresh Needs Your Review",
                greeting: `Hi ${admin.display_name ?? "league administrator"},`,
                paragraphs: [
                  "The scheduled morning recalculation finished, but some teams still lack a complete eligible lineup with positive projections.",
                  ...reasons,
                  "Affected selections remain locked. Review the roster or projection coverage and decide how to proceed. Other markets can open normally. Existing tickets have not changed.",
                ],
                details: [["Week", String(job.market_week)]] as [
                  string,
                  string,
                ][],
                button: "Review Lines & Markets",
                url: identity.url,
                brand: identity.brand,
              };
              await queueEmail(db, {
                league_id: job.league_id,
                event_key: `${job.event_key}:lineup-attention:${admin.id}`,
                kind: "attention",
                recipient: admin.invited_email,
                team_id: admin.team_id,
                market_week: job.market_week,
                payload: {
                  from: identity.from,
                  to: [admin.invited_email],
                  subject: content.subject,
                  html: renderEmail(content),
                  text: [
                    content.subject,
                    ...content.paragraphs,
                    content.url,
                  ].join("\n\n"),
                },
              });
            }
          }
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
            .select("operation,status")
            .eq("league_id", job.league_id)
            .eq("market_week", job.market_week)
            .gte("created_at", new Date(Date.now() - 7200000).toISOString())
            .in("operation", [
              "refresh_matchups",
              "refresh_players",
              "refresh_specials",
            ]),
        );
        if (!publicationRefreshComplete(fresh))
          throw new Error(
            "Publication held: all three categories need a successful fresh Wednesday refresh.",
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
            .gte("created_at", new Date(Date.now() - 7200000).toISOString()),
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
    }
    return json({
      job: job?.operation ?? null,
      status_source_error: statusError,
      ...(job && /^(generate|refresh)_/.test(job.operation)
        ? { delivery_deferred: true }
        : await deliverEmails(db)),
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
        const admins = await read(
          db
            .from("league_memberships")
            .select("id,team_id,invited_email")
            .eq("league_id", job.league_id)
            .eq("role", "admin"),
        );
        const identity = communicationIdentity(
          (
            await read(db.from("leagues").select("*").eq("id", job.league_id))
          )[0],
        );
        for (const m of admins) {
          const content = {
            subject: "Weekly Automation Needs Attention",
            heading: "An Automated Step Needs Review",
            greeting: "Hi league administrator,",
            paragraphs: [error],
            details: [
              ["Operation", job.operation],
              ["Week", String(job.market_week)],
            ] as [string, string][],
            button: "Review Weekly Execution",
            url: identity.url,
            brand: identity.brand,
          };
          await queueEmail(db, {
            league_id: job.league_id,
            event_key: job.event_key + ":failure:" + m.id,
            kind: "attention",
            recipient: m.invited_email,
            team_id: m.team_id,
            market_week: job.market_week,
            payload: {
              from: identity.from,
              to: [m.invited_email],
              subject: content.subject,
              html: renderEmail(content),
              text:
                content.subject +
                "\n" +
                job.operation +
                ": " +
                error +
                "\n" +
                content.url,
            },
          });
        }
      }
    } catch {
      /* Return the original error if logging is unavailable. */
    }
    return json({ error }, 503);
  }
}
