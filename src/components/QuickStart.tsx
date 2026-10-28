import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import "./QuickStart.css";

const tour = [
  {
    title: "Your Sleeper league. A new way to compete.",
    illustrationLabel:
      "Illustration of a league matchup with team portraits, projected scores, and a Sleeper matchup shortcut.",
    art: (
      <div className="tour-matchup">
        <div className="tour-mini-tabs">
          <b>Matchups</b>
          <span>Player Points</span>
          <span>Futures</span>
        </div>
        <div className="tour-teams">
          <div>
            <span className="tour-avatar">Y</span>
            <strong>
              Your team<small>Projected: 145.5</small>
            </strong>
          </div>
          <span>vs.</span>
          <div>
            <span className="tour-avatar rival">R</span>
            <strong>
              Your rival<small>Projected: 142.0</small>
            </strong>
          </div>
        </div>
        <div className="tour-mini-link">Your weekly matchup ↗ Sleeper</div>
      </div>
    ),
    copy: (
      <>
        <p>
          These are your league’s real fantasy teams and matchups, with pretend
          money and league bragging rights on the line.
        </p>
        <ul>
          <li>
            <strong>Matchups</strong> has team spreads, totals, and winners.{" "}
            <strong>Player Points</strong> and <strong>Head to Head</strong>{" "}
            focus on individual players.
          </li>
          <li>
            Try <strong>Weekly Specials</strong> for league-wide outcomes or{" "}
            <strong>Season Futures</strong> for the long game.
          </li>
          <li>Tap the Sleeper icon on a matchup to open it in Sleeper.</li>
        </ul>
      </>
    ),
  },
  {
    title: "Tuesday refills keep you in the game.",
    illustrationLabel:
      "Replenishment examples: a 32 dollar balance becomes 100 dollars; a 145 dollar balance stays 145 dollars; 40 dollars in open futures leaves a 60 dollar cash floor.",
    art: (
      <div className="tour-refill">
        <div>
          <span>After results settle</span>
          <strong>Tuesday replenishment</strong>
        </div>
        <div>
          <span>Balance $32</span>
          <b>→ $100</b>
        </div>
        <div>
          <span>Balance $145</span>
          <b>→ $145</b>
        </div>
        <div>
          <span>$40 in open futures</span>
          <b>$60 cash floor</b>
        </div>
      </div>
    ),
    copy: (
      <>
        <p>
          After weekly results settle, eligible balances are topped up to a
          floor—your winnings above that floor carry forward.
        </p>
        <ul>
          <li>
            Normally, the floor is <strong>$100</strong>. This is a top-up, not
            an extra $100 each week.
          </li>
          <li>
            Open futures stakes count toward that $100. Your cash floor is{" "}
            <strong>$100 minus those stakes, with at least $25 in cash</strong>.
          </li>
          <li>
            Unresolved weekly tickets can hold your refill until their results
            are confirmed. Check <strong>Account → Balance History</strong> for
            the entry.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "Spotlight games come with extra upside.",
    illustrationLabel:
      "Game of the Week boosts both moneylines by 25 percent. Tank Bowl boosts both moneylines and the match total Over by 25 percent.",
    art: (
      <div className="tour-features">
        <div>
          <strong>★ Game of the Week</strong>
          <p>Contenders in the spotlight</p>
          <b>
            Win <span>+25% profit</span>
          </b>
        </div>
        <div>
          <strong>
            <svg
              width="18"
              height="14"
              viewBox="0 0 32 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 4h9v3h10v3H21l-2 3H8l3-3V6h1zM6 13h19l4 5-3 5H5l-4-5z" />
            </svg>{" "}
            Tank Bowl
          </strong>
          <p>A rivalry at the other end</p>
          <b>
            Win + Match Over <span>+25% profit</span>
          </b>
        </div>
      </div>
    ),
    copy: (
      <>
        <p>
          Look for the gold banner and outlined odds on featured matchup cards.
        </p>
        <ul>
          <li>
            <strong>Game of the Week:</strong> a marquee matchup, usually
            between contenders. Either team’s moneyline gets a{" "}
            <strong>25% profit boost</strong>.
          </li>
          <li>
            <strong>Tank Bowl:</strong> a matchup near the bottom of the
            standings. Both moneylines and the <strong>match total Over</strong>{" "}
            get a <strong>25% profit boost</strong>.
          </li>
          <li>
            The highlighted odds already include the bonus. A $20 winning profit
            becomes $25; your returned wager stays the same. Featured games are
            chosen for the board, so a Tank Bowl may not appear every week.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "Tap your picks. Check your slip. Make it official.",
    illustrationLabel:
      "Illustrative bet slip with two selected picks, a 10 dollar wager, and a Place Bet confirmation button.",
    art: (
      <div className="tour-slip">
        <strong>
          Your bet slip <span>2 picks</span>
        </strong>
        <div>
          Your team +3.5 <b>−110</b>
        </div>
        <div>
          Rival team Under 145.5 <b>−110</b>
        </div>
        <footer>
          <span>
            Wager <b>$10</b>
          </span>
          <b className="tour-confirm">Place Bet</b>
        </footer>
      </div>
    ),
    copy: (
      <>
        <p>
          Tap an odds button to select a pick, then open your bet slip. Enter a
          wager from your available balance and review the final terms.
        </p>
        <ul>
          <li>
            Most weekly tickets need <strong>2 or more picks</strong>. Some
            specials can be singles; the slip explains what’s eligible.
          </li>
          <li>
            <strong>Spread</strong> adds or subtracts fantasy points.{" "}
            <strong>Over/Under</strong> compares a score to the listed line.{" "}
            <strong>Moneyline</strong> picks the winner.
          </li>
          <li>
            Confirm with <strong>Place Bet</strong>. A $10 bet at +150 returns
            $25 if it wins: your $10 wager plus $15 profit. If prices change
            first, review the updated slip.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "Follow the week, then see who’s ahead.",
    illustrationLabel:
      "A weekly timeline showing score updates every 15 minutes during games, two-hour updates otherwise, then confirmed results and Tuesday replenishment.",
    art: (
      <div className="tour-week">
        <div>
          <span>During games</span>
          <strong>15 min</strong>
          <small>Score refresh</small>
        </div>
        <div>
          <span>Otherwise</span>
          <strong>2 hours</strong>
          <small>Score refresh</small>
        </div>
        <div>
          <span>After final results</span>
          <strong>Tuesday</strong>
          <small>Settle & replenish</small>
        </div>
      </div>
    ),
    copy: (
      <>
        <p>
          <strong>My Bets</strong> is your ticket tracker.{" "}
          <strong>All Bets</strong> shows the league’s picks, and the{" "}
          <strong>Leaderboard</strong> shows how everyone stacks up.
        </p>
        <ul>
          <li>
            Scores refresh every{" "}
            <strong>15 minutes while NFL games are in progress</strong>, and
            every <strong>2 hours otherwise</strong>. Pregame lines refresh on a
            two-hour schedule.
          </li>
          <li>
            Live scores are provisional. Confirmed results settle tickets and
            update your balance.
          </li>
          <li>
            Betting follows the published board’s opening and cutoff. An
            updating score does not mean live bets are available—check the
            board’s open/closed status and available odds.
          </li>
        </ul>
      </>
    ),
  },
];

export function QuickStart({
  userId,
  eligible,
  seen,
}: {
  userId?: string;
  eligible: boolean;
  seen: boolean;
}) {
  const [slide, setSlide] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const offered = useRef(false);
  const storageKey = userId ? `sportsbook-quick-start-v1:${userId}` : null;

  useEffect(() => {
    dialog.current?.scrollTo({ top: 0 });
  }, [slide]);

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
        onClick={() => {
          setSlide(0);
          dialog.current?.showModal();
        }}
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
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            setSlide((current) =>
              Math.max(
                0,
                Math.min(
                  tour.length - 1,
                  current + (event.key === "ArrowRight" ? 1 : -1),
                ),
              ),
            );
          }
          if (event.key !== "Tab") return;
          const controls = event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not(:disabled)",
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
          <h2 id="quick-start-title">Welcome to your league sportsbook</h2>
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
          A quick tour of what makes this league’s sportsbook yours.
        </p>
        <section
          className="tour-page"
          aria-roledescription="slide"
          aria-label={`${slide + 1} of ${tour.length}`}
          aria-live="polite"
          aria-atomic="true"
        >
          <div
            className={`tour-art tour-art-${slide}`}
            role="img"
            aria-label={tour[slide].illustrationLabel}
          >
            {tour[slide].art}
          </div>
          <div className="tour-copy">
            <h3>{tour[slide].title}</h3>
            {tour[slide].copy}
          </div>
        </section>
        <nav className="tour-dots" aria-label="Tour pages">
          {tour.map((page, index) => (
            <button
              key={page.title}
              type="button"
              aria-label={`Page ${index + 1}: ${page.title}`}
              aria-current={slide === index ? "step" : undefined}
              onClick={() => setSlide(index)}
            >
              <span />
            </button>
          ))}
        </nav>
        <footer className="quick-start-footer">
          <button
            className="secondary"
            type="button"
            disabled={slide === 0}
            onClick={() => setSlide(slide - 1)}
          >
            Back
          </button>
          <span>
            {slide + 1} of {tour.length} · Reopen with ?
          </span>
          <button
            className="primary"
            type="button"
            onClick={() =>
              slide === tour.length - 1
                ? dialog.current?.close()
                : setSlide(slide + 1)
            }
          >
            {slide === tour.length - 1 ? "Got it" : "Next"}
          </button>
        </footer>
      </dialog>
    </>
  );
}
