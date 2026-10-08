import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { errorMessage } from "../lib/accounts";
import type { AccountData } from "../lib/accounts";
import { WeeklySchedule } from "./WeeklySchedule";
import type { Market } from "../lib/markets";
export function Approvals({
  data,
  leagueId,
  onApplied,
  onLines,
}: {
  data: AccountData;
  leagueId: string;
  onApplied?: () => Promise<void>;
  onLines: () => void;
}) {
  const [locked, setLocked] = useState<Market[]>([]),
    [failures, setFailures] = useState<
      {
        id: string;
        kind: string;
        recipient: string;
        status: string;
        last_error: string | null;
      }[]
    >([]),
    [notice, setNotice] = useState("");
  const [reviews, setReviews] = useState<
      { exception_key: string; decision: string; reason: string }[]
    >([]),
    [reviewKey, setReviewKey] = useState(""),
    [decision, setDecision] = useState(""),
    [reason, setReason] = useState(""),
    [saving, setSaving] = useState(false);
  async function recordDecision() {
    setSaving(true);
    try {
      const r = await supabase!.rpc("review_admin_exception", {
        p_league: leagueId,
        p_key: reviewKey,
        p_decision: decision,
        p_reason: reason,
      });
      if (r.error) throw r.error;
      await load();
      setReviewKey("");
      setReason("");
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  function reviewControl(key: string, action: string) {
    const reviewed = reviews.find((r) => r.exception_key === key);
    return (
      <div className="exception-decision">
        {reviewed && (
          <p>
            <span className="report-tag">Reviewed</span> {reviewed.reason}
          </p>
        )}
        <button
          onClick={() => {
            setReviewKey(key);
            setDecision(action);
            setReason("");
          }}
        >
          {action === "keep_locked"
            ? "Record decision to keep locked"
            : "Record delivery review"}
        </button>
        {reviewKey === key && (
          <div>
            <label>
              Reason
              <input
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What did you verify or decide?"
              />
            </label>
            <p className="report-note">
              This records your review. It does not unlock markets, settle
              tickets, or resend emails.
            </p>
            <button
              className="primary"
              disabled={saving || reason.trim().length < 5}
              onClick={() => void recordDecision()}
            >
              Save review
            </button>
            <button disabled={saving} onClick={() => setReviewKey("")}>
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }
  const load = useCallback(async () => {
    try {
      const b = await supabase!
        .from("sportsbook_boards")
        .select("id")
        .eq("league_id", leagueId)
        .neq("status", "closed");
      if (b.error) throw b.error;
      const [markets, emails] = await Promise.all([
        supabase!
          .from("sportsbook_markets")
          .select("*")
          .in(
            "board_id",
            (b.data ?? []).map((b) => b.id),
          )
          .eq("active", true)
          .contains("metadata", { lineup_locked: true }),
        supabase!
          .from("outbound_emails")
          .select("id,kind,recipient,status,last_error")
          .eq("league_id", leagueId)
          .in("status", ["failed", "needs_review"])
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (markets.error || emails.error) throw markets.error ?? emails.error;
      setLocked(markets.data ?? []);
      setFailures(emails.data ?? []);
      const history = await supabase!
        .from("admin_exception_reviews")
        .select("exception_key,decision,reason")
        .eq("league_id", leagueId);
      if (history.error) throw history.error;
      setReviews(history.data ?? []);
      setNotice("");
    } catch (e) {
      setNotice(errorMessage(e));
    }
  }, [leagueId]);
  useEffect(() => {
    void load();
  }, [load]);
  const gaps = [
    ...new Map(locked.map((m) => [m.matchup_key ?? m.market_key, m])).values(),
  ];
  const oldTickets = (data.tickets ?? []).filter(
    (t) =>
      t.league_id === leagueId &&
      t.status === "OPEN" &&
      t.ticket_type !== "future",
  );
  return (
    <section className="admin-workspace">
      <p className="report-note">
        Automatic processing continues normally. This inbox highlights
        exceptions that may need your decision. Use the result review below to
        inspect evidence before applying a financial change.
      </p>
      {notice && <p role="alert">{notice}</p>}
      <div className="report-kpis">
        <article>
          <small>Lineup exceptions</small>
          <strong>{gaps.length}</strong>
        </article>
        <article>
          <small>Delivery exceptions</small>
          <strong>{failures.length}</strong>
        </article>
        <article>
          <small>Open weekly tickets to check</small>
          <strong>{oldTickets.length}</strong>
        </article>
      </div>
      <button onClick={() => void load()}>Recheck exception inbox</button>
      {gaps.map((m) => (
        <article className="admin-panel exception-panel" key={m.id}>
          <span className="report-tag">Markets kept locked</span>
          <h2>{m.label}</h2>
          <p>
            {String(
              m.metadata.lock_reason ??
                m.metadata.lineup_lock_reason ??
                "An eligible positive-projection lineup could not be completed. Review the latest lineup details in Lines & Markets.",
            )}
          </p>
          <button onClick={onLines}>Review and regenerate lines</button>
          {reviewControl(
            `lineup:${m.matchup_key ?? m.market_key}:${String(m.metadata.generated_at ?? m.id)}`,
            "keep_locked",
          )}
        </article>
      ))}
      {failures.map((e) => (
        <article className="admin-panel exception-panel" key={e.id}>
          <h2>
            {e.kind} · {e.recipient}
          </h2>
          <p>{e.last_error ?? "Delivery needs review."}</p>
          <span className="report-tag">{e.status}</span>
          <p>
            Failed deliveries follow the existing retry policy. Ambiguous
            deliveries require a provider check before retrying, to avoid
            duplicate emails.
          </p>
          {reviewControl(
            `delivery:${e.id}:${e.status}`,
            "acknowledge_delivery",
          )}
        </article>
      ))}
      {!gaps.length && !failures.length && (
        <p className="market-admin-notice success">
          No lineup or delivery exceptions found.
        </p>
      )}
      <details className="admin-panel">
        <summary>
          Ticket results & held replenishments · review evidence and resolve
        </summary>
        <WeeklySchedule
          leagueId={leagueId}
          onApplied={onApplied}
          exceptionsOnly
        />
      </details>
    </section>
  );
}
