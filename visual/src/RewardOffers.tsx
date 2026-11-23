import { useEffect, useState } from "react";
import { fantasyRewards, type RewardKind } from "../server/fantasy-rewards";
import { auth, live } from "./live";
import { Badge } from "./ui";

export type EarnedReward = {
  id: string; achievement: RewardKind; percent: number; week: number; season: number; ready: boolean; seen: boolean;
};

export function RewardCards({ rewards, select }: { rewards: EarnedReward[]; select: (id: string) => void }) {
  if (!rewards.length) return null;
  return <div className="offers-grid">{rewards.map(reward => (
    <article className="offer-card" key={reward.id}>
      <div className="offer-top"><h2>{fantasyRewards[reward.achievement].label}</h2><Badge tone="gold">{reward.percent}% Profit Boost</Badge></div>
      <p>Week {reward.week} · {reward.ready ? "Single use · Expires at season end" : "Available next season"}</p>
      <button className="button primary" disabled={!reward.ready} onClick={() => select(reward.id)}>Use Boost</button>
    </article>
  ))}</div>;
}

type Correction = { season: number; week: number; awards: (EarnedReward & { team: string; used: boolean; removed: boolean })[] };
export function RewardCorrections() {
  const leagueId = live()?.leagueId;
  const [weeks, setWeeks] = useState<Correction[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function load(revoke?: string) {
    setPending(true);
    const result = await auth.rpc("dev_reward_corrections", { p_league: leagueId, ...(revoke ? {p_revoke: revoke} : {}) });
    if (result.error) setError(result.error.message);
    else { setError(""); setWeeks(result.data); }
    setPending(false);
  }
  useEffect(() => { if (leagueId) void load(); }, [leagueId]);
  return <section className="panel form-panel">
    <h3>Fantasy Reward Corrections</h3>
    {error && <p role="alert">{error}</p>}
    {!pending && !error && !weeks.length && <p>No corrections to review.</p>}
    {weeks.map(week => <div key={week.season + "-" + week.week}>
      <h4>{week.season} · Week {week.week}</h4>
      {week.awards.map(award => <div className="member-row" key={award.id}>
        <span>{award.team} · {fantasyRewards[award.achievement].label} · {award.percent}%</span>
        {award.removed ? <Badge>Removed</Badge> : award.used ? <Badge>Redeemed</Badge>
          : <button className="button quiet" disabled={pending} onClick={() => {
            if (window.confirm("Remove this unused reward?")) void load(award.id);
          }}>Remove Boost</button>}
      </div>)}
    </div>)}
  </section>;
}
