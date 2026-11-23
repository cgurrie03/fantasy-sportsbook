import { LegState } from "./LegState";
import { useState } from "react";
import { Icon } from "./ui";
const steps = [
  "Getting Started",
  "Markets",
  "Tickets",
  "Projections",
  "Offers",
  "Preferences",
];
export function Guide({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  return (
    <div className="walkthrough">
      <nav aria-label="Guide Sections">
        {steps.map((s, i) => (
          <button
            key={s}
            aria-current={step === i ? "step" : undefined}
            onClick={() => setStep(i)}
          >
            {s}
          </button>
        ))}
      </nav>
      <section className="guide-content">
        <h3>{steps[step]}</h3>
        {step === 0 ? (
          <>
            <p>Open the Weekly Slate and tap a price to add a pick. Open the Bet Slip to review the odds and enter your stake. Find the accepted ticket in My Bets.</p>
            <ol className="guide-steps" aria-label="Place a bet in three steps">
              <li><Icon name="ball" size={23} /> Pick a market</li>
              <li><Icon name="ticket" size={23} /> Review your slip</li>
              <li><Icon name="check" size={23} /> Confirm the ticket</li>
            </ol>
            <p>Boff uses virtual credits and your Sleeper league’s results. Tap the header balance to check your next credit claim and see your open stakes.</p>
          </>
        ) : step === 1 ? (
          <>
            <dl className="guide-market-list">
              <div><dt>Moneyline</dt><dd>Pick the matchup winner.</dd></div>
              <div><dt>Spread</dt><dd>Pick a team to cover its handicap.</dd></div>
              <div><dt>Total</dt><dd>Pick Over or Under the combined score.</dd></div>
              <div><dt>Team total</dt><dd>Pick Over or Under one team’s score.</dd></div>
            </dl>
            <p>Open a matchup to find Alternate Lines. You can browse player markets on the Weekly Slate and see which selections are available.</p>
          </>
        ) : step === 2 ? (
          <>
            <div className="result-legend">
              {["Won", "Lost", "Open", "Push"].map((status) => (
                <span key={status}>
                  <LegState status={status} small />
                  {status}
                </span>
              ))}
            </div>
            <p>
              Start with a single selection or combine compatible picks in a
              parlay. Selections from the same fantasy matchup are grouped
              together in your slip.
            </p>
            <p>
              Potential return includes your stake. Review any changed terms
              before accepting a ticket. Opposing outcomes and overlapping
              spread/moneyline picks cannot be combined.
            </p>
            <p>
              Tap a parlay to see each leg and its result. Use Text, Copy, or More to share a ticket with league members.
            </p>
          </>
        ) : step === 3 ? (
          <>
            <h4>Before Games</h4>
            <p>
              Use the strongest eligible lineup from each team’s roster, rather
              than relying on a temporarily incomplete starting lineup.
            </p>
            <h4>During Games</h4>
            <p>
              Use actual started slots and points already scored, plus projected
              remaining production from the best eligible unlocked lineup.
            </p>
            <h4>Unfillable Slots</h4>
            <p>
              Average the weekly projections of the top three eligible available
              free agents for that slot. This assumes a pickup and affects the
              forecast only; actual Sleeper results determine settlement.
            </p>
            <p>
              Beat-projection markets use the fixed opening target. Later line
              refreshes do not move that accepted target.
            </p>
          </>
        ) : step === 4 ? (
          <>
            <p>
              Featured boosts follow their matchup category. Tank Bowl boosts only the main match-total Over. Original prices are crossed
              out; preset offers use their own boost without stacking these
              increases.
            </p>
            <p>
              Each parlay shows its full selections, original combined price,
              boosted price and specific closing time. Cutoffs use the first
              applicable included kickoff.
            </p>
            <p>
              Claiming a boost adds it to your available offers. Use Go To
              Player H2H to build an eligible ticket. Claimed and used are
              separate states.
            </p>
            <p>
              An accepted profit boost remains after a pushed leg. All-push
              tickets return the stake.
            </p>
          </>
        ) : (
          <>
            <p>
              Your profile controls theme, odds format, default stake, starting
              page and player-filter defaults.
            </p>
            <p>
              Optional communication categories, delivery, frequency and quiet
              hours can be adjusted by league. Essential account and transaction
              messages remain separate.
            </p>
            <p>
              Preference changes in this preview are stored in this browser
              only.
            </p>
          </>
        )}
      </section>
      <div className="guide-navigation">
        {step > 0 ? (
          <button
            className="button secondary"
            onClick={() => setStep((s) => s - 1)}
          >
            <Icon name="back" size={15} />
            Previous
          </button>
        ) : (
          <span aria-hidden="true" />
        )}
        <span>
          {step + 1} / {steps.length}
        </span>
        <button
          className="button primary"
          onClick={() =>
            step === steps.length - 1 ? onComplete() : setStep((s) => s + 1)
          }
        >
          {step === steps.length - 1 ? "Let's Go!" : "Next"}
          <Icon name="arrow" size={15} />
        </button>
      </div>
    </div>
  );
}
