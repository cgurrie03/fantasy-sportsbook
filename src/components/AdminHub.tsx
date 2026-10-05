import { useState } from "react";
import type { ReactNode } from "react";
import type { AccountData } from "../lib/accounts";
import { money } from "../lib/accounts";
const categories = [
  {
    id: "users",
    group: "League Management",
    title: "Users",
    description: "Names, account mappings, and balances.",
    status: "Ready",
  },
  {
    id: "tickets",
    group: "League Management",
    title: "Tickets",
    description: "Inspect tickets, accepted picks, and settled results.",
    status: "View Results",
  },
  {
    id: "logs",
    group: "League Management",
    title: "Betting Logs",
    description: "Review placement and settlement records.",
    status: "Ready",
  },
  {
    id: "lines",
    group: "Markets",
    title: "Lines & Markets",
    description: "Adjust odds and totals; publish or close markets.",
    status: "Upcoming",
  },
  {
    id: "promos",
    group: "Markets",
    title: "Promos & Boosts",
    description: "Game of the Week, Tank Bowl, and featured parlays.",
    status: "Upcoming",
  },
  {
    id: "approvals",
    group: "Operations",
    title: "Approvals",
    description:
      "Review featured games, unclear results, and proposed changes.",
    status: "Upcoming",
  },
  {
    id: "schedule",
    group: "Operations",
    title: "Weekly Schedule",
    description: "Week advancement, cutoff, settlement, and replenishment.",
    status: "Upcoming",
  },
  {
    id: "emails",
    group: "Operations",
    title: "Emails & Delivery Logs",
    description: "Opening emails, reminders, confirmations, and results.",
    status: "Upcoming",
  },
  {
    id: "settings",
    group: "Operations",
    title: "League Settings",
    description: "Season, league connection, and sportsbook rules.",
    status: "Upcoming",
  },
];
const date = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }) + " Eastern";
export function AdminHub({
  data,
  leagueId,
  users,
  initialCategory,
  reviewMode,
}: {
  data: AccountData;
  leagueId: string;
  users: ReactNode;
  initialCategory?: string;
  reviewMode: boolean;
}) {
  const [selected, setSelected] = useState(initialCategory ?? ""),
    [filter, setFilter] = useState("All");
  const category = categories.find((c) => c.id === selected);
  const tickets = (data.tickets ?? []).filter((t) => t.league_id === leagueId);
  const owner = (id: string) =>
    data.memberships.find((m) => m.team_id === id)?.display_name ??
    data.teams.find((t) => t.id === id)?.team_name ??
    "League Member";
  const back = reviewMode ? (
    <a className="back-link" href="/stage1-admin-review.html">
      ‹ League Admin
    </a>
  ) : (
    <button className="text-button back-link" onClick={() => setSelected("")}>
      ‹ League Admin
    </button>
  );
  return (
    <main className="admin-hub">
      {category ? (
        <>
          {back}
          {selected === "users" ? (
            users
          ) : (
            <>
              <div className="page-heading">
                <h1>{category.title}</h1>
                <p>{category.description}</p>
              </div>
              {selected === "tickets" ? (
                <>
                  <div className="ticket-filters">
                    <label htmlFor="admin-ticket-status">Status</label>
                    <select
                      id="admin-ticket-status"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      {["All", "Open", "Settled", "Won", "Lost", "Push"].map(
                        (s) => (
                          <option key={s}>{s}</option>
                        ),
                      )}
                    </select>
                    <span>
                      {tickets.length} Tickets · Historical edits require a
                      reviewed correction.
                    </span>
                  </div>
                  <div className="ticket-list">
                    {tickets
                      .filter(
                        (t) =>
                          filter === "All" ||
                          (filter === "Settled"
                            ? t.status !== "OPEN"
                            : t.status === filter.toUpperCase()),
                      )
                      .map((t) => (
                        <details key={t.id}>
                          <summary>
                            <div>
                              <strong>{owner(t.team_id)}</strong>
                              <span>
                                {t.legacy_ticket_id ?? t.id.slice(0, 8)} · Week{" "}
                                {t.market_week}
                              </span>
                            </div>
                            <div
                              className={
                                "ticket-result " + t.status.toLowerCase()
                              }
                            >
                              <strong>
                                {t.status[0] + t.status.slice(1).toLowerCase()}
                              </strong>
                              <span>
                                {money(t.stake)} Wager ·{" "}
                                {money(t.actual_payout)} Payout
                              </span>
                            </div>
                          </summary>
                          <p>
                            Placed {date(t.placed_at)}
                            {t.settled_at
                              ? " · Settled " + date(t.settled_at)
                              : ""}
                          </p>
                          {(data.legs ?? [])
                            .filter((l) => l.ticket_id === t.id)
                            .map((l) => (
                              <div className="admin-leg" key={l.id}>
                                <div>
                                  <strong>{l.selection}</strong>
                                  <span>
                                    {l.market_type}
                                    {l.matchup ? " · " + l.matchup : ""}
                                  </span>
                                </div>
                                <strong className={l.status.toLowerCase()}>
                                  {l.status[0] +
                                    l.status.slice(1).toLowerCase()}
                                </strong>
                              </div>
                            ))}
                        </details>
                      ))}
                  </div>
                  {!tickets.length && (
                    <p>No tickets recorded for this league.</p>
                  )}
                </>
              ) : selected === "logs" ? (
                <div className="betting-logs">
                  {tickets
                    .flatMap((t) => [
                      {
                        key: t.id + "placed",
                        time: t.placed_at,
                        title: "Bet Placed",
                        text:
                          owner(t.team_id) +
                          " · " +
                          (t.legacy_ticket_id ?? t.id.slice(0, 8)) +
                          " · " +
                          money(t.stake) +
                          " wager",
                      },
                      ...(t.settled_at
                        ? [
                            {
                              key: t.id + "settled",
                              time: t.settled_at,
                              title: "Bet Settled",
                              text:
                                owner(t.team_id) +
                                " · " +
                                (t.legacy_ticket_id ?? t.id.slice(0, 8)) +
                                " · " +
                                t.status.toLowerCase() +
                                " · " +
                                money(t.actual_payout) +
                                " payout",
                            },
                          ]
                        : []),
                    ])
                    .sort((a, b) => b.time.localeCompare(a.time))
                    .map((e) => (
                      <div className="log-entry" key={e.key}>
                        <strong>{e.title}</strong>
                        <p>{e.text}</p>
                        <span>{date(e.time)}</span>
                      </div>
                    ))}
                  {!tickets.length && <p>No betting records yet.</p>}
                </div>
              ) : (
                <section className="upcoming-panel">
                  <strong>Upcoming Tools</strong>
                  <p>
                    This category is planned. Its actions will be connected as
                    we build the betting and weekly operations features.
                  </p>
                  {selected === "schedule" && (
                    <p>
                      The public week label advances Tuesday at 8 AM Eastern.
                      Settlement, replenishment, publishing, and email
                      scheduling still need their operational jobs.
                    </p>
                  )}
                  {selected === "approvals" && (
                    <p>
                      Approvals will stay inside the website. Items requiring
                      your decision will appear here; no approvals queue is
                      connected yet.
                    </p>
                  )}
                </section>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="page-heading">
            <h1>League Admin</h1>
            <p>Choose a category to manage your sportsbook.</p>
          </div>
          {["League Management", "Markets", "Operations"].map((group) => (
            <section className="admin-category-group" key={group}>
              <h2>{group}</h2>
              <div className="admin-category-list">
                {categories
                  .filter((c) => c.group === group)
                  .map((c) => {
                    const content = (
                      <>
                        <span>
                          <strong>{c.title}</strong>
                          <small>{c.description}</small>
                        </span>
                        <span
                          className={
                            "category-status " +
                            (c.status === "Upcoming" ? "upcoming" : "")
                          }
                        >
                          {c.status}
                        </span>
                        <span aria-hidden="true">›</span>
                      </>
                    );
                    return reviewMode ? (
                      <a
                        href={"/stage1-admin-" + c.id + "-review.html"}
                        key={c.id}
                      >
                        {content}
                      </a>
                    ) : (
                      <button key={c.id} onClick={() => setSelected(c.id)}>
                        {content}
                      </button>
                    );
                  })}
              </div>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
