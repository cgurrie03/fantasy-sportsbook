import {settleLeg} from './settlement.ts';
import {score} from './line-model.ts';
const ID='13121261-5398-4391-8240-000000000003',SL='1312126153980391424';
type Db = (path: string, method?: string, body?: unknown) => Promise<any>;

async function sleeper(path: string) {
 const response = await fetch(path, {signal: AbortSignal.timeout(12000)});
 if (!response.ok) throw Error('results_source_unavailable');
 return response.json();
}

export async function settleDevWeeks(db:Db,state:any,schedule:any[],read=sleeper){
 const open=await db(`tickets?league_id=eq.${ID}&user_wallet_id=not.is.null&status=eq.OPEN&ticket_type=neq.future&market_week=lt.${state.week}&nfl_season=eq.${state.season}&select=id,market_week,ticket_legs(id,accepted_line,settlement_context)&order=market_week&limit=60`);
 const archive = await db(`league_result_weeks?league_id=eq.${ID}&nfl_season=eq.${state.season}&select=market_week,final,results`);
 const archived = new Map<number, any>(archive.map((row: any) => [row.market_week, row]));
 const eligible = [...new Set<number>(schedule.filter(game => game.week < state.week && game.week <= 18).map(game => game.week))]
   .filter(week => schedule.filter(game => game.week === week).every(game => game.status === 'complete' || game.status === 'canceled'));
 const missing = eligible.filter(week => !archived.get(week)?.final).sort((a, b) => a - b).slice(0, 2);
 const weeks = [...new Set<number>([...missing, ...open.map((ticket: any) => ticket.market_week)])];
 if(!weeks.length)return 0;
 const teams=await db(`teams?league_id=eq.${ID}&select=id,team_name,roster_id`);
 const boards=await db(`sportsbook_boards?league_id=eq.${ID}&board_type=eq.weekly&select=market_week,closes_at`);
 let settled=0;
 for(const week of weeks){
  const board=boards.find((b:any)=>b.market_week===week);
  if(!eligible.includes(week)||(board&&Date.parse(board.closes_at)+6*3600000>Date.now()))continue;
  const rows=await read(`https://api.sleeper.app/v1/league/${SL}/matchups/${week}`);
  if(!Array.isArray(rows)||rows.length!==teams.length||new Set(rows.map(row=>row.roster_id)).size!==teams.length||rows.some((x:any)=>!Number.isFinite(x.custom_points??x.points)))continue;
  const points:any={},players:any={};for(const t of teams){const x=rows.find((r:any)=>r.roster_id===t.roster_id);if(!x)continue;points[t.id]={name:t.team_name,points:x.custom_points??x.points};for(const [id,p] of Object.entries(x.players_points||{}))if(Number.isFinite(p))players[id]={played:true,points:p};}
  if(Object.keys(points).length!==teams.length)continue;
  if (!archived.get(week)?.final) {
   const old = archived.get(week)?.results ?? {};
   const needProjections = teams.some((team: any) => !Number.isFinite(old[team.id]?.projection));
   const projectionInputs = needProjections ? await Promise.all([
    read(`https://api.sleeper.app/v1/league/${SL}`),
    read(`https://api.sleeper.com/projections/nfl/${state.season}/${week}?season_type=regular`),
   ]) : null;
   const projected = projectionInputs ? new Map<string, number>(
    projectionInputs[1].filter((row: any) => row.stats && row.date).map((row: any) => [
     String(row.player_id), Math.max(0, score(row.stats, projectionInputs[0].scoring_settings)),
    ]),
   ) : null;
   if (projected && projected.size === 0) continue;
   const results = Object.fromEntries(teams.map((team: any) => {
    const row = rows.find((item: any) => item.roster_id === team.roster_id);
    const starters: string[] = (row.starters ?? []).map(String).filter((id: string) => id !== '0');
    const starterProjection = starters.length && starters.some(id => projected?.has(id))
     ? Math.round(starters.reduce((sum, id) => sum + (projected?.get(id) ?? 0), 0) * 100) / 100 : null;
    return [team.id, {
     ...old[team.id], matchup_id: row.matchup_id, points: points[team.id].points,
     projection: old[team.id]?.projection ?? starterProjection,
    }];
   }));
   await db('rpc/archive_dev_result_week', 'POST', {p_league: ID, p_season: Number(state.season), p_week: week, p_results: results});
  }
  if(!board)continue;
  for(const t of open.filter((x:any)=>x.market_week===week)){
   const outcomes=t.ticket_legs.map((leg:any)=>settleLeg(leg,{final:true,teams:points,players}));
   if(outcomes.some((x:any)=>x.status==='OPEN'))continue;
   await db('rpc/settle_dev_ticket','POST',{p_ticket:t.id,p_results:outcomes});settled++;
  }
 }
 return settled;
}
