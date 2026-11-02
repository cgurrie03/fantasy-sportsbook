import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { errorMessage } from "../lib/accounts";
import type { ProviderDriftReview } from "../../api/_lib/league-intake";
type Review = ProviderDriftReview & {
  league_id: string;
  checked_at: string;
  note: string;
};
export function ProviderContractReview({ leagueId }: { leagueId: string }) {
  const [review, setReview] = useState<Review | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function check() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    setReview(null);
    try {
      const s = await supabase!.auth.getSession();
      if (!s.data.session) throw Error("Sign in as the platform owner.");
      const r = await fetch(
        "/api/provider-review?league_id=" + encodeURIComponent(leagueId),
        {
          method: "POST",
          headers: { Authorization: "Bearer " + s.data.session.access_token },
          signal: AbortSignal.timeout(30000),
        },
      );
      const data = await r.json();
      if (!r.ok) throw Error(data.error ?? "Provider review unavailable.");
      if (
        data.contract !== "provider-drift-review-v1" ||
        data.league_id !== leagueId ||
        data.approval !== "still_required" ||
        !Array.isArray(data.changes) ||
        data.changes.length > 7 ||
        data.changes.some(
          (c: any) =>
            typeof c.section !== "string" ||
            !Number.isInteger(c.count) ||
            c.count < 1 ||
            !Array.isArray(c.keys) ||
            c.keys.length > 32 ||
            c.keys.some((k: unknown) => typeof k !== "string"),
        ) ||
        !Number.isInteger(data.baseline_season) ||
        !Number.isInteger(data.observed_season) ||
        !Number.isFinite(Date.parse(data.checked_at)) ||
        typeof data.note !== "string" ||
        !["unchanged", "rules_changed", "renewal_required"].includes(data.state)
      )
        throw Error("Provider review scope is invalid.");
      if (active.current) setReview(data);
    } catch (e) {
      if (active.current) setNotice(errorMessage(e));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <article className="admin-panel" aria-label="Provider rule comparison">
      <h2>Provider Rule Comparison</h2>
      <p>
        Compare fresh Sleeper rules with this league's retained import baseline.
        No settings, team mappings, approvals or activation are changed.
      </p>
      <button disabled={busy} onClick={() => void check()}>
        {busy ? "Checking provider rules…" : "Compare current provider rules"}
      </button>
      {notice && <p role="alert">{notice}</p>}
      {review && (
        <div role="status">
          <h3>
            {review.state === "renewal_required"
              ? "Season renewal review required"
              : review.state === "rules_changed"
                ? "Provider changes require review"
                : "No compared rule changes found"}
          </h3>
          <p>
            Imported NFL season {review.baseline_season} · observed NFL season{" "}
            {review.observed_season}
          </p>
          <p>
            Checked {new Date(review.checked_at).toLocaleString()} · this is a
            point-in-time comparison.
          </p>
          {review.changes.map((c) => (
            <p key={c.section}>
              <strong>{c.section.replaceAll("_", " ")}</strong>: {c.count}{" "}
              changed field{c.count === 1 ? "" : "s"} ({c.keys.join(", ")}
              {c.count > c.keys.length ? ", additional fields omitted" : ""})
            </p>
          ))}
          <p>{review.note}</p>
          <p>
            <strong>
              Approval is still required, including when no changes are found.
            </strong>{" "}
            This comparison does not prove projection coverage, supported market
            behavior, or ownership of a sportsbook account.
          </p>
        </div>
      )}
    </article>
  );
}
