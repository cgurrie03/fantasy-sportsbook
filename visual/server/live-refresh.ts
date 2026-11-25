import {deliverPush,ensurePushKeys,type PushDevice} from "./notification-push.ts";
import {createEmailBoard,renderNotificationEmail,renderAccountEmail,notificationKinds,type NotificationEvent} from "./notification-templates.ts";
import {isSwitchableEmail,renderLeagueSwitcherEmail} from "./email-switcher.ts";
import {settleDevWeeks} from "./dev-results.ts";
import {buildDevBook} from "./dev-pricing.ts";
import {bracketLabel,findBracketGame} from "./postseason.ts";
import {historicalTeamNames,injuryStories,tradeStories} from "./league-feed.ts";
import {refreshFutures} from "./dev-futures-refresh.ts";
import {refreshRewards} from "./dev-reward-refresh.ts";
import {marketWeek} from "./weekly-rollover.ts";
import {workerTarget} from './runtime-target.ts';
import {productionRunPolicy} from './release-worker-policy.ts';
const LEAGUE='1312126153980391424';
const API='https://api.sleeper.app/v1/';
const url=Deno.env.get('SUPABASE_URL')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const runtime=workerTarget({target:Deno.env.get('BOFF_RELEASE_TARGET'),schema:Deno.env.get('BOFF_RELEASE_SCHEMA'),url});
const PROJECT=runtime?.projectRef;
const headers={apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'};
async function db(path:string,method='GET',body?:unknown){const r=await fetch(`${url}/rest/v1/${path}`,{method,headers:{...headers,Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('cache_unavailable');return r.status===204?null:r.json()}
async function fetchSource(path:string){const r=await fetch(path,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});if(!r.ok)throw Error(path.startsWith(API)?'sleeper_source_unavailable':'nfl_source_http_'+r.status);return r.json()}
function sharedSources(read=fetchSource){
 const requests=new Map<string,Promise<any>>();
 return (path:string)=>{
  const existing=requests.get(path);
  if(existing)return existing;
  const request=read(path).catch(error=>{requests.delete(path);throw error;});
  requests.set(path,request);
  return request;
 };
}
const iso=(ms:number)=>new Date(ms).toISOString();
function nextRefresh(now:number,minutes:number){const step=minutes*60000;return iso((Math.floor(now/step)+1)*step)}
function isLoading(_now:Date){return false}
function compactGames(schedule:any,week:number){if(!Array.isArray(schedule)||schedule.length>400)throw Error('invalid_nfl_schedule');return schedule.filter((e:any)=>e.week===week).slice(0,32).map((e:any)=>{if(!e.game_id||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||!e.home||!e.away)throw Error('invalid_nfl_game');return {id:String(e.game_id),gameDate:e.date,state:e.status==='complete'?'final':e.status==='in_game'?'in_progress':e.status==='pre_game'?'scheduled':e.status==='canceled'?'cancelled':'unknown',name:String(e.status||''),teams:[e.away,e.home]}})}
function cadence(games:any[],now:number){
 if(games.some(g=>g.state==='in_progress'))return 1;
 if(games.some(g=>g.finalObservedAt&&now-Date.parse(g.finalObservedAt)<3600000))return 15;
 if(games.some(g=>g.state==='unknown'))return 15;
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 // Sleeper's schedule has a date, not a precise kickoff. Refresh conservatively all game day.
 if(games.some(g=>g.state==='scheduled'&&g.gameDate<=today))return 15;
 return 60;
}
// Postgres JSONB returns object keys in its own order. Compare JSON values,
// preserving array order and nulls, rather than rewriting an identical TOAST value.
function orderedJson(value:any):any {
 if(Array.isArray(value))return value.map(orderedJson);
 if(value!==null&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,orderedJson(value[k])]));
 return value;
}
function currentPatch(payload:any,previous:any,now:number,minutes:number,count:number) {
 if(new TextEncoder().encode(JSON.stringify(payload)).length>120000)throw Error('payload_budget_exceeded');
 const patch:any={fetched_at:iso(now),next_refresh_at:nextRefresh(now,minutes),lease_until:iso(0),error_code:null,refresh_count:count+1};
 if(JSON.stringify(orderedJson(payload))!==JSON.stringify(orderedJson(previous)))patch.payload=payload;
 return patch;
}
async function save(key:string,payload:any,now:number,minutes:number,count:number,previous:any) {
 await db(`dev_live_cache?key=eq.${key}`,'PATCH',currentPatch(payload,previous,now,minutes,count));
}
Deno.serve(async(req:Request)=>{
 if(!runtime)return new Response('Wrong Environment',{status:503});
 const cors={"Access-Control-Allow-Origin":runtime.origin,"Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return new Response('Method Not Allowed',{status:405});
 if(new URL(url).hostname!==`${PROJECT}.supabase.co`)return new Response('Wrong Environment',{status:503});
 const source=sharedSources();
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');
 if(!/^[a-f0-9]{64}$/.test(token)){
  const respond=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
  if(!token||token===service)return respond({error:'Commissioner sign-in required'},401);
  try{
   if(runtime.name==='production'){
    const marker=await db('rpc/application_environment_identity','POST',{});
    if(marker?.release_state!=='active')return respond({error:'Production release is not active'},503);
   }
   const input=await req.json();
   if(input?.action!=='refresh_futures'||!Number.isInteger(input.revision))return respond({error:'Invalid refresh request'},400);
   const leagueId='13121261-5398-4391-8240-000000000003';
   if(input.leagueId&&input.leagueId!==leagueId)return respond({error:'League unavailable'},403);
   const access=await fetch(`${url}/rest/v1/rpc/dev_futures_rules`,{
    method:'POST',headers:{...headers,Authorization:`Bearer ${token}`},
    body:JSON.stringify({p_league:leagueId}),signal:AbortSignal.timeout(10000),
   });
   if(!access.ok)return respond({error:'Commissioner access required'},403);
   const saved=await access.json();
   if(saved.revision!==input.revision)return respond({error:'Futures rules changed. Reload the settings and try again.'},409);
   const [league]=await db(`dev_live_cache?key=eq.league:${LEAGUE}&select=payload`);
   const state=await source(API+'state/nfl');
   if(Number(state.season)!==saved.season||!Number.isInteger(state.week)||Number(league?.payload?.metadata?.season)!==saved.season)
    return respond({error:'Sleeper season data is still loading.'},503);
   const schedule=await source(`https://api.sleeper.app/schedule/nfl/regular/${saved.season}`);
   await refreshFutures(db,source,saved.season,state.week,schedule,league.payload,saved.revision);
   const futures=await db('rpc/read_dev_futures','POST',{p_league:leagueId,p_season:saved.season});
   if(!futures?.board||futures.rulesRevision!==saved.revision)return respond({error:'Futures pricing is still loading.'},503);
   return respond(futures);
  }catch(e){
   console.error('dev_futures_manual_retry',e instanceof Error?e.message:'unknown');
   return respond({error:'The futures board could not be refreshed. Try again.'},503);
  }
 }
 let claimed=false;
 try{
 const [control]=await db('dev_live_cache?key=eq.control&select=payload');const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==control?.payload?.tokenHash)return new Response('Unauthorized',{status:401});
 const marker=await db('rpc/application_environment_identity','POST',{});if(marker?.project_ref!==PROJECT||marker?.environment!==runtime.name||
  runtime.name==='production'&&marker?.release_schema!=='boff-person-wallets-2026-11')throw Error('wrong_environment');
 let productionPolicy:ReturnType<typeof productionRunPolicy>|undefined;
 if(runtime.name==='production'){
  const input=await req.json().catch(()=>({}));
  productionPolicy=productionRunPolicy(marker,await db('rpc/production_refresh_runtime','POST',{}),input.action??'scheduled',hash);
 }
 const now=Date.now();const [nfl]=await db(`dev_live_cache?key=eq.nfl&next_refresh_at=lte.${encodeURIComponent(iso(now))}&lease_until=lte.${encodeURIComponent(iso(now))}`,'PATCH',{lease_until:iso(now+180000)});
 if(!nfl)return Response.json({status:'not_due'});claimed=true;
 const providerState=await source(API+'state/nfl');
 const state={...providerState};
 const schedule=await source(`https://api.sleeper.app/schedule/nfl/regular/${state.season}`);
 if(!/^\d{4}$/.test(String(state.season))||!Number.isInteger(state.week)||state.week<1||state.week>22)throw Error('invalid_sleeper_state');
 state.week=marketWeek(schedule,state.week,now);
 if(productionPolicy&&(Number(state.season)!==productionPolicy.season||state.week<productionPolicy.openingWeek))throw Error('source_before_release_baseline');
 const games=compactGames(schedule,state.week).map(g=>({...g,finalObservedAt:g.state==='final'?(nfl.payload.games?.find((old:any)=>old.id===g.id)?.finalObservedAt||iso(now)):null})),minutes=cadence(games,now);const [old]=await db(`dev_live_cache?key=eq.league:${LEAGUE}`);
 const prior=old.payload;
 const due=!old.fetched_at||old.error_code||old.next_refresh_at<=iso(now)||prior.week!==state.week||prior.weeklyLoading!==isLoading(new Date(now))||(minutes<prior.cadenceMinutes);
 const [priceBook]=await db('dev_current_book?league_id=eq.13121261-5398-4391-8240-000000000003&select=valid_until');
 const pricingDue=due||!priceBook?.valid_until||Date.parse(priceBook.valid_until)<=now+5*60000;
 if(due){
  const metadataDue=prior.week!==state.week||!prior.metadataAt||prior.metadata?.settings?.leagueType==null||!prior.metadata?.teams?.every((team:any)=>'ownerId' in team)||now-Date.parse(prior.metadataAt)>3600000;
  let metadata=prior.metadata;
  if(metadataDue){const [league,rosters,users]=await Promise.all([source(API+'league/'+LEAGUE),source(API+'league/'+LEAGUE+'/rosters'),source(API+'league/'+LEAGUE+'/users')]);if(league.season!==String(state.season)||!Array.isArray(rosters)||rosters.length>64||!Array.isArray(users))throw Error('invalid_league_metadata');
   const playoffStart=league.settings?.playoff_week_start;let seeds=prior.metadata?.seeds||{};
   const explicit=rosters.map((r:any)=>[r.roster_id,r.settings?.playoff_seed]);
   if(explicit.every(([,seed]:any)=>Number.isInteger(seed)&&seed>0)&&new Set(explicit.map(([,seed]:any)=>seed)).size===rosters.length)seeds=Object.fromEntries(explicit);
   else if(state.week===playoffStart&&league.settings?.playoff_seed_type===0&&!league.settings?.divisions&&!rosters.some((r:any)=>r.settings?.division!=null)){const ranked=[...rosters].sort((a:any,b:any)=>((b.settings?.wins||0)+(b.settings?.ties||0)*.5)-((a.settings?.wins||0)+(a.settings?.ties||0)*.5)||(b.settings?.fpts||0)+(b.settings?.fpts_decimal||0)/100-(a.settings?.fpts||0)-(a.settings?.fpts_decimal||0)/100||(b.settings?.fpts_against||0)+(b.settings?.fpts_against_decimal||0)/100-(a.settings?.fpts_against||0)-(a.settings?.fpts_against_decimal||0)/100);seeds=Object.fromEntries(ranked.map((r:any,i:number)=>[r.roster_id,i+1]));}
   metadata={seeds,season:league.season,leagueName:league.name,avatar:league.avatar,previousLeagueId:league.previous_league_id,settings:{playoffWeekStart:league.settings?.playoff_week_start,playoffTeams:league.settings?.playoff_teams,playoffType:league.settings?.playoff_type,roundType:league.settings?.playoff_round_type,seedType:league.settings?.playoff_seed_type,leagueType:league.settings?.type,divisions:league.settings?.divisions??0,medianGame:league.settings?.league_average_match??0},teams:rosters.map((r:any)=>{const u=users.find((u:any)=>u.user_id===r.owner_id);return {rosterId:r.roster_id,ownerId:r.owner_id??null,ownerName:u?.username||u?.display_name||null,coManagers:(r.co_owners??[]).map((id:string)=>{const person=users.find((entry:any)=>entry.user_id===id);return {id,name:person?.username||person?.display_name||id,avatar:person?.avatar??null}}),name:u?.metadata?.team_name||u?.display_name||u?.username||`Team ${r.roster_id}`,avatar:u?.metadata?.avatar||u?.avatar||null,managers:users.filter((u:any)=>[r.owner_id,...r.co_owners||[]].includes(u.user_id)).map((u:any)=>u.username||u.display_name),wins:r.settings?.wins??0,losses:r.settings?.losses??0}})};
  }
  let featureFinalists=prior.featureFinalists;
  if(!featureFinalists && metadata.previousLeagueId){
   const past=String(metadata.previousLeagueId);
   const [bracket,rosters]=await Promise.all([
    source(API+`league/${past}/winners_bracket`),source(API+`league/${past}/rosters`),
   ]).catch(()=>[null,null]);
   const final=Array.isArray(bracket)?bracket.find((game:any)=>game.p===1&&game.w&&game.l):null;
   if(final&&Array.isArray(rosters)){
    const owners=[final.w,final.l].map(id=>rosters.find((roster:any)=>roster.roster_id===id)?.owner_id);
    featureFinalists=owners.flatMap(owner=>owner?metadata.teams.find((team:any)=>team.ownerId===owner)?.rosterId??[]:[]);
   }
  }
  const rows=await source(API+`league/${LEAGUE}/matchups/${state.week}`);if(!Array.isArray(rows)||rows.length!==metadata.teams.length)throw Error('invalid_matchups');
  const matchups=rows.map((r:any)=>{if(!Number.isInteger(r.roster_id)||!Array.isArray(r.starters)||r.starters.length>64)throw Error('invalid_roster');return {rosterId:r.roster_id,matchupId:r.matchup_id??null,points:Number.isFinite(r.custom_points)?r.custom_points:Number.isFinite(r.points)?r.points:null,starters:r.starters.map(String),starterPoints:(r.starters_points||[]).map((p:any)=>Number.isFinite(p)?p:null)}});
  const postseason=!!metadata.settings.playoffWeekStart&&state.week>=metadata.settings.playoffWeekStart;
  let brackets=prior.brackets||null;if(postseason&&(metadataDue||!brackets)){const [winners,losers]=await Promise.all([source(API+`league/${LEAGUE}/winners_bracket`),source(API+`league/${LEAGUE}/losers_bracket`)]);brackets={winners,losers};}
  const rounds:any[]=[];
  if(postseason&&brackets){const round=metadata.settings.roundType===0?state.week-metadata.settings.playoffWeekStart+1:undefined;const pairs=new Map<number,number[]>();for(const r of matchups)if(r.matchupId!=null)pairs.set(r.matchupId,[...(pairs.get(r.matchupId)||[]),r.rosterId]);
   for(const [matchupId,ids] of pairs){if(ids.length!==2)continue;const win=round?findBracketGame(brackets.winners,ids[0],ids[1],round):undefined,lose=round?findBracketGame(brackets.losers,ids[0],ids[1],round):undefined;const final=brackets.losers.find((g:any)=>g.p===1),inputs=[final?.t1_from,final?.t2_from].filter(Boolean);const lower=inputs.length&&inputs.every((x:any)=>x.l!=null)?'toilet':inputs.length&&inputs.every((x:any)=>x.w!=null)?'consolation':null;rounds.push({matchupId,label:win?bracketLabel(win,brackets.winners,'playoffs'):lose&&lower?bracketLabel(lose,brackets.losers,lower):'Postseason',formatVerified:!!(win||(lose&&lower))});}
  }
  await save('league:'+LEAGUE,{rounds,metadata,featureFinalists,metadataAt:metadataDue?iso(now):prior.metadataAt,week:state.week,cadenceMinutes:minutes,weeklyLoading:isLoading(new Date(now)),postseason,brackets,matchups,feed:prior.feed,futuresAt:prior.week===state.week?prior.futuresAt:null,rewardEvidence:prior.week===state.week?prior.rewardEvidence:null,pricingStatus:'not_connected',acceptanceEnabled:false},now,minutes,old.refresh_count,old.payload);
 }
 if(pricingDue){
  let pricingStage='teams';
  try{
   const teams=await db('teams?league_id=eq.13121261-5398-4391-8240-000000000003&select=*');
   if(teams.length){
    pricingStage='build';
    const [previousBook]=await db('dev_current_book?league_id=eq.13121261-5398-4391-8240-000000000003&select=payload');
    const oldBook=previousBook?.payload;
    const [currentLeague]=await db(`dev_live_cache?key=eq.league:${LEAGUE}&select=payload`);
    const cache=currentLeague.payload;
    const lastFeed=cache.feed;
    const sameWeek=lastFeed?.week===state.week&&lastFeed?.season===state.season;
    const tradeDue=!sameWeek||lastFeed.format!==5||!lastFeed.tradeAt||Date.parse(lastFeed.tradeAt)+3600000<=now;
    const players=oldBook?.players??[];
    const transactions=tradeDue?await source(API+`league/${LEAGUE}/transactions/${state.week}`).catch(()=>null):null;
    const tradeNews=Array.isArray(transactions)?tradeStories(transactions,cache.metadata.teams,players,state.week):[];
    const pastId=cache.metadata?.previousLeagueId;
    let historicalNews=sameWeek?(lastFeed.history??[]):[];
    let historyAt=sameWeek?lastFeed.historyAt:null;
    if (tradeDue&&/^\d+$/.test(pastId??'')&&(lastFeed?.format!==5||!historicalNews.length||Date.parse(lastFeed.historyAt??0)+86400000<=now)) {
     const past=API+`league/${pastId}`;
     const [pastLeague,pastTeams,pastUsers,pastTrades,pastScores]=await Promise.all([
      source(past),source(past+'/rosters'),source(past+'/users'),
      source(past+`/transactions/${state.week}`),source(past+`/matchups/${state.week}`),
     ]).catch(()=>[]);
     if (pastLeague&&Number(pastLeague.season)===Number(state.season)-1&&Array.isArray(pastTeams)
       &&Array.isArray(pastUsers)&&Array.isArray(pastTrades)&&Array.isArray(pastScores)) {
      const names=historicalTeamNames(pastTeams,pastUsers,cache.metadata.teams);
      historyAt=iso(now);
      const pickSeasons=new Set(pastTrades.flatMap((trade:any)=>(trade.draft_picks??[]).map((pick:any)=>String(pick.season))));
      const drafted:Record<string,string>={};
      for(const [id,season] of [[pastId,String(pastLeague.season)],[LEAGUE,String(state.season)]]){
       if(!pickSeasons.has(season))continue;
       const drafts=await source(API+`league/${id}/drafts`).catch(()=>[]);
       const draft=drafts.find((item:any)=>String(item.season)===season&&item.status==='complete'&&item.settings?.rounds<=8);
       if(!draft)continue;
       const [picks,draftRosters]=await Promise.all([
        source(API+`draft/${draft.draft_id}/picks`).catch(()=>[]),
        id===pastId?Promise.resolve(pastTeams):source(API+`league/${id}/rosters`).catch(()=>[]),
       ]);
       const slots=new Map<number,number>(draftRosters.flatMap((row:any)=>{
        const slot=draft.draft_order?.[row.owner_id];
        return Number.isInteger(slot)?[[slot,row.roster_id]]:[];
       }));
       for(const pick of picks){
        const original=draft.slot_to_roster?.[pick.draft_slot]??slots.get(pick.draft_slot);
        const name=[pick.metadata?.first_name,pick.metadata?.last_name].filter(Boolean).join(' ');
        if(original&&name)drafted[[season,pick.round,original].join(':')]=name;
       }
      }
      historicalNews=tradeStories(pastTrades,names,players,state.week,Number(pastLeague.season),drafted);
      const top=pastScores.filter((row:any)=>Number.isFinite(row.custom_points??row.points))
       .sort((a:any,b:any)=>(b.custom_points??b.points)-(a.custom_points??a.points))[0];
      const team=top&&names.find((row:any)=>row.rosterId===top.roster_id);
      if (team) historicalNews.push({
       id:`history:high:${pastLeague.season}:${state.week}`,category:'This Week in History',
       title:`${team.name} led Wk. ${state.week}`,
       detail:`${pastLeague.season} · ${Number(top.custom_points??top.points).toFixed(2)} fantasy points`,
      });
      const namedPlayers=new Map<string,string>(players.map((player:any)=>[String(player.id),player.name]));
      const performances=pastScores.flatMap((row:any)=>(row.starters??[]).flatMap((id:string)=>{
       const name=namedPlayers.get(String(id)),points=row.players_points?.[id];
       return name&&Number.isFinite(points)?[{name,points}]:[];
      })).sort((a:any,b:any)=>b.points-a.points);
      if (performances[0]) historicalNews.push({
       id:`history:player:${pastLeague.season}:${state.week}`,category:'This Week in History',
       title:`${performances[0].name} scored ${performances[0].points.toFixed(2)}`,
       detail:`${pastLeague.season} · Wk. ${state.week} fantasy points`,
      });
      if(state.week>=pastLeague.settings?.playoff_week_start){
       const bracket=await source(past+'/winners_bracket').catch(()=>[]);
       const round=pastLeague.settings?.playoff_round_type===0?state.week-pastLeague.settings.playoff_week_start+1:null;
       const result=Array.isArray(bracket)&&round!=null?bracket.find(game=>game.r===round&&game.w&&game.l):null;
       const winner=result&&names.find((row:any)=>row.rosterId===result.w);
       const loser=result&&names.find((row:any)=>row.rosterId===result.l);
       if(winner&&loser)historicalNews.push({
        id:`history:playoff:${pastLeague.season}:${state.week}`,category:'Playoff History',
        title:`${winner.name} defeated ${loser.name}`,
        detail:`${pastLeague.season} · ${bracketLabel(result,bracket,'playoffs')}`,
       });
      }
     }
    }
    const opening=Number(oldBook?.season)===Number(state.season)&&oldBook?.week===state.week?oldBook.openingTargets:undefined;
    const book=await buildDevBook(teams,state.week,minutes,opening,source);
    const existing=sameWeek?(lastFeed.news??[]):[];
    const firstDay=schedule.filter((game:any)=>game.week===state.week).map((game:any)=>game.date).sort()[0];
    const weekStart=Date.parse(firstDay+'T00:00:00Z')-2*86400000;
    const injuryChanges=injuryStories(lastFeed?.injuries??{},book.payload.players,state.week,weekStart);
    const finalPlayers=new Set(book.payload.players.filter((player:any)=>player.gameState==='post').map((player:any)=>player.id));
    const merged=[...tradeNews,...injuryChanges.stories,...existing.filter((row:any)=>
     !['Injury Report','Injury Update'].includes(row.category)||(lastFeed.format===5&&!finalPlayers.has(row.playerId)))];
    const news=merged.filter((story,index)=>merged.findIndex(row=>row.id===story.id)===index).slice(0,24);
    const feed={format:5,historyAt,week:state.week,season:state.season,history:historicalNews,news,
     injuries:injuryChanges.latest,tradeAt:Array.isArray(transactions)?iso(now):sameWeek?lastFeed.tradeAt:null};
    if (JSON.stringify(orderedJson(feed))!==JSON.stringify(orderedJson(lastFeed))) {
     await db(`dev_live_cache?key=eq.league:${LEAGUE}`,'PATCH',{payload:{...cache,feed}});
    }
    pricingStage='publish';
    await db('rpc/publish_dev_book','POST',{p_league:'13121261-5398-4391-8240-000000000003',p_book:book});
   }
  }catch(e){console.error('dev_pricing_failed',e instanceof Error?e.message:'unknown');await db('dev_current_book?league_id=eq.13121261-5398-4391-8240-000000000003'+(e instanceof Error&&e.message==='pricing_live_clock_unavailable'?'&payload->>gamesActive=eq.false':'&valid_until=lt.'+iso(Date.now())),'PATCH',{last_error:('pricing_'+pricingStage+'_'+(e instanceof Error?e.message:'unknown')).slice(0,120)});}
 }
 let settled=0;if(!productionPolicy?.warmup)try{settled=await settleDevWeeks(db,state,schedule,source)}catch{console.error('dev_settlement_retry');}
 const [futuresCache]=await db(`dev_live_cache?key=eq.league:${LEAGUE}&select=payload`);
 const lastFutures=futuresCache.payload.futuresAt;
 let rewardEvidence=futuresCache.payload.rewardEvidence;
 if(!productionPolicy?.warmup&&(!lastFutures||now-Date.parse(lastFutures)>=30*60000))try{
  const evidence=await refreshFutures(db,source,Number(state.season),state.week,schedule,futuresCache.payload);
  rewardEvidence=evidence&&{clinchWeeks:evidence.clinchWeeks,champion:evidence.champion,eliminationWeeks:evidence.eliminationWeeks};
  await db(`dev_live_cache?key=eq.league:${LEAGUE}`,'PATCH',{payload:{...futuresCache.payload,futuresAt:iso(now),rewardEvidence}});
 }catch(e){console.error('dev_futures_retry',e instanceof Error?e.message:'unknown');}
 try{if(!productionPolicy?.warmup&&(!productionPolicy||state.week>productionPolicy.openingWeek))await refreshRewards(db,Number(state.season),state.week,now,futuresCache.payload,rewardEvidence)}
 catch(e){console.error('dev_rewards_retry',e instanceof Error?e.message:'unknown');}
 if(!productionPolicy||productionPolicy.notificationsEnabled)try{
  const leagueId="13121261-5398-4391-8240-000000000003";
  const events=await db("rpc/dev_notification_candidates","POST",{p_league:leagueId});
  const keys=events.some((event:any)=>event.devices?.length)?await ensurePushKeys(db):null;
  const origin=runtime.origin,path="/"+LEAGUE;
  const emailBoard=events.some((event:any)=>event.email)?await Promise.all([
   db(`dev_current_book?league_id=eq.${leagueId}&select=payload`).then(rows=>rows[0]?.payload??{}).catch(()=>({})),
   [],
  ]):null;
  for(const event of events){
   if(!notificationKinds.includes(event.kind)&&event.kind!=="confirmation")continue;
   let details=event.details;
   let edition;
   if(event.email&&(event.withDetails===true||event.kind==="confirmation")&&!isSwitchableEmail(event.kind)){
    const keyTicket=["settled","confirmation"].includes(event.kind)?event.key.split(":")[1]:null;
    edition=await db("rpc/dev_email_edition","POST",{p_league:leagueId,p_user:event.userId,p_kind:event.kind,
     p_week:Number(event.details?.Week??state.week),p_ticket:keyTicket});
   }
   const visual=emailBoard?createEmailBoard(emailBoard[0],emailBoard[1],origin,path,event.teamId,futuresCache.payload.metadata?.leagueName):undefined;
   if(visual)visual.edition=edition;
   let message;
   if(event.kind==="confirmation"){
    if(!visual?.edition?.tickets?.[0])throw Error('confirmation_ticket_unavailable');
    message=renderAccountEmail('confirmation',visual,details,visual.edition.tickets[0]);
   }else message=renderNotificationEmail(event.kind as NotificationEvent,event.withDetails===true,details,
    origin,path,futuresCache.payload.metadata?.leagueName,visual);
   if(event.email&&isSwitchableEmail(event.kind)){
    const reports=await db("rpc/dev_email_switcher","POST",{p_user:event.userId,p_kind:event.kind,p_week:Number(event.details?.Week??state.week),p_primary:leagueId});
    if(reports.length)message=renderLeagueSwitcherEmail(reports,event.kind,origin,leagueId);
   }
   if(event.email)await db("rpc/dev_capture_notification","POST",{p_league:leagueId,p_user:event.userId,p_key:event.key,
    p_kind:event.kind,p_subject:message.subject,p_html:message.html,p_text:message.text});
   const deliveries=await Promise.allSettled((keys?event.devices??[]:[]).map((device:PushDevice)=>deliverPush(db,leagueId,event.key,device,keys!,message.subject,origin)));
   if(deliveries.some(delivery=>delivery.status==="rejected"))console.error("dev_notification_push_retry");
  }
 }catch{console.error("dev_notification_capture_retry");}
 await save('nfl',{season:state.season,week:state.week,games,activeGames:games.filter(g=>g.state==='in_progress').length,cadenceMinutes:minutes},now,minutes===1?1:5,nfl.refresh_count,nfl.payload);
 return Response.json({status:'refreshed',leagueRefreshed:!!due,cadenceMinutes:minutes,settled,mode:productionPolicy?.warmup?'warmup':'scheduled'});
 }catch(e){const code=e instanceof Error&&/^[a-z_0-9]{1,60}$/.test(e.message)?e.message:'refresh_failed';if(claimed){const retry=nextRefresh(Date.now(),5);await Promise.allSettled(['nfl','league:'+LEAGUE].map(key=>db(`dev_live_cache?key=eq.${key}`,'PATCH',{error_code:code,next_refresh_at:retry,lease_until:iso(0)})))}return Response.json({status:'refresh_failed',code},{status:503})}
});
