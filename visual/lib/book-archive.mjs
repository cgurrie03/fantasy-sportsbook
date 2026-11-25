// Loaded only by the authenticated archive request, never by price polling.
export async function loadArchive(read,league){
 const [context,teams]=await Promise.all([
  read(`rest/v1/leagues?id=eq.${league}&select=nfl_season,active_week&limit=1`),
  read(`rest/v1/teams?league_id=eq.${league}&select=id,roster_id,team_name`)
 ]);
 const season=context[0]?.nfl_season,week=context[0]?.active_week;
 if(!season)throw Error('Archive context unavailable');
 const [weeks,lines]=await Promise.all([
  read(`rest/v1/league_result_weeks?league_id=eq.${league}&nfl_season=eq.${season}&final=eq.true&select=market_week,results&order=market_week.asc&limit=18`),
  read(`rest/v1/opening_market_benchmarks?league_id=eq.${league}&nfl_season=eq.${season}&kind=eq.spread&select=market_week,team_id,line`)
 ]);
 const opening=new Map(lines.filter(r=>r.line!=null).map(r=>[`${r.market_week}:${r.team_id}`,Number(r.line)]));
 const roster=new Map(teams.map(t=>[t.id,t.roster_id]));
 const matchupHistory=[];
 const spreadHistory=weeks.flatMap(w=>{
  const games=new Map();
  for(const [id,row] of Object.entries(w.results)){if(row.matchup_id==null||!roster.has(id)||typeof row.points!=='number')continue;
   const game=games.get(row.matchup_id)||[];game.push({id,roster:roster.get(id),...row});games.set(row.matchup_id,game);}
  return [...games.values()].filter(game=>game.length===2).flatMap(game=>{
   const [a,b]=game.sort((a,b)=>a.roster-b.roster),official=opening.get(`${w.market_week}:${a.id}`)??-opening.get(`${w.market_week}:${b.id}`);
   matchupHistory.push({week:w.market_week,roster:a.roster,points:a.points,opponent:b.roster,against:b.points},
    {week:w.market_week,roster:b.roster,points:b.points,opponent:a.roster,against:a.points});
   if(!Number.isFinite(official)&&(!Number.isFinite(a.projection)||!Number.isFinite(b.projection)))return [];
   const gap=a.projection-b.projection,spread=Number.isFinite(official)?official:(gap>0?-1:1)*(Math.floor(Math.abs(gap))+.5),source=Number.isFinite(official)?'opening':'reconstructed';
   return [{week:w.market_week,roster:a.roster,points:a.points,opponent:b.roster,against:b.points,spread,source},
    {week:w.market_week,roster:b.roster,points:b.points,opponent:a.roster,against:a.points,spread:-spread,source}];
  });
 });
 const feedRecap=weeks.filter(w=>w.market_week>=week-1).flatMap(w=>{
  const high=Object.entries(w.results).filter(([,r])=>Number.isFinite(r.points)).sort((a,b)=>b[1].points-a[1].points)[0],team=high&&teams.find(t=>t.id===high[0]);
  return team?[{category:'Week Recap',title:`${team.team_name} led Wk. ${w.market_week} with ${high[1].points.toFixed(2)}`,detail:''}]:[];
 });
 return {matchupHistory,spreadHistory,feedRecap};
}
