import { PolicyTransfer } from "./PolicyTransfer";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { errorMessage, money } from "../lib/accounts";
import {
  parseWalletPolicy,
  walletPolicyDefaults,
} from "../../api/_lib/wallet-policy";
import type {
  WalletPolicy,
  WalletPolicyValues,
} from "../../api/_lib/wallet-policy";
type Review = {
  season: number;
  week: number;
  latest_revision: number;
  current: WalletPolicy;
  versions: {
    revision: number;
    nfl_season: number;
    market_week: number;
    overrides: Partial<WalletPolicyValues>;
    reason: string;
  }[];
};
const labels: Record<keyof WalletPolicyValues, string> = {
  minimum_stake: "Minimum wager",
  maximum_picks: "Maximum picks",
  weekly_target: "Weekly cash target",
  futures_cash_floor: "Futures cash floor",
};
export function WalletPolicyEditor({
  leagueId,
  onChanged,
}: {
  leagueId: string;
  onChanged?: () => Promise<void>;
}) {
  const [review, setReview] = useState<Review | null>(null),
    [values, setValues] = useState<WalletPolicyValues>({
      ...walletPolicyDefaults,
    }),
    [season, setSeason] = useState(""),
    [week, setWeek] = useState(""),
    [reason, setReason] = useState(""),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const r = await supabase!
        .rpc("wallet_policy_review", { p_league: leagueId })
        .abortSignal(signal ?? AbortSignal.timeout(15000));
      if (r.error) throw r.error;
      const d = r.data as Review;
      parseWalletPolicy(d.current);
      if (
        !Array.isArray(d.versions) ||
        d.versions.length > 64 ||
        new TextEncoder().encode(JSON.stringify(d)).length > 128000
      )
        throw Error("Policy review exceeds its budget.");
      return d;
    },
    [leagueId],
  );
  useEffect(() => {
    const c = new AbortController();
    void load(AbortSignal.any([c.signal, AbortSignal.timeout(15000)]))
      .then((d) => {
        if (!c.signal.aborted) {
          setReview(d);
          setValues({ ...d.current.values });
          setSeason(String(d.season));
          setWeek(String(d.week));
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setNotice(errorMessage(e));
      });
    return () => c.abort();
  }, [load]);
  async function save() {
    if (busy || !review || !ack) return;
    setBusy(true);
    setNotice("");
    try {
      parseWalletPolicy({ ...review.current, values });
      const overrides = Object.fromEntries(
        Object.entries(values).filter(
          ([k, v]) => v !== walletPolicyDefaults[k as keyof WalletPolicyValues],
        ),
      );
      const r = await supabase!.rpc("save_wallet_policy", {
        p_league: leagueId,
        p_expected: review.latest_revision,
        p_season: Number(season),
        p_week: Number(week),
        p_overrides: overrides,
        p_reason: reason.trim(),
      });
      if (r.error) throw r.error;
      setReview(await load());
      setAck(false);
      setReason("");
      setNotice(
        "Policy version saved. Effective-period rules apply to new wagers and replenishment; accepted ticket terms remain fixed.",
      );
      await onChanged?.();
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="admin-panel">
      <h2>Wallet and wager policy</h2>
      <p>
        Shared defaults apply unless reviewed league overrides replace them.
        Pause operations and automation before saving. Opening funds still
        require a separate owner decision.
      </p>
      {!review && <p role="status">Loading policy review…</p>}
      {review && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p>
            Current version: {review.current.revision} · Latest scheduled
            revision: {review.latest_revision}
          </p>
          {(Object.keys(labels) as (keyof WalletPolicyValues)[]).map((k) => (
            <label key={k}>
              {labels[k]}
              <input
                aria-label={labels[k]}
                type="number"
                step={k === "maximum_picks" ? 1 : 0.01}
                min={
                  k === "futures_cash_floor" ? 0 : k === "maximum_picks" ? 2 : 1
                }
                max={k === "maximum_picks" ? 10 : 10000}
                required
                disabled={busy}
                value={values[k]}
                onChange={(e) => {
                  setValues({ ...values, [k]: Number(e.target.value) });
                  setAck(false);
                }}
              />
              <small>
                Current{" "}
                {k === "maximum_picks"
                  ? review.current.values[k]
                  : money(review.current.values[k])}{" "}
                → Proposed{" "}
                {k === "maximum_picks" ? values[k] : money(values[k])}
              </small>
            </label>
          ))}
          <label>
            Policy effective NFL season
            <input
              aria-label="Policy effective NFL season"
              type="number"
              required
              min={review.season}
              max={review.season + 1}
              value={season}
              disabled={busy}
              onChange={(e) => {
                setSeason(e.target.value);
                setAck(false);
              }}
            />
          </label>
          <label>
            Policy effective week
            <input
              aria-label="Policy effective week"
              type="number"
              required
              min="1"
              max="18"
              value={week}
              disabled={busy}
              onChange={(e) => {
                setWeek(e.target.value);
                setAck(false);
              }}
            />
          </label>
          <label>
            Policy review reason
            <textarea
              aria-label="Policy review reason"
              required
              minLength={8}
              maxLength={400}
              value={reason}
              disabled={busy}
              onChange={(e) => {
                setReason(e.target.value);
                setAck(false);
              }}
            />
          </label>
          <label>
            <input
              aria-label="Acknowledge policy impact"
              type="checkbox"
              checked={ack}
              disabled={busy}
              onChange={(e) => setAck(e.target.checked)}
            />
            I reviewed the before/after values and effective period. Accepted
            terms and existing balances will be retained; the new floor affects
            later eligible replenishment.
          </label>
          <button
            className="primary"
            disabled={busy || !ack || reason.trim().length < 8}
          >
            Save effective policy version
          </button>
          <PolicyTransfer
            name="Wallet"
            contract="wallet-ticket-policy-v1"
            values={values}
            defaults={walletPolicyDefaults}
            validate={(v) =>
              parseWalletPolicy({ ...review.current, values: v }).values
            }
            onApply={(v) => {
              setValues(v);
              setAck(false);
            }}
          />
          <h3>Version history</h3>
          {review.versions.map((v) => (
            <p key={v.revision}>
              Version {v.revision} · NFL {v.nfl_season}, week {v.market_week} ·{" "}
              {v.reason}
            </p>
          ))}
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
    </article>
  );
}
