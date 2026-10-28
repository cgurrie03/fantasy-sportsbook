import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import "./QuickStart.css";

export function QuickStart({
  userId,
  eligible,
  seen,
}: {
  userId?: string;
  eligible: boolean;
  seen: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const offered = useRef(false);
  const storageKey = userId ? `sportsbook-quick-start-v1:${userId}` : null;

  useEffect(() => {
    if (!eligible || seen || offered.current) return;
    try {
      if (storageKey && localStorage.getItem(storageKey) === "seen") return;
    } catch {
      // Account preferences still work when browser storage is unavailable.
    }
    offered.current = true;
    dialog.current?.showModal();
  }, [eligible, seen, storageKey]);

  function dismiss() {
    trigger.current?.focus({ preventScroll: true });
    if (!eligible || !storageKey) return;
    try {
      localStorage.setItem(storageKey, "seen");
    } catch {
      // Persist to the signed-in account below.
    }
    if (!seen)
      void supabase?.auth
        .updateUser({ data: { sportsbook_quick_start_v1: true } })
        .catch(() => {
          // The local preference prevents repeats if the account update fails.
        });
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="quick-start-trigger"
        aria-label="Open sportsbook quick start"
        title="Sportsbook quick start"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        ?
      </button>
      <dialog
        ref={dialog}
        className="quick-start"
        aria-labelledby="quick-start-title"
        aria-describedby="quick-start-intro"
        onClose={dismiss}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls =
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button, summary",
            );
          const first = controls[0],
            last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            event.currentTarget.close();
        }}
      >
        <header className="quick-start-heading">
          <h2 id="quick-start-title">Your sportsbook, in a minute.</h2>
          <button
            type="button"
            className="quick-start-close"
            aria-label="Close quick start"
            autoFocus
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </header>
        <p id="quick-start-intro">
          Fantasy football. League bragging rights. Pretend money.
        </p>
        <ol className="quick-start-steps">
          <li>
            <div>
              <h3>Find your picks</h3>
              <p>
                Browse Matchups, Player Points, Head to Head, Weekly Specials,
                or Season Futures. Tap the odds to add a pick.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h3>Build your ticket</h3>
              <p>
                Open the bet slip, enter a wager from your balance, and check
                your picks and payout. Most weekly bets need 2+ picks; eligible
                specials can stand alone. The slip tells you what’s needed.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h3>Place it, then follow along</h3>
              <p>
                Confirm with Place Bet. Track your tickets in{" "}
                <strong>My Bets</strong>, see everyone’s picks in{" "}
                <strong>All Bets</strong>, and check the{" "}
                <strong>Leaderboard</strong> for standings.
              </p>
            </div>
          </li>
        </ol>
        <div className="quick-start-payout">
          <strong>Payout includes your wager.</strong>
          <p>A $10 bet at +150 wins $15 profit and returns $25 total.</p>
        </div>
        <details className="quick-start-details">
          <summary>A few terms worth knowing</summary>
          <dl>
            <div>
              <dt>Spread</dt>
              <dd>
                A points head start. A −3.5 pick needs to win by more than 3.5;
                +3.5 adds 3.5 to that team’s score.
              </dd>
            </div>
            <div>
              <dt>Total / player points</dt>
              <dd>
                Pick over or under the listed fantasy-point line. Match totals
                combine both teams’ scores.
              </dd>
            </div>
            <div>
              <dt>Moneyline / head to head</dt>
              <dd>
                Pick the team to win, or the player to outscore their opponent.
              </dd>
            </div>
            <div>
              <dt>Parlay</dt>
              <dd>
                Multiple picks on one ticket. All remaining picks must win; a
                push or void can change the payout.
              </dd>
            </div>
            <div>
              <dt>Odds & boosts</dt>
              <dd>
                +150 wins $150 profit per $100 wagered; −110 needs $110 to win
                $100. Profit boosts increase winnings, not the returned wager.
              </dd>
            </div>
          </dl>
        </details>
        <p className="quick-start-note">
          Prices can change before you confirm. Review any updated lines in the
          slip. Live scores are provisional until results settle.
        </p>
        <footer className="quick-start-footer">
          <span>Reopen this anytime with the ? button.</span>
          <button
            type="button"
            className="primary"
            onClick={() => dialog.current?.close()}
          >
            Got it
          </button>
        </footer>
      </dialog>
    </>
  );
}
