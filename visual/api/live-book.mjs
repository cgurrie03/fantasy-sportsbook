// Source cache endpoint. No provider calls or writes on page requests.
import {serverTarget} from '../lib/release-target.mjs';
const KEY='league:1312126153980391424';
const LEAGUE='13121261-5398-4391-8240-000000000003';
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'method_not_allowed'})}
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!serverTarget(process.env))return res.status(503).json({error:'feed_unavailable'});
 try{
 const authorization=req.headers.authorization;
 if(!authorization?.startsWith('Bearer ')||authorization.slice(7)===key)return res.status(401).json({error:'Verified sign-in required'});
 const userResponse=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:authorization},signal:AbortSignal.timeout(10000)});
 if(!userResponse.ok)return res.status(401).json({error:'Verified sign-in required'});
 const user=await userResponse.json();
 if(!user.id||!user.email_confirmed_at)return res.status(401).json({error:'Verified sign-in required'});
 const memberResponse=await fetch(`${url}/rest/v1/league_memberships?league_id=eq.${LEAGUE}&user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)});
 if(!memberResponse.ok)throw Error();
 const members=await memberResponse.json();
 if(!members.length){
  const coResponse=await fetch(`${url}/rest/v1/rpc/dev_co_manager_account`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({p_league:LEAGUE,p_user:user.id}),signal:AbortSignal.timeout(10000)});
  if(!coResponse.ok)throw Error();
  if(!await coResponse.json())return res.status(403).json({error:'League access required'});
 }
 const r=await fetch(`${url}/rest/v1/dev_live_cache?key=in.(nfl,${KEY})&select=key,payload,fetched_at,next_refresh_at,error_code`,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error();const rows=await r.json(),league=rows.find(r=>r.key===KEY),nfl=rows.find(r=>r.key==='nfl');if(!league||!nfl)throw Error();
 const p=league.payload,m=p.metadata||p;const payload=league.fetched_at?{season:m.season,week:p.week,leagueName:m.leagueName,teams:m.teams.map(({ownerId,...t})=>({...t,seed:m.seeds?.[String(t.rosterId)]??null})),matchups:p.matchups.map(r=>({rosterId:r.rosterId,matchupId:r.matchupId,points:r.points})),weeklyLoading:p.weeklyLoading,postseason:p.postseason,rounds:p.rounds||[]}:null;
 return res.status(200).json({status:league.error_code||nfl.error_code?'delayed':league.fetched_at?'connected':'starting',error:!!(league.error_code||nfl.error_code),fetchedAt:league.fetched_at,nextRefreshAt:league.next_refresh_at,sourceCheckedAt:nfl.fetched_at,gamesActive:nfl.payload.activeGames||0,cadenceMinutes:p.cadenceMinutes||60,payload});
 }catch{return res.status(503).json({error:'dev_feed_unavailable'})}
}
