import type { SupabaseClient } from "@supabase/supabase-js";
import { renderEmail, openingWeekStories } from "./email-templates.js";
import type { EmailContent } from "./email-templates.ts";
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
): Promise<EmailContent> {
  const [members, teams, wallets, leagues] = await Promise.all([
    read(
      db.from("league_memberships").select("*").eq("league_id", row.league_id),
    ),
    read(db.from("teams").select("*").eq("league_id", row.league_id)),
    read(
      db.from("wallets").select("team_id,balance").eq("team_id", row.team_id),
    ),
    read(db.from("leagues").select("*").eq("id", row.league_id)),
  ]);
  const member = members.find((m) => m.team_id === row.team_id),
    league = leagues[0];
  const balance = wallets[0]?.balance;
  const base = {
    greeting: `Hi ${member?.display_name ?? "Cooper"},`,
    url: "https://sportsbook.coopergurrie.com/",
    paragraphs: [],
    details: [],
    button: "Open Your Sportsbook",
  };
  if (row.kind === "confirmation") {
    const ticket = (
      await read(db.from("tickets").select("*").eq("id", row.ticket_id))
    )[0];
    if (!ticket) throw new Error("Accepted ticket unavailable.");
    const legs = await read(
      db
        .from("ticket_legs")
        .select("*")
        .eq("ticket_id", row.ticket_id)
        .order("leg_number"),
    );
    const ledger = (
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
      subject: `Bet Confirmed · Week ${ticket.market_week} · ${ticket.id.slice(0, 8)}`,
      heading: "Your Bet Is Confirmed",
      paragraphs: [
        "Your selections and accepted odds are locked in. Follow your ticket in My Bets.",
      ],
      details: [
        ["Ticket", ticket.id.slice(0, 8)],
        [
          "Season / Week",
          `Season ${ticket.league_season} • Week ${ticket.market_week}`,
        ],
        ["Placed", date(ticket.placed_at)],
        ["Wager", money(ticket.stake)],
        ["Odds", odds(ticket.accepted_combined_odds)],
        ["Total payout if won", money(ticket.accepted_potential_payout)],
        ["Balance after placement", money(ledger?.balance_after ?? balance)],
      ],
      legs: legs.map((l) => ({
        matchup: l.matchup ?? "Weekly Specials",
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
          .eq("league_id", row.league_id)
          .eq("nfl_season", league.nfl_season)
          .eq("market_week", row.market_week),
      )
    )[0];
    if (!board) throw new Error("Published board unavailable.");
    if (row.kind === "reminder")
      return {
        ...base,
        subject: `Betting Closes Tonight · Week ${row.market_week}`,
        heading: "Last Call For This Week’s Picks",
        paragraphs: [
          "Finish your parlay before betting closes. Fake money, real bragging rights.",
        ],
        details: [
          ["Betting closes", date(board.closes_at)],
          ["Your available balance", money(balance)],
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
    const projected = new Map<string, number>();
    for (const g of groups) {
      projected.set(g[0].home_team_id, Number(g[0].home_projection));
      projected.set(g[0].away_team_id, Number(g[0].away_projection));
    }
    return {
      ...base,
      subject: `Week ${row.market_week} Is Open · Goldy Fantasy Sportsbook`,
      heading: `Season ${league.league_season} • Week ${row.market_week} Is Open`,
      paragraphs: [
        "The board is ready. Bring your picks, your rivalries, and your wildly misplaced confidence.",
      ],
      details: [
        ["Betting opens", date(board.opens_at)],
        ["Betting closes", date(board.closes_at)],
        ["Your balance", money(balance)],
      ],
      stories: openingWeekStories(
        teams
          .filter((t) => projected.has(t.id))
          .map((t) => ({
            id: t.id,
            name: t.team_name,
            projected: projected.get(t.id)!,
          })),
        groups.map((g) => ({
          home:
            teams.find((t) => t.id === g[0].home_team_id)?.team_name ?? "Home",
          away:
            teams.find((t) => t.id === g[0].away_team_id)?.team_name ?? "Away",
          spread: Number(g.find((m) => m.kind === "spread")?.line),
        })),
      ),
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
  if (row.kind === "attention") {
    const pending = tickets.filter((t) => t.status === "OPEN");
    return {
      ...base,
      subject: `Admin Review Needed · Week ${row.market_week}`,
      heading: "Weekly Results Need Your Attention",
      paragraphs: [
        "These tickets remain unresolved. Their owners’ replenishment will wait for confirmed results.",
      ],
      details: pending.map((t) => [
        teams.find((x) => x.id === t.team_id)?.team_name ?? "Team",
        `Ticket ${t.id.slice(0, 8)} · Open`,
      ]),
      button: "Review Weekly Execution",
    };
  }
  const settled = tickets.filter((t) =>
      ["WON", "LOST", "PUSH"].includes(t.status),
    ),
    mine = settled.filter((t) => t.team_id === row.team_id),
    open = tickets.filter(
      (t) => t.team_id === row.team_id && t.status === "OPEN",
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
  const ledger = await read(
    db
      .from("wallet_ledger")
      .select("amount,created_at")
      .eq("team_id", row.team_id)
      .eq("kind", "weekly_replenishment")
      .gte("created_at", new Date(Date.now() - 86400000).toISOString()),
  );
  const replenished = ledger.reduce((n, l) => n + Number(l.amount), 0);
  const seasonTickets = await read(
    db
      .from("tickets")
      .select("team_id,status,stake,actual_payout")
      .eq("league_id", row.league_id)
      .eq("nfl_season", league.nfl_season)
      .neq("status", "VOIDED"),
  );
  const leagueWallets = await read(
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
      "The scores are in. The receipts are ready. 🍿 Here’s how the league’s betting week played out.",
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
      ["Weekly replenishment", money(replenished)],
      ["Current balance", money(balance)],
      ["League standing", `${standing} of ${teams.length}`],
    ],
    button: "View Results & Leaderboard",
  };
}
export async function deliverEmails(db: SupabaseClient) {
  if (!process.env.RESEND_API_KEY)
    throw new Error("Email delivery requires RESEND_API_KEY.");
  const claim = await db.rpc("claim_outbound_emails");
  if (claim.error) throw new Error(claim.error.message);
  let sent = 0;
  for (const row of claim.data ?? []) {
    try {
      if (row.kind === "reminder") {
        const w = await read(
          db.from("wallets").select("balance").eq("team_id", row.team_id),
        );
        if (!(Number(w[0]?.balance) > 0)) {
          await db
            .from("outbound_emails")
            .update({
              status: "skipped",
              last_error: "No available balance at send time.",
            })
            .eq("id", row.id);
          continue;
        }
      }
      let payload = row.payload;
      if (!payload) {
        const c = await buildEmail(db, row);
        const text = [
          c.heading,
          c.greeting,
          ...c.paragraphs,
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
          c.button + ": " + c.url,
        ].join("\n\n");
        payload = {
          from: "Goldy Fantasy Sportsbook <sportsbook@coopergurrie.com>",
          to: [row.recipient],
          subject: c.subject,
          html: renderEmail(c),
          text,
        };
        const save = await db
          .from("outbound_emails")
          .update({ payload })
          .eq("id", row.id);
        if (save.error) throw new Error(save.error.message);
      }
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": row.event_key,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });
      const result: any = await r.json();
      if (!r.ok)
        throw new Error(
          result.message ?? `Email provider returned ${r.status}`,
        );
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
  return { sent };
}
