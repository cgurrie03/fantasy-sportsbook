import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {offlineGateway} from './offline-production-gateway.mjs';
import {loadOfflineWorker} from './load-offline-worker.mjs';
import bookHandler from '../../visual/api/book.mjs';
import liveHandler from '../../visual/api/live-book.mjs';
import memberHandler from '../../visual/dist/api/membership.mjs';
import intakeHandler from '../../visual/dist/api/league-intake.mjs';

export async function rehearseProductionRuntime(db){
 const sources=['supabase/production/configure-worker.sql','visual/server/live-refresh.ts','visual/server/release-worker-policy.ts',
  'visual/api/book.mjs','visual/api/live-book.mjs','visual/dist/api/membership.mjs','visual/dist/api/league-intake.mjs',
  'scripts/lib/rehearse-production-runtime.mjs','scripts/lib/offline-production-gateway.mjs','scripts/lib/load-offline-worker.mjs',
  'scripts/lib/rehearse-production-browser.mjs','visual/scripts/test-production-runtime.py','work/production-migration/candidate-manifest.json'];
 const hashFile=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
 const sourceHashes=await Promise.all(sources.map(async path=>({path,sha256:await hashFile(path)})));
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const league='13121261-5398-4391-8240-000000000003',sleeper='1312126153980391424',savedEnv={...process.env},oldFetch=globalThis.fetch;
 const owner=(await q('select user_id from sportsbook_private.platform_owners order by user_id'))[0].user_id;
 const users=await q(`select distinct u.id,u.email,u.email_confirmed_at from auth.users u join public.league_memberships m on m.user_id=u.id
  where m.league_id=$1 and u.email_confirmed_at is not null order by u.id`,[league]);
 const member=users.find(u=>u.id!==owner);assert(member);
 const identities=new Map(users.map(u=>['offline-'+u.id,u]));
 identities.set('offline-unverified',{id:randomUUID(),email:'unverified@example.invalid',email_confirmed_at:null});
 identities.set('offline-outsider',{id:randomUUID(),email:'outsider@example.invalid',email_confirmed_at:new Date().toISOString()});
 const gateway=offlineGateway(db,identities),token=id=>'offline-'+id;
 const env={BOFF_RELEASE_TARGET:'production',BOFF_RELEASE_SCHEMA:'boff-person-wallets-2026-11',SUPABASE_URL:gateway.origin,SUPABASE_SERVICE_ROLE_KEY:gateway.service};
 let phase='setup';
 await db.exec('begin');
 try{
  await q('update public.leagues set operations_enabled=false where id=$1',[league]);
  await q('update public.weekly_schedule set automation_enabled=false where league_id=$1',[league]);
  await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[owner]);
  const jobs=(await q('select public.review_production_jobs($1) r',[league]))[0].r;
  if(jobs.count)await q('select public.retire_production_jobs($1,$2,$3,$4)',[league,jobs.digest,randomUUID(),'Offline runtime integration retirement']);
  const review=(await q('select public.prepare_production_wallet_migration($1) r',[league]))[0].r;
  await q('select public.apply_production_wallet_migration($1,$2)',[review.reviewId,randomUUID()]);
  // Local adapters only: Supabase Vault/pg_cron/pg_net are not installed in PGlite.
  await db.exec(`create schema cron;create schema vault;create schema net;
   create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,command text,active boolean default true);
   create function cron.schedule(name text,schedule text,command text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values(name,schedule,command) returning jobid$$;
   create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=alter_job.active where jobid=job_id$$;
   create table vault.decrypted_secrets(id uuid default gen_random_uuid(),name text unique,decrypted_secret text);
   create function vault.create_secret(value text,name text,description text) returns uuid language sql as $$insert into vault.decrypted_secrets(name,decrypted_secret) values(name,value) returning id$$;
   create function extensions.digest(value text,algorithm text) returns bytea language sql as $$select sha256(convert_to(value,'UTF8'))$$;
   create function extensions.gen_random_bytes(bytes integer) returns bytea language sql as $$select decode(md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),'hex')$$;
   create table net.offline_requests(id bigint generated always as identity,url text,headers jsonb,body jsonb);
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$insert into net.offline_requests(url,headers,body) values(url,headers,body) returning id$$;`);
  const configSql=await fs.readFile('supabase/production/configure-worker.sql','utf8');
  // The tooling file owns its transaction in deployment; fixture owns the rollback.
  await db.exec(configSql.replace(/^BEGIN;\r?\n/m,'').replace(/^COMMIT;\s*$/m,''));
  phase='configuration';
  const configured=(await q('select sportsbook_private.configure_production_worker(2026,11) r'))[0].r;
  assert.equal(configured.schedulerActive,false);
  assert.equal((await q('select sportsbook_private.configure_production_worker(2026,11) r'))[0].r.configured,true);
  assert.equal((await q('select count(*)::int n from cron.job'))[0].n,1);
  const credential=(await q('select decrypted_secret from vault.decrypted_secrets'))[0].decrypted_secret;
  assert(/^[a-f0-9]{64}$/.test(credential));
  assert.equal((await q('select command from cron.job'))[0].command.includes(credential),false);
  await q('select sportsbook_private.dispatch_production_refresh(true)');
  assert.equal((await q('select body from net.offline_requests'))[0].body.action,'warmup');
  const rejected=async(fn,pattern)=>{await db.exec('savepoint expected_runtime_denial');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to expected_runtime_denial;release expected_runtime_denial;reset role');}};
  await rejected(()=>q('select sportsbook_private.configure_production_worker(2026,12)'),/baseline changed/);
  await rejected(()=>q('select sportsbook_private.activate_production_worker($1,0)',[randomUUID()]),/launch approval|fresh current board/);
  globalThis.fetch=gateway.fetch;
  Object.assign(process.env,env,{VERCEL_ENV:'production',VERCEL_PROJECT_ID:'prj_xQNaH7f1SPr8bgn2GV92a9MODQu8'});
  const api=async(handler,url,uid=member.id,method='GET',body)=>{
   let status,data;await handler({url,method,body,headers:{host:'sportsbook.coopergurrie.com',origin:'https://sportsbook.coopergurrie.com',authorization:'Bearer '+(uid.startsWith('offline-')||identities.has(uid)?uid:token(uid))}},
    {setHeader(){},status(code){status=code;return this;},json(value){data=value;return this;}});return {status,data};
  };
  const rpc=async(name,data={},uid=member.id)=>gateway.fetch(gateway.origin+'/rest/v1/rpc/'+name,{method:'POST',headers:{Authorization:'Bearer '+token(uid)},body:JSON.stringify(data)});
  phase='worker fencing';
  let providerCalls=0;
  const worker=loadOfflineWorker(env,async(url,options)=>{
   if(String(url).startsWith(gateway.origin))return gateway.fetch(url,options);
   providerCalls++;throw Error('Source deliberately unavailable in worker boundary test');
  });
  const run=async(action,auth=credential)=>worker.handler(new Request(gateway.origin+'/functions/v1/boff-production-live-refresh',{method:'POST',headers:{Authorization:'Bearer '+auth},body:JSON.stringify({action})}));
  assert.equal((await run('scheduled')).status,503);assert.equal(providerCalls,0,'Prepared worker reached source');
  assert.equal((await run('warmup','f'.repeat(64))).status,401);
  assert.equal((await run('warmup')).status,503);assert.equal(providerCalls,1,'Warmup never reached permitted source');
  const afterFailure=(await q("select error_code,payload from public.dev_live_cache where key='nfl'"))[0];
  assert.equal(afterFailure.error_code,'refresh_failed');assert.deepEqual(afterFailure.payload,{});
  phase='board publication';
  const teams=await q('select * from public.teams where league_id=$1 order by roster_id',[league]);
  const end=new Date(Date.now()+86400000).toISOString(),quotes=[];
  const fixture=JSON.parse(await fs.readFile('visual/src/data.json','utf8'));
  const payloadTeams=teams.map((t,i)=>({...fixture.teams.find(row=>row.roster_id===t.roster_id),...t,name:t.team_name,manager:'Offline Manager '+(i+1),avatar:t.avatar_url,
   record:'5–5',rank:i+1,roster_id:t.roster_id,matchupId:Math.floor(i/2)+1,projection:110+i,observed:0,streak:'1W'}));
  for(let i=0;i<teams.length;i+=2){const a=teams[i],b=teams[i+1],key=String(i/2+1);
   for(const kind of ['moneyline','spread','match_total'])for(const [index,side] of (kind==='match_total'?['over','under']:['home','away']).entries()){
    const team=index===0?a:b,group=key+':'+kind;
    quotes.push({ui_id:group+':'+side,ui_group:group,matchup_key:key,kind,side,label:kind==='moneyline'?team.team_name:kind==='spread'?team.team_name+' '+(index?'+3.5':'-3.5'):(index?'Under ':'Over ')+'225.5',
     subject:kind,line:kind==='moneyline'?null:kind==='spread'?(index?3.5:-3.5):225.5,odds:kind==='moneyline'?(index?120:-140):-110,
     boost_pct:0,featured:null,team_id:kind==='match_total'?null:team.id,home_team_id:a.id,away_team_id:b.id,home_projection:110+i,away_projection:111+i,metadata:{cutoff:end}});
   }
  }
  for (const [index,team] of [teams[0],teams[2]].entries()) quotes.push({ui_id:`offline-prop-${index}`,ui_group:`offline-player-${index}`,matchup_key:String(index+1),kind:'player_points',side:'over',label:`Offline Player ${index+1} Over 10.5`,subject:'Fantasy Points',line:10.5,odds:-110,boost_pct:0,featured:null,team_id:team.id,home_team_id:teams[index*2].id,away_team_id:teams[index*2+1].id,home_projection:110,away_projection:111,metadata:{player_id:`offline-${index}`,cutoff:end}});
  const book={season:2026,week:11,observed_at:new Date().toISOString(),valid_until:new Date(Date.now()+3600000).toISOString(),closes_at:end,quotes,
   payload:{leagueName:'Offline Production Rehearsal',leagueAvatar:null,teams:payloadTeams,players:[],positions:['QB','RB','WR','TE','FLEX'],
    regularSeasonWeeks:14,firstGame:null,gamesActive:false,scoringStarted:false,cadenceMinutes:60,openingTargets:Object.fromEntries(payloadTeams.map(t=>[t.id,t.projection]))}};
  const metadata={season:2026,leagueName:book.payload.leagueName,teams:teams.map(t=>({rosterId:t.roster_id,name:t.team_name,ownerId:t.sleeper_owner_id,coManagers:[]})),settings:{playoffWeekStart:15,playoffTeams:7,roundType:0}};
  await q("update public.dev_live_cache set payload=$1,fetched_at=clock_timestamp(),error_code=null where key=$2",[{metadata,week:11,matchups:payloadTeams.map(t=>({rosterId:t.roster_id,matchupId:t.matchupId,points:0})),cadenceMinutes:60},'league:'+sleeper]);
  await db.exec("set request.jwt.claim.role='service_role'");
  const published=(await q('select public.publish_dev_book($1,$2) r',[league,book]))[0].r;assert.equal(published.quotes,38);
  const beforeActivation=await api(bookHandler,'/api/book');assert.equal(beforeActivation.status,200,'API snapshot: '+JSON.stringify(beforeActivation.data));
  const pick=beforeActivation.data.quotes.find(t=>t.kind==='moneyline');assert(pick);
  const place={boardId:published.board_id,revision:published.revision,picks:[pick.id],stake:5,requestId:randomUUID()};
  assert.notEqual((await api(bookHandler,'/api/book',member.id,'POST',place)).status,200,'Prepared release accepted a bet');
  phase='activation';
  await q("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
  await q(`insert into sportsbook_private.league_launch_approvals(league_id,owner_membership_id,verification_note)
   select $1,membership_id,'Offline fixture approval only; rolled back, no live release approval' from sportsbook_private.platform_owner
   on conflict(league_id) do nothing`,[league]);
  await q('select sportsbook_private.activate_production_worker($1,$2)',[published.board_id,published.revision]);
  assert.equal((await q('select active from cron.job'))[0].active,true);
  assert.equal(Number((await q('select active_week from public.leagues where id=$1',[league]))[0].active_week),11);
  await q('select sportsbook_private.dispatch_production_refresh(false)');
  assert.equal((await q('select body from net.offline_requests order by id desc limit 1'))[0].body.action,'scheduled');
  phase='member API flows';
  const boardClock=(await q('select now() current_time,opens_at,closes_at,status from public.sportsbook_boards where id=$1',[published.board_id]))[0];
  assert(Date.parse(boardClock.opens_at)<=Date.parse(boardClock.current_time)&&Date.parse(boardClock.closes_at)>Date.parse(boardClock.current_time),'Published board clock mismatch: '+JSON.stringify(boardClock));
  assert.equal((await api(bookHandler,'/api/book','offline-unverified')).status,401);
  assert.equal((await api(bookHandler,'/api/book','offline-outsider')).status,403);
  const snapshot=await api(bookHandler,'/api/book');assert.equal(snapshot.status,200);
  phase='authoritative acceptance freshness';
  await q("update public.line_refresh_runtime set market_week=11,observed_at=clock_timestamp()-interval '1 day',week_started=true,last_error='Retired worker fixture' where league_id=$1",[league]);
  const props=snapshot.data.quotes.filter(t=>t.kind==='player_points').map(t=>t.id);assert.equal(props.length,2);
  const propsBet={...place,picks:props,stake:1,requestId:randomUUID()};
  await db.exec('savepoint player_parlay_acceptance');
  const propAccepted=await api(bookHandler,'/api/book',member.id,'POST',propsBet);
  assert.equal(propAccepted.status,200,'Fresh player-points parlay rejected by retired worker: '+JSON.stringify(propAccepted.data));
  await db.exec('rollback to player_parlay_acceptance;release player_parlay_acceptance');
  for(const [name,change] of [
   ['expired',"valid_until=clock_timestamp()-interval '1 second'"],
   ['failed',"last_error='Source unavailable'"],
   ['mismatched',"observed_at=observed_at-interval '1 minute'"]
  ]) {
   await db.exec('savepoint invalid_acceptance_lease');
   await q(`update public.dev_current_book set ${change} where league_id=$1`,[league]);
   assert.notEqual((await api(bookHandler,'/api/book',member.id,'POST',{...propsBet,requestId:randomUUID()})).status,200,name+' current book accepted a parlay');
   await db.exec('rollback to invalid_acceptance_lease;release invalid_acceptance_lease');
  }
  assert.notEqual((await api(bookHandler,'/api/book',member.id,'POST',{...propsBet,revision:published.revision-1,requestId:randomUUID()})).status,200,'Stale revision accepted');
  const feedResponse=await api(liveHandler,'/api/live-book');assert.equal(feedResponse.status,200,'Feed: '+JSON.stringify(feedResponse.data));
  assert.equal((await api(liveHandler,'/api/live-book','offline-outsider')).status,403);
  const accepted=await api(bookHandler,'/api/book',member.id,'POST',place);assert.equal(accepted.status,200,'Placement: '+JSON.stringify(accepted.data));
  phase='duplicate placement';const duplicate=await api(bookHandler,'/api/book',member.id,'POST',place);assert.equal(duplicate.status,200,'Duplicate: '+JSON.stringify(duplicate.data));assert.equal(duplicate.data.ticket_id,accepted.data.ticket_id);
  phase='ticket history';const mine=await api(bookHandler,'/api/book?history=tickets&mine=1');assert.equal(mine.status,200,'History: '+JSON.stringify(mine.data));
  phase='ledger';assert.equal((await api(bookHandler,'/api/book?history=ledger')).status,200);
  phase='claims';const claim=await rpc('dev_credit_claim',{p_league:league});assert.equal(claim.status,200,'Claim: '+await claim.text());
  phase='communications';
  const preferences=await rpc('dev_save_communications',{p_league:league,p_choices:{settled:{email:true,push:true}},p_revision:null,p_routine:null});assert.equal(preferences.status,200,'Preferences: '+await preferences.text());
  phase='futures';assert.equal((await rpc('read_dev_futures',{p_league:league,p_season:2026})).status,403,'Futures cache reader must stay server-only');
  assert.equal((await gateway.fetch(gateway.origin+'/rest/v1/rpc/read_dev_futures',{method:'POST',headers:{Authorization:'Bearer '+gateway.service},body:JSON.stringify({p_league:league,p_season:2026})})).status,200);
  phase='rewards';assert.equal((await rpc('list_dev_fantasy_rewards',{p_league:league})).status,200);
  await db.exec('savepoint reward_redemption_fixture');
  const rewardId=randomUUID();
  await q("insert into boff_dev_internal.fantasy_reward_runs(league_id,season,week,source_digest,qualified) values($1,2026,10,md5('Offline reward redemption fixture'),'[]')",[league]);
  await q(`insert into boff_dev_internal.fantasy_reward_awards(id,league_id,season,week,team_id,user_id,achievement,percent,expires_at)
   select $1,$2,2026,10,team_id,user_id,'top_scorer',25,clock_timestamp()+interval '1 day' from public.user_wallets where league_id=$2 and user_id=$3`,[rewardId,league,member.id]);
  const rewardPick=snapshot.data.quotes.find(t=>t.boost_pct===0&&t.kind==='match_total');assert(rewardPick);
  const rewardBet={...place,picks:[rewardPick.id],requestId:randomUUID(),rewardId};
  const redeemed=await api(bookHandler,'/api/book',member.id,'POST',rewardBet);assert.equal(redeemed.status,200,'Reward redemption: '+JSON.stringify(redeemed.data));
  assert.equal((await api(bookHandler,'/api/book',member.id,'POST',rewardBet)).status,200,'Reward retry must be idempotent');
  assert.notEqual((await api(bookHandler,'/api/book',member.id,'POST',{...rewardBet,requestId:randomUUID()})).status,200,'Reward redeemed twice');
  await db.exec('rollback to reward_redemption_fixture;release reward_redemption_fixture;reset role');
  phase='role boundaries';
  assert.notEqual((await rpc('dev_commissioner_members',{p_league:league})).status,200);
  assert.equal((await rpc('dev_commissioner_members',{p_league:league},owner)).status,200);
  assert.notEqual((await rpc('dev_notification_choices',{p_league:randomUUID()})).status,200);
  assert.equal((await api(intakeHandler,'/api/league-intake',member.id,'POST',{action:'discover'})).status,403);
  const deniedInvitation=await api(memberHandler,'/api/membership',member.id,'POST',{action:'invite',requestId:randomUUID(),teamId:teams[0].id,
   sleeperId:teams[0].sleeper_owner_id,coManager:false,expected:null,email:'not-invited@example.invalid',reason:'Offline authorization boundary verification'});
  assert.equal(deniedInvitation.status,403,'Invitation authorization: '+JSON.stringify(deniedInvitation.data));
  assert.equal((await rpc('production_refresh_runtime')).status,403);
  phase='settlement';
  const ticketId=accepted.data.ticket_id??accepted.data.ticketId;assert(ticketId,'Accepted response has no ticket identifier');
  await db.exec("reset role;set request.jwt.claim.role='service_role'");
  const legs=await q('select id from public.ticket_legs where ticket_id=$1',[ticketId]);
  await rejected(()=>q('select public.settle_dev_ticket($1,$2)',[ticketId,legs.map(l=>({id:l.id,status:'WON',actual_value:125,evidence:'Offline premature settlement must be rejected'}))]),/settlement window/);
  // Simulate the later finalization window only for this new fixture board.
  await q("update public.sportsbook_boards set closes_at=clock_timestamp()-interval '7 hours',opens_at=clock_timestamp()-interval '1 day' where id=$1",[published.board_id]);
  await db.exec("set request.jwt.claim.role='service_role'");
  await q('select public.settle_dev_ticket($1,$2)',[ticketId,legs.map(l=>({id:l.id,status:'WON',actual_value:125,evidence:'Offline final scores: 125–110'}))]);
  assert.equal((await api(bookHandler,'/api/book?ticket='+ticketId)).status,200);
  phase='credit claim write';await db.exec('savepoint claim_write_fixture');
  await q('update public.user_wallets set balance=75 where league_id=$1 and user_id=$2',[league,member.id]);
  await q(`insert into boff_dev_internal.credit_claim_state(wallet_id,last_claim_at)
   select id,clock_timestamp()-interval '25 hours' from public.user_wallets where league_id=$1 and user_id=$2
   on conflict(wallet_id) do update set last_claim_at=excluded.last_claim_at`,[league,member.id]);
  const claimRequest=randomUUID(),claimResponse=await rpc('dev_credit_claim',{p_league:league,p_request:claimRequest});
  assert.equal(claimResponse.status,200);const claimed=await claimResponse.json();assert.equal(Number(claimed.claimed),50);assert.equal(Number(claimed.balance),125);
  const repeatClaim=await rpc('dev_credit_claim',{p_league:league,p_request:claimRequest});assert.equal(repeatClaim.status,200);assert.equal(Number((await repeatClaim.json()).balance),125);
  assert.notEqual((await rpc('dev_credit_claim',{p_league:league,p_request:randomUUID()})).status,200);
  await db.exec('rollback to claim_write_fixture;release claim_write_fixture;reset role');
  // Production notification suppression and no transport remain intact after all actions.
  assert.equal((await q("select count(*)::int n from boff_dev_internal.notification_capture"))[0].n,0);
  assert.equal((await q('select count(*)::int n from auth.users'))[0].n,11);
  let browser;
  if(process.argv.includes('--browser')){
   phase='browser acceptance';const commissioner=users.find(u=>u.id!==owner&&u.id!==member.id);assert(commissioner);
   await q("update public.league_memberships set role='admin' where league_id=$1 and user_id=$2",[league,commissioner.id]);
   const {rehearseProductionBrowser}=await import('./rehearse-production-browser.mjs');
   browser=await rehearseProductionBrowser(gateway,identities,api,{'/api/book':bookHandler,'/api/live-book':liveHandler,'/api/membership':memberHandler,'/api/league-intake':intakeHandler},
    [{name:'member',id:member.id},{name:'commissioner',id:commissioner.id},{name:'owner',id:owner}]);
  }
  for(const file of sourceHashes)assert.equal(await hashFile(file.path),file.sha256,'Runtime source changed during rehearsal');
  return {source_hashes:sourceHashes,configuration_idempotent:true,secret_only_in_vault:true,scheduler_staged_disabled:true,prepared_worker_denied:true,
   warmup_source_failure_safe:true,reviewed_board_activation:true,current_week_reconciled:true,actual_api_snapshot_and_feed:true,
   actual_placement_duplicate_history_settlement:true,claim_and_communications:true,claim_write_retry_once:true,reward_redeemed_once:true,futures_rewards_read:true,
   member_commissioner_owner_boundaries:true,unverified_outsider_and_cross_league_denied:true,
   no_accounts_or_emails_created:true,browser,transport:'offline Auth/JWT, pg_cron, pg_net and Vault adapters; real upgraded SQL and actual API/worker source',rolled_back:true};
 }catch(error){error.message='Production runtime '+phase+': '+error.message;throw error;}
 finally{globalThis.fetch=oldFetch;for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];Object.assign(process.env,savedEnv);await db.exec('rollback;reset role');}
}
