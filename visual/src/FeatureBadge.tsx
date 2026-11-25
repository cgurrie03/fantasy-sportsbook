import { featureCatalog } from "./featuredOptions";
import type { FeatureKind } from "./featuredOptions";
import { Icon, InfoPopover } from "./ui";
import { live } from "./live";
import { league } from "./model";
import type { Matchup } from "./model";
import type { Assignment } from "./featuredRules";
import history from "./season-context.json";

function FeatureExplanation({ matchup, assignment }: { matchup: Matchup; assignment: Assignment }) {
  const { kind, boost, source, targets } = assignment;
  const opponents = [matchup.away, matchup.home];
  const recipients = opponents.filter(team => targets.includes(team.id)).map(team => team.name.trim());
  const rows: { week: number; roster: number; opponent: number; points: number; against: number }[] =
    (live() ? live().matchupHistory ?? live().spreadHistory ?? [] : history.rows).filter((row: { week: number }) => row.week < league.week);
  const prior = rows.filter(row => row.roster === matchup.away.roster_id && row.opponent === matchup.home.roster_id).sort((a,b) => b.week-a.week)[0];
  const benefit = kind === "tank" ? "the match-total Over" : recipients.length ? `${recipients.join(" and ")}'s moneyline${recipients.length > 1 ? "s" : ""}` : featureCatalog[kind].market;
  const facts: string[] = [];
  if (kind === "revenge" && prior) {
    const awayWon = prior.points > prior.against;
    facts.push(`In Wk. ${prior.week}, ${awayWon ? matchup.away.name : matchup.home.name} beat ${awayWon ? matchup.home.name : matchup.away.name} ${Math.max(prior.points,prior.against).toFixed(2)}–${Math.min(prior.points,prior.against).toFixed(2)}. The loss was by ${Math.abs(prior.points-prior.against).toFixed(2)} points.`);
  }
  if (kind === "revenge" && !prior) facts.push("The earlier meeting's final score is not available in the loaded league history.");
  if (kind === "streak") for (const team of opponents) {
    const games = rows.filter(row => row.roster === team.roster_id).sort((a,b) => b.week-a.week);
    let wins = 0; for (const row of games) { if (row.points <= row.against) break; wins++; }
    if (wins) facts.push(`${team.name} entered this week with ${wins} consecutive win${wins === 1 ? "" : "s"}.`);
  }
  if (kind === "playoff") facts.push(`${recipients.join(" and ") || "The selected contender"} ${recipients.length > 1 ? "were" : "was"} selected to receive the boost while fighting for playoff qualification.`);
  if (kind === "rivalry") facts.push(`${matchup.away.name} and ${matchup.home.name} are paired for this rivalry matchup.`);
  if (kind === "upset") {
    const opening = live()?.book.payload.openingTargets;
    const away = live() ? opening?.[matchup.away.id] : matchup.awayProjection;
    const home = live() ? opening?.[matchup.home.id] : matchup.homeProjection;
    if (Number.isFinite(away) && Number.isFinite(home)) facts.push(`Pre-game projections: ${matchup.away.name} ${away.toFixed(1)}, ${matchup.home.name} ${home.toFixed(1)}.`);
  }
  if (kind === "game") facts.push("The ranking weighs records (50%), points scored (25%), projected competitiveness (15%), and projected total (10%). It does not move to the next game if another boost takes priority.");
  return <>
    <p>{source === "Commissioner" ? "Assigned by your commissioner. " : "Automatically selected under your league's featured matchup rules. "}{featureCatalog[kind].rule}</p>
    {facts.map(fact => <p key={fact}>{fact}</p>)}
    <p><strong>{boost}% Profit Boost</strong> on {benefit}. This increases the profit on a winning bet, excluding the returned stake. The boosted odds are shown on the eligible selection.</p>
    <p className="field-note">Featured assignments lock when scoring begins; live score and projection changes do not reassign them.</p>
  </>;
}
export function FeatureBadge({
  kind,
  label,
  boost,
  matchup,
  assignment,
}: {
  kind: FeatureKind;
  label?: string;
  boost?: number;
  matchup?: Matchup;
  assignment?: Assignment;
}) {
  const c = featureCatalog[kind];
  const badge = (
    <span
      className={"feature-badge feature-" + c.color}
      data-feature-type={kind}
    >
      <Icon name={c.icon} size={14} />
      <strong>{label || c.label}</strong>
      <small>{boost ?? c.boost}% Profit Boost</small>
    </span>
  );
  return matchup && assignment ? <InfoPopover title={label || c.label} triggerContent={badge} triggerClassName="feature-badge-button" hover>
    <FeatureExplanation matchup={matchup} assignment={assignment} />
  </InfoPopover> : badge;
}
