import {
  isPromotional,
  currentNotificationWindow,
  windowRejection,
} from "./notification-window.js";
import type { NotificationWindow } from "./notification-window.js";
import {
  isRoutine,
  routinePermission,
  recapSnapshot,
} from "./routine-notifications.js";
import type { RoutineContext } from "./routine-notifications.js";
import { buildStaffAlert } from "./staff-alerts.js";
import {
  openingEditorialFacts,
  sharedOpeningEdition,
} from "./opening-editorial.js";
import { reopeningEmail } from "./reopening-email.js";
import { environmentIdentity } from "./environment-policy.js";
import {
  communicationIdentity,
  validateDeliveryScope,
  validatePayloadRecipient,
  validateCommunicationPayload,
} from "./league-communications.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderEmail, summarizeRoutineEmail, teamWatchText } from "./email-templates.js";
import type { EmailContent } from "./email-templates.ts";
import { mondayEmail } from "./monday-watch.js";
import {sendAmpMail} from "./amp-mail.js";
const money = (v: unknown) => "$" + Number(v ?? 0).toFixed(2);
const odds = (v: number) => (v > 0 ? "+" + v : String(v));
const date = (v: string) =>
  new Date(v).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const price = (m: any) => {
  const d =
    1 +
    (m.odds > 0 ? m.odds / 100 : 100 / Math.abs(m.odds)) *
      (1 + m.boost_pct / 100);
  return odds(Math.round(d >= 2 ? (d - 1) * 100 : -100 / (d - 1)));
};
async function read(query: any): Promise<any[]> {
  const r = await query;
  if (r.error) throw new Error(r.error.message);
  return r.data ?? [];
}
export async function queueEmail(
  db: SupabaseClient,
  row: Record<string, unknown>,
) {
  const r = await db
    .from("outbound_emails")
    .upsert(row, { onConflict: "event_key", ignoreDuplicates: true });
  if (r.error) throw new Error(r.error.message);
}
export async function buildEmail(
  db: SupabaseClient,
  row: any,
  verifiedWindow?: NotificationWindow,
  routine?: RoutineContext,
): Promise<EmailContent> {
  if (row.kind === "attention") return buildStaffAlert(db, row);
  const acceptedTicket =
    row.kind === "confirmation"
      ? (
          await read(
            db
              .from("tickets")
              .select("*")
              .eq("id", row.ticket_id)
              .eq("league_id", row.league_id)
              .eq("team_id", row.team_id),
          )
        )[0]
      : null;
  let financialRecipient: any = null;
  if (acceptedTicket?.user_wallet_id) {
    const result = await db.rpc("financial_email_recipient", {
      p_ticket: row.ticket_id,
    });
    financialRecipient = result.data;
    if (
      result.error ||
      !financialRecipient ||
      financialRecipient.wallet_id !== acceptedTicket.user_wallet_id ||
      financialRecipient.league_id !== row.league_id ||
      financialRecipient.team_id !== row.team_id ||
      financialRecipient.recipient !== row.recipient
    )
      throw new Error("Accepted financial recipient unavailable.");
  }
  if (
    !financialRecipient &&
    row.wallet_model === "user" &&
    row.kind !== "attention" &&
    row.kind !== "confirmation"
  ) {
    const result = await db.rpc("financial_email_context", {
      p_league: row.league_id,
      p_team: row.team_id,
      p_recipient: row.recipient,
    });
    financialRecipient = result.data;
    if (
      result.error ||
      !financialRecipient ||
      financialRecipient.league_id !== row.league_id ||
      financialRecipient.team_id !== row.team_id ||
      financialRecipient.recipient !== row.recipient
    )
      throw new Error("Financial recipient approval is unavailable.");
  }
  const [members, teams, wallets, leagues] = await Promise.all([
    financialRecipient
      ? Promise.resolve([
          {
            team_id: row.team_id,
            display_name: financialRecipient.display_name,
          },
        ])
      : read(
          db
            .from("league_memberships")
            .select("*")
            .eq("league_id", row.league_id),
        ),
    read(db.from("teams").select("*").eq("league_id", row.league_id)),
    financialRecipient
      ? Promise.resolve([{ balance: financialRecipient.balance }])
      : read(
          db
            .from("wallets")
            .select("team_id,balance")
            .eq("team_id", row.team_id),
        ),
    read(db.from("leagues").select("*").eq("id", row.league_id)),
  ]);
  const member = members.find((m) => m.team_id === row.team_id),
    league = leagues[0];
  if (!member || !league)
    throw new Error("League email membership unavailable.");
  const identity = communicationIdentity(league);
  const devLeaguePath = process.env.BOFF_ENVIRONMENT === "development" &&
    new URL(identity.url).origin === "https://dev.sportsbook.coopergurrie.com" &&
    /^\d{1,32}$/.test(league.sleeper_league_id ?? "")
    ? "/" + league.sleeper_league_id
    : "";
  const devPage = row.kind === "confirmation" || row.kind === "monday_watch" ? "my-bets"
    : row.kind === "recap" ? "league" : row.kind === "attention" ? "commissioner" : "matchups";
  const balance = wallets[0]?.balance;
  const availableBalance =
    financialRecipient && balance === null ? "Funding pending" : money(balance);
  const base = {
    greeting: `Hi ${member.display_name},`,
    url: devLeaguePath ? new URL(devLeaguePath + "/" + devPage, identity.url).href : identity.url,
    brand: identity.brand,
    paragraphs: [],
    details: [],
    button: "Open Your Sportsbook",
  };
  const promotion = isPromotional(row.kind)
    ? (verifiedWindow ??
      (await currentNotificationWindow(db, row, league.nfl_season)))
    : null;
  if (promotion && !promotion.eligible)
    throw Error("No actionable weekly betting window: " + promotion.reason);
  if (row.kind === "reopening") {
    const window = (
      await read(
        db
          .from("sportsbook_reopening_reviews")
          .select("*")
          .eq("id", row.reopening_id)
          .eq("league_id", row.league_id),
      )
    )[0];
    const board = window
      ? (
          await read(
            db
              .from("sportsbook_boards")
              .select("id,status,reopening_id")
              .eq("id", window.weekly_board)
              .eq("league_id", row.league_id),
          )
        )[0]
      : null;
    if (
      !window ||
      window.status !== "approved" ||
      Date.parse(window.closes_at) <= Date.now() ||
      board?.status !== "published" ||
      board.reopening_id !== window.id
    )
      throw new Error(
        "A verified, open reopening window is required before announcing it.",
      );
    return reopeningEmail({
      ...base,
      brand: identity.brand,
      week: row.market_week,
      closes_at: promotion!.deadline!,
    });
  }
  if (row.kind === "monday_watch")
    return mondayEmail(
      db,
      { ...row, financial_wallet_id: financialRecipient?.wallet_id },
      league,
      teams,
      base,
    );
  if (row.kind === "confirmation") {
    const ticket = acceptedTicket;
    if (!ticket) throw new Error("Accepted ticket unavailable.");
    const legs = await read(
      db
        .from("ticket_legs")
        .select("*")
        .eq("ticket_id", row.ticket_id)
        .order("leg_number"),
    );
    const ledger = financialRecipient
      ? { balance_after: financialRecipient.accepted_balance }
      : (
          await read(
            db
              .from("wallet_ledger")
              .select("balance_after")
              .eq("ticket_id", row.ticket_id)
              .eq("kind", "wager"),
          )
        )[0];
    return {
      ...base,
      subject: `Bet Confirmed · ${ticket.ticket_type === "future" ? "Season Futures" : `Week ${ticket.market_week}`} · ${ticket.id.slice(0, 8)}`,
      heading: "Your Bet Is Confirmed",
      paragraphs: [
        "Your selections and accepted odds are locked in. Follow your ticket in My Bets.",
      ],
      details: [
        ["Ticket", ticket.id.slice(0, 8)],
        [
          "Season / Week",
          `Season ${ticket.league_season} • ${ticket.ticket_type === "future" ? "Season Futures" : `Week ${ticket.market_week}`}`,
        ],
        ["Placed", date(ticket.placed_at)],
        ["Wager", money(ticket.stake)],
        ["Odds", odds(ticket.accepted_combined_odds)],
        ["Total payout if won", money(ticket.accepted_potential_payout)],
        ["Balance after placement", money(ledger?.balance_after ?? balance)],
      ],
      legs: legs.map((l) => ({
        matchup:
          l.matchup ??
          (ticket.ticket_type === "future"
            ? "Season Futures"
            : "Weekly Specials"),
        selection: l.selection,
        type: l.market_type,
      })),
      button: "View Your Bet",
    };
  }
  if (row.kind === "opening" || row.kind === "reminder") {
    const board = (
      await read(
        db
          .from("sportsbook_boards")
          .select("*")
          .eq("board_type", "weekly")
          .eq("league_id", row.league_id)
          .eq("nfl_season", league.nfl_season)
          .eq("market_week", row.market_week),
      )
    )[0];
    if (!board || board.status !== "published")
      throw new Error(
        "Published board unavailable; email waits for final publication.",
      );
    if (promotion?.board_id !== board.id)
      throw Error("The promotional board changed while composing the message.");
    if (row.kind === "reminder")
      return {
        ...base,
        subject: `Weekly Betting Window · Week ${row.market_week}`,
        heading: "Your Available Weekly Picks",
        paragraphs: [
          "Eligible weekly selections are available now. Individual markets may lock earlier; check the sportsbook for current prices and availability.",
          ...(routine?.merge_watch
            ? [
                `Your Monday ticket watch: at preparation on ${date(routine.prepared_at)}, you had ${routine.open_ticket_count >= 10000 ? "at least " : ""}${routine.open_ticket_count} open weekly ticket${routine.open_ticket_count === 1 ? "" : "s"}. Review your accepted selections and current progress in My Bets: ${new URL(devLeaguePath ? devLeaguePath + "/my-bets" : "#/bets", base.url).href}`,
              ]
            : []),
        ],
        details: [
          ["Available weekly opportunity until", date(promotion!.deadline!)],
          ["Your balance at preparation", availableBalance],
        ],
        button: "Finish Your Picks",
      };
    const markets = await read(
      db
        .from("sportsbook_markets")
        .select("*")
        .eq("board_id", board.id)
        .eq("active", true),
    );
    const groups = [
      ...new Set(
        markets.filter((m) => m.kind === "spread").map((m) => m.matchup_key),
      ),
    ].map((key) => markets.filter((m) => m.matchup_key === key));
    const futuresBoard = (
      await read(
        db
          .from("sportsbook_boards")
          .select("id")
          .eq("league_id", row.league_id)
          .eq("nfl_season", league.nfl_season)
          .eq("board_type", "future")
          .eq("status", "published")
          .lte("opens_at", new Date().toISOString())
          .gt("closes_at", new Date().toISOString()),
      )
    )[0];
    const favorites = futuresBoard
      ? (
          await read(
            db
              .from("sportsbook_markets")
              .select("team_id,odds,metadata")
              .eq("board_id", futuresBoard.id)
              .eq("kind", "future_champion")
              .eq("active", true),
          )
        )
          .sort(
            (a, b) =>
              Number(b.metadata.simulated_probability) -
              Number(a.metadata.simulated_probability),
          )
          .slice(0, 4)
          .map((m) => ({
            id: m.team_id,
            odds: Number(m.odds),
          }))
      : [];
    const edition = await sharedOpeningEdition(
      db,
      openingEditorialFacts(
        league,
        board,
        promotion!,
        teams,
        groups,
        favorites,
      ),
    );
    return {
      ...base,
      subject: `Week ${row.market_week} Is Open · ${identity.brand}`,
      heading: `Season ${league.league_season} • Week ${row.market_week} Is Open`,
      paragraphs: [
        "The board is ready. Bring your picks, your rivalries, and your wildly misplaced confidence.",
      ],
      details: [
        ["Betting opens", date(board.opens_at)],
        ["Available weekly opportunity until", date(promotion!.deadline!)],
        ["Your balance at preparation", availableBalance],
        ["Story snapshot prepared", date(edition.facts.prepared_at)],
      ],
      stories: edition.stories,
      featured: groups
        .filter((g) => g[0].featured)
        .map((g) => ({
          title: g[0].featured,
          total: String(g.find((m) => m.kind === "match_total")?.line ?? "—"),
          boostedOver:
            g[0].featured === "Tank Bowl"
              ? price(
                  g.find((m) => m.kind === "match_total" && m.side === "over"),
                )
              : undefined,
          teams: [g[0].home_team_id, g[0].away_team_id].map((id) => {
            const t = teams.find((t) => t.id === id),
              ml = g.find((m) => m.kind === "moneyline" && m.team_id === id),
              spread = g.find((m) => m.kind === "spread" && m.team_id === id);
            return {
              name: t.team_name,
              record: `${t.wins}–${t.losses}${t.ties ? "–" + t.ties : ""}`,
              avatarUrl: t.avatar_url,
              spread:
                Number(spread.line) > 0
                  ? "+" + spread.line
                  : String(spread.line),
              originalOdds: odds(ml.odds),
              boostedOdds: price(ml),
            };
          }),
        })),
      button: "View This Week’s Markets",
    };
  }
  const tickets = await read(
    db
      .from("tickets")
      .select("*")
      .eq("league_id", row.league_id)
      .eq("nfl_season", league.nfl_season)
      .eq("market_week", row.market_week)
      .neq("status", "VOIDED"),
  );
  const settled = tickets.filter((t) =>
      ["WON", "LOST", "PUSH"].includes(t.status),
    ),
    mine = settled.filter((t) =>
      financialRecipient
        ? t.user_wallet_id === financialRecipient.wallet_id
        : t.team_id === row.team_id,
    ),
    open = tickets.filter(
      (t) =>
        (financialRecipient
          ? t.user_wallet_id === financialRecipient.wallet_id
          : t.team_id === row.team_id) && t.status === "OPEN",
    ).length;
  const legs = tickets.length
    ? await read(
        db
          .from("ticket_legs")
          .select("*")
          .in(
            "ticket_id",
            tickets.map((t) => t.id),
          ),
      )
    : [];
  const stories: NonNullable<EmailContent["stories"]> = [];
  const worst = legs
    .filter(
      (l) =>
        l.status === "LOST" &&
        ["spread", "match_total", "team_total", "player_points"].includes(
          l.settlement_context?.kind,
        ) &&
        l.actual_value !== null &&
        l.accepted_line !== null,
    )
    .map((l) => ({
      ...l,
      miss: Math.abs(
        Number(l.actual_value) +
          (l.settlement_context.kind === "spread"
            ? Number(l.accepted_line)
            : -Number(l.accepted_line)),
      ),
    }))
    .sort((a, b) => a.miss - b.miss)[0];
  if (worst)
    stories.push({
      title: "💔 Worst Beat · So Close",
      text: `${worst.selection} missed by ${worst.miss.toFixed(2)} points. Half the fun is the pain. The group chat will understand. Eventually.`,
    });
  const upset = legs
    .filter(
      (l) =>
        l.status === "WON" &&
        l.settlement_context?.kind === "moneyline" &&
        Number(l.accepted_odds) > 0,
    )
    .sort((a, b) => b.accepted_odds - a.accepted_odds)[0];
  if (upset)
    stories.push({
      title: "🚨 Biggest Upset · Underdog Receipts",
      text: `${upset.selection} won at accepted odds of ${odds(upset.accepted_odds)}. Someone believed. Someone gets to be unbearable this week.`,
    });
  const popular = new Map<
    string,
    { selection: string; tickets: Set<string> }
  >();
  for (const l of legs) {
    const k = JSON.stringify([
      l.matchup,
      l.selection,
      l.accepted_line,
      l.accepted_odds,
    ]);
    const v = popular.get(k) ?? {
      selection: l.selection,
      tickets: new Set<string>(),
    };
    v.tickets.add(l.ticket_id);
    popular.set(k, v);
  }
  const most = [...popular.values()].sort(
    (a, b) => b.tickets.size - a.tickets.size,
  )[0];
  if (most)
    stories.push({
      title: "🧲 Most Bet Line · Group Chat Consensus",
      text: `${most.selection} appeared on ${most.tickets.size} ticket(s). Apparently everyone had the same brilliant idea.`,
    });
  const profits = teams.map((t) => ({
    name: t.team_name,
    profit: settled
      .filter((b) => b.team_id === t.id)
      .reduce((n, b) => n + Number(b.actual_payout) - Number(b.stake), 0),
  }));
  const best = Math.max(...profits.map((p) => p.profit));
  if (best > 0)
    stories.push({
      title: "👑 Biggest Winner · Bragging Rights Secured",
      text: `${profits
        .filter((p) => p.profit === best)
        .map((p) => p.name)
        .join(
          " / ",
        )} led with ${money(best)} in net betting profit. Fake money. Very real receipts.`,
    });
  const recap =
    routine?.recap ?? (await recapSnapshot(db, row, league.nfl_season));
  const replenished =
    recap.credited === null
      ? (
          {
            funding_pending: "Opening funds pending",
            results_pending: "Pending confirmed results",
            review_pending: "Pending account review",
            weekly_calendar_complete: "No further weekly top-up scheduled",
          } as Record<string, string>
        )[recap.state]
      : money(recap.credited) +
        (recap.state === "no_topup_needed" ? " · No top-up needed" : "");
  const seasonTickets = financialRecipient
    ? []
    : await read(
        db
          .from("tickets")
          .select("team_id,status,stake,actual_payout")
          .eq("league_id", row.league_id)
          .eq("nfl_season", league.nfl_season)
          .neq("status", "VOIDED"),
      );
  const leagueWallets = financialRecipient
    ? []
    : await read(
        db
          .from("wallets")
          .select("team_id,balance")
          .in(
            "team_id",
            teams.map((t) => t.id),
          ),
      );
  const standings = teams
    .map((t) => {
      const bets = seasonTickets.filter((b) => b.team_id === t.id);
      return {
        id: t.id,
        name: t.team_name,
        bets: bets.length,
        balance: Number(
          leagueWallets.find((w) => w.team_id === t.id)?.balance ?? 0,
        ),
        profit: bets
          .filter((b) => b.status !== "OPEN")
          .reduce((n, b) => n + Number(b.actual_payout) - Number(b.stake), 0),
      };
    })
    .sort(
      (a, b) =>
        b.profit - a.profit ||
        b.balance - a.balance ||
        b.bets - a.bets ||
        a.name.localeCompare(b.name),
    );
  const standing = standings.findIndex((t) => t.id === row.team_id) + 1;
  const wagered = mine.reduce((n, t) => n + Number(t.stake), 0),
    paid = mine.reduce((n, t) => n + Number(t.actual_payout), 0);
  return {
    ...base,
    subject: `Week ${row.market_week} League Roundup`,
    heading: `Week ${row.market_week}: The League Roundup`,
    paragraphs: [
      "Here are the confirmed betting outcomes recorded for this week. Unresolved tickets remain pending.",
      ...(recap.state === "funding_pending"
        ? ["Your independent account is still waiting for opening funds."]
        : []),
      ...(recap.state === "weekly_calendar_complete"
        ? [
            "The supported weekly calendar has finished. This recap does not schedule another weekly cash reset; accepted tickets and season outcomes keep their own review process.",
          ]
        : []),
      ...(open
        ? [
            `${open} of your tickets remain under review; their results and replenishment are pending.`,
          ]
        : []),
    ],
    stories,
    compactDetails: true,
    details: [
      [
        "Results",
        `${mine.filter((t) => t.status === "WON").length} Won • ${mine.filter((t) => t.status === "LOST").length} Lost • ${mine.filter((t) => t.status === "PUSH").length} Push`,
      ],
      ["Total wagered (settled tickets)", money(wagered)],
      ["Total paid out", money(paid)],
      ["Net betting profit", money(paid - wagered)],
      ["Weekly replenishment", replenished],
      ["Your balance at preparation", availableBalance],
      [
        financialRecipient
          ? "Account standing (all seasons)"
          : "League standing",
        financialRecipient
          ? `${financialRecipient.rank} of ${financialRecipient.participants}`
          : `${standing} of ${teams.length}`,
      ],
    ],
    button: "View Results & Leaderboard",
  };
}
export async function deliverEmails(
  db: SupabaseClient,
  ticketId: string | null = null,
) {
  const synthetic =
    process.env.BOFF_ENVIRONMENT === "test" &&
    process.env.NODE_ENV === "test" &&
    !process.env.VERCEL &&
    !process.env.VERCEL_ENV;
  const identity = synthetic ? null : environmentIdentity(process.env);
  const capture = identity?.environment === "development";
  if (!capture && !synthetic && process.env.BOFF_MAIL_MODE !== "delivery")
    throw new Error("Production delivery mode must be explicitly enabled.");
  if (!capture && !process.env.RESEND_API_KEY)
    throw new Error("Email delivery requires RESEND_API_KEY.");
  const claim = await db.rpc("claim_scoped_outbound_emails", {
    p_ticket: ticketId,
  });
  if (claim.error) throw new Error(claim.error.message);
  let sent = 0,
    captured = 0;
  for (const row of claim.data ?? []) {
    try {
      await validateDeliveryScope(db, row);
      if (capture && row.kind !== "signin") {
        const verified = await db.rpc("dev_outbound_email_is_verified", {p_email:row.id});
        if (verified.error) throw Error("Recipient verification could not be checked.");
        if (verified.data !== true) {
          const skipped=await db.from("outbound_emails").update({
            status:"skipped",last_error:"Email verification required.",
          }).eq("id",row.id);
          if(skipped.error)throw Error("Unverified email retirement could not be recorded.");
          continue;
        }
      }
      const routine = isRoutine(row.kind)
        ? await routinePermission(db, row, false)
        : null;
      if (routine?.allowed === false) {
        const saved = await db
          .from("outbound_emails")
          .update({
            status: row.attempts > 1 ? "needs_review" : "skipped",
            last_error: routine.reason,
          })
          .eq("id", row.id);
        if (saved.error)
          throw Error("Routine notification retirement could not be recorded.");
        continue;
      }
      let promotion: NotificationWindow | undefined;
      if (isPromotional(row.kind)) {
        const bound = row.notification_context as
          NotificationWindow | undefined;
        if (!bound) {
          const save = await db
            .from("outbound_emails")
            .update({
              status: row.attempts > 1 ? "needs_review" : "skipped",
              last_error:
                "Queued promotion has no verified window; prepare a fresh notification.",
            })
            .eq("id", row.id);
          if (save.error)
            throw Error("Promotion retirement could not be recorded.");
          continue;
        }
        promotion = await currentNotificationWindow(db, row, bound.nfl_season);
        const reason = windowRejection(row, promotion);
        if (reason) {
          const saved = await db
            .from("outbound_emails")
            .update({
              status: row.attempts > 1 ? "needs_review" : "skipped",
              last_error: reason,
            })
            .eq("id", row.id);
          if (saved.error)
            throw Error("Promotion retirement could not be recorded.");
          continue;
        }
      }
      if (row.kind === "reminder") {
        let w;
        if (row.wallet_model === "user") {
          const scoped = await db.rpc("financial_email_context", {
            p_league: row.league_id,
            p_team: row.team_id,
            p_recipient: row.recipient,
          });
          if (
            scoped.error ||
            !scoped.data ||
            scoped.data.recipient !== row.recipient
          )
            throw new Error("Financial reminder recipient unavailable.");
          w = [{ balance: scoped.data.balance }];
        } else
          w = await read(
            db.from("wallets").select("balance").eq("team_id", row.team_id),
          );
        if (
          w[0]?.balance === null ||
          !Number.isFinite(Number(w[0]?.balance)) ||
          Number(w[0]?.balance) < promotion!.minimum_stake!
        ) {
          const saved = await db
            .from("outbound_emails")
            .update({
              status: row.attempts > 1 ? "needs_review" : "skipped",
              last_error:
                "Available balance is below the effective minimum wager.",
            })
            .eq("id", row.id);
          if (saved.error)
            throw Error("Promotion retirement could not be recorded.");
          continue;
        }
      }
      let payload = row.payload;
      if (!payload) {
        const full = await buildEmail(
          db,
          row,
          promotion,
          routine?.allowed ? routine.context : undefined,
        );
        const c = routine?.allowed && routine.context.include_details === false
          ? summarizeRoutineEmail(full)
          : full;
        let designed: {subject:string;html:string;text:string;amp?:string;leagues?:{id:string;details:boolean}[]}|undefined;
        if(capture||process.env.BOFF_AMP_EMAIL_ENABLED==="true"){
          const url=new URL(c.url);
          let path=url.pathname.match(/^\/\d+(?=\/|$)/)?.[0];
          if(!path&&row.kind==="attention"&&url.origin==="https://dev.sportsbook.coopergurrie.com"){
            const league=await db.from("leagues").select("sleeper_league_id").eq("id",row.league_id).maybeSingle();
            const sleeperId=league.data?.sleeper_league_id;
            if(/^\d{1,32}$/.test(sleeperId??""))path="/"+sleeperId;
          }
          if(path){
            const detailed=!routine?.allowed||routine.context.include_details===true;
            const book=await db.from("dev_current_book").select("payload").eq("league_id",row.league_id).maybeSingle();
            if(book.data?.payload){
              const {createEmailBoard,renderEmailBoard,renderAccountEmail,renderNotificationEmail}=await import("../../visual/server/notification-templates.js");
              const visual=createEmailBoard(book.data.payload,[],url.origin,path,row.kind==="attention"?undefined:row.team_id);
              c.board=renderEmailBoard(visual,false);
              if(["opening","recap","monday_watch","confirmation"].includes(row.kind)){
                const member=await db.from("user_wallets").select("user_id").eq("league_id",row.league_id).eq("team_id",row.team_id)
                  .eq("id",row.user_wallet_id??row.routine_context?.wallet_id??"00000000-0000-0000-0000-000000000000").maybeSingle();
                let user=member.data?.user_id??(routine?.allowed?routine.context.user_id:undefined)??row.routine_context?.user_id;
                if(!user&&row.ticket_id){
                  const ticket=await db.from("tickets").select("user_wallet_id").eq("id",row.ticket_id).eq("league_id",row.league_id).maybeSingle();
                  if(ticket.data?.user_wallet_id){
                    const owner=await db.from("user_wallets").select("user_id").eq("id",ticket.data.user_wallet_id).eq("league_id",row.league_id).maybeSingle();
                    user=owner.data?.user_id;
                  }
                }
                if(user){
                  const edition=await db.rpc("dev_email_edition",{p_league:row.league_id,p_user:user,p_kind:row.kind,p_week:row.market_week,p_ticket:row.ticket_id??null});
                  if(edition.error)throw Error("Email edition could not be prepared.");
                  visual.edition=edition.data;
                }
                if(row.kind==="confirmation")designed=renderAccountEmail("confirmation",visual,Object.fromEntries(c.details),visual.edition?.tickets?.[0]);
                else {
                  const {isSwitchableEmail,renderLeagueSwitcherEmail}=await import("../../visual/server/email-switcher.js");
                  if(isSwitchableEmail(row.kind)&&user){
                    const reports=await db.rpc("dev_email_switcher",{p_user:user,p_kind:row.kind,p_week:row.market_week,p_primary:row.league_id});
                    if(reports.error)throw Error("League email reports could not be prepared.");
                    if(reports.data?.length)designed=renderLeagueSwitcherEmail(reports.data,row.kind,url.origin,row.league_id);
                  }
                  designed??=renderNotificationEmail(row.kind,detailed,{Week:row.market_week},url.origin,path,visual.leagueName,visual);
                }
              }else if(row.kind==="attention"){
                const job=await db.from("automation_jobs").select("status,last_error,summary")
                  .eq("id",row.staff_context?.job_id).eq("league_id",row.league_id).maybeSingle();
                if(job.error)throw Error("The admin issue could not be prepared.");
                designed=renderAccountEmail("attention",{...visual,team:undefined},{...Object.fromEntries(c.details),
                  Issue:job.data?.last_error??JSON.stringify(job.data?.summary??{}),Status:job.data?.status??"Needs Review"});
              }
            }
          }
        }
        if (routine?.allowed && routine.context.include_details !== false)
          c.details.push([
            "Message prepared",
            date(routine.context.prepared_at),
          ]);
        const text = [
          c.heading,
          c.greeting,
          ...c.paragraphs,
          ...(c.tickets ?? []).map(
            (t) =>
              `${t.status}\nTicket ${t.id} · ${t.summary}\n${t.legs.map((l, i) => `${i + 1}. ${l.selection}\n${l.detail}\n${(l.teams ?? []).map(teamWatchText).join("\n\n")}`).join("\n\n")}`,
          ),
          ...(c.stories ?? []).map((s) => s.title + "\n" + s.text),
          ...c.details.map((d) => d.join(": ")),
          ...(c.featured ?? []).flatMap((f) => [
            f.title,
            ...f.teams.map(
              (t) =>
                `${t.name} (${t.record}): Spread ${t.spread}; Moneyline ${t.originalOdds} → ${t.boostedOdds}`,
            ),
            `Match Total: ${f.total}`,
          ]),
          ...(c.legs ?? []).map(
            (l) => `${l.matchup}: ${l.selection} (${l.type})`,
          ),
          ...(c.board?.text ? [c.board.text] : []),
          c.button + ": " + c.url,
        ].join("\n\n");
        payload = {
          from: communicationIdentity(
            (
              await read(db.from("leagues").select("*").eq("id", row.league_id))
            )[0],
          ).from,
          to: [row.recipient],
          subject: designed?.subject??c.subject,
          html: designed?.html??renderEmail(c),
          text: designed?.text??text,
          ...(designed?.amp?{amp:designed.amp,league_reports:designed.leagues}:{}),
        };
        const save = await db
          .from("outbound_emails")
          .update({
            payload,
            ...(routine?.allowed ? { routine_context: routine.context } : {}),
          })
          .eq("id", row.id);
        if (save.error) throw new Error(save.error.message);
      }
      validatePayloadRecipient(payload, row.recipient);
      // Authorization can change while the message is composed or frozen.
      await validateDeliveryScope(db, { ...row, payload });
      if(payload.amp){
        const scope=await db.rpc("dev_email_switcher_scope",{p_recipient:row.recipient,p_kind:row.kind,p_leagues:payload.league_reports});
        if(scope.error||scope.data!==true)throw Error("League email permissions changed; rebuild the message before sending.");
      }
      const configuredLeague = await db
        .from("leagues")
        .select("name,sportsbook_url,email_sender")
        .eq("id", row.league_id)
        .maybeSingle();
      if (configuredLeague.error)
        throw Error("Current league communication identity is unavailable.");
      validateCommunicationPayload(payload, configuredLeague.data);
      if (promotion) {
        const latest = await currentNotificationWindow(
            db,
            row,
            promotion.nfl_season,
          ),
          reason = windowRejection(row, latest);
        if (reason) {
          const saved = await db
            .from("outbound_emails")
            .update({
              status: row.attempts > 1 ? "needs_review" : "skipped",
              last_error: reason,
            })
            .eq("id", row.id);
          if (saved.error)
            throw Error("Promotion retirement could not be recorded.");
          continue;
        }
      }
      if (routine) {
        const latest = await routinePermission(db, row, true);
        if (latest.allowed === false) {
          const saved = await db
            .from("outbound_emails")
            .update({
              status: row.attempts > 1 ? "needs_review" : "skipped",
              last_error: latest.reason,
            })
            .eq("id", row.id);
          if (saved.error)
            throw Error(
              "Routine notification retirement could not be recorded.",
            );
          continue;
        }
      }
      if (capture) {
        const saved = await db.rpc("capture_development_email", {
          p_email: row.id,
          p_payload: payload,
        });
        if (saved.error) throw new Error("Development email capture failed.");
        captured++;
        continue;
      }
      let result:any;
      if(payload.amp&&process.env.BOFF_AMP_EMAIL_ENABLED==="true"){
        result=await sendAmpMail(payload,row.event_key);
      }else{
      const {amp,league_reports,...standardPayload}=payload;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": row.event_key,
        },
        body: JSON.stringify(standardPayload),
        signal: AbortSignal.timeout(8000),
      });
      result = await r.json();
      if (!r.ok)
        throw new Error(
          result.message ?? `Email provider returned ${r.status}`,
        );
      }
      const save = await db
        .from("outbound_emails")
        .update({
          status: "sent",
          provider_id: result.id,
          sent_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id);
      if (save.error) throw new Error(save.error.message);
      if (row.ticket_id)
        await db
          .from("email_deliveries")
          .update({
            status: "sent",
            provider_id: result.id,
            sent_at: new Date().toISOString(),
            attempts: row.attempts,
            last_error: null,
          })
          .eq("ticket_id", row.ticket_id);
      sent++;
      await new Promise((resolve) => setTimeout(resolve, 600));
    } catch (e) {
      const error = e instanceof Error ? e.message : "Email failed";
      await db
        .from("outbound_emails")
        .update({
          status: row.attempts >= 5 ? "needs_review" : "failed",
          last_error: error,
          lease_until: new Date(Date.now() + 300000).toISOString(),
        })
        .eq("id", row.id);
    }
  }
  return { sent, captured };
}
