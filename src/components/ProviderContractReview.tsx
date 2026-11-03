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
  const [capability, setCapability] = useState<{
    review_hash: string;
    build_sha: string;
    revision: number;
    season: number;
    current_season: number;
    approval_current: boolean;
  } | null>(null);
  const [renewalId, setRenewalId] = useState("");
  const [reason, setReason] = useState(""),
    [ack, setAck] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function check(prepare = false) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    setReview(null);
    setCapability(null);
    setAck(false);
    try {
      const s = await supabase!.auth.getSession();
      if (!s.data.session) throw Error("Sign in as the platform owner.");
      const r = await fetch(
        "/api/provider-review?league_id=" +
          encodeURIComponent(leagueId) +
          (prepare ? "&prepare=1" : "") +
          (renewalId.trim()
            ? "&renewal_source=" + encodeURIComponent(renewalId.trim())
            : ""),
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
      if (prepare) {
        const c = await supabase!.rpc("provider_capability_review", {
          p_league: leagueId,
        });
        if (c.error) throw c.error;
        if (
          !/^[a-f0-9]{64}$/.test(c.data?.review_hash) ||
          !/^[a-f0-9]{40}$/.test(c.data?.build_sha) ||
          !Number.isInteger(c.data?.revision) ||
          !Number.isInteger(c.data?.season) ||
          !Number.isInteger(c.data?.current_season)
        )
          throw Error("Prepared capability review scope is invalid.");
        if (active.current) setCapability(c.data);
      }
      if (active.current) setReview(data);
    } catch (e) {
      if (active.current) setNotice(errorMessage(e));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function decide(renew = false) {
    if (!capability || !ack || busy || reason.trim().length < 8) return;
    setBusy(true);
    setNotice("");
    try {
      const r = renew
        ? await supabase!.rpc("renew_provider_season", {
            p_league: leagueId,
            p_hash: capability.review_hash,
            p_expected_season: capability.current_season,
            p_reason: reason.trim(),
          })
        : await supabase!.rpc("approve_provider_capability", {
            p_league: leagueId,
            p_hash: capability.review_hash,
            p_expected: capability.revision,
            p_build: capability.build_sha,
            p_reason: reason.trim(),
            p_coverage_reviewed: ack,
          });
      if (r.error) throw r.error;
      if (active.current) {
        setCapability(null);
        setAck(false);
        setReason("");
        setNotice(
          renew
            ? "Season renewed without funding or activation. Prepare a fresh capability review."
            : "Owner capability decision saved. No activation or funding was performed.",
        );
      }
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
      <label>
        Next-season Sleeper league ID (optional)
        <input
          inputMode="numeric"
          maxLength={32}
          value={renewalId}
          disabled={busy}
          onChange={(e) => {
            setRenewalId(e.target.value);
            setCapability(null);
            setAck(false);
          }}
        />
      </label>
      <p>
        For renewal, the provider must link the new league to this league
        through its previous-season ID. The immediately following season and
        unchanged roster field are required.
      </p>
      <button disabled={busy} onClick={() => void check()}>
        {busy ? "Checking provider rules…" : "Compare current provider rules"}
      </button>
      <button disabled={busy} onClick={() => void check(true)}>
        Prepare capability review
      </button>
      {capability && (
        <section aria-label="Prepared provider capability decision">
          <p>
            Build {capability.build_sha.slice(0, 7)} · decision revision{" "}
            {capability.revision}. Observations expire for approval after 15
            minutes. Only reviewed weekly profiles are supported for imported
            leagues; season futures must be disabled.
            Unknown/IDP/division/median/multiweek profiles remain blocked.
          </p>
          <label>
            Capability review reason
            <input
              value={reason}
              maxLength={400}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            I verified projection/result coverage, supported house rules, and
            the exact configuration. This is my review attestation, not
            automatic compatibility proof.
          </label>
          <button
            disabled={busy || !ack || reason.trim().length < 8}
            onClick={() =>
              void decide(capability.season !== capability.current_season)
            }
          >
            {capability.season !== capability.current_season
              ? "Renew next provider season"
              : "Record owner capability review"}
          </button>
          <p>
            Renewal requires paused operations, unchanged roster IDs, and no
            open tickets. It closes old boards and requires fresh review.
            Account approvals, wallets and funds are preserved.
          </p>
        </section>
      )}
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
