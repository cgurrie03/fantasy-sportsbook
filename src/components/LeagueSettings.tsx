import { useEffect, useState } from "react";
import type { AccountData } from "../lib/accounts";
import { errorMessage } from "../lib/accounts";
import { supabase } from "../lib/supabase";
export function LeagueSettings({
  data,
  leagueId,
  onChanged,
}: {
  data: AccountData;
  leagueId: string;
  onChanged?: () => Promise<void>;
}) {
  const league = data.leagues.find((l) => l.id === leagueId)!;
  const [name, setName] = useState(league.name),
    [avatar, setAvatar] = useState(league.avatar_url ?? ""),
    [reason, setReason] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<
    {
      id: string;
      created_at: string;
      reason: string;
      before_value: { name: string };
      after_value: { name: string };
    }[]
  >([]);
  useEffect(() => {
    void supabase
      ?.from("admin_change_log")
      .select("*")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then((r) => {
        if (r.error) setNotice(errorMessage(r.error));
        else setHistory(r.data ?? []);
      });
  }, [leagueId]);
  async function save() {
    setBusy(true);
    try {
      const r = await supabase!.rpc("save_league_identity", {
        p_league: leagueId,
        p_name: name,
        p_avatar: avatar,
        p_reason: reason,
      });
      if (r.error) throw r.error;
      setReason("");
      setNotice("League identity saved. Existing tickets are unchanged.");
      await onChanged?.();
      const h = await supabase!
        .from("admin_change_log")
        .select("*")
        .eq("league_id", leagueId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (h.error) throw h.error;
      setHistory(h.data ?? []);
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const groups = [
    [
      "Season & Sleeper",
      "Season",
      `${league.league_season} · NFL ${league.nfl_season}`,
      "Records, roster membership, scoring, playoff structure, and pick ownership are sourced from Sleeper when markets are generated. They are not overridden here.",
    ],
    [
      "Wallet rules",
      "Weekly cash floor",
      "max($25, $100 − open futures stakes)",
      "Higher balances are retained. Unresolved weekly tickets hold replenishment for admin review. User balances can be adjusted under Users with a reason.",
    ],
    [
      "Betting & ticket rules",
      "Standard bets",
      "Two or more picks; weekly specials also allow singles",
      "Same-matchup spread and moneyline cannot combine. Contradictory selections cannot combine. League Winner and #1 Pick are singles; playoffs require playoff-only parlays; win totals allow singles or win-total-only parlays.",
    ],
    [
      "Forecast rules",
      "Odds rounding",
      "Matchups: 10 · Weekly specials: 25 · Futures: 50",
      "Futures cap at ±10,000. Best lineups use only eligible active roster and bench players; Taxi and IR are excluded. Unfillable positive-projection slots lock affected markets.",
    ],
    [
      "Settlement & access",
      "Non-participating player",
      "Push that leg",
      "All-push tickets return the stake. Admin cancellation refunds the stake and preserves a Voided audit record. Approved league members only; admin permissions are enforced in the database.",
    ],
  ];
  return (
    <section className="admin-workspace">
      <p className="report-note">
        These are the rules currently enforced by the sportsbook. Schedule and
        email preferences are editable in Automation & Communications.
      </p>
      <article className="admin-panel">
        <h2>League connection</h2>
        <strong>
          {league.sleeper_league_id ? (
            <a
              href={`https://sleeper.com/leagues/${league.sleeper_league_id}`}
              target="_blank"
              rel="noreferrer"
            >
              Sleeper league {league.sleeper_league_id}
            </a>
          ) : (
            "Sleeper connection unavailable"
          )}
        </strong>
        <p>
          {data.teams.filter((t) => t.league_id === leagueId).length} teams ·
          Time zone: America/New_York · Daylight saving time handled
          automatically.
        </p>
        <small>
          League-managed scoring and playoff settings are read from Sleeper when
          lines are generated. Changing this connection requires a verified
          migration; it cannot silently remap accepted tickets.
        </small>
      </article>
      {notice && (
        <p className="market-admin-notice" role="status">
          {notice}
        </p>
      )}
      <article className="admin-panel">
        <h2>League identity</h2>
        <div className="settings-fields">
          <label>
            League name
            <input
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Profile image URL
            <input
              value={avatar}
              maxLength={1000}
              placeholder="https://…"
              onChange={(e) => setAvatar(e.target.value)}
            />
          </label>
          <label>
            Change reason
            <input
              value={reason}
              maxLength={500}
              placeholder="Explain this change"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>
        <button
          className="primary"
          disabled={busy || reason.trim().length < 5 || name.trim().length < 3}
          onClick={() => void save()}
        >
          Save league identity
        </button>
        <small>
          Effective immediately. A before-and-after record is saved with your
          account.
        </small>
      </article>
      <div className="report-grid">
        {groups.map(([title, label, value, help]) => (
          <article className="admin-panel" key={title}>
            <h2>{title}</h2>
            <small>{label}</small>
            <strong className="setting-value">{value}</strong>
            <p>{help}</p>
            <span className="report-tag">Enforced rule · read only</span>
          </article>
        ))}
      </div>
      <article className="admin-panel">
        <h2>Settings change history</h2>
        {history.length ? (
          history.map((h) => (
            <p key={h.id}>
              <time>{new Date(h.created_at).toLocaleString()}</time> ·{" "}
              {h.before_value.name} → {h.after_value.name}
              <small>{h.reason}</small>
            </p>
          ))
        ) : (
          <p>No settings changes recorded.</p>
        )}
      </article>
    </section>
  );
}
