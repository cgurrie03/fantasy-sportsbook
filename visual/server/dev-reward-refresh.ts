import { prepareWeeklyRewards } from "./weekly-reward-results.ts";
import type { futuresEvidence } from "./futures-evidence.ts";

type Db = (path: string, method?: string, body?: unknown) => Promise<any>;
const league = "13121261-5398-4391-8240-000000000003";
const sleeper = "https://api.sleeper.app/v1/league/1312126153980391424";
const eastern = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23",
});

export async function refreshRewards(db: Db, season: number, week: number, now: number,
  cache: any, evidence?: Pick<ReturnType<typeof futuresEvidence>, "clinchWeeks" | "champion">) {
  const parts = eastern.formatToParts(now);
  const day = parts.find(part => part.type === "weekday")?.value;
  const hour = Number(parts.find(part => part.type === "hour")?.value);
  if (day === "Tue" && hour < 5) return;
  const closingWeek = cache.metadata.settings.playoffWeekStart +
    Math.ceil(Math.log2(cache.metadata.settings.playoffTeams)) * (cache.metadata.settings.roundType === 1 ? 2 : 1) - 1;
  const closedWeek = Math.min(week - 1, closingWeek);
  if (!Number.isInteger(closedWeek) || closedWeek < 1 || closedWeek > 18) return;
  if (!evidence) return;
  const context = await db("rpc/dev_reward_worker_context", "POST", {p_league:league,p_season:season,p_week:closedWeek});
  if (context.issued && context.hasQualified !== false) {
    // Recheck after game-day corrections, without polling Sleeper on every worker run.
    if (day !== "Thu" || hour !== 6 || new Date(now).getUTCMinutes() >= 5) return;
  }
  if (closedWeek === closingWeek && !evidence?.champion && !context.issued) return;
  const [teams,weeks,lines] = await Promise.all([
    db(`teams?league_id=eq.${league}&select=id,roster_id`),
    db(`league_result_weeks?league_id=eq.${league}&nfl_season=eq.${season}&final=eq.true&market_week=lte.${closedWeek}&select=market_week,final,results`),
    db(`opening_market_benchmarks?league_id=eq.${league}&nfl_season=eq.${season}&kind=eq.spread&select=market_week,team_id,line`),
  ]);
  const current = weeks.find((row: any) => row.market_week === closedWeek);
  if (!current) return;
  const response = await fetch(`${sleeper}/matchups/${closedWeek}`, {signal:AbortSignal.timeout(12000)});
  if (!response.ok) return;
  const scores = await response.json();
  if (!Array.isArray(scores) || scores.length !== teams.length) return;
  const results = {...current.results};
  for (const team of teams) {
    const row = scores.find(item => item.roster_id === team.roster_id);
    if (!row || !results[team.id] || !Number.isFinite(row.custom_points ?? row.points)) return;
    results[team.id] = {...results[team.id], points:row.custom_points ?? row.points};
  }
  await db("rpc/update_dev_reward_scores", "POST", {p_league:league,p_season:season,p_week:closedWeek,p_before:current.results,p_results:results});
  if (context.issued && context.hasQualified !== false) return;
  current.results=results;
  const firstClinches=Object.entries(evidence?.clinchWeeks ?? {}).filter(([, value]) => value===closedWeek).map(([id])=>Number(id));
  const outcome=prepareWeeklyRewards({refreshWeek:closedWeek+1,teams,weeks,lines,rules:context.rules??undefined,
    historicalHigh:context.historicalHigh??undefined,firstClinches,champion:closedWeek===closingWeek?evidence?.champion??undefined:undefined,
    seasonClosing:closedWeek===closingWeek});
  if (!outcome) return;
  const serialize = (award: (typeof outcome.awards)[number]) => ({team_id:teams.find((team:any)=>team.roster_id===award.rosterId).id, achievement:award.kind, percent:award.percent});
  await db("rpc/record_dev_fantasy_rewards","POST",{p_league:league,p_season:season,p_week:closedWeek,p_results:results,
    p_expires:null,p_awards:outcome.awards.map(serialize),p_qualified:outcome.earned.map(serialize)});
}
