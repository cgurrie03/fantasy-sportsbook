import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { loadAccounts, money, errorMessage } from "./lib/accounts";
import type { AccountData, Team, Membership } from "./lib/accounts";
import "./App.css";
import { AdminHub } from "./components/AdminHub";
import { ThemeIcon } from "./components/ThemeIcon";
import { buildBalanceHistory } from "./lib/balanceHistory";
import { Sportsbook } from "./components/Sportsbook";
const leagueAvatar =
  "https://sleepercdn.com/avatars/bac95664e269132b2a43e889f980a3e2";
function Avatar({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="avatar">
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
function SignIn() {
  const [period, setPeriod] = useState({ league_season: 3, week: 5 });
  useEffect(() => {
    let active = true;
    const update = async () => {
      if (!supabase) return;
      const { data, error } = await supabase.rpc("sportsbook_period", {
        p_league: "13121261-5398-4391-8240-000000000003",
      });
      if (active && !error && data?.[0]) setPeriod(data[0]);
    };
    void update();
    const timer = setInterval(update, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const [email, setEmail] = useState(""),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds(seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || seconds > 0) return;
    setBusy(true);
    setError("");
    try {
      if (!supabase) throw new Error("Account Service Is Not Configured.");
      const result = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: window.location.origin + "/",
        },
      });
      if (result.error) throw result.error;
      setSent(true);
      setSeconds(60);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="signin-layout">
      <section className="league-intro">
        <div className="season">
          Season {period.league_season} • Week {period.week}
        </div>
        <h1>
          Fake Football.
          <br />
          Fake Betting.
        </h1>
        <p>Welcome to your Fantasy Sportsbook.</p>
        <div className="league-signature">
          <Avatar src={leagueAvatar} name="Goldy" />
          <div>
            <strong>Goldy Plays Pretend With Men</strong>
          </div>
        </div>
      </section>
      <section className="signin-card">
        <span className="entry-icon" aria-hidden="true">
          ↗
        </span>
        <h2>{sent ? "Check Your Email" : "Welcome"}</h2>
        <p>
          {sent ? (
            <>
              Your sign-in link was requested for <strong>{email}</strong>. Open
              it to access your account.
            </>
          ) : (
            "Enter your approved league email to receive a sign-in link."
          )}
        </p>
        <form onSubmit={submit}>
          <label htmlFor="signin-email">Email Address</label>
          <input
            id="signin-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            disabled={busy || sent}
            placeholder="you@example.com"
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="primary" disabled={busy || seconds > 0}>
            {busy
              ? "Sending…"
              : seconds > 0
                ? `Resend In ${seconds}s`
                : sent
                  ? "Resend Sign-In Link"
                  : "Email Me A Sign-In Link"}
          </button>
        </form>
        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
        {sent && (
          <button
            className="text-button alternate-email"
            onClick={() => {
              setSent(false);
              setEmail("");
              setError("");
            }}
          >
            Use Another Email
          </button>
        )}
        <div className="signin-help">
          <strong>No password. No verification code.</strong>
          <p>
            The link is single-use and expires. Check spam if it does not
            arrive. You can stay signed in on your device.
          </p>
        </div>
      </section>
    </main>
  );
}
function History({ data, team }: { data: AccountData; team: Team }) {
  const entries = buildBalanceHistory(data, team.id);
  return (
    <section className="history">
      <h3>Balance History</h3>
      {entries.some((e) => e.imported) && (
        <p className="history-note">
          Winning payouts include your returned wager. Imported settlements show
          the import date; their original settlement times were not recorded.
        </p>
      )}
      {entries.length ? (
        entries.map((e) => (
          <div className="history-entry" key={e.id}>
            <div>
              <strong>{e.title}</strong>
              <p className="history-reason">{e.reason}</p>
              <span>
                {e.imported
                  ? "Imported " +
                    new Date(e.date).toLocaleDateString("en-US", {
                      timeZone: "America/New_York",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : new Date(e.date).toLocaleString("en-US", {
                      timeZone: "America/New_York",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    }) + " Eastern"}
              </span>
            </div>
            <span className="history-amount">
              <strong className={e.amount > 0 ? "won" : ""}>
                {e.amount > 0 ? "+" : "−"}
                {money(Math.abs(e.amount))}
              </strong>
              <small>Balance: {money(e.balanceAfter)}</small>
            </span>
          </div>
        ))
      ) : (
        <p>No balance changes yet.</p>
      )}
    </section>
  );
}
export function Account({
  data,
  member,
  team,
}: {
  data: AccountData;
  member: Membership;
  team: Team;
}) {
  const balance = data.wallets.find((w) => w.team_id === team.id)?.balance;
  return (
    <main className="account-layout">
      <section className="account-card">
        <div className="identity">
          <Avatar src={team.avatar_url} name={member.display_name} />
          <div>
            <span className="season">Your Account</span>
            <h1>{member.display_name}</h1>
            <p>{team.team_name}</p>
            <span>
              {team.wins}–{team.losses}
              {team.ties ? `–${team.ties}` : ""} · Sleeper Connected{" "}
              <span className="connected-check" aria-label="Connected">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="m8 12 3 3 5-6" />
                </svg>
              </span>
            </span>
          </div>
        </div>
        <div className="balance-highlight">
          <span>Current Balance</span>
          <strong>{money(balance)}</strong>
        </div>
        <dl className="account-details">
          <div>
            <dt>Sign-In Email</dt>
            <dd>{member.invited_email}</dd>
          </div>
          <div>
            <dt>Sleeper Account</dt>
            <dd>{team.sportsbook_owner_name}</dd>
          </div>
          <div>
            <dt>Access</dt>
            <dd>
              {member.role === "admin" ? "League Admin" : "League Member"}
            </dd>
          </div>
        </dl>
      </section>
      <History data={data} team={team} />
    </main>
  );
}
function TeamAdmin({
  data,
  team,
  refresh,
}: {
  data: AccountData;
  team: Team;
  refresh: () => Promise<void>;
}) {
  const member = data.memberships.find((m) => m.team_id === team.id);
  const current = data.wallets.find((w) => w.team_id === team.id)?.balance;
  const [email, setEmail] = useState(member?.invited_email ?? ""),
    [name, setName] = useState(member?.display_name ?? ""),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState(""),
    [error, setError] = useState("");
  const request = useRef(crypto.randomUUID());
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFeedback("");
    setError("");
    try {
      await action();
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function mapping(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    await run(async () => {
      const r = await supabase!.rpc("approve_member", {
        p_team: team.id,
        p_email: email,
        p_name: name,
        p_sleeper_user: team.sportsbook_owner_id,
      });
      if (r.error) throw r.error;
      setFeedback(
        member
          ? "Owner name saved."
          : "Account mapping approved. No email was sent.",
      );
    });
  }
  async function balance(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    await run(async () => {
      const r = await supabase!.rpc("set_team_balance", {
        p_team: team.id,
        p_balance: Number(amount),
        p_reason: reason,
        p_request: request.current,
      });
      if (r.error) throw r.error;
      request.current = crypto.randomUUID();
      setAmount("");
      setReason("");
      setFeedback("Balance updated. Leaderboard betting profit is unchanged.");
    });
  }
  return (
    <section className="admin-detail">
      <div className="identity compact">
        <Avatar src={team.avatar_url} name={team.team_name} />
        <div>
          <h2>{team.team_name}</h2>
          <p>{team.sportsbook_owner_name}</p>
        </div>
      </div>
      {team.co_owner_names.length > 0 && (
        <p className="shared-notice">
          Shared Sleeper team. Only{" "}
          <strong>{team.sportsbook_owner_name}</strong> is approved for this
          sportsbook account.
        </p>
      )}
      <form onSubmit={mapping}>
        <h3>Account Mapping</h3>
        <label htmlFor="owner-name">Owner Name</label>
        <input
          id="owner-name"
          value={name}
          maxLength={80}
          required
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <label htmlFor="owner-email">Email Address</label>
        <input
          id="owner-email"
          type="email"
          value={email}
          required
          disabled={busy || !!member}
          onChange={(e) => setEmail(e.target.value)}
        />
        {member && (
          <p className="field-note">
            Email reassignment requires a separate review.
          </p>
        )}
        <button className="secondary" disabled={busy}>
          {member ? "Save Owner Name" : "Approve Account Mapping"}
        </button>
      </form>
      <form onSubmit={balance}>
        <div className="balance-heading">
          <h3>Set Balance</h3>
          <strong>
            {money(current)} <span>Current</span>
          </strong>
        </div>
        <label htmlFor="new-balance">New Balance</label>
        <input
          id="new-balance"
          type="number"
          inputMode="decimal"
          min="0"
          max="9999999999.99"
          step="0.01"
          value={amount}
          required
          disabled={busy}
          placeholder="0.00"
          onChange={(e) => {
            setAmount(e.target.value);
            request.current = crypto.randomUUID();
          }}
        />
        <label htmlFor="balance-reason">Reason For Adjustment</label>
        <textarea
          id="balance-reason"
          value={reason}
          minLength={3}
          maxLength={500}
          required
          disabled={busy}
          placeholder="Explain why this balance is changing"
          onChange={(e) => {
            setReason(e.target.value);
            request.current = crypto.randomUUID();
          }}
        />
        <p className="field-note">
          Saves the previous balance, new balance, and your reason. Adjustments
          do not count as betting profit.
        </p>
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save Balance"}
        </button>
      </form>
      {feedback && (
        <p className="feedback success" role="status">
          {feedback}
        </p>
      )}
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      <History data={data} team={team} />
    </section>
  );
}
function UsersAdmin({
  data,
  leagueId,
  refresh,
}: {
  data: AccountData;
  leagueId: string;
  refresh: () => Promise<void>;
}) {
  const teams = data.teams.filter((t) => t.league_id === leagueId),
    [selected, setSelected] = useState(teams[0]?.id);
  const team = teams.find((t) => t.id === selected) ?? teams[0];
  return (
    <section className="admin-layout">
      <div className="page-heading">
        <h1>Users</h1>
        <p>Manage names, account mappings, and balances for your league.</p>
      </div>
      <div className="admin-columns">
        <aside aria-label="League Teams" className="team-list">
          {teams.map((t) => {
            const m = data.memberships.find((m) => m.team_id === t.id);
            return (
              <button
                className={t.id === team?.id ? "selected" : ""}
                key={t.id}
                onClick={() => setSelected(t.id)}
                aria-pressed={t.id === team?.id}
              >
                <Avatar src={t.avatar_url} name={t.team_name} />
                <span>
                  <strong>{t.team_name}</strong>
                  <small>{m?.display_name ?? t.sportsbook_owner_name}</small>
                </span>
                <span className="mapping-state">
                  {m ? "Approved" : "Unmapped"}
                </span>
              </button>
            );
          })}
        </aside>
        {team && (
          <TeamAdmin key={team.id} data={data} team={team} refresh={refresh} />
        )}
      </div>
    </section>
  );
}
export function Admin({
  data,
  leagueId,
  refresh,
  initialCategory,
  reviewMode = false,
}: {
  data: AccountData;
  leagueId: string;
  refresh: () => Promise<void>;
  initialCategory?: string;
  reviewMode?: boolean;
}) {
  return (
    <AdminHub
      data={data}
      leagueId={leagueId}
      refresh={refresh}
      initialCategory={initialCategory}
      reviewMode={reviewMode}
      users={<UsersAdmin data={data} leagueId={leagueId} refresh={refresh} />}
    />
  );
}
export default function App() {
  const profileMenu = useRef<HTMLDetailsElement>(null);
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(!supabase),
    [data, setData] = useState<AccountData | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [page, setPage] = useState<"home" | "account" | "admin">("home"),
    [leagueId, setLeagueId] = useState("");
  const [light, setLight] = useState(() => {
    try {
      return localStorage.getItem("goldy-theme") === "light";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
    try {
      localStorage.setItem("goldy-theme", light ? "light" : "dark");
    } catch {
      /* Theme Still Works Without Storage. */
    }
  }, [light]);
  useEffect(() => {
    const closeProfile = (event: MouseEvent) => {
      if (
        profileMenu.current &&
        !profileMenu.current.contains(event.target as Node)
      )
        profileMenu.current.open = false;
    };
    document.addEventListener("click", closeProfile);
    return () => document.removeEventListener("click", closeProfile);
  }, []);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (active) {
        setSession(data.session);
        if (error) setError(error.message);
        setReady(true);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, next) => {
        setSession(next);
        setReady(true);
      },
    );
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);
  const userId = session?.user.id;
  // Reset private account state when the external authentication identity changes.
  useEffect(() => {
    let active = true;
    // oxlint-disable-next-line react/set-state-in-effect
    setData(null);
    setError("");
    setPage("account");
    if (!userId) return;
    setLoading(true);
    loadAccounts()
      .then((next) => {
        if (active) {
          setData(next);
          setLeagueId(next.leagues[0]?.id ?? "");
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);
  async function refresh() {
    const next = await loadAccounts();
    setData(next);
  }
  const member = data?.memberships.find(
      (m) => m.user_id === userId && m.league_id === leagueId,
    ),
    team = data?.teams.find((t) => t.id === member?.team_id);
  async function signOut() {
    const r = await supabase?.auth.signOut();
    if (r?.error) setError(errorMessage(r.error));
    else {
      setData(null);
      setSession(null);
    }
  }
  return (
    <div className="app-shell">
      <header className="masthead">
        <div className="brand">
          <Avatar
            src={
              data?.leagues.find((l) => l.id === leagueId)?.avatar_url ??
              leagueAvatar
            }
            name="Goldy"
          />
          <div>
            <strong>Goldy Plays Pretend With Men</strong>
            <span>Fantasy Sportsbook</span>
          </div>
        </div>
        <div className="account-tools">
          <button
            className="theme-toggle"
            aria-label={light ? "Use Dark Mode" : "Use Light Mode"}
            title={light ? "Use Dark Mode" : "Use Light Mode"}
            onClick={() => setLight(!light)}
          >
            <ThemeIcon light={light} />
          </button>
          {session && (
            <>
              <details
                className="profile-menu"
                ref={profileMenu}
                onKeyDown={(e) => {
                  if (e.key === "Escape") e.currentTarget.open = false;
                }}
              >
                <summary
                  className="profile profile-box"
                  aria-label="Open Account Options"
                >
                  <Avatar
                    src={team?.avatar_url ?? null}
                    name={member?.display_name ?? "Member"}
                  />
                  <span className="profile-copy">
                    <strong>{member?.display_name ?? "Account"}</strong>
                    <small>
                      Balance:{" "}
                      {money(
                        Number(
                          data?.wallets.find(
                            (w) => w.team_id === member?.team_id,
                          )?.balance ?? 0,
                        ),
                      )}
                    </small>
                  </span>
                </summary>
                <div className="profile-options">
                  <button
                    onClick={() => {
                      setPage("home");
                      if (profileMenu.current) profileMenu.current.open = false;
                    }}
                  >
                    Home
                  </button>
                  <button
                    onClick={() => {
                      setPage("account");
                      if (profileMenu.current) profileMenu.current.open = false;
                    }}
                  >
                    Account
                  </button>
                  {member?.role === "admin" && (
                    <button
                      onClick={() => {
                        setPage("admin");
                        if (profileMenu.current)
                          profileMenu.current.open = false;
                      }}
                    >
                      Admin
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (profileMenu.current) profileMenu.current.open = false;
                      void signOut();
                    }}
                  >
                    Sign Out
                  </button>
                </div>
              </details>
            </>
          )}
        </div>
      </header>
      {!ready ? (
        <main className="empty" role="status">
          Loading Your Account…
        </main>
      ) : !session ? (
        <>
          <SignIn />
          {error && (
            <p className="feedback error" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <>
          {data && member && data.leagues.length > 1 && (
            <nav className="account-nav" aria-label="Account Navigation">
              {data.leagues.length > 1 && (
                <select
                  aria-label="League"
                  value={leagueId}
                  onChange={(e) => {
                    setLeagueId(e.target.value);
                    setPage("account");
                  }}
                >
                  {data.leagues.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
            </nav>
          )}
          {error ? (
            <main className="empty">
              <h1>Could Not Load Your Account</h1>
              <p role="alert">{error}</p>
              <button
                className="primary"
                onClick={() => {
                  setError("");
                  setLoading(true);
                  refresh()
                    .catch((e) => setError(errorMessage(e)))
                    .finally(() => setLoading(false));
                }}
              >
                Try Again
              </button>
            </main>
          ) : loading ? (
            <main className="empty" role="status">
              Loading Your League…
            </main>
          ) : data && member && team ? (
            page === "home" ? (
              <Sportsbook data={data} member={member} refresh={refresh} />
            ) : page === "admin" && member.role === "admin" ? (
              <Admin data={data} leagueId={leagueId} refresh={refresh} />
            ) : (
              <Account data={data} member={member} team={team} />
            )
          ) : (
            <main className="empty">
              <h1>Membership Pending</h1>
              <p>{session.user.email}</p>
              <p>
                Ask Cooper to approve this email for your Sleeper team, then
                refresh your account.
              </p>
              <button
                className="primary"
                onClick={() => {
                  setError("");
                  refresh().catch((e) => setError(errorMessage(e)));
                }}
              >
                Refresh Account
              </button>
            </main>
          )}
        </>
      )}
      <footer>Goldy Fantasy Sportsbook</footer>
    </div>
  );
}
