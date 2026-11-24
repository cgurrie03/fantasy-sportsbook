import {loadArchive} from '../lib/book-archive.mjs';
import {serverTarget} from '../lib/release-target.mjs';
const LEAGUE='13121261-5398-4391-8240-000000000003';
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
 let input,params;
 try{
  params=new URL(req.url,'https://dev.sportsbook.coopergurrie.com').searchParams;
  const allowed=new Set(['ticket','prices','account','version','futures','offers','history','mine','status','week','participant','search','sort','cursor','size','archive']);
  for(const name of params.keys())if(!allowed.has(name)||params.getAll(name).length!==1)throw Error();
  if(params.has('ticket')&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(params.get('ticket')))throw Error();
  if(['mine','status','week','participant','search','sort','cursor','size'].some(name=>params.has(name))&&!params.has('history'))throw Error();
  if(['version','futures','offers','account'].some(name=>params.has(name))&&!params.has('prices'))throw Error();
  if([params.has('history'),params.has('prices'),params.has('ticket'),params.has('archive')].filter(Boolean).length>1)throw Error();
  if(params.has('archive')&&params.size>1)throw Error();
  if(req.method==='POST'&&params.size)throw Error();
  for(const name of ['prices','account','mine','archive'])if(params.has(name)&&params.get(name)!=='1')throw Error();
  if(params.has('version')&&!/^[a-zA-Z0-9:_-]{1,180}$/.test(params.get('version')))throw Error();
  if(params.has('offers')&&!/^[a-f0-9]{32}$/.test(params.get('offers')))throw Error();
  if(params.has('futures')&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}:[1-9][0-9]{0,9}:(published|draft|closed|paused)$/.test(params.get('futures')))throw Error();
  if(params.has('history')&&!['tickets','ledger'].includes(params.get('history')))throw Error();
  if(params.has('status')&&!['All','Open','Won','Lost','Push','Voided'].includes(params.get('status')))throw Error();
  if(params.has('sort')&&!['newest','oldest','stake-high','stake-low'].includes(params.get('sort')))throw Error();
  if(params.has('week')&&!/^(?:[1-9]|1[0-8])$/.test(params.get('week')))throw Error();
  if(params.has('size')&&(!/^[1-9][0-9]{0,2}$/.test(params.get('size'))||Number(params.get('size'))>100))throw Error();
  if(params.has('participant')&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(params.get('participant')))throw Error();
  if((params.get('search')??'').length>100)throw Error();
  if(params.has('cursor')){
   const raw=params.get('cursor');if(raw.length>256)throw Error();const cursor=JSON.parse(raw);
   if(!cursor||typeof cursor!=='object'||Array.isArray(cursor)||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(cursor.id))throw Error();
   if(params.get('history')==='ledger'){if(typeof cursor.time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.time)||!Number.isFinite(Date.parse(cursor.time)))throw Error();}
   else if(typeof cursor.value!=='string'||!/^\d{1,16}(?:\.\d{1,10})?$/.test(cursor.value))throw Error();
  }
  if(req.method==='POST'){
   const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body??null);
   if(Buffer.byteLength(raw)>32768)return res.status(413).json({error:'Request is too large'});
   input=JSON.parse(raw);if(!input||typeof input!=='object'||Array.isArray(input))throw Error();
   const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
   if(!uuid(input.boardId)||!uuid(input.requestId)||!Number.isSafeInteger(input.revision)||input.revision<0||
    !Array.isArray(input.picks)||input.picks.length<1||input.picks.length>10||!input.picks.every(uuid)||
    !Number.isFinite(input.stake)||input.stake<=0||input.rewardId&&!uuid(input.rewardId)||
    input.offerSlot&&(typeof input.offerSlot!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(input.offerSlot))||
    input.futures!==undefined&&typeof input.futures!=='boolean')throw Error();
  }
 }catch{return res.status(400).json({error:'Invalid request parameters or JSON'});}
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!serverTarget(process.env))return res.status(503).json({error:'League service unavailable'});
 const token=(req.headers.authorization||'').replace(/^Bearer /,'');
 if(!token||token===key)return res.status(401).json({error:'Sign in to your account'});
 const read=async(path,method='GET',body,asUser=false)=>{const r=await fetch(`${url}/${path}`,{method,headers:{apikey:key,Authorization:`Bearer ${asUser?token:key}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok){const e=Error(data.message||data.msg||'Request failed');e.status=r.status;throw e}return data;};
 try{
  const user=await read('auth/v1/user','GET',undefined,true);
  if(!user.id||!user.email_confirmed_at)return res.status(401).json({error:'Verified sign-in required'});
  const members=await read(`rest/v1/league_memberships?league_id=eq.${LEAGUE}&user_id=eq.${user.id}&select=id,team_id,display_name,role,sleeper_user_id`);
  const member=members[0]??await read('rest/v1/rpc/dev_co_manager_account','POST',{p_league:LEAGUE,p_user:user.id});
  if(!member)return res.status(403).json({error:'Your account is not mapped to this league'});
  if(params.get('archive')==='1')return res.status(200).json(await loadArchive(read,LEAGUE));
  if(req.method==='POST'){
   if(req.headers.origin&&req.headers.origin!==`https://${req.headers.host}`)return res.status(403).json({error:'Invalid request origin'});
   const b=input;
   if(!b||!Array.isArray(b.picks)||b.picks.length<1||b.picks.length>10||!Number.isFinite(b.stake)||!b.requestId)return res.status(400).json({error:'Invalid ticket'});
   if(b.offerSlot&&(b.rewardId||b.futures))return res.status(400).json({error:'Only one boost may be applied'});
   const result=await read(b.offerSlot?'rest/v1/rpc/place_dev_weekly_offer':b.rewardId?'rest/v1/rpc/place_dev_reward':b.futures?'rest/v1/rpc/place_dev_future':'rest/v1/rpc/place_dev_ticket','POST',{
    p_board:b.boardId,p_revision:b.revision,p_picks:b.picks,p_stake:b.stake,p_request:b.requestId,...(b.rewardId?{p_reward:b.rewardId}:{}),...(b.offerSlot?{p_slot:b.offerSlot}:{})},true);
   return res.status(200).json(result);
  }
  if(req.method!=='GET'){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'})}
  if(params.has('history')){
   const cursor=params.has('cursor')?JSON.parse(params.get('cursor')):null,size=Number(params.get('size')??25);
   return res.status(200).json(await read(params.get('history')==='ledger'?'rest/v1/rpc/dev_balance_history_page':'rest/v1/rpc/dev_ticket_history_page','POST',{
    p_league:LEAGUE,p_cursor:cursor,p_size:size,...(params.get('history')==='tickets'?{p_mine:params.get('mine')==='1',p_status:params.get('status')??'All',
     p_week:params.has('week')?Number(params.get('week')):null,p_participant:params.get('participant')??null,p_search:params.get('search')??'',p_sort:params.get('sort')??'newest'}:{})
   },true));
  }
  if(params.has('ticket')){
   const id=params.get('ticket');
   if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))return res.status(404).json({error:'Ticket unavailable'});
   const rows=await read(`rest/v1/tickets?league_id=eq.${LEAGUE}&id=eq.${id}&select=*,ticket_legs(*)&limit=1`, 'GET',undefined,true);
   return rows.length?res.status(200).json({ticket:rows[0]}):res.status(404).json({error:'Ticket unavailable'});
  }
  const version=params.get('version');
  const lean=params.has('prices') && !params.has('account');
  const offerVersion=params.get('offers');
  const [update,offerUpdate]=await Promise.all([
   version && version.length<=180
    ? read('rest/v1/rpc/dev_weekly_changes','POST',{p_league:LEAGUE,p_version:version}) : null,
   read('rest/v1/rpc/dev_weekly_offer_changes','POST',{p_league:LEAGUE,p_version:/^[a-f0-9]{32}$/.test(offerVersion??'')?offerVersion:null},true).catch(()=>null),
  ]);
  const futuresId=params.get('futures') ?? '';
  const futuresKey=update?.futures ? `${update.futures.id}:${update.futures.revision}:${update.futures.status}` : '';
  if(lean && update?.mode==='unchanged' && futuresId===futuresKey){
   return res.status(200).json({...update,offerUpdate,lightweight:true});
  }
  const incremental=update && update.mode!=='snapshot';
  const wallet=await read(`rest/v1/user_wallets?league_id=eq.${LEAGUE}&user_id=eq.${user.id}&select=id,balance,status`, 'GET',undefined,true);
  const [current,teams,tickets,entries,capabilities]=await Promise.all([
   incremental?update:read('rest/v1/rpc/dev_weekly_snapshot','POST',{p_league:LEAGUE}),read(`rest/v1/teams?league_id=eq.${LEAGUE}&select=*,wallets(balance)`),
   lean?[]:Promise.all([
    read(`rest/v1/tickets?league_id=eq.${LEAGUE}&select=id,team_id,user_wallet_id,bettor_display_name,nfl_season,market_week,placed_at,stake,status,accepted_combined_odds,accepted_potential_payout,actual_payout,ticket_legs(*)&order=placed_at.desc,id.desc&limit=10`, 'GET',undefined,true),
    wallet[0]?read(`rest/v1/tickets?league_id=eq.${LEAGUE}&user_wallet_id=eq.${wallet[0].id}&select=id,team_id,user_wallet_id,bettor_display_name,nfl_season,market_week,placed_at,stake,status,accepted_combined_odds,accepted_potential_payout,actual_payout,ticket_legs(*)&order=placed_at.desc,id.desc&limit=8`, 'GET',undefined,true):[]
   ]).then(pages=>[...new Map(pages.flat().map(row=>[row.id,row])).values()].sort((a,b)=>Date.parse(b.placed_at)-Date.parse(a.placed_at)||b.id.localeCompare(a.id))),
   // Team-level legacy entries have no immutable person ownership. Keep them in
   // the archive; a current team mapping must never grant personal history.
   [],
   lean?null:read('rest/v1/rpc/league_capabilities','POST',{p_league:LEAGUE},true).catch(()=>null)
  ]);
  if(!current?.board)return res.status(503).json({error:'Current prices are loading'});
  const {book,board,quotes}=current;
  const payload=book.payload??{};
  const [cache,feedPreferences]=await Promise.all([
   read('rest/v1/dev_live_cache?key=eq.league:1312126153980391424&select=payload->feed').catch(()=>[]),
   read('rest/v1/rpc/dev_league_feed_preferences','POST',{p_league:LEAGUE},true).catch(()=>({})),
  ]);
  const keepFutures=!!update && futuresId===futuresKey;
  const futures=keepFutures?null:await read('rest/v1/rpc/read_dev_futures','POST',{p_league:LEAGUE,p_season:board.nfl_season}).catch(()=>null);
  const futuresBoard=keepFutures?update.futures:futures?.board??null, futuresQuotes=keepFutures?undefined:futures?.quotes??[];
  const standingsWallets=await read('rest/v1/rpc/dev_standings_wallets','POST',{p_league:LEAGUE},true).catch(()=>null);
  const feedArchive=[...(payload.leagueFeed??[]),...(payload.leagueFeedHistory??[])];
  const rewardFeed=await read('rest/v1/rpc/dev_reward_feed','POST',{p_league:LEAGUE,p_season:board.nfl_season,p_week:board.market_week-1}).catch(()=>[]);
  const feed=cache[0]?.feed;
  if(feed?.week===board.market_week&&Number(feed.season)===board.nfl_season)feedArchive.push(...(feed.news??[]),...(feed.history??[]));
  return res.status(200).json({book,board,quotes,version:current.version,mode:current.mode??"snapshot",changes:current.changes,offerUpdate,futuresBoard,futuresQuotes,teams,tickets,feedPreferences,feedArchive,rewardFeed,standingsWallets,ledger:entries,balance:wallet[0]?.balance??null,user:{id:user.id,email:user.email,walletId:wallet[0]?.id,name:member.display_name,sleeperId:member.sleeper_user_id,teamId:member.team_id,role:member.role,platformOwner:capabilities?.platform_owner===true,commissioner:member.role==='admin'||capabilities?.platform_owner===true},leagueId:LEAGUE});
 }catch(e){const message=e.message||'Dev service unavailable';return res.status(e.status===401?401:e.status===403?403:e.status>=500?503:/changed|expired|available|suspended|selection|market|balance|wager|pick/i.test(message)?409:e.status===400?400:503).json({error:message})}
}
