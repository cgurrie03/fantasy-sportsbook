import { createClient } from "@supabase/supabase-js";
import { isWorker } from "./_lib/worker-auth.js";
import { POST as generate } from "./generate-markets.js";
import { POST as execution } from "./weekly-execution.js";
import { deliverEmails, queueEmail } from "./_lib/mail.js";
import { renderEmail } from "./_lib/email-templates.js";
import { randomUUID } from "node:crypto";
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
    new Request("https://sportsbook.coopergurrie.com/api/" + path, {
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
      if (["settlement", "recheck", "replenishment"].includes(job.operation)) {
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
            greeting: "Hi Cooper,",
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
            url: "https://sportsbook.coopergurrie.com/",
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
                from: "Goldy Fantasy Sportsbook <sportsbook@coopergurrie.com>",
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
      } else if (job.operation === "generate_futures") {
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
        const category = job.operation.endsWith("matchups")
          ? "Matchups"
          : job.operation.endsWith("players")
            ? "Player Points"
            : "Weekly Specials";
        // Refresh standings used by featured selections and opening-email records.
        const rostersResponse = await fetch(
          "https://api.sleeper.com/v1/league/1312126153980391424/rosters",
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
        if (board?.status === "published") {
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
        if (board && board.status !== "draft")
          throw new Error(
            "Automatic regeneration will not change an already published or manually closed board.",
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
            ? ["spread", "moneyline", "match_total", "team_total"]
            : category === "Player Points"
              ? ["player_points"]
              : [
                  "weekly_high",
                  "weekly_low",
                  "weekly_count_150",
                  "weekly_any_below_100",
                  "weekly_any_200",
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
        };
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
        if (
          board?.status !== "published" &&
          !["refresh_matchups", "refresh_players", "refresh_specials"].every(
            (op) =>
              fresh.some((j: any) => j.operation === op && j.status === "done"),
          )
        )
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
        .eq("id", job.id);
      if (save.error) throw new Error(save.error.message);
    }
    return json({
      job: job?.operation ?? null,
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
          .eq("id", job.id);
      if (job) {
        const admins = await read(
          db
            .from("league_memberships")
            .select("id,team_id,invited_email")
            .eq("league_id", job.league_id)
            .eq("role", "admin"),
        );
        for (const m of admins) {
          const content = {
            subject: "Weekly Automation Needs Attention",
            heading: "An Automated Step Needs Review",
            greeting: "Hi Cooper,",
            paragraphs: [error],
            details: [
              ["Operation", job.operation],
              ["Week", String(job.market_week)],
            ] as [string, string][],
            button: "Review Weekly Execution",
            url: "https://sportsbook.coopergurrie.com/",
          };
          await queueEmail(db, {
            league_id: job.league_id,
            event_key: job.event_key + ":failure:" + m.id,
            kind: "attention",
            recipient: m.invited_email,
            team_id: m.team_id,
            market_week: job.market_week,
            payload: {
              from: "Goldy Fantasy Sportsbook <sportsbook@coopergurrie.com>",
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
