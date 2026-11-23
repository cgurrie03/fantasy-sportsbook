import {buildFutures} from "./dev-futures-pricing.ts";
import {gradeFuturesSelection} from "./futures-evidence.ts";

const LEAGUE="13121261-5398-4391-8240-000000000003";
const SLEEPER="https://api.sleeper.app/v1/league/1312126153980391424";
type Db=(path:string,method?:string,body?:unknown)=>Promise<any>;
type Source=(url:string)=>Promise<any>;
type ParametersOfBuild=Parameters<typeof buildFutures>[0];

export async function refreshFutures(db:Db,source:Source,season:number,week:number,nfl:ParametersOfBuild["schedule"],cache:any,expectedRevision?:number) {
 const settings=cache.metadata.settings;
 if (!Number.isInteger(settings.playoffWeekStart)||!Number.isInteger(settings.playoffTeams)) return;
 const [bookRows,archived,rules,open]=await Promise.all([
  db(`dev_current_book?league_id=eq.${LEAGUE}&select=payload`),
  db(`league_result_weeks?league_id=eq.${LEAGUE}&nfl_season=eq.${season}&final=eq.true&select=market_week,results`),
  db("rpc/dev_futures_worker_rules","POST",{p_league:LEAGUE,p_season:season}),
  db(`tickets?league_id=eq.${LEAGUE}&nfl_season=eq.${season}&ticket_type=eq.future&status=eq.OPEN&select=id,ticket_legs(id,status,actual_value,result_evidence,accepted_line,settlement_context)&order=id&limit=200`),
 ]);
 if(expectedRevision!==undefined&&(rules?.revision??0)!==expectedRevision)throw Error("futures_rules_changed");
 const book=bookRows[0]?.payload;
 if (!book?.teams?.length||book.teams.length!==cache.metadata.teams.length) return;
 const legacyFirstPick=open.some((ticket:any)=>ticket.ticket_legs.some((leg:any)=>
  leg.settlement_context?.kind==="future_first_pick"&&leg.settlement_context.metadata?.last_place_basis==="regular_season"));
 const selected=rules?.rules??{qualification:"sleeper",firstPick:settings.leagueType===2&&legacyFirstPick?"regular_season":"disabled",rostersReady:false};
 const playoffWeek=settings.playoffWeekStart;
 const byWeek=new Map<number,any>(archived.map((row:any)=>[row.market_week,row.results]));
 const weeks:ParametersOfBuild["weeks"]=[];
 for(let start=1;start<playoffWeek;start+=4) {
  const group=Array.from({length:Math.min(4,playoffWeek-start)},(_,index)=>start+index);
  const rows=await Promise.all(group.map(async number=>{
   const results=byWeek.get(number);
   if(results&&book.teams.every((team:any)=>Number.isInteger(results[team.id]?.matchup_id)&&Number.isFinite(results[team.id]?.points))){
    return {week:number,final:true,matchups:book.teams.map((team:any)=>({
     roster_id:team.roster_id,matchup_id:results[team.id].matchup_id,points:results[team.id].points,
    }))};
   }
   const matchups=await source(SLEEPER+`/matchups/${number}`);
   return {week:number,final:false,matchups};
  }));
  weeks.push(...rows);
 }
 const winners=week>=playoffWeek?cache.brackets?.winners??[]:[];
 const losers=week>=playoffWeek?cache.brackets?.losers??[]:[];
 const tradedPicks=selected.firstPick!=="disabled"?await source(SLEEPER+"/traded_picks").catch(()=>undefined):undefined;
 const {quotes,evidence,names}=buildFutures({teams:book.teams,weeks,season,week,playoffWeek,playoffTeams:settings.playoffTeams,
  leagueType:settings.leagueType,divisions:settings.divisions,medianGame:!!settings.medianGame,rules:selected,winners,losers,schedule:nfl,
  playoffRoundWeeks:settings.roundType===1?2:1,tradedPicks:Array.isArray(tradedPicks)?tradedPicks:undefined});
 const settlements=open.flatMap((ticket:any)=>{
  let changed=false;
  const legs=ticket.ticket_legs.map((leg:any)=>{
   if(leg.status!=="OPEN")return {id:leg.id,status:leg.status,actual_value:leg.actual_value,evidence:leg.result_evidence??"Previously graded"};
   const context=leg.settlement_context;
   const grade=context&&gradeFuturesSelection({kind:context.kind,side:context.side,
    rosterId:context.metadata?.roster_id==null?undefined:Number(context.metadata.roster_id),
    line:leg.accepted_line==null?undefined:Number(leg.accepted_line)},evidence);
   if(!grade)return {id:leg.id,status:"OPEN",evidence:"Waiting for finalized season results",actual_value:null};
   changed=true;
   const eliminationWeek=evidence.eliminationWeeks[grade.rosters[0]];
   const qualification=grade.actual?"Made playoffs":eliminationWeek==null?"Missed playoffs":`Eliminated in Week ${eliminationWeek}`;
   return {id:leg.id,status:grade.won?"WON":"LOST",actual_value:grade.actual,
    evidence:`${context.kind.includes("clinch")||context.kind.includes("elimination")?`Week ${grade.actual} · `:""}${grade.rosters.map(id=>names.get(id)).filter(Boolean).join(", ")} · ${context.kind==="future_playoffs"?qualification:context.kind==="future_win_total"?`${grade.actual} wins`:grade.won?"Selection won":"Selection lost"}`};
  });
  return changed?[{id:ticket.id,legs}]:[];
 });
 await db("rpc/publish_dev_futures","POST",{p_league:LEAGUE,p_season:season,p_revision:rules?.revision??0,p_quotes:quotes,p_settlements:settlements,p_complete:evidence.champion!==null});
 return evidence;
}
