import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { loadAccounts, money, errorMessage } from "./lib/accounts";
import type { AccountData, Team, Membership } from "./lib/accounts";
import "./App.css";
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
        <div className="season">Season 3</div>
        <h1>
          Your League.
          <br />
          Your Rivalries.
        </h1>
        <p>
          Welcome To Goldy Fantasy Sportsbook. All The Competition, All Pretend.
        </p>
        <div className="league-signature">
          <Avatar src={leagueAvatar} name="Goldy" />
          <div>
            <strong>Goldy Plays Pretend With Men</strong>
            <span>12 Teams · One League</span>
          </div>
        </div>
      </section>
      <section className="signin-card">
        <span className="entry-icon" aria-hidden="true">
          ↗
        </span>
        <h2>{sent ? "Check Your Email" : "Welcome Back"}</h2>
        <p>
          {sent ? (
            <>
              Your Sign-In Link Was Requested For <strong>{email}</strong>. Open
              It To Access Your Account.
            </>
          ) : (
            "Enter Your Approved League Email To Receive A Sign-In Link."
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
            className="text-button"
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
          <strong>No Password. No Verification Code.</strong>
          <p>
            The Link Is Single-Use And Expires. Check Spam If It Does Not
            Arrive. You Can Stay Signed In On Your Device.
          </p>
        </div>
      </section>
    </main>
  );
}
function History({ data, team }: { data: AccountData; team: Team }) {
  const entries = [
    ...data.events
      .filter((e) => e.team_id === team.id)
      .map((e) => ({
        id: e.id,
        reason: e.reason,
        before: e.previous_balance,
        after: e.new_balance,
        date: e.created_at,
      })),
    ...data.ledger
      .filter((e) => e.team_id === team.id)
      .map((e) => ({
        id: e.id,
        reason: e.reason,
        before: e.balance_before,
        after: e.balance_after,
        date: e.created_at,
      })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section className="history">
      <h3>Balance History</h3>
      {entries.length ? (
        entries.map((e) => (
          <div className="history-entry" key={e.id}>
            <div>
              <strong>{e.reason}</strong>
              <span>
                {new Date(e.date).toLocaleString("en-US", {
                  timeZone: "America/New_York",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                Eastern
              </span>
            </div>
            <span className="history-amount">
              {e.before == null ? "Opening Balance" : money(e.before) + " →"}
              <strong>{money(e.after)}</strong>
            </span>
          </div>
        ))
      ) : (
        <p>No Balance Changes Yet.</p>
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
              {team.ties ? `–${team.ties}` : ""} · Sleeper Connected
            </span>
          </div>
        </div>
        <div className="balance-highlight">
          <span>Current Balance</span>
          <strong>{money(balance)}</strong>
          <small>Virtual Currency</small>
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
        <p className="account-note">
          Week 3 Bets Are Settled And Your Balance Is Ready. Bet History And The
          Leaderboard Will Appear With The Sportsbook Screens.
        </p>
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
          ? "Owner Name Saved."
          : "Account Mapping Approved. No Email Was Sent.",
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
      setFeedback("Balance Updated. Leaderboard Betting Profit Is Unchanged.");
    });
  }
  return (
    <section className="admin-detail">
      <div className="identity compact">
        <Avatar src={team.avatar_url} name={team.team_name} />
        <div>
          <h2>{team.team_name}</h2>
          <p>
            Roster {team.roster_id} · {team.sportsbook_owner_name}
          </p>
        </div>
      </div>
      {team.co_owner_names.length > 0 && (
        <p className="shared-notice">
          Shared Sleeper Team. Only{" "}
          <strong>{team.sportsbook_owner_name}</strong> Is Approved For This
          Sportsbook Account.
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
            Email Reassignment Requires A Separate Review.
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
          placeholder="Explain Why This Balance Is Changing"
          onChange={(e) => {
            setReason(e.target.value);
            request.current = crypto.randomUUID();
          }}
        />
        <p className="field-note">
          Saves The Previous Balance, New Balance, And Your Reason. Adjustments
          Do Not Count As Betting Profit.
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
export function Admin({
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
    <main className="admin-layout">
      <div className="page-heading">
        <h1>League Admin</h1>
        <p>Manage Accounts And Balances For Your League.</p>
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
    </main>
  );
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(!supabase),
    [data, setData] = useState<AccountData | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [page, setPage] = useState<"account" | "admin">("account"),
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
            {light ? "☾" : "☀"}
          </button>
          {session && (
            <>
              <div className="profile">
                <Avatar
                  src={team?.avatar_url ?? null}
                  name={member?.display_name ?? "Member"}
                />
                <span>{member?.display_name ?? "Account"}</span>
              </div>
              <button className="text-button" onClick={signOut}>
                Sign Out
              </button>
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
          {data && member && (
            <nav className="account-nav" aria-label="Account Navigation">
              <button
                aria-current={page === "account" ? "page" : undefined}
                onClick={() => setPage("account")}
              >
                Account
              </button>
              {member.role === "admin" && (
                <button
                  aria-current={page === "admin" ? "page" : undefined}
                  onClick={() => setPage("admin")}
                >
                  Admin
                </button>
              )}
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
            page === "admin" && member.role === "admin" ? (
              <Admin data={data} leagueId={leagueId} refresh={refresh} />
            ) : (
              <Account data={data} member={member} team={team} />
            )
          ) : (
            <main className="empty">
              <h1>Membership Pending</h1>
              <p>{session.user.email}</p>
              <p>
                Ask Cooper To Approve This Email For Your Sleeper Team, Then
                Refresh Your Account.
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
      <footer>Goldy Fantasy Sportsbook · Virtual Currency Only</footer>
    </div>
  );
}
