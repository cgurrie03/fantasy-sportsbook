import { PolicyTransfer } from "./PolicyTransfer";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { errorMessage } from "../lib/accounts";
import {
  parseSportsbookPolicy,
  sportsbookDefaults,
} from "../../api/_lib/sportsbook-policy";
import type {
  SportsbookPolicy,
  SportsbookValues,
} from "../../api/_lib/sportsbook-policy";
type Review = {
  season: number;
  week: number;
  latest_revision: number;
  current: SportsbookPolicy;
  versions: {
    revision: number;
    nfl_season: number;
    market_week: number;
    reason: string;
  }[];
};
const labels: Record<keyof SportsbookValues, string> = {
  featured_boost_pct: "Featured profit boost percent",
  matchup_odds_step: "Matchup price rounding step",
  weekly_odds_step: "Weekly-special price rounding step",
  futures_odds_step: "Futures price rounding step",
  futures_max_odds: "Maximum absolute futures price",
  matchups_enabled: "Enable matchup markets",
  players_enabled: "Enable player markets",
  specials_enabled: "Enable weekly specials",
  futures_enabled: "Enable season futures",
};
export function SportsbookPolicyEditor({ leagueId }: { leagueId: string }) {
  const [review, setReview] = useState<Review | null>(null),
    [values, setValues] = useState<SportsbookValues>({ ...sportsbookDefaults }),
    [season, setSeason] = useState(""),
    [week, setWeek] = useState(""),
    [reason, setReason] = useState(""),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const alive = useRef(true);
  const load = useCallback(async () => {
    const r = await supabase!
      .rpc("sportsbook_policy_review", { p_league: leagueId })
      .abortSignal(AbortSignal.timeout(15000));
    if (r.error) throw r.error;
    const d = r.data as Review;
    parseSportsbookPolicy(d.current);
    if (!Array.isArray(d.versions) || d.versions.length > 64)
      throw Error("Policy review exceeds its budget.");
    return d;
  }, [leagueId]);
  useEffect(() => {
    alive.current = true;
    void load()
      .then((d) => {
        if (alive.current) {
          setReview(d);
          setValues({ ...d.current.values });
          setSeason(String(d.season));
          setWeek(String(d.week));
        }
      })
      .catch((e) => {
        if (alive.current) setNotice(errorMessage(e));
      });
    return () => {
      alive.current = false;
    };
  }, [load]);
  async function save() {
    if (!review || busy || !ack) return;
    setBusy(true);
    setNotice("");
    try {
      parseSportsbookPolicy({
        contract: "sportsbook-policy-v1",
        revision: 0,
        values,
      });
      const r = await supabase!
        .rpc("save_sportsbook_policy", {
          p_league: leagueId,
          p_expected: review.latest_revision,
          p_season: Number(season),
          p_week: Number(week),
          p_overrides: values,
          p_reason: reason.trim(),
        })
        .abortSignal(AbortSignal.timeout(15000));
      if (r.error) throw r.error;
      const d = await load();
      if (alive.current) {
        setReview(d);
        setAck(false);
        setReason("");
        setNotice(
          "Policy version saved. Existing accepted tickets and prices are unchanged.",
        );
      }
    } catch (e) {
      if (alive.current) setNotice(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <article
      className="admin-panel"
      aria-label="Shared sportsbook pricing policy"
    >
      <h2>Sportsbook Pricing &amp; Market Policy</h2>
      <p>
        Shared defaults with reviewed league overrides. Pause operations and
        automation first. Choose a period without published boards or accepted
        tickets; regenerate affected draft quotes before publication.
      </p>
      {review && (
        <p>
          Current revision {review.current.revision} · latest scheduled revision{" "}
          {review.latest_revision}
        </p>
      )}
      <PolicyTransfer
        name="Pricing"
        contract="sportsbook-policy-v1"
        values={values}
        defaults={sportsbookDefaults}
        validate={(v) =>
          parseSportsbookPolicy({
            contract: "sportsbook-policy-v1",
            revision: 0,
            values: v,
          }).values
        }
        onApply={(v) => {
          setValues(v);
          setAck(false);
        }}
      />
      <div className="settings-fields">
        {(Object.keys(labels) as (keyof SportsbookValues)[]).map((k) => (
          <label key={k}>
            {labels[k]}
            {typeof values[k] === "boolean" ? (
              <input
                type="checkbox"
                checked={Boolean(values[k])}
                disabled={!review || busy}
                onChange={(e) => {
                  setValues({ ...values, [k]: e.target.checked });
                  setAck(false);
                }}
              />
            ) : (
              <input
                type="number"
                value={Number(values[k])}
                disabled={!review || busy}
                onChange={(e) => {
                  setValues({ ...values, [k]: Number(e.target.value) });
                  setAck(false);
                }}
              />
            )}
          </label>
        ))}
        <label>
          Pricing effective NFL season
          <input
            type="number"
            value={season}
            onChange={(e) => {
              setSeason(e.target.value);
              setAck(false);
            }}
          />
        </label>
        <label>
          Pricing effective week
          <input
            type="number"
            min={1}
            max={18}
            value={week}
            onChange={(e) => {
              setWeek(e.target.value);
              setAck(false);
            }}
          />
        </label>
        <label>
          Pricing policy review reason
          <input
            maxLength={400}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      <p>
        Supported rounding: matchups/specials 10, 25 or 50; futures 25, 50 or
        100. Featured boost 0–50%; futures cap 1,000–10,000, divisible by its
        rounding step. Fixed spread/total/player prices retain their reviewed
        quotes.
      </p>
      {review && (
        <section aria-label="Pricing policy change review">
          <p>
            Applies to new quotes and wagers in NFL {season}, week {week}.
            Existing accepted terms remain fixed. Disabled families stop
            accepting new wagers; affected quotes need regeneration.
          </p>
          <table>
            <caption>Current and proposed pricing policy</caption>
            <thead>
              <tr>
                <th>Setting</th>
                <th>Current</th>
                <th>Proposed</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(labels) as (keyof SportsbookValues)[])
                .filter((k) => values[k] !== review.current.values[k])
                .map((k) => (
                  <tr key={k}>
                    <th>{labels[k]}</th>
                    <td>{String(review.current.values[k])}</td>
                    <td>{String(values[k])}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}
      <label>
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />
        I reviewed the effective period and enabled families. This does not
        approve provider compatibility or activate the league.
      </label>
      <button
        disabled={!review || busy || !ack || reason.trim().length < 8}
        onClick={() => void save()}
      >
        {busy ? "Saving policy…" : "Save sportsbook policy version"}
      </button>
      {notice && <p role="status">{notice}</p>}
      {review?.versions.length ? (
        <details>
          <summary>Scheduled pricing policy versions</summary>
          {review.versions.map((v) => (
            <p key={v.revision}>
              Revision {v.revision} · NFL {v.nfl_season}, week {v.market_week}:{" "}
              {v.reason}
            </p>
          ))}
        </details>
      ) : null}
    </article>
  );
}
