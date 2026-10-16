import { ReadinessPanel } from "./ReadinessPanel";
import { ReopeningReview } from "./ReopeningReview";
import { useRoute, navigate } from "../lib/navigation";
import { lazy, Suspense, useState } from "react";
import type { ReactNode } from "react";
import type { AccountData } from "../lib/accounts";
import { BettingLogs, Chevron, TicketHistory } from "./TicketHistory";
import { MarketAdmin } from "./MarketAdmin";
import { LeagueSettings } from "./LeagueSettings";
import { Approvals } from "./Approvals";
const PromoAdmin = lazy(() =>
  import("./PromoAdmin").then((m) => ({ default: m.PromoAdmin })),
);
const Reports = lazy(() =>
  import("./Reports").then((module) => ({ default: module.Reports })),
);
import "./AdminWorkspace.css";
import { WeeklySchedule } from "./WeeklySchedule";
const categories = [
  {
    id: "readiness",
    group: "Operations",
    title: "Board Readiness",
    description: "Source health, category coverage, and locked selections.",
    status: "Review Health",
  },
  {
    id: "reopening",
    group: "Markets",
    title: "Review Reopening",
    description:
      "Review all updated lines, a one-time cutoff, and the announcement before publishing.",
    status: "Review First",
  },
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
    description: "Image offers, preset tickets, and claimed profit boosts.",
    status: "Manage Offers",
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
    title: "Automation & Communications",
    description: "Weekly execution, email templates, and delivery history.",
    status: "Review Schedule",
  },
  {
    id: "settings",
    group: "Operations",
    title: "League Settings",
    description: "League identity, enforced rules, and change history.",
    status: "Manage",
  },
  {
    id: "reports",
    group: "Insights",
    title: "Reports & Dashboard",
    description: "League performance, forecast accuracy, and operating health.",
    status: "Live Data",
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
  const route = useRoute();
  const [localSelected, setLocalSelected] = useState(
    initialCategory === "emails" ? "schedule" : (initialCategory ?? ""),
  );
  const selected = reviewMode
    ? localSelected
    : (route.split("?")[0].split("/")[2] ?? "");
  const setSelected = (value: string) =>
    reviewMode
      ? setLocalSelected(value)
      : navigate("/admin" + (value ? "/" + value : ""));

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
    <nav aria-label="Breadcrumb">
      <a className="back-link" href="#/home">
        Sportsbook
      </a>{" "}
      /{" "}
      <a className="back-link" href="#/admin">
        League Admin
      </a>{" "}
      / <span>{category?.title}</span>
    </nav>
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
              {selected === "readiness" ? (
                <ReadinessPanel leagueId={leagueId} review={reviewMode} />
              ) : selected === "reopening" ? (
                <ReopeningReview
                  data={data}
                  leagueId={leagueId}
                  readOnly={reviewMode}
                />
              ) : selected === "tickets" ? (
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
              ) : selected === "promos" ? (
                <Suspense fallback={<p role="status">Loading offers…</p>}>
                  <PromoAdmin
                    data={data}
                    leagueId={leagueId}
                    reviewMode={reviewMode}
                  />
                </Suspense>
              ) : selected === "lines" ? (
                <MarketAdmin data={data} leagueId={leagueId} />
              ) : selected === "schedule" ? (
                <WeeklySchedule
                  league={data.leagues.find((l) => l.id === leagueId)}
                  leagueId={leagueId}
                  reviewMode={reviewMode}
                  onApplied={refresh}
                />
              ) : selected === "reports" ? (
                <Suspense fallback={<p role="status">Loading reports…</p>}>
                  <Reports data={data} leagueId={leagueId} />
                </Suspense>
              ) : selected === "settings" ? (
                <LeagueSettings
                  data={data}
                  leagueId={leagueId}
                  onChanged={refresh}
                />
              ) : selected === "approvals" ? (
                <Approvals
                  data={data}
                  leagueId={leagueId}
                  onApplied={refresh}
                  onLines={() => setSelected("lines")}
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
          {["Insights", "League Management", "Markets", "Operations"].map(
            (group) => (
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
                        <a key={c.id} href={`#/admin/${c.id}`}>
                          {content}
                        </a>
                      );
                    })}
                </div>
              </section>
            ),
          )}
        </>
      )}
    </main>
  );
}
