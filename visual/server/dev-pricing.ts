import {candidates,lineupWithReplacements,score} from './line-model.ts';
const LEAGUE='1312126153980391424';
const half=(n:number)=>Math.floor(Math.abs(n))+.5;
const rounded=(n:number)=>Math.round(n*100)/100;
const american=(p:number)=>{p=Math.min(.99,Math.max(.01,p));const n=p<=.5?(1/p-1)*100:-100*p/(1-p);return Math.sign(n)*Math.max(100,Math.round(Math.abs(n)/10)*10)};
const houseMargin=1.0476;
const price=(fair:number)=>american(fair*houseMargin);
// Approximate a standard normal CDF with error below 1e-6.
const normal=(z:number)=>{
 const t=1/(1+.2316419*Math.abs(z));
 const tail=Math.exp(-z*z/2)/Math.sqrt(2*Math.PI)*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
 return z<0?tail:1-tail;
};
async function source(url:string){const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('pricing_source_'+new URL(url).hostname+'_'+r.status);return r.json()}
// One source collection is shared by the league. Raw provider bodies are not stored.
export async function buildDevBook(dbTeams:any[], requestedWeek?:number, refreshMinutes?:number, openingTargets?:Record<string,number>, read=source){
 const state=await read('https://api.sleeper.app/v1/state/nfl');
 const season=Number(state.season),week=requestedWeek??Number(state.week);
 if(season!==2026||!Number.isInteger(week)||week<1||week>18||Math.abs(week-Number(state.week))>1)throw Error('pricing_week_mismatch');
 const base='https://api.sleeper.app/v1/league/'+LEAGUE;
 const [league,rosters,users,matchups,projections,seasonStats,gameScores]=await Promise.all([
  read(base),read(base+'/rosters'),read(base+'/users'),read(base+'/matchups/'+week),
  read(`https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular`),
  read(`https://api.sleeper.com/stats/nfl/${season}?season_type=regular`),
  read(`https://api.sleeper.app/scores/nfl/regular/${season}/${week}`)
 ]);
 if(rosters.length!==dbTeams.length||matchups.length!==rosters.length)throw Error('pricing_roster_mismatch');
 if(week<Number(league.settings?.playoff_week_start)){
  const pairs=new Map<number,number>();
  for(const matchup of matchups){
   if(!Number.isInteger(matchup.matchup_id))throw Error('pricing_matchups_unavailable');
   pairs.set(matchup.matchup_id,(pairs.get(matchup.matchup_id)||0)+1);
  }
  if([...pairs.values()].some(count=>count!==2))throw Error('pricing_matchups_unavailable');
 }
 const settings=league.scoring_settings,slots=league.roster_positions.filter((p:string)=>!['BN','IR','TAXI'].includes(p));
 const pool=candidates(projections,settings,[]),byId=new Map(pool.map(p=>[p.id,p])),owned=new Set(rosters.flatMap((r:any)=>r.players||[]));
 const free=pool.filter(p=>!owned.has(p.id));
 const normalize=(team:string)=>({WSH:'WAS',JAC:'JAX',LA:'LAR'} as Record<string,string>)[team]??team;
 const games=new Map<string,{state:string;remaining:number;start:string|null;clockVerified:boolean;opponent:string;homeAway:string}>();
 for(const game of gameScores){
  const meta=game.metadata;
  if(Number(game.week)!==week||Number(game.season)!==season||!meta?.home_team||!meta?.away_team)continue;
  const home=normalize(meta.home_team),away=normalize(meta.away_team);
  const start=Number.isFinite(game.start_time)?new Date(game.start_time).toISOString():null;
  const state=game.status==='complete'?'post':game.status==='in_game'?'in':game.status==='pre_game'?'pre':'unknown';
  const period=Number(meta.quarter_num);
  const clockVerified=state!=='in'||Number.isInteger(period)&&period>=1&&/^\d{1,2}:\d{2}$/.test(meta.time_remaining??'');
  const [minutes,seconds]=clockVerified&&state==='in'?meta.time_remaining.split(':').map(Number):[0,0];
  const remaining=state==='post'?0:state==='pre'?1:Math.max(0,Math.min(1,((period>=5?0:(4-Math.max(1,period))*900)+minutes*60+seconds)/3600));
  games.set(home,{state,remaining,start,clockVerified,opponent:away,homeAway:'home'});
  games.set(away,{state,remaining,start,clockVerified,opponent:home,homeAway:'away'});
 }
 if(!games.size||![...games.values()].some(game=>game.start))throw Error('pricing_schedule_unavailable');
 const gameFor=(team:string)=>games.get(normalize(team));
 const first=[...games.values()].flatMap(g=>g.start?[g.start]:[]).sort()[0];const close=new Date(first);close.setUTCDate(close.getUTCDate()+((9-close.getUTCDay())%7||7));close.setUTCHours(6,0,0,0);
 const scoringStarted=[...games.values()].some(g=>g.state==='in'||g.state==='post');
 const stats=new Map((Array.isArray(seasonStats)?seasonStats:[]).map((p:any)=>[p.player_id,p]));
 const players:any[]=[];
 const teams=rosters.map((r:any)=>{
  const db=dbTeams.find(t=>t.roster_id===r.roster_id);if(!db)throw Error('pricing_team_unmapped');
  const actual=matchups.find((m:any)=>m.roster_id===r.roster_id),managers=[r.owner_id,...(r.co_owners||[])].map(id=>users.find((u:any)=>u.user_id===id)).filter(Boolean),primary=managers[0];
  const lockedSlots=new Set<number>();let lockedRemaining=0,verifiedClock=true;
  (actual.starters||[]).forEach((id:string,i:number)=>{const p=byId.get(id);const g=gameFor(p?.team||projections.find((x:any)=>x.player_id===id)?.team);if(g&&['in','post'].includes(g.state)){lockedSlots.add(i);verifiedClock&&=g.clockVerified;lockedRemaining+=(p?.projection||0)*g.remaining;}});
  const unlocked=(r.players||[]).map((id:string)=>byId.get(id)).filter((p:any)=>p&&gameFor(p.team)?.state==='pre');
  const lineup=lineupWithReplacements(unlocked,free.filter(p=>gameFor(p.team)?.state==='pre'),slots.filter((_:string,i:number)=>!lockedSlots.has(i)));
  if(lineup.missingSlots.length)throw Error('pricing_lineup_incomplete');
  const mean=rounded(Number(actual.custom_points??actual.points??0)+lockedRemaining+lineup.picks.reduce((n:number,p:any)=>n+p.projection,0));
  const currentProjection=rounded(Number(actual.custom_points??actual.points??0)+(actual.starters??[]).reduce((sum:number,id:string)=>{
   const player=byId.get(id);
   return sum+(player?.projection??0)*(player?gameFor(player.team)?.remaining??0:0);
  },0));
  const selected=new Set(lineup.picks.map(p=>p.id));
  for(const id of r.players||[]){const row=projections.find((p:any)=>p.player_id===id),p=byId.get(id);if(!row?.player)continue;const st:any=stats.get(id);const pos=row.player.position;const game=gameFor(row.team);const current=Number(actual.players_points?.[id]??0);players.push({id,name:[row.player.first_name,row.player.last_name].filter(Boolean).join(' '),position:pos,nflTeam:row.team,roster:r.roster_id,starter:selected.has(id)||(actual.starters||[]).some((x:string,i:number)=>x===id&&lockedSlots.has(i)),seasonAverage:st?.stats?.gp?rounded(score(st.stats,settings)/st.stats.gp):null,gamesPlayed:st?.stats?.gp||0,headshot:`https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`,opponent:game?.opponent||row.opponent||'Bye',homeAway:game?.homeAway??'',kickoff:game?.start??null,gameState:game?.state??'bye',clockVerified:game?.clockVerified??false,taxi:r.taxi?.includes(id)??false,current,liveProjection:rounded(current+(p?.projection??0)*(game?.remaining??0)),injuryUpdatedAt:row.player.injury_start_date??null,lineupIndex:(actual.starters||[]).indexOf(id),lineupSlot:slots[(actual.starters||[]).indexOf(id)]||pos,projection:p?.projection||0,injury:row.player.injury_status||'',injuryBody:row.player.injury_body_part||''});}
  const rs=r.settings||{},wins=rs.wins||0,losses=rs.losses||0,ties=rs.ties||0;
  return {id:db.id,roster_id:r.roster_id,name:primary?.metadata?.team_name||db.team_name,avatar:primary?.metadata?.avatar||primary?.avatar||db.avatar_url,manager:primary?.display_name||primary?.username||db.owner_name,managers:managers.map((u:any)=>u.display_name||u.username),managerProfiles:managers.map((u:any)=>({name:u.display_name||u.username,avatar:u.avatar,sleeperId:String(u.user_id)})),wins,losses,ties,games:wins+losses+ties,pointsFor:rounded((rs.fpts||0)+(rs.fpts_decimal||0)/100),pointsAgainst:rounded((rs.fpts_against||0)+(rs.fpts_against_decimal||0)/100),potentialPoints:rounded((rs.ppts||0)+(rs.ppts_decimal||0)/100),streak:r.metadata?.streak||'',clockVerified:verifiedClock,currentProjection,pregameProjection:openingTargets?.[db.id]??(!scoringStarted?mean:undefined),projection:mean,observed:Number(actual.custom_points??actual.points??0),matchupId:actual.matchup_id,lineup:lineup.picks.map(p=>({id:p.id,projection:p.projection,replacement:p.replacement||null}))};
 });
 const quotes:any[]=[];const groups=new Map<number,any[]>();for(const t of teams){if(t.matchupId!=null)groups.set(t.matchupId,[...(groups.get(t.matchupId)||[]),t]);}
 for(const [mid,pair]of groups){if(pair.length!==2)continue;const [away,home]=pair;const matchup=String(mid),total=half(away.projection+home.projection),spread=(away.projection>home.projection?-1:1)*half(away.projection-home.projection),sd=Math.max(14,Math.sqrt(away.projection**2+home.projection**2)*.14);
  const context={model:'dev-sleeper-projection-v1',scoring_settings:settings,roster_positions:league.roster_positions,away_lineup:away.lineup,home_lineup:home.lineup,projection_targets:{[away.id]:away.projection,[home.id]:home.projection},source_week:week};
  const add=(kind:string,side:string,line:number|null,odds:number,t:any=null,suffix='')=>{const id=`${matchup}:${kind}${suffix}:${side}`;quotes.push({ui_id:id,ui_group:`${matchup}:${kind}${suffix}`,matchup_key:matchup,kind,side,line,odds,label:kind==='moneyline'?t.name:kind==='spread'?`${t.name} ${line!>0?'+':''}${line}`:`${side==='over'?'Over':'Under'} ${line}`,subject:t?.name||`${away.name} vs ${home.name}`,team_id:t?.id||null,home_team_id:home.id,away_team_id:away.id,home_projection:home.projection,away_projection:away.projection,metadata:{...context,...(!away.clockVerified||!home.clockVerified?{cutoff:'2000-01-01T00:00:00Z'}: {})},boost_pct:0,featured:''});};
  for(const [side,t,other] of [['away',away,home],['home',home,away]] as any[]){add('spread',side,side==='away'?spread:-spread,-110,t);add('moneyline',side,null,price(normal((t.projection-other.projection)/sd)),t);}
  add('match_total','over',total,-110);add('match_total','under',total,-110);
  for(const delta of [-10,-5,5,10]){
   for(const [side,t,line] of [['away',away,spread+delta],['home',home,-spread-delta]] as any[]){
    add('spread',side,line,price(normal(((t.projection-(side==='away'?home:away).projection)+line)/sd)),t,':alternate:'+delta);
    Object.assign(quotes.at(-1),{ui_id:`alternate-${matchup}-spread-${side}-${line}`,ui_group:`${matchup}:spread`,variant_key:`${matchup}:spread:alternate:${delta}`,metadata:{...quotes.at(-1).metadata,alternate:true}});
   }
   for(const side of ['over','under']){const line=total+delta;add('match_total',side,line,price(normal((side==='over'?1:-1)*(away.projection+home.projection-line)/sd)),null,':alternate:'+delta);Object.assign(quotes.at(-1),{ui_id:`alternate-${matchup}-match_total-${side}-${line}`,ui_group:`${matchup}:match_total`,variant_key:`${matchup}:match_total:alternate:${delta}`,metadata:{...quotes.at(-1).metadata,alternate:true}});}
  }

  for(const t of pair){const line=half(t.projection);for(const side of ['over','under'])add('team_total',side,line,-110,t,':'+t.id);}
  const available=(player:any)=>player&&player.opponent!=='Bye'&&player.projection>0
   && !/^(out|ir|pup|suspended)$/i.test(player.injury)
   && player.gameState==='pre'&&Date.parse(player.kickoff)>Date.now()&&!player.taxi;
  const liveEligible=(player:any)=>player&&(available(player)||['in','post'].includes(player.gameState))&&!player.taxi&&player.clockVerified;
  const headToHead=(awayPlayers:any[],homePlayers:any[],kind:string,slot:string,index?:number)=>{
   const participants=[...awayPlayers,...homePlayers];
   if(!participants.every(liveEligible)||!participants.some(p=>p.gameState!=='post'))return;
   if(kind==='player_h2h'&&(
    awayPlayers[0].gameState==='post'&&homePlayers[0].gameState==='in'&&homePlayers[0].current>awayPlayers[0].current
    || homePlayers[0].gameState==='post'&&awayPlayers[0].gameState==='in'&&awayPlayers[0].current>homePlayers[0].current
   ))return;
   const live=participants.some(p=>p.gameState!=='pre');
   const starts=participants.filter(p=>p.gameState==='pre').map(p=>Date.parse(p.kickoff));
   const deadline=new Date(Math.min(close.getTime(),...starts)).toISOString();
   const projection=(rows:any[])=>rows.reduce((sum,p)=>sum+p.liveProjection,0);
   const a=projection(awayPlayers),b=projection(homePlayers);
   const uncertainty=Math.hypot(...participants.map(p=>p.projection*(gameFor(p.nflTeam)?.remaining??0)));
   const chance=normal((b-a)/Math.max(2,uncertainty*.32));
   const aIds=awayPlayers.map(p=>p.id).sort(),bIds=homePlayers.map(p=>p.id).sort();
   const group=`${matchup}:${kind}:${index??slot}:${aIds.join(',')}:${bIds.join(',')}`;
   for(const [side,members,team,p] of [['away',awayPlayers,away,1-chance],['home',homePlayers,home,chance]] as const){
    const label=kind==='position_group'?`${team.name} · Starting ${slot}s`:members[0].name;
    const uiId=kind==='position_group'?`position-group-${matchup}-${slot}-${side}`:`player-${matchup}-${slot.replaceAll('_',' ')}-${index}-${members[0].id}`;
    quotes.push({ui_id:uiId,ui_group:group,matchup_key:matchup,kind,side,line:null,odds:price(p),label,
     subject:kind==='position_group'?`Starting ${slot}s`:`${awayPlayers[0].name} vs ${homePlayers[0].name}`,
     team_id:team.id,home_team_id:home.id,away_team_id:away.id,home_projection:b,away_projection:a,boost_pct:0,featured:'',
     metadata:{...(kind==='position_group'?{away_player_ids:aIds,home_player_ids:bIds}:{player_id:bIds[0],opponent_player_id:aIds[0]}),slot,live,cutoff:deadline,cutoff_at:deadline}});
   }
  };
  league.roster_positions.forEach((slot:string,index:number)=>{
   if(['K','BN','IR','TAXI'].includes(slot))return;
   const a=players.find(p=>p.roster===away.roster_id&&p.lineupIndex===index);
   const b=players.find(p=>p.roster===home.roster_id&&p.lineupIndex===index);
   if(a&&b&&a.id!==b.id)headToHead([a],[b],'player_h2h',slot,index);
  });
  for(const position of ['QB','RB','WR','TE']){
   const members=(id:number)=>players.filter(p=>p.roster===id&&p.lineupIndex>=0&&p.position===position);
   const a=members(away.roster_id),b=members(home.roster_id);
   if(a.length&&b.length)headToHead(a,b,'position_group',position);
  }
  for(const player of players.filter(p=>pair.some(t=>t.roster_id===p.roster)&&available(p))){
   const team=pair.find(t=>t.roster_id===player.roster);
   const target=half(player.projection);
   const deviation=Math.max(5.8,player.projection*.51);
   const addProp=(kind:string,side:string,line:number,label:string,probability:number)=>{
    const group=`${matchup}:${kind}:${player.id}`;
    quotes.push({ui_id:`prop-${player.id}-${kind==='player_points'?'Fantasy Points':'Milestone Ladders'}-${label}`,
     ui_group:group,variant_key:`${group}:${line}`,matchup_key:matchup,kind,side,line,odds:price(probability),
     label:`${player.name} · ${label} Fantasy Points`,subject:player.name,team_id:team.id,
     home_team_id:home.id,away_team_id:away.id,boost_pct:0,featured:'',
     metadata:{player_id:player.id,cutoff:player.kickoff,cutoff_at:player.kickoff}});
   };
   for(const side of ['over','under']){
    const probability=normal((side==='over'?player.projection-target:target-player.projection)/deviation);
    addProp('player_points',side,target,`${side==='over'?'Over':'Under'} ${target}`,probability);
   }
   for(const line of [10,15,20,25]) addProp('player_milestone','at_least',line,`${line}+`,
    normal((player.projection-line)/deviation));
  }
 }
 if(quotes.length<36||teams.some((t:any)=>!Number.isFinite(t.projection)||t.projection<=0))throw Error('pricing_incomplete');
 const active=[...games.values()].some(g=>g.state==='in');const minutes=refreshMinutes??(active?5:60);
 if(first&&Date.parse(first)>Date.now()){
  const projections=teams.map(t=>t.projection);
  const targets=Object.fromEntries(teams.map(t=>[t.id,openingTargets?.[t.id]??t.projection]));
  const add=(kind:string,title:string,side:string,line:number|null,probability:number,label:string,teamId:string|null=null,variant?:string)=>{
   quotes.push({ui_id:`special-${title}-${variant??side}`,ui_group:kind,variant_key:`${kind}:${variant??side}`,
    kind,side,line,odds:price(probability),label,subject:title,team_id:teamId,boost_pct:0,featured:'',
    metadata:{cutoff:first,expected_team_count:teams.length,...(kind==='weekly_count_projection'?{projection_targets:targets}:{})}});
  };
  const teamDeviation=(projection:number)=>Math.max(16,projection*.18);
  const above=(projection:number,line:number)=>normal((projection-line)/teamDeviation(projection));
  // Integrate each team's score density against the other teams' CDFs.
  const extremeProbabilities=(sign:number)=>{
   const bins=160, step=12/bins;
   const weights=projections.map((mean,i)=>{
    let probability=0;
    for(let bin=0;bin<bins;bin++){
     const z=-6+(bin+.5)*step;
     const score=mean+z*teamDeviation(mean);
     const allOthers=projections.reduce((chance,other,j)=>j===i?chance:
      chance*(sign===1?1-above(other,score):above(other,score)),1);
     probability+=Math.exp(-z*z/2)/Math.sqrt(2*Math.PI)*allOthers*step;
    }
    return probability;
   });
   const sum=weights.reduce((a,b)=>a+b,0);
   return weights.map(w=>w/sum);
  };
  for(const [kind,title,sign] of [['weekly_high','Top Scorer',1],['weekly_low','Lowest Scorer',-1]] as const){
   const weights=extremeProbabilities(sign);
   teams.forEach((t,i)=>add(kind,title,t.id,null,weights[i],`${t.name} · ${title}`,t.id));
  }
  for(const [kind,title,line,below] of [['weekly_any_below_100','Any Team Below 100',100,true],['weekly_any_200','Any Team Scoring 200+',200,false]] as const){
   const no=projections.reduce((chance,p)=>chance*(below?above(p,line):1-above(p,line)),1);
   add(kind,title,'yes',null,1-no,`Yes · ${title}`);add(kind,title,'no',null,no,`No · ${title}`);
  }
  for(const [kind,title,mean] of [['weekly_average','League Average',projections.reduce((a,b)=>a+b,0)/teams.length],['weekly_highest_score','Highest Score',Math.max(...projections)]] as const){
   const averageDeviation=Math.hypot(...projections.map(teamDeviation))/projections.length;
   // Use the median of the maximum distribution for a competitive highest-score line.
   let target=mean;
   if(kind==='weekly_highest_score'){
    let low=Math.min(...projections), high=mean+6*Math.max(...projections.map(teamDeviation));
    for(let i=0;i<32;i++){
     const mid=(low+high)/2;
     const under=projections.reduce((chance,p)=>chance*(1-above(p,mid)),1);
     if(under<.5)low=mid;else high=mid;
    }
    target=(low+high)/2;
   }
   const line=half(target);
   const under=kind==='weekly_average'?normal((line-mean)/averageDeviation):projections.reduce((chance,p)=>chance*(1-above(p,line)),1);
   add(kind,title,'over',line,1-under,`Over ${line} · ${title}`);add(kind,title,'under',line,under,`Under ${line} · ${title}`);
  }
  for(const [kind,title] of [['weekly_count_150','Teams Scoring 150+'],['weekly_count_projection','Teams Beating Projection']] as const){
   const counts=[1,...teams.map(()=>0)];
   projections.forEach((p,i)=>{
    const chance=above(p,kind==='weekly_count_150'?150:targets[teams[i].id]);
    for(let j=i+1;j>=0;j--) counts[j]=counts[j]*(1-chance)+(counts[j-1]??0)*chance;
   });
   for(let n=kind==='weekly_count_150'?1:0;n<=teams.length;n++){
    add(kind,title,String(n),n,counts[n],`Exactly ${n} Teams · ${title}`,null,`exact-${n}`);
    if(n>0) add(kind,title,`${n}+`,n,counts.slice(n).reduce((a,b)=>a+b,0),`At Least ${n} Teams · ${title}`,null,`atleast-${n}`);
   }
  }
 }
 return {week,season,observed_at:new Date().toISOString(),valid_until:new Date(Date.now()+(minutes===1?2:minutes+5)*60000).toISOString(),closes_at:close.toISOString(),quotes,payload:{week,season,leagueName:league.name,leagueAvatar:league.avatar,teams,players,regularSeasonWeeks:league.settings.playoff_week_start-1,scoring:settings,positions:league.roster_positions,firstGame:first,cadenceMinutes:minutes,pricingModel:'Dev Projection Pricing',openingTargets:openingTargets??(!scoringStarted?Object.fromEntries(teams.map(t=>[t.id,t.projection])):undefined),gamesActive:active,scoringStarted}};
}
