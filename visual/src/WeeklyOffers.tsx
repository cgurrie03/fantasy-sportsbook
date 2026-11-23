import { live } from "./live";
import { american, price } from "./model";
import { deadlineLabel } from "./settings";
import { Badge } from "./ui";

export type WeeklyOffer = {
  slot: string;
  title: string;
  description?: string;
  deadline: string;
  percent: number;
  base: number | null;
  claimed: boolean;
  used: boolean;
  picks: {id: string; label: string; odds: number; subject: string; kind: string; matchup: string}[];
};

export function WeeklyOfferCards({ offers, onOffer }: {
  offers: WeeklyOffer[];
  onOffer: (slot: string) => void;
}) {
  if (!offers.length) return null;
  return <div className="weekly-offer-summaries" aria-label="Weekly Offers">
    {[...offers].sort((a,b)=>Number(b.picks.length>1)-Number(a.picks.length>1)).map(offer=>
      <article className="weekly-offer-summary" key={offer.slot}>
        <strong title={offer.title}>{offer.title}</strong>
        <span>{offer.picks.length>1?`${offer.picks.length}-Leg Parlay · `:""}{offer.percent}% profit boost</span>
        <div className="offer-summary-footer">
          <span className="offer-summary-value">{offer.used?"Used":offer.base?price(american(1+(offer.base-1)*(1+offer.percent/100))):""}</span>
          <button className="button secondary compact-button" aria-label={`View Details: ${offer.title}`} onClick={()=>onOffer(offer.slot)}>View Details</button>
        </div>
      </article>)}
  </div>;
}
const marketNames: Record<string,string> = {
  player_h2h: "Player Head-to-Head",
  position_group: "Position Group",
  player_milestone: "Player Milestone",
  player_points: "Player Fantasy Points",
  moneyline: "Moneyline",
  spread: "Spread",
  match_total: "Matchup Total",
  team_total: "Team Total",
};

type OfferQuote = {
  id: string;
  home_projection?: number | string | null;
  away_projection?: number | string | null;
  metadata?: {
    slot?: string;
    player_id?: string;
    opponent_player_id?: string;
    away_player_ids?: string[];
    home_player_ids?: string[];
  };
};
type OfferPlayer = { id: string; name: string; projection?: number | null };

function withProjection(name: string, projection: number | string | null | undefined) {
  return projection != null && projection !== "" && Number.isFinite(Number(projection))
    ? `${name} (${Number(projection).toFixed(1)})`
    : name;
}

function OfferLeg({ pick }: { pick: WeeklyOffer["picks"][number] }) {
  const book = live();
  const quote = (book?.quotes as OfferQuote[] | undefined)?.find(row => row.id === pick.id);
  const players = (book?.book.payload.players ?? []) as OfferPlayer[];
  const player = (id?: string) => players.find(row => String(row.id) === String(id));
  const meta = quote?.metadata;
  const slot = meta?.slot?.replaceAll("_"," ");
  const type = marketNames[pick.kind] ?? pick.kind.replaceAll("_"," ");
  let label = pick.label.replace(/\u00c2(?=\u00b7)/g,"");
  let participants: string | undefined;
  if (pick.kind === "player_h2h") {
    const [away, home] = pick.subject.split(/\s+vs\.?\s+/i);
    const awayName = player(meta?.opponent_player_id)?.name ?? away;
    const homeName = player(meta?.player_id)?.name ?? home;
    participants = awayName && homeName
      ? `${withProjection(awayName,quote?.away_projection)} vs. ${withProjection(homeName,quote?.home_projection)}`
      : pick.subject;
  }
  if (pick.kind === "position_group") {
    const names = (ids?: string[]) => (ids ?? []).flatMap(id => {
      const member = player(id);
      return member ? [withProjection(member.name,member.projection)] : [];
    }).join(", ");
    const away=names(meta?.away_player_ids), home=names(meta?.home_player_ids);
    participants=away&&home?`${away} vs. ${home}`:undefined;
  }
  if (pick.kind === "player_milestone" || pick.kind === "player_points") {
    const selected = player(meta?.player_id);
    if (selected && label.startsWith(selected.name))
      label = withProjection(selected.name,selected.projection) + label.slice(selected.name.length);
  }
  return <li>
    <span><strong>{label}</strong>
      <small className="offer-player-context">{[type,slot].filter(Boolean).join(" · ")}</small>
      {participants && <small className="offer-player-context">{participants}</small>}
    </span>
    <b>{price(pick.odds)}</b>
  </li>;
}

export function WeeklyOfferDetails({offer,onOffer}:{offer:WeeklyOffer;onOffer:(slot:string)=>void}){
  return <div className="weekly-offer-details">
    {offer.picks.length > 0 && <ul className="inline-parlay">{offer.picks.map(pick => <OfferLeg key={pick.id} pick={pick}/>)}</ul>}
    <div className="offer-price-row">
      <Badge tone="gold">{offer.percent}% Profit Boost</Badge>
      {offer.base != null && <div className="offer-odds">
        <del>{price(american(offer.base))}</del>
        <strong>{price(american(1 + (offer.base - 1) * (1 + offer.percent / 100)))}</strong>
      </div>}
    </div>
    <div className="offer-inline-bottom">
      <div>
        {!offer.picks.length&&<small className="offer-player-context">4+ eligible pre-game player duels from different matchups</small>}
        <time className="offer-expiry" dateTime={offer.deadline}>Closes {deadlineLabel(offer.deadline)}</time>
      </div>
      <button className="button primary" disabled={offer.used} onClick={() => onOffer(offer.slot)}>
        {offer.used ? "Used" : offer.base ? "Add To Slip" : offer.claimed ? "Use Claimed Boost" : "Claim Boost"}
      </button>
    </div>
  </div>;
}
