import { useState } from "react";
import type { Board, Market } from "../lib/markets";
import { combinedPrice, americanPrice, formatOdds } from "../lib/markets";
import { adjustedSpread, teaserEligibility } from "../lib/teaser-eligibility";
import { money } from "../lib/accounts";
import "./TeaserConversion.css";

export interface TeaserPreviewPrice {
  adjustment: number;
  decimal: number;
  odds: number;
}
export function TeaserConversion({
  picks,
  board,
  matchupCount,
  promotion,
  stake,
  active,
  onActive,
  previewPrices,
}: {
  picks: Market[];
  board: Board | null;
  matchupCount: number;
  promotion: boolean;
  stake: number;
  active: boolean;
  onActive: (active: boolean) => void;
  previewPrices?: TeaserPreviewPrice[];
}) {
  const [adjustment, setAdjustment] = useState(9);
  const reason = teaserEligibility(picks, board, matchupCount, promotion);
  if (reason && !active) return null;
  // Research quote fixtures are injected only by the local review entrypoint.
  const quote = !reason
    ? previewPrices?.find((p) => p.adjustment === adjustment)
    : undefined;
  const base = combinedPrice(picks);
  const spread = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
  return (
    <section className="teaser-conversion" aria-label="Spread teaser">
      {!active ? (
        <button
          type="button"
          className="secondary"
          onClick={() => onActive(true)}
        >
          Convert to Teaser
        </button>
      ) : (
        <>
          <div className="teaser-heading">
            <strong>Spread teaser preview</strong>
            <button
              type="button"
              className="secondary"
              onClick={() => onActive(false)}
            >
              Convert back to parlay
            </button>
          </div>
          <p>This week is for research. Teaser betting is unavailable.</p>
          <fieldset disabled={!!reason}>
            <legend>Move every spread in your favor</legend>
            <div className="teaser-adjustments">
              {[6, 9, 12].map((n) => (
                <button
                  type="button"
                  key={n}
                  aria-pressed={n === adjustment}
                  onClick={() => setAdjustment(n)}
                >
                  +{n} points
                </button>
              ))}
            </div>
          </fieldset>
          <small>
            Provisional choices; this week’s results may change the range.
          </small>
          {reason ? (
            <p role="status">{reason} Convert back to review your parlay.</p>
          ) : (
            <>
              <table>
                <caption>Original and adjusted spreads</caption>
                <thead>
                  <tr>
                    <th>Selection</th>
                    <th>Original</th>
                    <th>Teaser</th>
                  </tr>
                </thead>
                <tbody>
                  {picks.map((p) => (
                    <tr key={p.id}>
                      <th>{p.subject}</th>
                      <td>{spread(p.line!)}</td>
                      <td>{spread(adjustedSpread(p.line!, adjustment))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="teaser-comparison">
                <div>
                  <span>Original parlay</span>
                  <strong>{formatOdds(americanPrice(base))}</strong>
                  <small>Pays {money(stake * base)}</small>
                </div>
                <div>
                  <span>Teaser {quote ? "(fixture)" : ""}</span>
                  <strong>
                    {quote ? formatOdds(quote.odds) : "Price pending"}
                  </strong>
                  <small>
                    {quote
                      ? `Pays ${money(stake * quote.decimal)}`
                      : "Payout pending validation"}
                  </small>
                </div>
              </div>
              <p>
                Any loss loses the ticket. Pushes and voided legs are removed;
                one or more winning legs can cash at saved odds. No remaining
                legs: stake refunded.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
