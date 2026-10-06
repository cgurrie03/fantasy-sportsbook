import { useState } from "react";
import type { ReactNode } from "react";
import type { AccountData } from "../lib/accounts";
import { BettingLogs, Chevron, TicketHistory } from "./TicketHistory";
import { MarketAdmin } from "./MarketAdmin";
import { WeeklySchedule } from "./WeeklySchedule";
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
    status: "Generate Lines",
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
    description: "Review unresolved tickets and held replenishments.",
    status: "Review Results",
  },
  {
    id: "schedule",
    group: "Operations",
    title: "Weekly Schedule",
    description: "Week advancement, cutoff, settlement, and replenishment.",
    status: "Review Schedule",
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
export function AdminHub({
  data,
  leagueId,
  users,
  initialCategory,
  reviewMode,
  refresh,
}: {
  data: AccountData;
  leagueId: string;
  users: ReactNode;
  initialCategory?: string;
  reviewMode: boolean;
  refresh?: () => Promise<void>;
}) {
  const [selected, setSelected] = useState(initialCategory ?? "");
  const category = categories.find((c) => c.id === selected);
  const tickets = (data.tickets ?? []).filter((t) => t.league_id === leagueId);
  const owner = (id: string) =>
    data.memberships.find((m) => m.team_id === id)?.display_name ??
    data.teams.find((t) => t.id === id)?.team_name ??
    "League Member";
  const back = reviewMode ? (
    <a className="back-link" href="/stage1-admin-review.html">
      <Chevron left /> League Admin
    </a>
  ) : (
    <button className="text-button back-link" onClick={() => setSelected("")}>
      <Chevron left /> League Admin
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
                <TicketHistory
                  data={data}
                  tickets={tickets}
                  owner={owner}
                  canVoid={
                    !reviewMode &&
                    data.memberships.some(
                      (m) =>
                        m.league_id === leagueId &&
                        m.role === "admin" &&
                        m.user_id,
                    )
                  }
                  onChanged={refresh}
                />
              ) : selected === "logs" ? (
                <BettingLogs tickets={tickets} owner={owner} />
              ) : selected === "lines" || selected === "promos" ? (
                <MarketAdmin data={data} leagueId={leagueId} />
              ) : selected === "schedule" || selected === "approvals" ? (
                <WeeklySchedule
                  leagueId={leagueId}
                  reviewMode={reviewMode}
                  onApplied={refresh}
                />
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
