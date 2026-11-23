import { LegState } from "./LegState";
import { PickProgress } from "./TicketProgress";
import { PickLabel } from "./PickLabel";
import { Icon } from "./ui";
import { groupPicks, price } from "./model";
import type { Pick } from "./model";
export function GroupedPicks({
  picks,
  onRemove,
  compact = false,
}: {
  picks: Pick[];
  compact?: boolean;
  onRemove?: (p: Pick) => void;
}) {
  return (
    <div
      className={
        "grouped-picks " +
        (compact ? "compact-picks " : "") +
        (onRemove ? "draft-picks" : "") +
        (!onRemove && picks.length === 1 ? " single-grouped-pick" : "")
      }
    >
      {groupPicks(picks).map((group) => (
        <section className="slip-game" key={group.id}>
          <h3>{group.label}</h3>
          {group.picks.map((p) => (
            <div
              className={
                "slip-selection " +
                (p.result ? "result-" + p.result.status.toLowerCase() : "")
              }
              key={p.id}
            >
              {!onRemove && picks.length === 1 ? null : onRemove ||
                !p.result ? (
                <span className="selection-tick">
                  <Icon name="check" size={13} />
                </span>
              ) : (
                <LegState status={p.result?.status || "Open"} />
              )}
              <div>
                <strong>
                  <PickLabel pick={p} />
                </strong>
                <small>{p.detail}</small>
                <span className="selection-price">
                  {p.originalOdds != null && (
                    <del className="original-price">
                      {price(p.originalOdds)}
                    </del>
                  )}{" "}
                  {price(p.odds)}
                </span>
                {p.result?.summary &&
                  !(
                    p.result.status === "Open" &&
                    p.result.summary === "Awaiting Final Confirmation"
                  ) && <p className="leg-result">{p.result.summary}</p>}
                {!onRemove && p.result && <PickProgress pick={p} />}
              </div>
              {onRemove && (
                <button
                  className="icon-button"
                  aria-label={"Remove " + p.label}
                  onClick={() => onRemove(p)}
                >
                  <Icon name="close" size={15} />
                </button>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
