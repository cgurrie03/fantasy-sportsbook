import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Market } from "../lib/markets";
import { MarketTitle } from "./MarketTitle";

export function WeeklyCountPicker({
  markets,
  renderQuote,
  projection = false,
}: {
  markets: Market[];
  renderQuote: (market: Market) => ReactNode;
  projection?: boolean;
}) {
  const options = [...markets].sort((a, b) => Number(a.line) - Number(b.line));
  const preferred = [...options].sort(
    (a, b) =>
      Math.abs(a.odds + 110) - Math.abs(b.odds + 110) ||
      Number(a.line) - Number(b.line),
  )[0];
  const [selected, setSelected] = useState<string | null>(null);
  const wheel = useRef<HTMLDivElement>(null);
  const current = options.find((m) => m.id === selected) ?? preferred;
  useEffect(() => {
    const node = wheel.current;
    const option = node?.querySelector<HTMLElement>(
      `[data-id="${preferred?.id}"]`,
    );
    if (node && option)
      node.scrollLeft =
        option.offsetLeft - (node.clientWidth - option.clientWidth) / 2;
    setSelected(preferred?.id ?? null);
  }, [preferred?.id]);
  useEffect(() => {
    const node = wheel.current;
    if (!node) return;
    const scroll = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        node.scrollLeft += event.deltaY;
      }
    };
    node.addEventListener("wheel", scroll, { passive: false });
    return () => node.removeEventListener("wheel", scroll);
  }, [Boolean(current)]);
  return (
    <article className="prop-card count-special">
      <MarketTitle eligibility="Singles or parlays">
        {projection
          ? "How Many Teams Will Beat Their Projection?"
          : "How Many Teams Will Score 150+?"}
      </MarketTitle>
      <p>
        {projection
          ? "Choose the exact count. Teams must exceed the published projections saved with your ticket. A tied projection does not count."
          : "Choose the exact count. Each qualifying team must score at least 150 points."}
      </p>
      {!current ? (
        <p>These markets are coming soon.</p>
      ) : (
        <>
          <div
            className="count-wheel"
            ref={wheel}
            role="group"
            aria-label={
              projection
                ? "Number of teams beating projection"
                : "Number of teams scoring 150 or more"
            }
            onScroll={(e) => {
              const node = e.currentTarget,
                center = node.scrollLeft + node.clientWidth / 2;
              const closest = Array.from(
                node.children,
              ).reduce<HTMLElement | null>((best, child) => {
                const item = child as HTMLElement;
                return !best ||
                  Math.abs(item.offsetLeft + item.clientWidth / 2 - center) <
                    Math.abs(best.offsetLeft + best.clientWidth / 2 - center)
                  ? item
                  : best;
              }, null);
              if (closest?.dataset.id) setSelected(closest.dataset.id);
            }}
          >
            {options.map((m) => (
              <button
                type="button"
                key={m.id}
                data-id={m.id}
                aria-pressed={current.id === m.id}
                aria-label={`${m.line} teams`}
                onClick={(e) => {
                  setSelected(m.id);
                  const node = wheel.current;
                  if (node)
                    node.scrollTo({
                      left:
                        e.currentTarget.offsetLeft -
                        (node.clientWidth - e.currentTarget.clientWidth) / 2,
                      behavior: "smooth",
                    });
                }}
              >
                {m.line}
              </button>
            ))}
          </div>
          <small className="count-instruction">
            Swipe or scroll to choose · Exact count
          </small>
          <div className="count-selection">{renderQuote(current)}</div>
        </>
      )}
    </article>
  );
}
