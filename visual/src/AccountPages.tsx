import { OwnerEmailCommunications } from "./OwnerEmailCommunications";
import {DevSignIn} from "./DevSignIn";
import { LeagueIntake } from "../../src/components/LeagueIntake";
import {IntakeBoundary} from './IntakeBoundary';
import { CommissionerMembers } from "./CommissionerMembers";
import { LeagueFeedSettings } from "./LeagueFeedSettings";
import { CommunicationsSettings } from "./CommunicationsSettings";
import { FantasyRewardsSettings } from "./FantasyRewardsSettings";
import { auth, live } from "./live";
import { accountProfile, saveAccountProfile } from "./accountState";
import { FeaturedCommissioner, RivalriesPanel } from "./FeaturedCommissioner";
import { FuturesRules } from "./FuturesRules";
import { RewardCorrections } from "./RewardOffers";
import { BalanceHistory } from "./BalanceHistory";
import { TicketProgress } from "./TicketProgress";
import { OwnerSupportInbox } from "./Feedback";
import {CommissionerActivity} from './CommissionerActivity';
import { routeUrl, navigate, currentRoute, routeQuery } from "./routing";
import { useEffect, useState } from "react";
import { Icon, PageHeading, Badge, Toggle, Empty, Mark } from "./ui";
import {
  league,
  teams,
  members,
  profileTeam,
  price,
  money,
  decimal,
  matchups,
  exampleTickets,
  ticketReturn,
  ticketOdds,
} from "./model";
import type { Ticket } from "./model";
import { Avatar, LeagueAvatar, ParticipantAvatar } from "./Markets";
import { getSettings, saveSettings } from "./settings";
import type { ReviewSettings } from "./settings";

export { TicketsPage } from "./TicketsPage";
export function LeaguePage({ tickets: leagueTickets }: { tickets: Ticket[] }) {
  const [tab, setTab] = useState("Sleeper Standings");
  const [sorting, setSorting] = useState({ key: "Rank", descending: false });
  const sortValue = (a: string | number, b: string | number) =>
    (typeof a === "string" ? a.localeCompare(String(b)) : a - Number(b)) *
    (sorting.descending ? -1 : 1);
  const heading = (label: string) => (
    <th
      aria-sort={
        sorting.key === label
          ? sorting.descending
            ? "descending"
            : "ascending"
          : "none"
      }
    >
      <button
        className="sort-heading"
        onClick={() =>
          setSorting({
            key: label,
            descending:
              sorting.key === label
                ? !sorting.descending
                : !["Rank", "Team", "Participant"].includes(label),
          })
        }
      >
        {label}
        <span
          className={
            "sort-direction " +
            (sorting.key === label && !sorting.descending ? "ascending" : "")
          }
          aria-hidden="true"
        >
          <Icon name="chevron" size={12} />
        </span>
      </button>
    </th>
  );
  const ranked = teams
    .slice()
    .sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor);
  const sorted = ranked.slice().sort((a, b) => {
    const value = (t: typeof a): string | number =>
      ({
        Rank: ranked.indexOf(t),
        Team: t.name,
        W: t.wins,
        L: t.losses,
        T: t.ties,
        "Win %": (t.wins + t.ties * 0.5) / Math.max(1, t.games),
        "Points For": t.pointsFor,
        "Points Against": t.pointsAgainst,
        "Diff.": t.pointsFor - t.pointsAgainst,
        "Avg.": t.pointsFor / Math.max(1, t.games),
        "Potential Pts.": t.potentialPoints,
        Streak: (t.streak.startsWith("L") ? -1 : 1) * Number(t.streak.slice(1)),
      })[sorting.key] ?? ranked.indexOf(t);
    return sortValue(value(a), value(b));
  });
  const wallets: {id:string; teamId:string; name:string; sleeperId?:string; balance:number; tickets:number; won:number; lost:number; stake:number; open:number; profit:number}[] = live()?.standingsWallets ?? [];
  const bettingMembers = members.map(m=>({
    m, wallet:wallets.find(wallet=>wallet.teamId===m.team.id &&
      (wallet.sleeperId && m.sleeperId ? wallet.sleeperId===m.sleeperId : wallet.name===m.name)),
  }));
  const bettingRanked = bettingMembers
    .map(({m,wallet}) => {
      const tickets = leagueTickets.filter(t=>t.season===String(league.season) &&
        (t.walletId ? t.walletId===wallet?.id : t.participant===m.name));
      const settled = tickets.filter((t) => t.status !== "Open");
      const stake = settled
        .filter((t) => t.status !== "Push")
        .reduce((n, t) => n + t.stake, 0);
      const profit = settled.reduce(
        (n, t) =>
          n +
          (t.status === "Won"
            ? ticketReturn(t) - t.stake
            : t.status === "Lost"
              ? -t.stake
              : 0),
        0,
      );
      const open = tickets
        .filter((t) => t.status === "Open")
        .reduce((n, t) => n + t.stake, 0);
      return {
        m,
        tickets: wallet?.tickets ?? tickets.length,
        won: wallet?.won ?? tickets.filter((t) => t.status === "Won").length,
        lost: wallet?.lost ?? tickets.filter((t) => t.status === "Lost").length,
        open: wallet?.open ?? open,
        stake: wallet?.stake ?? stake,
        profit: wallet?.profit ?? profit,
        balance: live() ? (wallet?.tickets ? Number(wallet.balance) : 0) : tickets.length ? 250 + profit - open : 0,
      };
    })
    .sort((a, b) => Number(b.tickets > 0) - Number(a.tickets > 0) || b.profit - a.profit || a.m.name.localeCompare(b.m.name));
  const betting = bettingRanked.slice().sort((a, b) => {
    const activeFirst = Number(b.tickets > 0) - Number(a.tickets > 0);
    if (activeFirst) return activeFirst;
    const value = (v: typeof a): string | number =>
      ({
        Rank: bettingRanked.indexOf(v),
        Participant: v.m.name,
        Team: v.m.team.name,
        Credits: v.balance,
        "Net Profit": v.profit,
        ROI: v.stake ? v.profit / v.stake : 0,
        Tickets: v.tickets,
        Won: v.won,
        Lost: v.lost,
        "Win %": v.won / Math.max(1, v.won + v.lost),
        "Open Stake": v.open,
      })[sorting.key] ?? bettingRanked.indexOf(v);
    return sortValue(value(a), value(b));
  });
  return (
    <>
      <PageHeading title="The League" />
      <div className="league-identity">
        <LeagueAvatar />
        <div>
          <h2>{league.league}</h2>
          <p>
            {teams.length} Teams · {members.length} Managers · Sleeper ·{" "}
            {league.season}
          </p>
        </div>
        <a
          className="button secondary"
          href={"https://sleeper.com/leagues/" + league.leagueId}
          target="_blank"
          rel="noreferrer"
        >
          Sleeper League
          <Icon name="external" size={15} />
        </a>
      </div>
      <div className="tabs" role="tablist" aria-label="League Views">
        {["Sleeper Standings", "boff Standings", "Managers"].map((t) => (
          <button
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setSorting({ key: "Rank", descending: false });
            }}
            key={t}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Sleeper Standings" ? (
        <div className="table-wrap standings-table">
          <table>
            <thead>
              <tr>
                {heading("Rank")}
                {heading("Team")}
                {heading("W")}
                {heading("L")}
                {heading("T")}
                {heading("Win %")}
                {heading("Points For")}
                {heading("Points Against")}
                {heading("Diff.")}
                {heading("Avg.")}
                {heading("Potential Pts.")}
                {heading("Streak")}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.id}>
                  <td className="rank">{ranked.indexOf(t) + 1}</td>
                  <td>
                    <div className="table-team">
                      <Avatar team={t} small />
                      <span>
                        <strong>{t.name}</strong>
                        <small>{t.manager}</small>
                      </span>
                    </div>
                  </td>
                  <td>{t.wins}</td>
                  <td>{t.losses}</td>
                  <td>{t.ties}</td>
                  <td>
                    {(
                      (100 * (t.wins + t.ties * 0.5)) /
                      Math.max(1, t.wins + t.losses + t.ties)
                    ).toFixed(1)}
                    %
                  </td>
                  <td>{money(t.pointsFor)}</td>
                  <td>{money(t.pointsAgainst)}</td>
                  <td
                    className={
                      t.pointsFor >= t.pointsAgainst ? "positive" : "negative"
                    }
                  >
                    {t.pointsFor >= t.pointsAgainst ? "+" : ""}
                    {money(t.pointsFor - t.pointsAgainst)}
                  </td>
                  <td>{money(t.pointsFor / Math.max(1, t.games))}</td>
                  <td>{money(t.potentialPoints)}</td>
                  <td className="streak-cell">
                    <Badge
                      tone={
                        t.streak.startsWith("W")
                          ? "green"
                          : t.streak.startsWith("L")
                            ? "red"
                            : "neutral"
                      }
                    >
                      {t.streak}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === "boff Standings" ? (
        <>
          <div className="table-caption">
            <span>{live() ? "Current Season Betting Statistics" : "Example Betting Statistics"}</span>
          </div>
          <div className="table-wrap standings-table">
            <table>
              <thead>
                <tr>
                  {heading("Rank")}
                  {heading("Participant")}

                  {heading("Credits")}
                  {heading("Net Profit")}
                  {heading("ROI")}
                  {heading("Tickets")}
                  {heading("Won")}
                  {heading("Lost")}
                  {heading("Win %")}
                  {heading("Open Stake")}
                </tr>
              </thead>
              <tbody>
                {betting.map((b) => (
                  <tr key={b.m.team.id + "-" + b.m.name}>
                    <td className="rank">{bettingRanked.indexOf(b) + 1}</td>
                    <td>
                      <div className="table-team">
                        <ParticipantAvatar name={b.m.name} team={b.m.team} />
                        <span>
                          <strong>{b.m.name}</strong>
                          <small>{b.m.team.name}</small>
                        </span>
                      </div>
                    </td>
                    <td>{money(b.balance)}</td>
                    <td className={b.profit >= 0 ? "positive" : "negative"}>
                      {b.profit > 0 ? "+" : ""}
                      {money(b.profit)}
                    </td>
                    <td>
                      {b.stake
                        ? ((100 * b.profit) / b.stake).toFixed(1) + "%"
                        : "—"}
                    </td>
                    <td>{b.tickets}</td>
                    <td>{b.won}</td>
                    <td>{b.lost}</td>
                    <td>
                      {b.won + b.lost
                        ? ((100 * b.won) / (b.won + b.lost)).toFixed(0) + "%"
                        : "—"}
                    </td>
                    <td>{money(b.open)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="panel">
          {members.map((m) => (
            <div className="member-row" key={m.name + "-" + m.team.id}>
              <Avatar team={m.team} />
              <div>
                <strong>{m.name}</strong>
                <small>{m.team.name}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
export function ProfilePage({
  tickets,
  dark,
  onTheme,
  notify,
}: {
  tickets: Ticket[];
  dark: boolean;
  onTheme: () => void;
  notify: (s: string) => void;
}) {
  const account = live()?.user;
  const [name, setName] = useState(() => accountProfile(account).name || (!live() ? profileTeam.manager : ""));
  const email = accountProfile(account).email;
  useEffect(() => { setName(accountProfile(account).name || (!live() ? profileTeam.manager : "")); }, [account?.id]);
  const sections = [
    ["account", "Account"],
    ["preferences", "Preferences"],
    ["communications", "Communications"],
    ["balance-history", "Balance History"],
  ] as const;
  const [profileTab, setProfileTab] = useState(
    () => routeQuery().get("section") || "account",
  );
  useEffect(() => {
    const scroll = () => {
      const value = routeQuery().get("section") || "account";
      setProfileTab(sections.some((s) => s[0] === value) ? value : "account");
    };
    scroll();
    window.addEventListener("boff-navigation", scroll);
    return () => window.removeEventListener("boff-navigation", scroll);
  }, []);
  const [prefs, setPrefs] = useState<ReviewSettings>(getSettings);
  const update = <K extends keyof ReviewSettings>(
    key: K,
    value: ReviewSettings[K],
  ) => setPrefs((p) => ({ ...p, [key]: value }));
  function save() {
    if (
      !Number.isFinite(prefs.defaultStake) ||
      prefs.defaultStake <= 0 ||
      prefs.defaultStake > 250
    ) {
      notify("Default stake must be between 0.01 and 250 credits.");
      return;
    }
    saveSettings(prefs);
    notify("Preferences Saved In This Browser");
  }
  return (
    <>
      <PageHeading title="Profile" />
      <div
        className="tabs profile-tabs"
        role="tablist"
        aria-label="Profile Sections"
      >
        {sections.map(([key, label]) => (
          <button
            key={key}
            id={"profile-tab-" + key}
            aria-controls="profile-settings-panel"
            tabIndex={profileTab === key ? 0 : -1}
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              const i = sections.findIndex((s) => s[0] === key),
                next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? sections.length - 1
                      : (i +
                          (e.key === "ArrowRight" ? 1 : -1) +
                          sections.length) %
                        sections.length;
              setProfileTab(sections[next][0]);
              navigate("profile?section=" + sections[next][0]);
              requestAnimationFrame(() =>
                document
                  .getElementById("profile-tab-" + sections[next][0])
                  ?.focus(),
              );
            }}
            role="tab"
            aria-selected={profileTab === key}
            onClick={() => {
              setProfileTab(key);
              navigate("profile?section=" + key);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="profile-panel"
        id="profile-settings-panel"
        aria-labelledby={"profile-tab-" + profileTab}
        role="tabpanel"
      >
        {profileTab === "account" ? (
          <section className="panel form-panel">
            <div className="profile-summary">
              <ParticipantAvatar
                name={account?.name || name}
                team={profileTeam}
              />
              <div>
                <h2>{name || account?.name}</h2>
                <p>{profileTeam.name}</p>
              </div>
            </div>
            <label>
              Display Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="nickname"
              />
            </label>
            <label>
              Email Address
              <input
                type="email"
                value={email}
                readOnly
                placeholder="Your Account Email"
                autoComplete="email"
              />
            </label>
            <p className="muted">Your verified sign-in email. Saving your display name does not change this address.</p>
            <div className="form-actions">
              <button
                className="button primary"
                onClick={() => {
                  if (!account?.id) return;
                  try { saveAccountProfile(account, name); notify("Display Name Saved For This Account In This Browser"); }
                  catch { notify("This browser could not save your display name."); }
                }}
              >
                Save Details
              </button>
              <a
                className="text-button"
                href={
                  "https://sleeper.com/matchup/" +
                  league.leagueId +
                  "/" +
                  league.week +
                  "/" +
                  profileTeam.roster_id
                }
                target="_blank"
                rel="noreferrer"
              >
                Sleeper Team
                <Icon name="external" size={15} />
              </a>
            </div>
          </section>
        ) : profileTab === "preferences" ? (
          <section className="panel form-panel">
            <h3>Display & Betting Preferences</h3>
            <Toggle checked={dark} onChange={onTheme} label="Dark Mode" />
            <div className="preferences-fields">
              <label>
                Odds Format
                <select
                  aria-label="Odds Format"
                  value={prefs.oddsFormat}
                  onChange={(e) =>
                    update(
                      "oddsFormat",
                      e.target.value as ReviewSettings["oddsFormat"],
                    )
                  }
                >
                  <option value="american">American (+100)</option>
                  <option value="decimal">Decimal (2.00)</option>
                </select>
              </label>
              <label>
                Default Stake
                <input
                  type="number"
                  min=".01"
                  max="250"
                  step=".01"
                  value={prefs.defaultStake}
                  onChange={(e) =>
                    update("defaultStake", Number(e.target.value))
                  }
                />
              </label>
              <label>
                Starting Page
                <select
                  aria-label="Starting Page"
                  value={prefs.landingPage}
                  onChange={(e) => update("landingPage", e.target.value)}
                >
                  <option value="matchups">Weekly Slate</option>
                  <option value="offers">Offers</option>
                  <option value="my-bets">My Bets</option>
                  <option value="league">The League</option>
                </select>
              </label>
              <label>
                Default Player Filter
                <select
                  aria-label="Default Player Filter"
                  value={prefs.playerScope}
                  onChange={(e) =>
                    update(
                      "playerScope",
                      e.target.value as ReviewSettings["playerScope"],
                    )
                  }
                >
                  <option value="my-team">My Team</option>
                  <option value="all">All Teams</option>
                </select>
              </label>
              <label>
                Market Density
                <select
                  aria-label="Market Density"
                  value={prefs.density}
                  onChange={(e) =>
                    update(
                      "density",
                      e.target.value as ReviewSettings["density"],
                    )
                  }
                >
                  <option value="compact">Compact</option>
                  <option value="comfortable">Comfortable</option>
                </select>
              </label>
              <label>
                Display Time Zone
                <select
                  aria-label="Display Time Zone"
                  value={prefs.timezone}
                  onChange={(e) => update("timezone", e.target.value)}
                >
                  <option value="America/New_York">Eastern Time</option>
                  <option value="device">My Device Time Zone</option>
                </select>
              </label>
            </div>
            <button className="button primary" onClick={save}>
              Save Preferences
            </button>
          </section>
        ) : profileTab === "communications" ? (
          <CommunicationsSettings />
        ) : (
          <BalanceHistory tickets={tickets} />
        )}
      </div>
    </>
  );
}
export function CommissionerPage({ notify }: { notify: (s: string) => void }) {
  const [tab, setTab] = useState("Members");
  return (
    <>
      <PageHeading
        title="Commissioner"
        action={<Badge>Commissioner View</Badge>}
      />
      <div className="tabs" role="tablist" aria-label="Commissioner Tools">
        {[
          "Members",
          "Featured Matchups",
          "Fantasy Rewards",
          "League Feed",
          "Season Futures",
          "Rivalries",
          "League Identity",
          "Betting Log",
        ].map((t) => (
          <button
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            key={t}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Members" ? live() ? <CommissionerMembers /> : (
        <>
          <div className="section-intro split">
            <span>
              {teams.length} Teams · {members.length} Participants
            </span>
            <button
              className="button primary"
              onClick={() => navigate("setup")}
            >
              <Icon name="plus" size={16} />
              Invite & Map Members
            </button>
          </div>
          <div className="panel">
            {members.map((m, i) => (
              <div className="member-row" key={m.team.id + "-" + m.name}>
                <Avatar team={m.team} small />
                <div>
                  <strong>{m.name}</strong>
                  <small>{m.team.name}</small>
                </div>
                <Badge tone={i === 3 ? "gold" : "green"}>
                  {i === 3 ? "Review Mapping" : "Mapped Example"}
                </Badge>
                <button
                  className="text-button"
                  onClick={() => notify("Mapping Review Preview: " + m.name)}
                >
                  Review
                  <Icon name="arrow" size={14} />
                </button>
              </div>
            ))}
          </div>
        </>
      ) : tab === "Featured Matchups" ? (
        <FeaturedCommissioner notify={notify} />
      ) : tab === "League Feed" ? (
        <LeagueFeedSettings />
      ) : tab === "Fantasy Rewards" ? (
        <FantasyRewardsSettings />
      ) : tab === "Season Futures" ? (
        <FuturesRules />
      ) : tab === "Rivalries" ? (
        <RivalriesPanel notify={notify} />
      ) : tab === "League Identity" ? (
        <section className="panel form-panel readonly-identity">
          <div className="league-identity">
            <LeagueAvatar />
            <div>
              <h2>{league.league}</h2>
              <Badge>From Sleeper</Badge>
            </div>
          </div>
          <dl>
            <div>
              <dt>League ID</dt>
              <dd>{league.leagueId}</dd>
            </div>
            <div>
              <dt>Sport</dt>
              <dd>NFL Fantasy Football</dd>
            </div>
            <div>
              <dt>Season</dt>
              <dd>{league.season}</dd>
            </div>
            <div>
              <dt>Teams</dt>
              <dd>{teams.length}</dd>
            </div>
            <div>
              <dt>Participants</dt>
              <dd>{members.length}</dd>
            </div>
          </dl>
          <a
            className="button secondary"
            href={"https://sleeper.com/leagues/" + league.leagueId}
            target="_blank"
            rel="noreferrer"
          >
            Sleeper League
            <Icon name="external" size={15} />
          </a>
        </section>
      ) : (
        <CommissionerActivity />
      )}
    </>
  );
}
export function PlatformPage({
  notify,
  tickets,
}: {
  notify: (s: string) => void;
  tickets: Ticket[];
}) {
  const [tab, setTab] = useState(()=>routeQuery().get('section')==='support'?'Support Inbox':'Overview');
  useEffect(()=>{const sync=()=>{if(routeQuery().get('section')==='support')setTab('Support Inbox');};
    window.addEventListener('boff-navigation',sync);return()=>window.removeEventListener('boff-navigation',sync);},[]);
  const [review, setReview] = useState(false);
  const [reviewWeek, setReviewWeek] = useState("all");
  const [memberQuery, setMemberQuery] = useState("");
  const [balanceMember, setBalanceMember] = useState("all");
  const [balanceLeague, setBalanceLeague] = useState<string>(()=>live()?.leagueId ?? "");
  const [ownerLeagues, setOwnerLeagues] = useState<{id:string;name:string;season:number}[]>([]);
  const [reviewMembers, setReviewMembers] = useState<{
    id: string;
    name: string;
    teamName: string;
    lastSignIn: string | null;
    balance: number | null;
    hasAccount: boolean;
  }[]>([]);
  const [memberError, setMemberError] = useState("");
  const [leagueListError, setLeagueListError] = useState("");
  const [memberLoading, setMemberLoading] = useState(false);
  const needsMembers = review || tab === "User Balances";
  const selectedLeague = tab==="User Balances" ? balanceLeague : live()?.leagueId;
  useEffect(()=>{
    if(!live() || (tab!=="Overview" && tab!=="User Balances"))return;
    let active=true;
    setLeagueListError("");
    void auth.rpc("dev_owner_leagues").then(({data,error})=>{
      if(active && !error)setOwnerLeagues(data ?? []);
      if(active && error)setLeagueListError(error.message);
    });
    return ()=>{active=false;};
  },[tab]);
  useEffect(() => {
    if (!needsMembers || !selectedLeague) return;
    let active = true;
    setMemberLoading(true);
    setReviewMembers([]);
    setMemberError("");
    void auth.rpc("dev_league_review_members", { p_league: selectedLeague }).then(({ data, error }) => {
      if (!active) return;
      setMemberLoading(false);
      if (error) setMemberError(error.message);
      else setReviewMembers(data ?? []);
    });
    return () => { active = false; };
  }, [needsMembers, selectedLeague]);
  const currentSeasonTickets = tickets.filter((ticket) => ticket.season === String(league.season));
  const reviewTickets = currentSeasonTickets.filter((ticket) => reviewWeek === "all" || ticket.week === Number(reviewWeek));
  const reviewWeeks = [...new Set(currentSeasonTickets.map((ticket) => ticket.week).filter((week) => week != null))].sort((a, b) => b - a);
  return (
    <>
      <PageHeading title="Platform Owner" action={live() ? <a className="button primary" href={routeUrl("setup")}>Add League</a> : <Badge>Owner view</Badge>} />
      <div className="tabs" role="tablist" aria-label="Platform tools">
        {[
          "Overview",
          "Result Review",
          "Operations",
          "Communications",
          "Support Inbox",
          "User Balances",
        ].map((t) => (
          <button
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            key={t}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "User Balances" ? (
        <section className="panel form-panel">
          <h3>User Balances</h3>
          <div className="preferences-fields">
            <label>League<select value={balanceLeague} onChange={event=>{setBalanceLeague(event.target.value);setBalanceMember("all");}}>
              {(ownerLeagues.length ? ownerLeagues : [{id:balanceLeague,name:league.league,season:Number(league.season)}]).map(item=>
                <option value={item.id} key={item.id}>{item.name} · {item.season}</option>)}
            </select></label>
            <label>Member<select value={balanceMember} onChange={(event) => setBalanceMember(event.target.value)}>
              <option value="all">All members</option>
              {reviewMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select></label>
          </div>
          {memberLoading && <p role="status">Loading balances…</p>}
          {leagueListError && <p role="status">{leagueListError}</p>}
          {memberError && <p role="status">{memberError}</p>}
          {reviewMembers.filter((member) => balanceMember === "all" || member.id === balanceMember).map((member) => (
            <div className="member-row" key={member.id}>
              <div><strong>{member.name}</strong><small>{member.teamName}</small></div>
              <span>{member.balance == null ? "—" : money(Number(member.balance))}</span>
            </div>
          ))}
        </section>
      ) : tab === "Support Inbox" ? (
        <OwnerSupportInbox />
      ) : tab === "Overview" ? (
        <>
          <div className="section-intro">
            <h2>Connected Leagues</h2>
            <p>League membership and betting activity</p>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <h3>League Directory</h3>
              <Badge tone="green">{ownerLeagues.length || 1} {ownerLeagues.length > 1 ? "leagues" : "league"}</Badge>
            </div>
            <div className="member-row">
              <LeagueAvatar small />
              <div>
                <strong>{league.league}</strong>
                <small>
                  {teams.length} teams · {members.length} managers · NFL {league.season}
                </small>
              </div>
              
              <button
                className="text-button"
                onClick={() => setReview((open) => !open)}
                aria-expanded={review}
                aria-controls="league-review"
              >
                Review league <Icon name="arrow" size={15} />
              </button>
            </div>
            {ownerLeagues.filter(item => item.id !== live()?.leagueId).map(item => (
              <div className="member-row" key={item.id}>
                <div><strong>{item.name}</strong><small>NFL {item.season}</small></div>
                <Badge>Imported</Badge>
              </div>
            ))}
            {leagueListError && <p role="status">{leagueListError}</p>}
          </section>
          {review && (
            <section className="panel form-panel" id="league-review" aria-label="League review">
              <div className="panel-heading">
                <h3>League Review</h3>
                <label>
                  Week
                  <select value={reviewWeek} onChange={(event) => setReviewWeek(event.target.value)}>
                    <option value="all">Entire Season</option>
                    {reviewWeeks.map((week) => <option key={week} value={week}>Week {week}</option>)}
                  </select>
                </label>
              </div>
              <dl className="review-summary">
                <div><dt>Season</dt><dd>{league.season}</dd></div>
                <div><dt>Members</dt><dd>{members.length}</dd></div>
                <div><dt>Open Tickets</dt><dd>{reviewTickets.filter((ticket) => ticket.status === "Open").length}</dd></div>
                <div><dt>Settled Tickets</dt><dd>{reviewTickets.filter((ticket) => ticket.status !== "Open").length}</dd></div>
                <div><dt>Credits Wagered</dt><dd>{money(reviewTickets.reduce((total, ticket) => total + ticket.stake, 0))}</dd></div>
                <div><dt>Last Score Sync</dt><dd>{live()?.book.observed_at ? new Date(live().book.observed_at).toLocaleString() : "Unavailable"}</dd></div>
              </dl>
              <h3>Members</h3>
              <label>Find a member<input type="search" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} /></label>
              {memberLoading && <p role="status">Loading members…</p>}
              {memberError && <p role="status">{memberError}</p>}
              {reviewMembers.filter((member) => `${member.name} ${member.teamName}`.toLowerCase().includes(memberQuery.trim().toLowerCase())).map((member) => (
                <div className="member-row" key={member.id}>
                  <div>
                    <strong>{member.name}</strong><small>{member.teamName}</small>
                    <small>Last Boff sign-in · {member.lastSignIn ? new Date(member.lastSignIn).toLocaleDateString() : "Never signed in"}</small>
                  </div>
                  <button className="text-button" onClick={() => {
                    setBalanceMember(member.id);
                    setTab("User Balances");
                    setBalanceLeague(live().leagueId);
                  }}>View balance</button>
                </div>
              ))}
            </section>
          )}
        </>
      ) : tab === "Result Review" ? (
        live() ? <RewardCorrections /> :
        <section className="panel">
          <div className="panel-heading">
            <h3>Results To Review</h3>
            <Badge tone="gold">Automatic Review · Preview</Badge>
          </div>
          <div className="review-example">
            <Badge>Player participation unclear</Badge>
            <h3>Participation Review</h3>
            <p>
              The system checks uncertain results against source evidence
              automatically. Only unresolved cases reach the owner. Participants
              do not need to submit a dispute. This workflow is a preview.
            </p>
            <dl>
              <div>
                <dt>League</dt>
                <dd>{league.league}</dd>
              </div>
              <div>
                <dt>Ticket</dt>
                <dd>Example BF-08104</dd>
              </div>
              <div>
                <dt>Action</dt>
                <dd>Await participation evidence</dd>
              </div>
            </dl>
            <button
              className="button secondary"
              onClick={() =>
                notify(
                  "Evidence panel example. No source research or settlement was performed.",
                )
              }
            >
              Review supporting evidence <Icon name="arrow" size={16} />
            </button>
          </div>
        </section>
      ) : tab === "Operations" ? (
        <section className="panel">
          <div className="panel-heading">
            <h3>Weekly Schedule</h3>
            <Badge>Eastern time</Badge>
          </div>
          {[
            [
              "Tuesday · 5:00 AM",
              "Advance to the next week",
              "Publish the new board when its schedule, projections and team data are ready. No scheduled downtime.",
            ],
            [
              "Tuesday · 7:00 AM",
              "Settle, then replenish",
              "Unclear results move to owner review.",
            ],
            [
              "Tuesday · 8:00 AM",
              "Weekly recap",
              "Send relevant updates to opted-in participants.",
            ],
            [
              "Throughout the week",
              "Refresh available markets",
              "Reprice roster and injury changes. Placed bets retain their accepted odds.",
            ],
          ].map(([time, title, note]) => (
            <div className="schedule-row" key={title}>
              <Icon name="clock" />
              <span>{time}</span>
              <div>
                <strong>{title}</strong>
                <small>{note}</small>
              </div>
              <Badge>Eastern Time</Badge>
            </div>
          ))}
        </section>
      ) : (
        <OwnerEmailCommunications />
      )}
    </>
  );
}
export function Onboarding(props: { notify: (s: string) => void }) {
  if (!live()) return <OnboardingPreview {...props} />;
  if (!live().user.platformOwner) return <Empty title="Platform Owner Access Required" children={null} />;
  return <>
    <PageHeading title="Add League" action={<a className="button secondary" href={routeUrl("platform")}>Platform Owner</a>} />
    <div className="panel form-panel owner-league-intake"><IntakeBoundary><LeagueIntake client={auth} discoverLeagues /></IntakeBoundary></div>
  </>;
}

function OnboardingPreview({ notify }: { notify: (s: string) => void }) {
  const [step, setStep] = useState(1);
  const [id, setId] = useState(league.leagueId);
  const [approved, setApproved] = useState(false);
  return (
    <>
      <PageHeading title="League Setup" />
      <div className="setup-progress">
        {["Connect Sleeper", "Map Managers", "Review & Open"].map((t, i) => (
          <div
            className={
              step === i + 1 ? "current" : step > i + 1 ? "complete" : ""
            }
            key={t}
          >
            <span>
              {step > i + 1 ? <Icon name="check" size={14} /> : i + 1}
            </span>
            {t}
          </div>
        ))}
      </div>
      {step === 1 ? (
        <section className="panel form-panel setup-panel">
          <span className="setup-symbol">
            <Icon name="people" size={36} />
          </span>
          <h2>Connect Sleeper</h2>
          <label>
            Sleeper league ID
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              inputMode="numeric"
            />
          </label>
          <p className="field-note">
            This preview uses your connected league fixture. No live import or
            account is created.
          </p>
          <button
            className="button primary"
            onClick={() =>
              id === league.leagueId
                ? setStep(2)
                : notify(
                    "Use the prefilled league ID to review the available real-league fixture.",
                  )
            }
          >
            Preview this league <Icon name="arrow" size={16} />
          </button>
        </section>
      ) : step === 2 ? (
        <>
          <div className="section-intro split">
            <div>
              <h2>{league.league}</h2>
              <p>
                {teams.length} teams · {members.length} managers & co-managers
              </p>
            </div>
            <button
              className="button secondary"
              onClick={() =>
                notify(
                  "Invite-link appearance previewed. No invitation was created or sent.",
                )
              }
            >
              <Icon name="share" size={16} /> Preview invite link
            </button>
          </div>
          <section className="panel">
            {members.map((m) => (
              <div className="mapping-row" key={`${m.name}-${m.team.id}`}>
                <Avatar team={m.team} small />
                <div>
                  <strong>{m.name}</strong>
                  <small>
                    {m.team.name}
                    {m.co ? " · Co-manager" : ""}
                  </small>
                </div>
                <input
                  type="email"
                  aria-label={`Email for ${m.name}`}
                  placeholder="Add email or invite by link"
                />
              </div>
            ))}
          </section>
          <div className="form-actions">
            <button className="button secondary" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="button primary" onClick={() => setStep(3)}>
              Review league <Icon name="arrow" size={16} />
            </button>
          </div>
        </>
      ) : (
        <section className="panel form-panel">
          <Badge tone="green">Ready for your review</Badge>
          <h2>Review Mappings</h2>
          <p>
            Review the participant-to-team mappings before opening the league.
            Managers who have not joined can finish later; their teams still
            appear on the board.
          </p>
          <div className="review-stats">
            <span>
              <strong>{teams.length}</strong>teams imported
            </span>
            <span>
              <strong>{members.length}</strong>managers found
            </span>
          </div>
          <Toggle
            checked={approved}
            onChange={() => setApproved(!approved)}
            label="I’ve reviewed the mapping"
            note="Participants receive access after their mapping is approved."
          />
          <div className="form-actions">
            <button className="button secondary" onClick={() => setStep(2)}>
              Back
            </button>
            <button
              className="button primary"
              disabled={!approved}
              onClick={() =>
                notify(
                  "Activation screen reviewed. This visual preview did not activate a league.",
                )
              }
            >
              Preview league opening <Icon name="arrow" size={16} />
            </button>
          </div>
        </section>
      )}
    </>
  );
}
export function AccessPage(_props:{notify:(message:string)=>void}){
 return <DevSignIn/>;
}
