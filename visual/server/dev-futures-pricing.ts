import { bracketProbabilities, firstRoundOwner, seasonProbabilities, seasonStrength } from "../../api/_lib/futures-model.ts";
import { futuresEvidence, gradeFuturesSelection } from "./futures-evidence.ts";
import { playoffTiming } from "./playoff-timing.ts";

const titles = {
 future_champion: "League Champion",
 future_playoffs: "Make / Miss Playoffs",
 future_win_total: "Regular-Season Wins",
 future_first_pick: "#1 Pick",
 future_first_clinch: "First Team to Clinch Playoffs",
 future_first_elimination: "First Team Eliminated from Playoffs",
} as const;
type Kind = keyof typeof titles;
type ProviderWeek = Parameters<typeof futuresEvidence>[1][number];
type Rules = Parameters<typeof futuresEvidence>[3];
type BracketGame = Parameters<typeof bracketProbabilities>[1][number];
type Team = { id:string; roster_id:number; name:string; manager:string; projection:number };
type Game = {home:number;away:number};
type Quote = { kind:Kind; label:string; subject:string; side:string; line:number|null; odds:number; team_id:string|null;
 metadata:{roster_id?:number; ui_group:string; quote_key:string; cutoff:string; result?:string; playoff_elimination_week?:number;
  elimination_weeks?:Record<string,number>} };
type Source = {
 teams:Team[]; weeks:ProviderWeek[]; season:number; week:number; playoffWeek:number; playoffTeams:number;
 leagueType:number; divisions:number; medianGame:boolean; rules:Rules; winners:BracketGame[]; losers:BracketGame[];
 schedule:{week:number;status:string;date:string}[]; playoffRoundWeeks?:number;
 tradedPicks?:Parameters<typeof firstRoundOwner>[2];
};

function odds(probability:number) {
 const p=Math.min(.99,Math.max(.01,probability*1.0476));
 const price=p>.5?-100*p/(1-p):100/p-100;
 return Math.sign(price)*Math.max(100,Math.round(Math.abs(price)/50)*50);
}

export function buildFutures(input:Source) {
 const {teams,weeks,playoffWeek,playoffTeams,rules,winners,losers,week,schedule}=input;
 const names = new Map(teams.map(team=>[team.roster_id,team.name]));
 const ids = teams.map(team=>team.roster_id);
 const evidence=futuresEvidence(ids,weeks,input,rules,winners,losers);
 const finals=weeks.filter(row=>row.final && row.week<playoffWeek && row.week<=evidence.scoredThroughWeek);
 const timingMode=rules.qualification==='head_to_head'||(rules.qualification==='sleeper'&&!input.divisions&&!input.medianGame);
 const byWeek=weeks.filter(row=>row.week>evidence.scoredThroughWeek&&row.week<playoffWeek).map(row=>{
  const groups=new Map<number,number[]>();
  for(const match of row.matchups) if(match.matchup_id!=null) groups.set(match.matchup_id,[...(groups.get(match.matchup_id)??[]),match.roster_id]);
  return [...groups.values()].filter(group=>group.length===2).map(([home,away])=>({home,away}));
 });
 const models=teams.map(team=>{
  let wins=0,ties=0,points=0;
  const history=finals.flatMap(({matchups})=>{
   const row=matchups.find(row=>row.roster_id===team.roster_id);
   const opponent=row&&matchups.find(other=>other.matchup_id===row.matchup_id&&other.roster_id!==row.roster_id);
   if(!row||!opponent)return [];
   const value=row.custom_points??row.points,against=opponent.custom_points??opponent.points;
   if(value>against)wins++;else if(value===against)ties++;
   points+=value;
   return [value];
  });
  const baseline=history.length?points/history.length:team.projection;
  return {id:team.id,roster_id:team.roster_id,wins,ties,points,...seasonStrength(history,[team.projection>0?team.projection:baseline],400)};
 });
 const standard=!input.divisions&&!input.medianGame;
 const simulations=standard&&week<playoffWeek&&byWeek.length===playoffWeek-1-evidence.scoredThroughWeek
  ? seasonProbabilities(models,byWeek,playoffTeams,input.season,3000):null;
 let bracket:number[]|null=null;
 if(winners.length&&week>=playoffWeek&&!evidence.champion) {
  try { bracket=bracketProbabilities(models,winners,input.season,3000); } catch { /* Wait for a complete bracket. */ }
 }
 let toilet:number[]|null=null;
 if(rules.firstPick==='toilet_bowl'&&losers.length&&week>=playoffWeek&&!evidence.firstPick) {
  const final=losers.find(game=>game.p===1);
  if(final?.t1_from?.l!=null&&final.t2_from?.l!=null){
   const losingBracket=losers.map(game=>({
    ...game,w:game.l,l:game.w,
    t1_from:game.t1_from?{w:game.t1_from.l,l:game.t1_from.w}:undefined,
    t2_from:game.t2_from?{w:game.t2_from.l,l:game.t2_from.w}:undefined,
   }));
   try { toilet=bracketProbabilities(models.map(model=>({...model,mean:1000-model.mean})),losingBracket,input.season,3000); }
   catch { /* Wait for a complete toilet-bowl bracket. */ }
  }
 }
 const quotes:Quote[]=[];
 const cutoff=(target:number)=>{
  const day=schedule.filter(row=>row.week===target).map(row=>row.date).sort()[0];
  // Sleeper's date has no kickoff. Close before any NFL game on that date.
  return day?new Date(day+'T04:00:00Z').toISOString():null;
 };
 const nextWindow=evidence.scoredThroughWeek+1;
 const preGameClose=cutoff(nextWindow)??cutoff(playoffWeek);
 const regularClose=cutoff(playoffWeek-1);
 const championshipWeek=playoffWeek+Math.ceil(Math.log2(playoffTeams))*(input.playoffRoundWeeks??1)-1;
 const championshipClose=cutoff(championshipWeek);
 function add(kind:Kind,side:string,probability:number|null,deadline:string|null,team?:Team,line:number|null=null) {
  if(!deadline)return;
  const grade=gradeFuturesSelection({kind,side,rosterId:team?.roster_id,line:line??undefined},evidence);
  const extreme=probability===0||probability===1;
  const unpriced=probability==null||!Number.isFinite(probability);
  if(!team&&!grade&&unpriced)return;
  const identity=kind==='future_champion'||kind==='future_first_pick'?kind:`${kind}${team?':'+team.id:''}`;
  const eliminatedWeek=team ? evidence.eliminationWeeks[team.roster_id] : undefined;
  const clinchedWeek=team ? evidence.clinchWeeks[team.roster_id] : undefined;
  const result=grade?kind==='future_first_clinch'||kind==='future_first_elimination'
   ? `Week ${grade.actual} · ${grade.rosters.map(id=>names.get(id)).join(', ')}`
   : kind==='future_win_total'?`${team?.name} · ${grade.actual} wins`
   : kind==='future_playoffs'?`${team?.name} · ${grade.actual?(clinchedWeek!=null?`Clinched in Week ${clinchedWeek}`:'Clinched playoff spot'):eliminatedWeek!=null?`Eliminated in Week ${eliminatedWeek}`:'Missed playoffs'}`
   : names.get(grade.actual):undefined;
  const closeReason=grade?undefined:
   kind==='future_champion'&&eliminatedWeek!=null?`Eliminated in Week ${eliminatedWeek}`:
   kind==='future_first_pick'&&team&&evidence.firstPickEliminationWeeks[team.roster_id]!=null?
    `Out of contention in Week ${evidence.firstPickEliminationWeeks[team.roster_id]}`:
   kind==='future_playoffs'&&extreme?((probability===1)===(side==='make')?'Projected to make playoffs':'Projected to miss playoffs'):
   extreme?'Outcome outside the pricing range':unpriced?'Waiting for verified pricing data':undefined;
  const owner=kind==='future_first_pick'&&team&&input.tradedPicks
   ? teams.find(row=>row.roster_id===firstRoundOwner(team.roster_id,input.season+1,input.tradedPicks)):null;
  const label=side==='over'||side==='under'?`${side==='over'?'Over':'Under'} ${line}`
   : side==='make'?'Make Playoffs':side==='miss'?'Miss Playoffs'
   : owner&&team?`${team.name} · Pick held by ${owner.name} (${owner.manager})`:team?.name??titles[kind];
  quotes.push({kind,side,odds:odds(probability??.5),line,team_id:team?.id??null,label,
   subject:team?.name??titles[kind],metadata:{roster_id:team?.roster_id,ui_group:identity,
    quote_key:`${identity}:${side}`,cutoff:deadline,result,close_reason:closeReason,playoff_clinch_week:clinchedWeek,playoff_elimination_week:eliminatedWeek}});
 }
 for(const [i,team] of teams.entries()) {
  const price=simulations?.[i];
  add('future_champion',team.id,bracket?.[i]??price?.champion??null,championshipClose,team);
  add('future_playoffs','make',price?.playoffs??null,regularClose,team);
  add('future_playoffs','miss',price?1-price.playoffs:null,regularClose,team);
  if(price){
   add('future_win_total','over',price.win_over,regularClose,team,price.win_line);
   add('future_win_total','under',1-price.win_over,regularClose,team,price.win_line);
  }
  if(input.leagueType===2&&rules.firstPick!=='disabled'){
   add('future_first_pick',team.id,rules.firstPick==='regular_season'?price?.last??null:toilet?.[i]??null,
    rules.firstPick==='regular_season'?regularClose:championshipClose,team);
  }
 }
 const timingLine=Math.max(nextWindow,evidence.scoredThroughWeek+1)+.5;
 if(timingLine<playoffWeek||evidence.clinch||evidence.elimination){
  const horizon=Math.floor(timingLine)-evidence.scoredThroughWeek;
  const probabilities=timingMode&&simulations&&byWeek[horizon-1]
   ? timingPrices(models,byWeek,horizon,playoffTeams,input.season):null;
  for(const [kind,event,under] of [
   ['future_first_clinch',evidence.clinch,probabilities?.clinch],
   ['future_first_elimination',evidence.elimination,probabilities?.elimination],
  ] as const){
   const deadline=preGameClose??regularClose;
   if(event||(under!=null&&timingLine<playoffWeek)) {
    add(kind,'over',under==null?null:1-under,deadline,undefined,timingLine);
    add(kind,'under',under??null,deadline,undefined,timingLine);
   }
  }
 }
 for(const [kind,weeks] of [['future_champion',evidence.eliminationWeeks],['future_first_pick',evidence.firstPickEliminationWeeks]] as const){
  const first=quotes.find(quote=>quote.kind===kind);
  if(first) first.metadata.elimination_weeks=Object.fromEntries(teams.flatMap(team=>{
   const week=weeks[team.roster_id];
   return week==null?[]:[[team.id,week]];
  }));
 }
 return {quotes,evidence,names};
}

function timingPrices(models:{roster_id:number;wins:number;ties:number;mean:number;sd:number}[], schedule:Game[][], horizon:number, spots:number, seed:number) {
 let state=seed>>>0;
 const uniform=()=>{state=(1664525*state+1013904223)>>>0;return (state+.5)/4294967296;};
 const normal=()=>Math.sqrt(-2*Math.log(uniform()))*Math.cos(2*Math.PI*uniform());
 const trials=160,remaining=schedule.slice(horizon).flat();
 let clinched=0,eliminated=0;
 for(let trial=0;trial<trials;trial++){
  const records=new Map(models.map(model=>[model.roster_id,2*model.wins+model.ties]));
  for(const week of schedule.slice(0,horizon)) {
   const scores=new Map(models.map(model=>[model.roster_id,model.mean+model.sd*normal()]));
   for(const {home,away} of week){
    const winner=scores.get(home)!>scores.get(away)!?home:away;
    records.set(winner,records.get(winner)!+2);
   }
  }
  const result=playoffTiming([...records].map(([rosterId,recordUnits])=>({rosterId,recordUnits})),remaining,spots);
  if(result.clinched.length)clinched++;
  if(result.eliminated.length)eliminated++;
 }
 return {clinch:(clinched+.5)/(trials+1),elimination:(eliminated+.5)/(trials+1)};
}
