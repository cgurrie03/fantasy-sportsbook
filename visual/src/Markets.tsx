import { feedOption } from "./feedOptions";
import {live,currentPick} from "./live";
import { useInteractionPreview, selectionConflict, usePropFavorites } from "./InteractionPreview";
import { FeatureBadge } from "./FeatureBadge";
import { fantasyRewards, type RewardKind } from "../server/fantasy-rewards";
import { WeeklyOfferCards, type WeeklyOffer } from "./WeeklyOffers";
import { featureCatalog } from "./featuredOptions";
import {
  alternatePick,
  positionGroups,
  positionGroupPick,
  positionGroupAvailable,
  divisionMarkets,
} from "./additionalMarkets";
import { MatchupCarousel } from "./MatchupSeason";
import { routeUrl, navigate, currentRoute, routeQuery } from "./routing";
import { useEffect, useRef, useState } from "react";
import { Icon, Badge, PageHeading, Empty } from "./ui";
import {
  league,
  currentTeamScore,
  pregameTeamProjection,
  liveTeamProjection,
  matchups,
  marketPick,
  price,
  line,
  offers,
  boosted,
  offerPrice,
  halfPoint,
  decimal,
  futurePick,
  futures,
  teams,
  profileTeam,
  featuredLabel,
  featuredAssignment,
} from "./model";
import type { Pick, Team, Matchup, Ticket } from "./model";
import { deadlineLabel, getSettings } from "./settings";
import archivedPlayers from "./players.json";
type Player = (typeof archivedPlayers)[number] & {
  projection?: number;
  injury?: string;
  taxi?: boolean;
  current?: number;
  gameState?: "pre"|"in"|"post"|"bye"|"unknown";
};

function playerPool(): Player[] {
  return live()?.book.payload.players ?? archivedPlayers;
}
export type BoardProps = {
  weeklyOffers?: WeeklyOffer[];
  earnedRewards?: number;
  onRewards?: () => void;
  selected: Pick[];
  onPick: (p: Pick) => void;
  onInfo: () => void;
  onMatch: (id: string) => void;
  onOffer: (id: string) => void;
  used: string[];
};
export function Avatar({
  team: t,
  small = false,
}: {
  team: Team;
  small?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const url = t.avatar?.startsWith("http")
    ? t.avatar
    : "https://sleepercdn.com/avatars/thumbs/" + t.avatar;
  return (
    <span
      className={
        "avatar " + (small ? "small " : "") + "tone-" + (t.roster_id % 5)
      }
    >
      {t.avatar && !failed ? (
        <img src={url} alt="" onError={() => setFailed(true)} />
      ) : (
        t.name.replace(/^The /, "").slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
export function ParticipantAvatar({
  name,
  team,
  sleeperId,
  preferTeam = false,
}: {
  name: string;
  team: Team;
  sleeperId?: string;
  preferTeam?: boolean;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const profiles: {name:string;avatar?:string|null;sleeperId?:string}[]=team.managerProfiles;
  const profile = sleeperId
    ? profiles.find((p) => p.sleeperId === sleeperId)
    : profiles.find((p) => p.name === name);
  const avatar = preferTeam && sleeperId && profiles[0]?.sleeperId === sleeperId
    ? team.avatar || profile?.avatar : profile?.avatar;
  const source=avatar
    ? (/^https:\/\//.test(avatar)?avatar:"https://sleepercdn.com/avatars/thumbs/"+avatar)
    : null;
  return (
    <span className="avatar small participant-avatar">
      {source && source !== failedSource ? (
        <img
          src={source}
          alt=""
          onError={() => setFailedSource(source)}
        />
      ) : (
        name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
export function LeagueAvatar({ small = false }: { small?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={"league-avatar " + (small ? "small" : "")}>
      {league.avatar && !failed ? (
        <img
          src={"https://sleepercdn.com/avatars/thumbs/" + league.avatar}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon name="people" size={small ? 20 : 32} />
      )}
    </span>
  );
}
export function OddsButton({
  pick,
  selected,
  onPick,
  top,
  disabled = false,
  boostTone,
}: {
  pick: Pick;
  selected: boolean;
  onPick: (p: Pick) => void;
  top?: string;
  disabled?: boolean;
  boostTone?: string;
}) {
  const quote=live()?currentPick(pick):pick;
  if(live()&&!quote)disabled=true;
  if(quote)pick=quote;
  const review = useInteractionPreview();
  if(live()&&quote)selected=review.selected.some(s=>s.id===quote.id);
  const conflict = review.enabled && review.conflicts && !disabled ? selectionConflict(pick, review.selected) : "";
  return (
    <button
      className={
        "odds-button " + (conflict ? "conflicting-price " : "") +
        (pick.originalOdds != null
          ? "boosted-odds " +
            (boostTone ? "boosted-tone-" + boostTone + " " : "")
          : "") +
        (selected ? "selected" : "")
      }
      data-market={
        pick.family === "match_total"
          ? "Total"
          : pick.family === "moneyline"
            ? "Moneyline"
            : pick.family === "spread"
              ? "Spread"
              : ""
      }
      onClick={() => conflict ? review.explain(conflict) : onPick(pick)}
      aria-disabled={!!conflict || disabled}
      title={conflict || (live()&&!quote?"Not Available On This Dev Board":undefined)}
      aria-pressed={selected}
      aria-label={
        pick.detail +
        " · " +
        pick.label +
        ", " +
        price(pick.odds) +
        (pick.originalOdds != null
          ? ", Boosted From " + price(pick.originalOdds)
          : "")
      }
      disabled={disabled}
    >
      <span>{top || "Win"}</span>
      <span className="price-pair">
        {pick.originalOdds != null && (
          <del className="original-price">{price(pick.originalOdds)}</del>
        )}
        <strong>{price(pick.odds)}</strong>
      </span>
      {selected && <Icon name="check" size={14} />}
    </button>
  );
}
function Match({
  m,
  selected,
  onPick,
  onMatch,
  detail = false,
}: { m: Matchup; detail?: boolean } & BoardProps) {
  const feature = featuredAssignment(m);
  const tag = feature?.label || "";
  return (
    <section
      className={
        "matchup " +
        (tag ? "featured " : "") +
        (tag === "Tank Bowl" ? "tank-bowl " : "") +
        (!detail ? "matchup-clickable" : "") + (live()&&!detail?" matchup-live-preview":"")
      }
      data-matchup-id={m.id}
      data-rank-score={m.rankScore}
      data-featured={tag}
      aria-label={m.away.name + " versus " + m.home.name}
    >
      {!detail && (
        <a
          className="matchup-open-overlay"
          href={routeUrl("matchup/" + m.id)}
          aria-label={
            "View Extra Markets For " + m.away.name + " vs " + m.home.name
          }
        />
      )}
      <div className="matchup-heading">
        <span>
          <span className="matchup-time">Week {league.week}</span>
          {feature && (
            <FeatureBadge kind={feature.kind} label={feature.label} boost={feature.boost} />
          )}
        </span>
        <span className="matchup-actions">
          <a
            className="text-button sleeper-link"
            title="Open Sleeper Matchup"
            aria-label={
              "Open " + m.away.name + " vs " + m.home.name + " In Sleeper"
            }
            href={
              "https://sleeper.com/matchup/" +
              league.leagueId +
              "/" +
              league.week +
              "/" +
              m.away.roster_id
            }
            target="_blank"
            rel="noreferrer"
          >
            Sleeper Matchup
          </a>
          {!detail && (
            <span className="matchup-open-cue" aria-hidden="true">
              <Icon name="arrow" size={16} />
            </span>
          )}
        </span>
      </div>
      <div className="board-columns">
        <span>Matchup</span>
        {live()&&!detail&&<span className="matchup-scoreboard-heading">Live scoring</span>}
        <span>Spread</span>
        <span>Moneyline</span>
        <span>Total</span>
      </div>
      {[
        { t: m.away, side: "away", total: "over" },
        { t: m.home, side: "home", total: "under" },
      ].map(({ t, side, total }) => (
        <div className="team-market-row" key={t.id}>
          <button className="team-cell" onClick={() => onMatch(m.id)}>
            <Avatar team={t} />
            <span>
              <strong>{t.name}</strong>
              {feature?.raceTeams.includes(t.id) && (
                <span className="playoff-team-indicator">
                  Fighting For A Playoff Spot
                </span>
              )}
              <small>
                {t.wins}–{t.losses}
                {t.ties ? "-" + t.ties : ""}
                <span className="team-manager"> · {t.manager}</span>
              </small>
              {live() && <span className="team-current-score matchup-mobile-score"><b>{currentTeamScore(t)}</b> <span>Current</span></span>}
              <span className={"team-projection"+(live()&&!detail?" matchup-mobile-score":"")}>
                Projection{" "}
                {Number(
                  t.id === m.away.id ? m.awayProjection : m.homeProjection,
                ).toFixed(1)}
              </span>
              {live()&&!detail&&<small className="matchup-pregame">Pre-game projection {pregameTeamProjection(t)}</small>}
            </span>
          </button>
          {live()&&!detail&&<div className="matchup-scoreboard">
            <div><small>Current score</small><b>{currentTeamScore(t)}</b></div>
            <div><small>Current projection</small><b>{liveTeamProjection(t,t.id===m.away.id?m.awayProjection:m.homeProjection)}</b></div>
          </div>}
          {["spread", "moneyline", "match_total"].map((kind) => {
            const source = m.markets.find(
              (x) =>
                x.kind === kind &&
                (kind === "match_total" ? x.side === total : x.side === side),
            )!;
            const p = marketPick(source);
            return (
              <OddsButton
                key={kind}
                pick={p}
                boostTone={
                  feature ? featureCatalog[feature.kind].color : undefined
                }
                top={
                  kind === "spread"
                    ? line(source.line!)
                    : kind === "match_total"
                      ? (total === "over" ? "O " : "U ") + m.total
                      : "To Win"
                }
                selected={selected.some((s) => s.id === p.id)}
                onPick={onPick}
              />
            );
          })}
        </div>
      ))}
    </section>
  );
}
export function OfferCards({
  onOffer,
  used,
  compact = false,
}: {
  onOffer: (id: string) => void;
  used: string[];
  compact?: boolean;
}) {
  return (
    <div className={compact ? "compact-offers" : "offers-grid"}>
      {offers.map((o, i) => (
        <article
          className={"offer-card offer-" + i + (compact ? " compact" : "")}
          key={o.id}
        >
          <div className="offer-top">
            <h2>{o.name}</h2>
            <Badge tone="gold">
              {o.type === "parlay" ? "Boosted Parlay" : "Profit Boost"}
            </Badge>
          </div>
          {o.type === "parlay" ? (
            !compact ? (
              <ol className="inline-parlay">
                {o.picks.map((p) => (
                  <li key={p.id}>
                    <Icon name="check" size={13} />
                    <span>
                      <strong>{p.label}</strong>
                      <small>
                        {p.matchupLabel}
                        {p.family === "match_total" ? " · " + p.detail : ""}
                      </small>
                    </span>
                    <b>{price(p.odds)}</b>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="compact-parlay">
                {o.picks.map((p) => (
                  <span key={p.id}>
                    <b className="compact-leg-label">{p.label}</b>
                    {p.family === "match_total" && (
                      <small title={p.matchupLabel}>{p.matchupLabel}</small>
                    )}
                  </span>
                ))}
              </div>
            )
          ) : (
            <p className="offer-eligibility">{o.description}</p>
          )}
          <div className="offer-inline-bottom">
            {o.type === "parlay" ? (
              <div className="offer-odds">
                <del>{price(o.base)}</del>
                <strong>{price(offerPrice(o))}</strong>
              </div>
            ) : (
              <strong className="claim-state">
                {used.includes("boost-used")
                  ? "Used"
                  : used.includes(o.id)
                    ? "Claimed"
                    : "Available"}
              </strong>
            )}
            <button
              className={i === 0 ? "button pale" : "button primary"}
              onClick={() => onOffer(o.id)}
              disabled={
                (o.type === "parlay" && used.includes(o.id)) ||
                (o.type === "boost" && used.includes("boost-used"))
              }
            >
              {used.includes(o.id)
                ? o.type === "boost"
                  ? used.includes("boost-used")
                    ? "Used"
                    : "Go To Player H2H"
                  : "Used"
                : o.type === "boost"
                  ? "Claim Boost"
                  : "Add To Slip"}
              <Icon
                name={
                  used.includes(o.id) && o.type === "parlay" ? "check" : "arrow"
                }
                size={14}
              />
            </button>
          </div>
          <time
            className="offer-expiry"
            dateTime={o.deadline}
            title={"Archived Week " + league.week + " offer cutoff"}
          >
            <Icon name="clock" size={12} />
            Closes {deadlineLabel(o.deadline)}
          </time>
        </article>
      ))}
    </div>
  );
}
function headlineRank(value: string, seed: number) {
  let hash = seed;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  }
  return (hash ^ (hash >>> 16)) >>> 0;
}

function SlateTicker({ tickets }: { tickets: Ticket[] }) {
  const [paused, setPaused] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const track = useRef<HTMLDivElement>(null);
  const options=live()?.feedPreferences;
  const historical: { category: string; title: string; detail: string; href?: string; playerId?:string }[] = [
    ...(live()?.feedArchive ?? []), ...(live()?.feedRecap ?? []),
  ];
  const ownTeam=teams.find(team=>team.id===live()?.user.teamId);
  const matchup=matchups.find(row=>row.away.id===ownTeam?.id||row.home.id===ownTeam?.id);
  const relevant=new Set([matchup?.away.roster_id,matchup?.home.roster_id]);
  const currentPlayers=playerPool();
  const injuryVisible=(story:typeof historical[number])=>{
    if(story.category!=="Injury Report"&&story.category!=="Injury Update")return true;
    if(!story.playerId)return false;
    return currentPlayers.some(row=>row.id===story.playerId && row.gameState!=="post"
      &&(feedOption("includeTaxi",options)||!row.taxi)&&(!feedOption("injuriesMyMatchup",options)||relevant.has(row.roster)));
  };
  const teamWithMoneyline=(matchup:Matchup,side:"away"|"home")=>{
    const market=matchup.markets.find(row=>row.kind==="moneyline"&&row.side===side);
    if(!market)return matchup[side].name;
    const pick=feedOption("featuredOdds",options)?currentPick(marketPick(market)):null;
    return `${matchup[side].name} (${price(pick?.odds??market.odds)})`;
  };
  const additionalBoost=(matchup:Matchup)=>feedOption("featuredOdds",options)?matchup.markets.flatMap(row=>{
    if(row.kind==="moneyline")return [];
    const pick=currentPick(marketPick(row));
    return pick?.originalOdds!=null?[`${row.kind==="match_total"?(row.side==="over"?"Over ":"Under ")+row.line:row.kind==="spread"?"Spread "+line(row.line!):"Boost"} (${price(pick.odds)})`]:[];
  }):[];
  const headlineSeed = headlineRank(`${league.leagueId}:${league.season}:${league.week}`, 2166136261);
  const headlines = [
    ...((live()?.rewardFeed ?? []) as {team_name:string;achievement:RewardKind;percent:number;week:number;awarded?:boolean}[]).map(row => ({
      category: "Fantasy Reward", title: `${row.team_name} · ${fantasyRewards[row.achievement].label}`,
      detail: row.awarded ? `${row.percent}% profit boost` : "", href: routeUrl("matchups?boosts=1"),
    })),
    ...historical.filter(injuryVisible).filter(story=>feedOption("tradeHistory",options) || story.title!=="Trade Flashback")
      .map(story=>{
        if(story.category==="Injury Report"&&!feedOption("injuryBody",options))return {...story,detail:""};
        const detail=story.detail.replace(/ fantasy points\b/gi,"");
        return story.category==="Week Recap"&&/ led Wk\. \d+$/.test(story.title)&&/^\d/.test(detail)
          ? {...story,title:story.title+" with "+detail,detail:""}
          : {...story,detail:story.category==="This Week in History"?detail:story.detail};
      }),
    ...matchups.flatMap(matchup=>{
      const label=featuredLabel(matchup);
      if(!label)return [];
      return [{category:"Featured",title:label,
        detail:[`${teamWithMoneyline(matchup,"away")} vs. ${teamWithMoneyline(matchup,"home")}`,...additionalBoost(matchup)].join(" · "),
        href:routeUrl("matchup/"+matchup.id)}];
    }),
    ...tickets.filter((ticket) => ticket.week === league.week && ticket.season === String(league.season)).flatMap((ticket) => {
      const won = ticket.picks.filter((pick) => pick.result?.status === "Won").length;
      const manager = ticket.participant || "League Member";
      const payout = (ticket as Ticket & { actualReturn?: number }).actualReturn;
      const profit = payout == null ? null : payout - ticket.stake;
      const bigWin = ticket.status === "Won" && ((profit != null && profit >= Number(feedOption("bigWinProfit",options))) || ticket.odds >= Number(feedOption("bigWinOdds",options)));
      const progress = ticket.status === "Open" && won >= Number(feedOption("parlayProgress",options)) && ticket.picks.length > 1;
      if (!bigWin && !progress && ticket.picks.length < Number(feedOption("ticketLegs",options)) && ticket.stake < Number(feedOption("ticketStake",options))) return [];
      return [{
        category: bigWin ? "Big Win" : progress ? "Parlay Watch" : "Ticket Placed",
        title: bigWin ? `${manager} hit ${price(ticket.odds)}` : progress ? `${manager} · ${won}/${ticket.picks.length} Legs Won` : `${manager} · ${ticket.picks.length > 1 ? ticket.picks.length + "-Leg Parlay" : "Single"}`,
        detail: bigWin && profit != null ? `${profit.toLocaleString()} credits in net profit` : `${ticket.stake} credits wagered · ${price(ticket.odds)}`,
        href: routeUrl("all-bets?ticket=" + encodeURIComponent(ticket.id)),
      }];
    }),
    ...matchups.flatMap((matchup) => {
      if (!live()?.book.payload.gamesActive) return [];
      const [away, home] = [matchup.away, matchup.home].map((team) => league.finalScores.find((score) => score.roster === team.roster_id)?.points);
      if (away == null || home == null || (away === 0 && home === 0)) return [];
      const pregame=live()?.book.payload.openingTargets??{};
      const a=pregame[matchup.away.id],b=pregame[matchup.home.id];
      const underdog = a < b ? matchup.away : b < a ? matchup.home : null;
      const awayLeads=away>home;
      const leader=awayLeads?matchup.away:matchup.home;
      const leaderLabel=teamWithMoneyline(matchup,awayLeads||away===home?"away":"home");
      const opponentLabel=teamWithMoneyline(matchup,awayLeads||away===home?"home":"away");
      const leads = underdog?.id===leader.id && away!==home && Math.abs(away-home)>=Number(feedOption("underdogLead",options));
      return [{
        category: leads ? "Underdog Watch" : "Live Score",
        title: away===home?`${leaderLabel} tied with ${opponentLabel}`:`${leaderLabel} leads ${opponentLabel}`,
        detail: [awayLeads||away===home?`${away.toFixed(2)}–${home.toFixed(2)}`:`${home.toFixed(2)}–${away.toFixed(2)}`,...additionalBoost(matchup)].join(" · "),
        href: routeUrl("matchup/" + matchup.id),
      }];
    }),
  ].filter(story=>live()?.feedPreferences?.[story.category]!==false)
    .map(story => ({ story, rank: headlineRank(`${story.category}:${story.title}:${story.href ?? ""}`, headlineSeed) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0,20)
    .map(({ story }) => story);
  useEffect(() => {
    const element = track.current;
    if (!element || paused || !headlines.length) return;
    let previous = 0;
    let position = element.scrollLeft;
    let frame = 0;
    const advance = (now: number) => {
      const loopWidth = element.children[headlines.length]?.getBoundingClientRect().left
        - element.firstElementChild!.getBoundingClientRect().left;
      if (previous && loopWidth > 0 && element.scrollWidth - element.clientWidth >= loopWidth && !document.hidden && !element.matches(":hover, :focus-within")) {
        position = (position + Math.min(now - previous, 50) * 0.035) % loopWidth;
        element.scrollLeft = position;
      } else {
        position = element.scrollLeft;
      }
      previous = now;
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [paused, headlines.length]);
  if (!headlines.length && !live()) return null;
  const cleanHeadline = (value: string) => value
    .replace(/\u00c2(?=[\u00b7\u00a0])/g, "")
    .replace(/\u00c3\u2014/g, "×");
  const renderHeadline = (headline: typeof headlines[number], key: string, duplicate = false) => (
    <a key={key} className="slate-headline" href={headline.href} tabIndex={duplicate ? -1 : undefined} aria-hidden={duplicate || undefined}>
      <span className="slate-headline-category" data-category={headline.category}>{headline.category}</span>
      <strong>{cleanHeadline(headline.title)}</strong>
      {headline.detail && <span>{cleanHeadline(headline.detail)}</span>}
    </a>
  );
  return (
    <section className="slate-ticker" aria-label="League headlines">
      <div className="slate-ticker-label">League Feed</div>
      <div className="slate-ticker-track" ref={track} onTouchStart={() => setPaused(true)}>
        {!headlines.length&&<small className="slate-headline">No headlines for these settings</small>}
        {headlines.map((headline, index) => renderHeadline(headline, String(index)))}
        {!paused && headlines.map((headline, index) => renderHeadline(headline, "copy-" + index, true))}
      </div>
      <button className="ticker-playback" onClick={() => setPaused(!paused)} aria-label={paused ? "Play league feed" : "Pause league feed"}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          {paused ? <path d="M4 2.5v11l9-5.5z" /> : <path d="M3 2h4v12H3zm6 0h4v12H9z" />}
        </svg>
      </button>
    </section>
  );
}
export function MarketBoard(props: BoardProps & { tickets?: Ticket[] }) {
  const [tab, setTab] = useState(() => routeQuery().get("tab") || "Matchups");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All Matchups");
  useEffect(() => {
    const update = () => {
      const t = routeQuery().get("tab");
      setTab(t || "Matchups");
    };
    window.addEventListener("boff-navigation", update);
    return () => window.removeEventListener("boff-navigation", update);
  }, []);
  const visible = matchups.filter(
    (m) =>
      (filter === "All Matchups" ||
        (filter === "Featured"
          ? !!featuredLabel(m)
          : m.away.id === profileTeam.id || m.home.id === profileTeam.id)) &&
      (m.away.name + " " + m.home.name)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="market-page">
      <PageHeading
        title="Weekly Slate"
        action={
          <div className="week-select">
            <Icon name="ball" /> NFL · Week {league.week}
          </div>
        }
      />
      <SlateTicker tickets={props.tickets ?? []} />
      {!!props.earnedRewards&&<button className="button secondary weekly-earned-boosts" onClick={props.onRewards}>
        <Icon name="gift" size={16}/> Earned Boosts <Badge>{props.earnedRewards}</Badge>
      </button>}
      {live() ? <WeeklyOfferCards offers={props.weeklyOffers ?? []} onOffer={props.onOffer} /> : <OfferCards onOffer={props.onOffer} used={props.used} compact />}
      <div
        className="tabs market-tabs"
        role="tablist"
        aria-label="Market Categories"
      >
        {[
          "Matchups",
          "Player Head-To-Head",
          "Player Points & Milestones",
          "This Week's Specials",
        ].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              navigate(
                "matchups" +
                  (t === "Matchups" ? "" : "?tab=" + encodeURIComponent(t)),
              );
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Matchups" ? (
        <>
          <div className="board-toolbar">
            <div className="segmented">
              {["All Matchups", "Featured", "My Team"].map((f) => (
                <button
                  className={filter === f ? "active" : ""}
                  key={f}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
            <label className="search">
              <Icon name="search" size={17} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find A Team"
                aria-label="Find A Team"
              />
            </label>
          </div>
          <div className="matchup-list">
            {visible.length ? (
              visible.map((m) => (
                <div key={m.id}>
                  <Match m={m} {...props} />
                </div>
              ))
            ) : (
              <Empty title="No Matchups Found">
                Try another team name or clear the filters.
              </Empty>
            )}
          </div>
        </>
      ) : tab === "Player Head-To-Head" ? (
        <PlayerMarkets {...props} />
      ) : tab === "Player Points & Milestones" ? (
        <PlayerExtras {...props} />
      ) : (
        <WeeklySpecials {...props} />
      )}
    </div>
  );
}
type PlayerFilter = {
  team: string;
  matchup: string;
  position: string;
  query: string;
};
function usePlayerFilter(h2h = false) {
  const scope = getSettings().playerScope;
  const initial = scope === "all" ? "all" : "team:" + profileTeam.roster_id;
  return useState<PlayerFilter>({
    team: initial,
    matchup:
      h2h && scope !== "all"
        ? matchups.find(
            (m) => m.away.id === profileTeam.id || m.home.id === profileTeam.id,
          )!.id
        : "all",
    position: "All Positions",
    query: "",
  });
}
function PlayerFilters({
  value,
  onChange,
  h2h = false,
}: {
  h2h?: boolean;
  value: PlayerFilter;
  onChange: (v: PlayerFilter) => void;
}) {
  return (
    <div className={"player-filters " + (h2h ? "h2h-filters" : "prop-filters")}>
      {!h2h && (
        <label>
          Team
          <select
            aria-label="Player Team Filter"
            value={value.team}
            onChange={(e) => onChange({ ...value, team: e.target.value })}
          >
            <option value={"team:" + profileTeam.roster_id}>
              My Team · {profileTeam.name}
            </option>
            <option value="all">All Teams</option>
            {teams
              .filter((t) => t.id !== profileTeam.id)
              .map((t) => (
                <option value={"team:" + t.roster_id} key={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {h2h && (
        <label>
          Matchup
          <select
            aria-label="Player Matchup Filter"
            value={value.matchup}
            onChange={(e) => onChange({ ...value, matchup: e.target.value })}
          >
            <option value="all">All Matchups</option>
            {matchups.map((m) => (
              <option key={m.id} value={m.id}>
                {m.away.name} vs {m.home.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!h2h && (
        <label>
          Position
          <select
            aria-label="Player Position Filter"
            value={value.position}
            onChange={(e) => onChange({ ...value, position: e.target.value })}
          >
            {["All Positions", "QB", "RB", "WR", "TE"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      )}
      <label className="search">
        <Icon name="search" size={16} />
        <input
          aria-label="Find A Player"
          placeholder="Find A Player"
          value={value.query}
          onChange={(e) => onChange({ ...value, query: e.target.value })}
        />
      </label>
    </div>
  );
}
function PlayerHeadshot({ player: p }: { player: Player }) {
  const [failed, setFailed] = useState(false);
  const defense = ["DEF", "DST", "D/ST"].includes(p.position);
  const teamCode = (p.nflTeam || p.id).toLowerCase();
  return (
    <span className={defense ? "player-headshot defense-logo" : "player-headshot"}>
      {!failed ? (
        <img
          src={defense && teamCode ? `https://a.espncdn.com/i/teamlogos/nfl/500/${({ was: "wsh", jax: "jax", la: "lar" } as Record<string, string>)[teamCode] ?? teamCode}.png` : p.headshot}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        p.name
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")
      )}
    </span>
  );
}
function PlayerIdentity({
  player: p,
  showTeam = false,
}: {
  player: Player;
  showTeam?: boolean;
}) {
  return (
    <div className="player-identity">
      <PlayerHeadshot player={p} />
      <span>
        <strong>{p.name}</strong>
        {showTeam && (
          <small className="fantasy-team-name">
            {teams.find((t) => t.roster_id === p.roster)?.name}
          </small>
        )}
        <small className="player-matchup-context">
          {p.position} · {p.nflTeam || "FA"}{" "}
          {p.opponent && !/^bye$/i.test(p.opponent) ? (
            <>
              <span className="context-divider">·</span>
              {p.homeAway === "home" ? "vs " : "@ "}
              {p.opponent}
            </>
          ) : " · Bye / No Game"}
          {p.gameState==="in"?" · In Progress":p.gameState==="post"?" · Final":p.kickoff?
            <> · <time dateTime={p.kickoff}>{deadlineLabel(p.kickoff)}</time></>:p.gameState==="pre"?" · Time unavailable":null}
        </small>
        <small className="player-context">
          <span
            title={
              "League-scored average through Week " +
              league.playerContext.throughWeek +
              ", " +
              p.gamesPlayed +
              " games"
            }
          >
            Season Average {p.seasonAverage == null ? "—" : p.seasonAverage.toFixed(1)}
          </span>

          {(() => {
            const started=p.gameState==="in"||p.gameState==="post";
            const value=started?p.current:p.projection;
            return typeof value==="number"&&Number.isFinite(value)
              ? <span className="player-live-points">
                  <span className="player-score-divider" aria-hidden="true">·</span>
                  <span className={started?"player-score-emphasis":undefined}>
                    {p.gameState==="post"?"Score":started?"Current Score":"Projected"} {value.toFixed(1)}
                  </span>
                </span>
              : null;
          })()}
        </small>
      </span>
    </div>
  );
}
function PlayerMarkets({ selected, onPick }: BoardProps) {
  const players = playerPool().filter((player) => !/^bye$/i.test(player.opponent?.trim() ?? ""));
  const [mode,setMode]=useState("Player Matchups");
  const [filter, setFilter] = usePlayerFilter(true);
  const matches = matchups
    .filter((m) => filter.matchup === "all" || filter.matchup === m.id)
    .map((m) => {
      const pairs = league.rosterPositions.flatMap((slot, index) => {
        if (["K", "BN", "IR", "TAXI"].includes(slot)) return [];
        const a = players.find(
          (p) => p.roster === m.away.roster_id && p.lineupIndex === index,
        );
        const b = players.find(
          (p) => p.roster === m.home.roster_id && p.lineupIndex === index,
        );
        if (!a && !b) return [];
        if (
          !((a?.name || "") + " " + (b?.name || ""))
            .toLowerCase()
            .includes(filter.query.toLowerCase())
        )
          return [];
        return [{ a, b, pos: slot.replaceAll("_", " "), index }];
      });
      return { m, pairs };
    })
    .filter((r) => r.pairs.length);
  function reset() {
    setFilter({
      ...filter,
      matchup: matchups.find(
        (m) => m.away.id === profileTeam.id || m.home.id === profileTeam.id,
      )!.id,
      query: "",
    });
  }
  return (
    <>
      <PlayerFilters value={filter} onChange={setFilter} h2h />
      <div className="filter-wrap">{["Player Matchups","Position Groups"].map(k=><button key={k} className={"filter-chip "+(mode===k?"active":"")} onClick={()=>setMode(k)}>{k}</button>)}</div>
      {mode === "Position Groups" ? <div className="position-group-list">{matchups.filter(m=>filter.matchup==="all"||filter.matchup===m.id).map(m=><section key={m.id}><PositionGroupMarkets m={m} selected={selected} onPick={onPick}/></section>)}</div> : <>
      <div className="compact-player-list">
        {matches.map(({ m, pairs }) => (
          <section className="panel compact-h2h" key={m.id}>
            <div className="h2h-teams">
              {[m.away, m.home].map((t) => (
                <div className="table-team" key={t.id}>
                  <Avatar team={t} small />
                  <span>
                    <strong>{t.name}</strong>
                    <small>{t.managers.join(" · ")}</small>
                  </span>
                </div>
              ))}
            </div>
            {pairs.map((pair) => (
              <div className="h2h-line" key={pair.pos + pair.index}>
                <span className="position-tag">{pair.pos}</span>
                {[pair.a, pair.b].map((p, side) => {
                  if (!p)
                    return (
                      <div className="h2h-side empty-slot" key={side}>
                        No Starter In This Slot
                      </div>
                    );
                  const pick: Pick = {
                    id:
                      "player-" +
                      m.id +
                      "-" +
                      pair.pos +
                      "-" +
                      pair.index +
                      "-" +
                      p.id,
                    label: p.name,
                    detail:
                      "Player Head-To-Head · " +
                      teams.find((t) => t.roster_id === p.roster)!.name,
                    odds: -110,
                    group: "player-" + m.id + "-" + pair.pos + "-" + pair.index,
                    family: "player",
                    kind: "player",
                    matchupId: m.id,
                    matchupLabel: m.away.name + " vs " + m.home.name,
                  };
                  return (
                    <div className="h2h-side" key={p.id}>
                      <PlayerIdentity player={p} />
                      <OddsButton
                        pick={pick}
                        top="More Points"
                        disabled={
                          !live() && (!p.kickoff || !pair.a?.kickoff || !pair.b?.kickoff)
                        }
                        selected={selected.some((s) => s.id === pick.id)}
                        onPick={onPick}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        ))}
      </div>
      {!matches.length && (
        <Empty
          title="No Matching Players"
          action={
            <button className="button secondary" onClick={reset}>
              Clear Filters
            </button>
          }
        >
          Choose another matchup or clear the search.
        </Empty>
      )}
      </>}
    </>
  );
}
function PlayerExtras({ selected, onPick }: BoardProps) {
  const players = playerPool();
  const review=useInteractionPreview();
  const favorites=usePropFavorites();
  const [favoritesOnly,setFavoritesOnly]=useState(false);
  const [filter, setFilter] = usePlayerFilter();
  const [kind, setKind] = useState("Fantasy Points");
  const eligible = players.filter((p) => {
    const m = matchups.find((m) =>
      [m.away.roster_id, m.home.roster_id].includes(p.roster),
    );
    return (
      m && p.kickoff && p.opponent && !/^bye$/i.test(p.opponent) &&
      !/^(out|ir|pup|suspended)$/i.test(p.injury ?? "") &&
      ((review.enabled && favoritesOnly) || filter.team === "all" ||
        p.roster === Number(filter.team.split(":")[1])) &&
      (filter.position === "All Positions" || p.position === filter.position) &&
      p.name.toLowerCase().includes(filter.query.toLowerCase())
    );
  }).sort((a, b) => (b.projection ?? -Infinity) - (a.projection ?? -Infinity) || a.name.localeCompare(b.name));
  return (
    <>
      <PlayerFilters value={filter} onChange={setFilter} />
      <div className="filter-wrap">
        {review.enabled && <button className={"filter-chip " + (favoritesOnly ? "active" : "")} onClick={()=>setFavoritesOnly(v=>!v)}>★ Favorites ({favorites.ids.length})</button>}
        {["Fantasy Points", "Milestone Ladders"].map((k) => (
          <button
            className={"filter-chip " + (kind === k ? "active" : "")}
            key={k}
            onClick={() => setKind(k)}
          >
            {k}
          </button>
        ))}
      </div>
      <section className="panel compact-props">
        {eligible.map((p) => {
          const m = matchups.find((m) =>
            [m.away.roster_id, m.home.roster_id].includes(p.roster),
          )!;
          const target =
            p.position === "QB" ? 20.5 : p.position === "TE" ? 10.5 : 15.5;
          const liveOptions: [string, number][] = live()?.quotes
            .filter((quote: any) => quote.kind === (kind === "Fantasy Points" ? "player_points" : "player_milestone")
              && quote.metadata?.player_id === p.id)
            .sort((a: any,b: any)=>kind==="Fantasy Points" ? a.side.localeCompare(b.side) : Number(a.line)-Number(b.line))
            .map((quote: any)=>[quote.kind==="player_points" ? `${quote.side==="over"?"Over":"Under"} ${quote.line}` : `${quote.line}+`, quote.odds]) ?? [];
          const options = live() ? liveOptions :
            kind === "Fantasy Points"
              ? [
                  ["Over " + target, -110],
                  ["Under " + target, -110],
                ]
              : [
                  ["10+", -180],
                  ["15+", 110],
                  ["20+", 180],
                  ["25+", 300],
                ];
          if(review.enabled && favoritesOnly && !options.some(([label])=>favorites.ids.includes("prop-"+p.id+"-"+kind+"-"+label))) return null;
          return (
            <div className={"extra-player-row " + (kind === "Fantasy Points" ? "points-row" : "ladder-row")} key={p.id}>
              <PlayerIdentity player={p} showTeam />
              <div className="extra-odds">
                {!options.length && <small>Lines closed or unavailable</small>}
                {options.map(([label, odds]) => {
                  const pick: Pick = {
                    id: "prop-" + p.id + "-" + kind + "-" + label,
                    label: p.name + " · " + label + " Fantasy Points",
                    detail:
                      kind +
                      " · " +
                      teams.find((t) => t.roster_id === p.roster)!.name,
                    odds: Number(odds),
                    group: "prop-" + p.id,
                    family: "player",
                    kind: "player",
                    matchupId: m.id,
                    matchupLabel: m.away.name + " vs " + m.home.name,
                  };
                  if(review.enabled && favoritesOnly && !favorites.ids.includes(pick.id)) return null;
                  return (
                    <div className="favorite-prop" key={label}>
                    {review.enabled && <button className={"prop-star " + (favorites.ids.includes(pick.id)?"is-favorite":"")} aria-pressed={favorites.ids.includes(pick.id)} aria-label={(favorites.ids.includes(pick.id)?"Unfavorite ":"Favorite ")+pick.label} onClick={()=>favorites.toggle(pick.id)}>{favorites.ids.includes(pick.id)?"★":"☆"}</button>}
                    <OddsButton
                      pick={pick}
                      top={String(label)}
                      disabled={!p.kickoff}
                      selected={selected.some((s) => s.id === pick.id)}
                      onPick={onPick}
                    />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {review.enabled && favoritesOnly && !eligible.some(p=>favorites.ids.some(id=>id.startsWith(`prop-${p.id}-${kind}-`))) && <Empty title={favorites.ids.length ? "No Favorites Match These Filters" : "No Favorite Props"}>{favorites.ids.length ? "Choose another market or clear the position and search filters." : "Star a specific Over, Under, or milestone to find it here."}</Empty>}
        {!eligible.length && (
          <Empty title="No Matching Players">
            Change the team, position, or search filter.
          </Empty>
        )}
      </section>
    </>
  );
}
const specialCategories = [
  "Top Scorer",
  "Lowest Scorer",
  "Teams Scoring 150+",
  "Any Team Below 100",
  "Any Team Scoring 200+",
  "Teams Beating Projection",
  "League Average",
  "Highest Score",
];
export function JumpNav({
  items,
  prefix,
  className = "",
}: {
  items: string[];
  prefix: string;
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const clicked = useRef<number | null>(null);
  useEffect(() => {
    let frame = 0;
    const sync = () => {
      frame = 0;
      const nav = document.getElementById(prefix + "-navigation");
      const boundary = (nav?.getBoundingClientRect().bottom || 175) + 24;
      const sections = items
        .map((_, i) => ({
          i,
          rect: document
            .getElementById(prefix + "-" + i)
            ?.getBoundingClientRect(),
        }))
        .filter((s) => s.rect);
      if (clicked.current !== null) {
        const target = sections.find((s) => s.i === clicked.current);
        if (
          target?.rect &&
          target.rect.bottom > boundary &&
          target.rect.top < innerHeight - 40
        ) {
          setActive(clicked.current);
          return;
        }
        clicked.current = null;
      }
      const passed = sections.filter((s) => s.rect!.top <= boundary);
      setActive(passed.at(-1)?.i ?? sections[0]?.i ?? 0);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    const manual = () => {
      clicked.current = null;
      schedule();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (
        [
          "PageDown",
          "PageUp",
          "Home",
          "End",
          "ArrowDown",
          "ArrowUp",
          " ",
        ].includes(event.key) &&
        !["INPUT", "SELECT", "TEXTAREA"].includes(
          (event.target as HTMLElement).tagName,
        )
      )
        manual();
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("wheel", manual, { passive: true });
    window.addEventListener("touchmove", manual, { passive: true });
    window.addEventListener("keydown", keyboard);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("wheel", manual);
      window.removeEventListener("touchmove", manual);
      window.removeEventListener("keydown", keyboard);
    };
  }, [items.join("|"), prefix]);
  return (
    <nav
      id={prefix + "-navigation"}
      className={"jump-nav " + className}
      aria-label={
        prefix === "weekly" ? "Weekly Special Navigation" : "Futures Navigation"
      }
    >
      {items.map((label, i) => (
        <button
          className={active === i ? "active" : ""}
          aria-current={active === i ? "location" : undefined}
          onClick={() => {
            clicked.current = i;
            setActive(i);
            document
              .getElementById(prefix + "-" + i)
              ?.scrollIntoView({ behavior: "instant", block: "start" });
          }}
          key={label}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
function WeeklySpecials({ selected, onPick }: BoardProps) {
  const [counts, setCounts] = useState<Record<string, number>>({
    "Teams Scoring 150+": 6,
    "Teams Beating Projection": 6,
  });
  if(live() && !live().quotes.some((q:{kind:string; metadata?:{cutoff?:string}})=>q.kind.startsWith("weekly_") &&
    q.metadata?.cutoff && Date.parse(q.metadata.cutoff)>Date.now())) {
    return <Empty title="Weekly Specials Are Closed">Weekly Specials are offered before the first NFL kickoff of the week.</Empty>;
  }
  const total = matchups.reduce(
    (n, m) => n + m.awayProjection + m.homeProjection,
    0,
  );
  return (
    <>
      <JumpNav
        items={[
          "Scoring Leaders",
          "Team Counts",
          "Score Thresholds",
          "League Scoring",
        ]}
        prefix="weekly"
        className="weekly-jump"
      />
      <div className="continuous-markets weekly-groups">
        {[
          [0, 1],
          [2, 5],
          [3, 4],
          [6, 7],
        ].map((indices, group) => (
          <div
            className="special-pair anchored-market"
            id={"weekly-" + group}
            data-jump-index={group}
            key={group}
          >
            {indices.map((i) => {
              const tab = specialCategories[i];
              const target =
                tab === "League Average"
                  ? halfPoint(total / teams.length)
                  : Math.round(
                      Math.max(
                        ...matchups.flatMap((m) => [
                          m.awayProjection,
                          m.homeProjection,
                        ]),
                      ) * 2,
                    ) / 2;
              const postedTotal = live()?.quotes.find((quote: any)=>quote.subject===tab&&quote.side==="over");
              const normalizedTarget = postedTotal?.line ?? halfPoint(target);
              const pick = (label: string, odds: number, id: string): Pick => ({
                id: "special-" + tab + "-" + id,
                label,
                detail: tab + " · Week " + league.week,
                odds,
                group: "special-" + tab,
                family: "special",
                kind: "weekly",
              });
              const option = (
                label: string,
                odds: number,
                id: string,
                top: string,
              ) => {
                const p = pick(label, odds, id);
                return (
                  <OddsButton
                    key={id}
                    pick={p}
                    top={top}
                    selected={selected.some((s) => s.id === p.id)}
                    onPick={onPick}
                  />
                );
              };
              const count = counts[tab] ?? 6;
              const scoringTeams = i < 2 ? teams.slice()
                .sort((a,b)=>i===0?b.pointsFor-a.pointsFor:a.pointsFor-b.pointsFor)
                .map((team,index)=>{
                  const fallbackOdds=350+index*125;
                  const quote=live()?currentPick(pick(team.name+" · "+tab,fallbackOdds,team.id)):null;
                  return {team,fallbackOdds,sortPrice:live()?(quote?.decimalOdds??(quote?decimal(quote.odds):Infinity)):decimal(fallbackOdds)};
                })
                .sort((a,b)=>a.sortPrice-b.sortPrice||a.team.name.localeCompare(b.team.name)||a.team.id.localeCompare(b.team.id)) : [];
              return (
                <section
                  className="panel special-market"
                  data-special={tab}
                  key={tab}
                >
                  <div className="panel-heading">
                    <h2>{tab}</h2>
                    <span className="muted">Week {league.week}</span>
                  </div>
                  {i < 2 ? (
                    scoringTeams.map(({team:t,fallbackOdds}) => (
                        <div className="selection-list-row" key={t.id}>
                          <Avatar team={t} small />
                          <span>
                            <strong>{t.name}</strong>
                            <small>
                              {t.wins}–{t.losses}
                            </small>
                          </span>
                          {option(
                            t.name + " · " + tab,
                            fallbackOdds,
                            t.id,
                            i === 0 ? "Highest Score" : "Lowest Score",
                          )}
                        </div>
                      ))
                  ) : i === 2 || i === 5 ? (
                    <div className="special-detail">
                      <label htmlFor={"count-" + i}>
                        Number Of Teams <strong>{count}</strong>
                      </label>
                      <input
                        id={"count-" + i}
                        aria-label={tab + " Count"}
                        type="range"
                        min={tab==="Teams Scoring 150+" && live() ? 1 : 0}
                        max={teams.length}
                        value={count}
                        onChange={(e) =>
                          setCounts((c) => ({
                            ...c,
                            [tab]: Number(e.target.value),
                          }))
                        }
                      />
                      <div className="count-scale">
                        <span>{tab==="Teams Scoring 150+" && live() ? 1 : 0}</span>
                        <span>{teams.length}</span>
                      </div>
                      <div className="paired-options">
                        {option(
                          "Exactly " + count + " Teams · " + tab,
                          400,
                          "exact-" + count,
                          "Exactly " + count,
                        )}
                        {option(
                          "At Least " + count + " Teams · " + tab,
                          120,
                          "atleast-" + count,
                          "At Least " + count,
                        )}
                      </div>
                    </div>
                  ) : i === 3 || i === 4 ? (
                    <div className="special-detail">
                      <p className="market-rule">
                        {i === 3
                          ? "At Least One Team Below 100 Points"
                          : "At Least One Team Reaches 200 Points"}
                      </p>
                      <div className="paired-options">
                        {option("Yes · " + tab, 150, "yes", "Yes")}
                        {option("No · " + tab, -180, "no", "No")}
                      </div>
                    </div>
                  ) : (
                    <div className="special-detail">
                      <p className="market-rule">
                        {tab === "League Average"
                          ? "Average Final Points Across All " +
                            teams.length +
                            " Teams"
                          : "Highest Final Team Score"}
                      </p>
                      <div className="paired-options">
                        {option(
                          "Over " + normalizedTarget + " · " + tab,
                          -110,
                          "over",
                          "Over " + normalizedTarget,
                        )}
                        {option(
                          "Under " + normalizedTarget + " · " + tab,
                          -110,
                          "under",
                          "Under " + normalizedTarget,
                        )}
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
function MatchupExtras({ m, selected, onPick }: BoardProps & { m: Matchup }) {
  const [kind, setKind] = useState("Alternate Lines");
  return (
    <>
      <div
        role="tablist"
        className="tabs matchup-market-tabs"
        aria-label="Additional Matchup Markets"
      >
        {[
          "Alternate Lines",
          "Team Totals",
          "Team Milestones",
          "Winning Margin",
        ].map((k) => (
          <button
            role="tab"
            aria-selected={kind === k}
            key={k}
            onClick={() => setKind(k)}
          >
            {k}
          </button>
        ))}
      </div>
      {kind === "Alternate Lines" ? (
        <AlternateLines m={m} selected={selected} onPick={onPick} />
      ) : (
        <section className="panel">
          {[m.away, m.home].map((t) => {
            const projection = halfPoint(
              t.id === m.away.id ? m.awayProjection : m.homeProjection,
            );
            const options =
              kind === "Team Totals"
                ? [
                    ["Over " + projection, -110],
                    ["Under " + projection, -110],
                  ]
                : kind === "Team Milestones"
                  ? [100, 125, 150, 175, 200].map((n, i) => [
                      n + "+ Points",
                      -180 + i * 110,
                    ])
                  : [
                      ["Under 10 Points", 300],
                      ["10 To Under 20", 400],
                      ["20 To Under 30", 550],
                      ["30+ Points", 650],
                    ];
            return (
              <div className="extra-team-row" key={t.id}>
                <div className="table-team">
                  <Avatar team={t} small />
                  <span>
                    <strong>{t.name}</strong>
                  </span>
                </div>
                <div className="extra-odds">
                  {options.map(([label, odds]) => {
                    const p: Pick = {
                      id:
                        "extra-" + m.id + "-" + t.id + "-" + kind + "-" + label,
                      label: t.name + " · " + label,
                      detail: kind,
                      odds: Number(odds),
                      group:
                        m.id +
                        "-" +
                        (kind === "Winning Margin" ? "margin" : t.id),
                      family: kind,
                      kind: "weekly",
                      matchupId: m.id,
                      matchupLabel: m.away.name + " vs " + m.home.name,
                    };
                    return (
                      <OddsButton
                        key={label}
                        pick={p}
                        top={String(label)}
                        selected={selected.some((s) => s.id === p.id)}
                        onPick={onPick}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}
type SelectionProps = { selected: Pick[]; onPick: (p: Pick) => void };
function AlternateLines({ m, selected, onPick }: { m: Matchup } & SelectionProps) {
  const baseSpread = m.markets.find(
    (row) => row.kind === "spread" && row.side === "away",
  )!.line!;
  return (
    <div className="alternate-market-grid">
      {(["spread", "match_total"] as const).map((kind) => {
        const isSpread = kind === "spread";
        const title = isSpread ? "Alternate Spreads" : "Alternate Match Totals";
        return (
          <section className="panel alternate-market" key={kind}>
            <div className="panel-heading"><h2>{title}</h2></div>
            <div className="alternate-presets" role="table" aria-label={title}>
              <div className="alternate-preset-head" role="row">
                {isSpread
                  ? [m.away, m.home].map((team) => (
                      <div className="alternate-team-heading" role="columnheader" key={team.id}>
                        <Avatar team={team} small />
                        <strong>{team.name}</strong>
                      </div>
                    ))
                  : ["Over", "Under"].map((side) => (
                      <div role="columnheader" key={side}><strong>{side}</strong></div>
                    ))}
              </div>
              <div role="rowgroup" className="alternate-preset-body">
                {[-10, -5, 0, 5, 10].map((offset) => {
                  const target = (isSpread ? baseSpread : m.total) + offset;
                  return (
                    <div className="alternate-preset-row" role="row" key={offset}>
                      {(isSpread ? ["away", "home"] : ["over", "under"]).map((side) => {
                        const pick = alternatePick(
                          m, kind, side, isSpread && side === "home" ? -target : target,
                        );
                        return (
                          <div role="cell" key={pick.id}>
                            <OddsButton
                              pick={pick}
                              top={isSpread ? line(pick.line!) : `${side === "over" ? "Over" : "Under"} ${pick.line}`}
                              selected={selected.some((item) => item.id === pick.id)}
                              onPick={onPick}
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
function PositionGroupMarkets({
  m,
  selected,
  onPick,
}: { m: Matchup } & SelectionProps) {
  const groups = positionGroups(m);
  return (
    <div className="position-group-markets">
      {groups.map((g) => (
        <section className="panel position-group-market" key={g.position}>
          <div className="panel-heading">
            <h2>Starting {g.position}s</h2>
          </div>
          <div className="position-group-columns">
            {(["away", "home"] as const).map((side) => {
              const t = m[side],
                members = g[side],
                p = live()
                  ? live().quotes.find((q:any)=>q.metadata?.ui_id===`position-group-${m.id}-${g.position}-${side}`)
                  : positionGroupAvailable(g) ? positionGroupPick(m, g.position, side) : null;
              const pick:Pick|null = live()&&p ? {id:p.id,quoteKey:p.metadata.quote_key,teamId:t.id,side,label:p.label,
                detail:"Starting position group",odds:p.odds,group:m.id,family:"position_group",kind:"player-group",matchupId:m.id} : p;
              return (
                <div key={side}>
                  <div className="table-team">
                    <Avatar team={t} small />
                    <strong>{t.name}</strong>
                  </div>
                  <small className="position-group-context">
                    {members.length}{" "}
                    {members.length === 1 ? "Starter" : "Starters"} · Season
                    Avg.{" "}
                    {members.every(
                      (p) =>
                        typeof p.seasonAverage === "number" &&
                        p.gamesPlayed > 0,
                    )
                      ? members
                          .reduce((n, p) => n + (p.seasonAverage || 0), 0)
                          .toFixed(1)
                      : "Unavailable"}
                  </small>
                  <p className="position-group-members">
                    {members.map((p) => p.name).join(", ")}
                  </p>
                  {pick ? (
                    <OddsButton
                      pick={pick}
                      top="To Score More"
                      selected={selected.some((s) => s.id === pick.id)}
                      onPick={onPick}
                    />
                  ) : (
                    <span
                      className="unavailable-group-price"
                      title="A price is unavailable when starter or scoring data is incomplete or the group is final."
                    >
                      Price Unavailable
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {!groups.length && (
        <Empty title="No Matching Starter Groups">
          Both teams need starters in the same position group.
        </Empty>
      )}
    </div>
  );
}
export function MatchupDetail({ id, ...props }: BoardProps & { id: string }) {
  const m = matchups.find((m) => m.id === id) || matchups[0];
  return (
    <>
      <button
        className="text-button back-link"
        onClick={() => navigate("matchups")}
      >
        <Icon name="back" size={16} /> All Matchups
      </button>
      <PageHeading title="Matchup" />
      <MatchupCarousel m={m} />
      <Match m={m} {...props} detail />
      <MatchupExtras m={m} {...props} />
    </>
  );
}
export function FuturesPage({
  selected,
  onPick,
}: {
  selected: Pick[];
  onPick: (p: Pick) => void;
}) {
  if(live())return <LiveFutures selected={selected} onPick={onPick}/>;
  const divisions = divisionMarkets();
  const markets = [...futures, ...divisions];
  const groups = [
    [0, 3],
    [1, 2],
    [4, 5],
    ...Array.from({ length: Math.ceil(divisions.length / 2) }, (_, i) =>
      [6 + i * 2, 7 + i * 2].filter((n) => n < markets.length),
    ),
  ];
  const navigation = [
    "Season Finish",
    "Season Targets",
    "Season Leaders",
    ...Array.from({ length: Math.ceil(divisions.length / 2) }, (_, i) =>
      divisions.length <= 2
        ? "Division Winners"
        : `Divisions ${i * 2 + 1}–${Math.min(divisions.length, i * 2 + 2)}`,
    ),
  ];
  return (
    <div className="futures-page">
      <PageHeading
        title="Futures"
        action={<Badge>{league.season} Season</Badge>}
      />
      <JumpNav items={navigation} prefix="future" />
      <div className="continuous-markets future-groups">
        {groups.map((indices, group) => (
          <div
            className="future-pair anchored-market"
            id={"future-" + group}
            data-jump-index={group}
            key={group}
          >
            {indices.map((i) => {
              const f = markets[i];
              const pool = "teams" in f ? (f.teams as Team[]) : teams;
              return (
                <section className="panel future-market" key={f.kind}>
                  <div className="panel-heading">
                    <h2>{f.title}</h2>
                    {f.kind === "last" && (
                      <span className="muted">Regular-Season Finish</span>
                    )}
                  </div>
                  {pool
                    .slice()
                    .sort((a, b) =>
                      f.kind === "points-leader"
                        ? b.pointsFor - a.pointsFor
                        : b.wins - a.wins || b.pointsFor - a.pointsFor,
                    )
                    .map((t) => (
                      <div className="selection-list-row" key={t.id}>
                        <Avatar team={t} />
                        <span>
                          <strong>{t.name}</strong>
                          <small>
                            {f.kind === "points-leader"
                              ? t.pointsFor.toFixed(2) + " Points"
                              : `${t.wins}–${t.losses}`}
                          </small>
                        </span>
                        <div className="future-options">
                          {(f.kind === "playoffs"
                            ? ["yes", "no"]
                            : f.kind === "wins"
                              ? ["over", "under"]
                              : ["yes"]
                          ).map((side) => {
                            const p = futurePick(
                              t,
                              f.kind,
                              side,
                              pool,
                              f.title,
                            );
                            return (
                              <OddsButton
                                key={side}
                                pick={p}
                                top={
                                  f.kind === "playoffs"
                                    ? side === "yes"
                                      ? "Make Playoffs"
                                      : "Miss Playoffs"
                                    : f.kind === "wins"
                                      ? (side === "over" ? "Over " : "Under ") +
                                        (t.wins + 3.5)
                                      : f.kind === "last"
                                        ? "To Finish Last"
                                        : "To Win"
                                }
                                selected={selected.some((s) => s.id === p.id)}
                                onPick={onPick}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </section>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

type FuturesQuote = {
  id: string;
  kind: string;
  label: string;
  subject: string;
  side: string;
  line: number | null;
  odds: number;
  team_id: string | null;
  metadata: { ui_group: string; cutoff: string; result?: string; close_reason?: string; playoff_clinch_week?: number; playoff_elimination_week?: number; elimination_weeks?: Record<string, number> };
};

function LiveFutures({ selected, onPick }: { selected: Pick[]; onPick: (pick: Pick) => void }) {
  const board = live().futuresBoard;
  const quotes: FuturesQuote[] = live().futuresQuotes ?? [];
  const eliminationWeeks = new Map<string, number>();
  for (const quote of quotes) {
    const week = quote.metadata.playoff_elimination_week;
    if (quote.team_id && week != null) eliminationWeeks.set(quote.team_id, week);
  }
  const sections = [
    { title: "Season Finish", markets: [["future_champion", "League Champion"], ["future_first_pick", "#1 Pick"]] },
    { title: "Season Targets", markets: [["future_playoffs", "Make / Miss Playoffs"], ["future_win_total", "Regular-Season Wins"]] },
    { title: "Playoff Timing", markets: [["future_first_clinch", "First Team to Clinch Playoffs"], ["future_first_elimination", "First Team Eliminated from Playoffs"]] },
  ];
  const visible = quotes.filter(row => row.metadata.result || board?.status === "published" || board?.status === "closed");
  const displayed = sections.map(section => ({
    ...section,
    markets: section.markets.filter(([kind]) => visible.some(row => row.kind === kind)),
  })).filter(section => section.markets.length);
  const choiceOrder = ["make", "miss", "over", "under"];
  const asPick = (row: FuturesQuote, title: string): Pick => ({
    id: row.id, label: row.label, detail: title, group: row.metadata.ui_group,
    family: row.kind, kind: "future", odds: row.odds, line: row.line ?? undefined,
    side: row.side, teamId: row.team_id ?? undefined,
  });

  function renderMarket(kind: string, title: string) {
    const rows = visible.filter(row => row.kind === kind);
    const marketEliminations = rows.find(row => row.metadata.elimination_weeks)?.metadata.elimination_weeks;
    const outright = kind === "future_champion" || kind === "future_first_pick";
    const timing = kind === "future_first_clinch" || kind === "future_first_elimination";
    const results = [...new Set(rows.flatMap(row => row.metadata.result ? [row.metadata.result] : []))];
    const groups = new Map<string, FuturesQuote[]>();
    for (const row of rows) {
      const key = timing ? row.metadata.ui_group : row.team_id ?? row.id;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    const rankingOdds = (rows: FuturesQuote[]) => {
      const available = rows.filter(row => currentPick(asPick(row, title)));
      const quote = available.find(row => row.side === "make" || row.side === "over") ?? available[0];
      return quote ? (quote.odds < 0 ? 1 + 100 / -quote.odds : 1 + quote.odds / 100) : Infinity;
    };
    const entries: { key: string; team?: Team; rows: FuturesQuote[] }[] = !timing
      ? teams.map(team => ({
        key: team.id, team, rows: groups.get(team.id) ?? [],
      })).sort((a, b) => (kind==="future_win_total" ? (b.rows[0]?.line??-1)-(a.rows[0]?.line??-1) : rankingOdds(a.rows) - rankingOdds(b.rows)) || a.team.name.localeCompare(b.team.name))
      : [...groups].map(([key, group]) => ({ key, rows: group, team: teams.find(team => team.id === group[0].team_id) }));
    const cutoff = rows[0].metadata.cutoff;
    const sharedCutoff = rows.every(row => row.metadata.cutoff === cutoff);

    return (
      <section className="panel future-market live-future-market" key={kind}>
        <header className="panel-heading live-future-heading">
          <h2>{title}</h2>
          {sharedCutoff && <small>Cutoff {deadlineLabel(cutoff)}</small>}
        </header>
        {timing && <p className="live-future-note">
          {kind === "future_first_clinch" ? "Over/under on the first clinch week." : "Over/under on the first elimination week."}
        </p>}
        {outright && results.length > 0 && <p className="live-future-result"><Badge>Result</Badge> {results.join(" · ")}</p>}
        {entries.map(entry => {
            const first = entry.rows[0];
            const result = first?.metadata.result;
            const options = entry.rows.slice().sort((a, b) => choiceOrder.indexOf(a.side) - choiceOrder.indexOf(b.side));
            const hasOdds = options.some(row => currentPick(asPick(row, title)));
            const eliminationWeek = !hasOdds && entry.team
              ? marketEliminations?.[entry.team.id] ?? (kind === "future_champion" ? eliminationWeeks.get(entry.team.id) : undefined)
              : undefined;
            const status=hasOdds?undefined:result?.replace(entry.team?.name+" · ","")
              || first?.metadata.close_reason
              || (eliminationWeek!=null?`Eliminated in Week ${eliminationWeek}`:undefined)
              || (Date.parse(first?.metadata.cutoff??cutoff)<=Date.now()?"Betting cutoff passed":
                  board?.status!=="published"?"Market closed":!first?"Waiting for verified pricing data":"Prices temporarily suspended");
            const holder = outright && first?.label.startsWith(first.subject + " · ")
              ? first.label.slice(first.subject.length + 3) : undefined;
            return (
              <div className="selection-list-row live-future-row" key={entry.key}>
                {entry.team && <>
                  <Avatar team={entry.team} />
                  <span>
                    <strong>{entry.team.name}</strong>
                    <small>{entry.team.wins}–{entry.team.losses}{entry.team.ties ? "–" + entry.team.ties : ""}{holder && " · " + holder}
                      {status&&" · "+status}
                    </small>
                  </span>
                </>}
                {!sharedCutoff && first && <small>Cutoff {deadlineLabel(first.metadata.cutoff)}</small>}
                {timing&&status&&<p className="live-future-result">{status}</p>}
                <div className={"future-options" + (!timing && !outright ? " future-options-paired" : "")}>
                  {!timing&&!hasOdds?<span className="future-odds-status">Closed</span>:options.map(row => {
                    const pick=asPick(row,title);
                    const available=Boolean(currentPick(pick));
                    if(!available)return <span key={row.id} className="future-odds-status"><small>{row.label}</small>Closed</span>;
                    return <OddsButton key={row.id} pick={pick} top={outright?(kind==="future_first_pick"?"To Earn #1 Pick":"To Win"):row.label}
                      selected={selected.some(item=>item.id===row.id)} onPick={onPick}/>;
                  })}
                </div>
              </div>
            );
          })}
      </section>
    );
  }

  return (
    <div className="futures-page">
      <PageHeading title="Season Futures" action={<Badge>{league.season} Season</Badge>} />
      <p>Winning futures payouts carry into next season, on top of your starting balance.</p>
      {displayed.length ? <>
        <JumpNav items={displayed.map(section => section.title)} prefix="future" />
        <div className="continuous-markets future-groups">
          {displayed.map((section, index) => (
            <div className="future-pair anchored-market" id={"future-" + index} key={section.title}>
              {section.markets.map(([kind, title]) => renderMarket(kind, title))}
            </div>
          ))}
        </div>
      </> : <Empty title="Futures Pricing Is Not Open">Previously placed futures remain in My Bets and All Bets.</Empty>}
    </div>
  );
}
