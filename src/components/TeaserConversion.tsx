import { useEffect, useRef, useState } from "react";
import { formatOdds } from "../lib/markets";
import "./TeaserConversion.css";
export interface TeaserPreviewPrice {
  adjustment: number;
  decimal: number;
  odds: number;
}
export function TeaserConversion({
  active,
  onActive,
  adjustment,
  onAdjustment,
  reason,
  prices,
  odds,
}: {
  active: boolean;
  onActive: (active: boolean) => void;
  adjustment: number;
  onAdjustment: (value: number) => void;
  reason: string;
  prices?: TeaserPreviewPrice[];
  odds: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const picker = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (expanded && active && !reason) picker.current?.showModal();
    else picker.current?.close();
  }, [expanded, active, reason]);
  if (reason && !active) return null;
  return (
    <section className="teaser-conversion" aria-label="Ticket type">
      <div
        className="slip-tabs"
        role="tablist"
        aria-label="Ticket type"
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            return;
          e.preventDefault();
          const next =
            e.key === "Home" ? false : e.key === "End" ? true : !active;
          onActive(next);
          setExpanded(false);
          e.currentTarget
            .querySelectorAll<HTMLButtonElement>("button")
            [next ? 1 : 0]?.focus();
        }}
      >
        <button
          role="tab"
          id="parlay-tab"
          aria-controls="slip-picks"
          tabIndex={active ? -1 : 0}
          aria-selected={!active}
          onClick={() => {
            onActive(false);
            setExpanded(false);
          }}
        >
          Parlay
        </button>
        <button
          role="tab"
          id="teaser-tab"
          aria-controls="slip-picks"
          tabIndex={active ? 0 : -1}
          aria-selected={active}
          onClick={() => onActive(true)}
        >
          Teaser
        </button>
      </div>
      <div className="ticket-price-row">
        {active ? (
          <button
            className="teaser-picker-toggle"
            aria-expanded={expanded}
            aria-controls="teaser-point-choices"
            disabled={!!reason}
            onClick={() => setExpanded(!expanded)}
          >
            {adjustment}-Point Teaser{" "}
            <span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span>
          </button>
        ) : (
          <strong>{"Parlay"}</strong>
        )}
        <strong className="ticket-total-odds" aria-label="Total odds">
          {odds}
        </strong>
      </div>
      <dialog
        ref={picker}
        id="teaser-point-choices"
        className="teaser-point-choices"
        aria-label="Choose your point adjustment"
        onCancel={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setExpanded(false);
        }}
        onClose={(e) => e.stopPropagation()}
      >
        <fieldset>
          <legend>Choose your point adjustment</legend>
          {[6, 9, 12].map((n) => (
            <label key={n}>
              <input
                type="radio"
                name="teaser-adjustment"
                checked={adjustment === n}
                onChange={() => onAdjustment(n)}
              />
              <span>{n}-Point Teaser</span>
              <strong>
                {prices?.find((p) => p.adjustment === n)
                  ? formatOdds(prices.find((p) => p.adjustment === n)!.odds)
                  : "Pending"}
              </strong>
            </label>
          ))}
        </fieldset>
        <button
          className="teaser-picker-done"
          onClick={() => setExpanded(false)}
        >
          Done
        </button>
      </dialog>
      {active && (
        <p className="teaser-research-note" role="status">
          {reason || "Research preview · Betting unavailable"}
        </p>
      )}
    </section>
  );
}
