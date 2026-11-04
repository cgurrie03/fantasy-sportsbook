// Explicitly DEV-only DBA fixture. No Auth key, network client or executor.
export const financialDigestSql = `md5(jsonb_build_object(
'wallets',(select coalesce(jsonb_agg(to_jsonb(x)order by team_id),'[]')from public.wallets x),
'user_wallets',(select coalesce(jsonb_agg(to_jsonb(x)order by id),'[]')from public.user_wallets x),
'tickets',(select coalesce(jsonb_agg(to_jsonb(x)order by id),'[]')from public.tickets x),
'wallet_ledger',(select coalesce(jsonb_agg(to_jsonb(x)order by id),'[]')from public.wallet_ledger x),
'user_wallet_entries',(select coalesce(jsonb_agg(to_jsonb(x)order by id),'[]')from public.user_wallet_entries x))::text)`;
export function dispatchDatabaseProbe(expectedClaimMd5) {
  if (!/^[a-f0-9]{32}$/.test(expectedClaimMd5))
    throw Error("Exact installed claim source MD5 required");
  return `
set local statement_timeout='15s';
set local lock_timeout='2s';
do $probe$
declare
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); owner_id uuid; member_id uuid;
 target uuid; picked public.automation_jobs; i integer; position integer; turns uuid[]:='{}';
 initial_digest text; final_digest text; before_leagues integer; before_reviews integer; before_legacy integer;
 began timestamptz; started timestamptz; durations double precision[]:='{}'; elapsed_ms double precision;
 output jsonb; rolled_back boolean:=false; claim_md5 text;
begin
 if public.application_environment_identity()->>'environment' is distinct from 'development' or
 public.application_environment_identity()->>'project_ref' is distinct from 'whlcnlacueweaqpsupqs'
 then raise exception 'Development identity required';end if;
 select md5(prosrc)into claim_md5 from pg_proc where oid='public.claim_automation_job()'::regprocedure;
 if claim_md5<>'${expectedClaimMd5}'then raise exception 'Installed claim source changed';end if;
 if exists(select 1 from public.leagues where operations_enabled)or
 exists(select 1 from public.weekly_schedule where automation_enabled)or
 exists(select 1 from public.automation_jobs)or exists(select 1 from sportsbook_private.automation_dispatch_state)or
 exists(select 1 from public.tickets)or exists(select 1 from public.outbound_emails)
 then raise exception 'Empty paused Development fixture required';end if;
 if(select count(*)from sportsbook_private.platform_owners)<>1 then raise exception 'One verified independent DEV owner required';end if;
 select o.user_id,m.id into owner_id,member_id from sportsbook_private.platform_owners o
 join auth.users u on u.id=o.user_id and u.email_confirmed_at is not null
 join public.league_memberships m on m.user_id=o.user_id order by m.id limit 1;
 if member_id is null then raise exception 'Existing verified owner membership required';end if;
 initial_digest:=${financialDigestSql};
 select count(*)into before_leagues from public.leagues;
 select count(*)into before_reviews from sportsbook_private.league_launch_approvals;
 select count(*)into before_legacy from sportsbook_private.platform_owner;
 -- This exception block is a PostgreSQL subtransaction. Success deliberately
 -- raises the private rollback code; all fixture DML is undone before the receipt.
 begin
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  if not public.league_intake_owner()then raise exception 'Verified owner check failed';end if;
  if before_legacy=0 then insert into sportsbook_private.platform_owner(membership_id)values(member_id);
  elsif not exists(select 1 from sportsbook_private.platform_owner where membership_id=member_id)
   then raise exception 'Legacy owner binding differs';end if;
  insert into public.leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor)
   values(a,'Rollback dispatch fixture A',('9'||floor(random()*1000000000000000)::bigint)::text,2026,1,5,now()),
         (b,'Rollback dispatch fixture B',('8'||floor(random()*1000000000000000)::bigint)::text,2026,1,5,now());
  insert into sportsbook_private.league_launch_approvals(league_id,owner_membership_id,verification_note)
   values(a,member_id,'Uncommitted synthetic dispatch fixture only; not a live launch approval'),
         (b,member_id,'Uncommitted synthetic dispatch fixture only; not a live launch approval');
  update public.leagues set operations_enabled=true where id in(a,b);
  insert into public.weekly_schedule(league_id,automation_enabled)values(a,true),(b,true);
  perform set_config('request.jwt.claim.role','service_role',true);
  -- Keep the real calendar planner. Complete only its synthetic fixture jobs,
  -- so settlement-priority probes do not accidentally measure calendar arrivals.
  perform sportsbook_private.enqueue_weekly_jobs(now());
  update public.automation_jobs set status='done',completed_at=now(),lease_until=null where league_id in(a,b);
  insert into public.automation_jobs(league_id,event_key,operation,market_week,created_at)
   select a,'rollback-dispatch-a:'||a||':'||n,'settlement',5,now()-interval '30 minutes' from generate_series(1,64)n;
  target:=gen_random_uuid();
  insert into public.automation_jobs(id,league_id,event_key,operation,market_week,created_at)
   values(target,b,'rollback-dispatch-b:'||b,'settlement',5,now()-interval '1 minute');
  began:=clock_timestamp();
  for i in 1..65 loop
   started:=clock_timestamp();select * into picked from public.claim_automation_job();
   durations:=array_append(durations,extract(epoch from(clock_timestamp()-started))*1000);
   if picked.id is null or picked.league_id not in(a,b)or picked.operation<>'settlement'
    then raise exception 'Unexpected synthetic backlog claim';end if;
   if picked.id=target then position:=i;end if;
   update public.automation_jobs set status='done',completed_at=now(),lease_until=null where id=picked.id;
  end loop;
  if position<>2 then raise exception 'Peer backlog turn was %, expected 2',position;end if;
  insert into public.automation_jobs(league_id,event_key,operation,market_week,created_at)
   select l,'rollback-peer:'||l||':'||n,'settlement',5,now()-interval '1 minute'
    from unnest(array[a,b])l cross join generate_series(1,16)n;
  for i in 1..32 loop
   started:=clock_timestamp();select * into picked from public.claim_automation_job();
   durations:=array_append(durations,extract(epoch from(clock_timestamp()-started))*1000);
   if picked.id is null or picked.league_id not in(a,b)or picked.operation<>'settlement'
    then raise exception 'Unexpected equal-peer claim';end if;
   if i>1 and turns[i-1]=picked.league_id then raise exception 'Backlogged peers did not alternate';end if;
   turns:=array_append(turns,picked.league_id);
   update public.automation_jobs set status='done',completed_at=now(),lease_until=null where id=picked.id;
  end loop;
  elapsed_ms:=extract(epoch from(clock_timestamp()-began))*1000;
  output:=jsonb_build_object('format','boff-hosted-dispatch-probe-v1','synthetic',true,
   'claim_source_md5',claim_md5,'backlog_a',64,'backlog_b',1,'peer_first_turn',position,
   'equal_peer_claims',32,'claims',97,'claim_p50_ms',(select percentile_cont(0.5)within group(order by v)from unnest(durations)v),
   'claim_p95_ms',(select percentile_cont(0.95)within group(order by v)from unnest(durations)v),
   'claim_max_ms',(select max(v)from unnest(durations)v),'total_loop_ms',elapsed_ms,
   'calendar_planner','actual installed functions','true_concurrent_workers',false,
   'transaction_scope','single DBA connection with synthetic rows; not REST/API/provider/worker throughput',
   'sequence_gaps_possible',true,'persistent_activation',false,'real_email',false);
  raise exception using errcode='ZX044',message='Rollback synthetic dispatch fixture';
 exception when sqlstate 'ZX044' then rolled_back:=true;
 end;
 if not rolled_back or exists(select 1 from public.leagues where id in(a,b))or
 exists(select 1 from public.automation_jobs)or exists(select 1 from sportsbook_private.automation_dispatch_state)or
 (select count(*)from public.leagues)<>before_leagues or
 (select count(*)from sportsbook_private.league_launch_approvals)<>before_reviews or
 (select count(*)from sportsbook_private.platform_owner)<>before_legacy or
 exists(select 1 from public.leagues where operations_enabled)or
 exists(select 1 from public.weekly_schedule where automation_enabled)or
 exists(select 1 from public.outbound_emails)
 then raise exception 'Fixture rollback postflight failed';end if;
 final_digest:=${financialDigestSql};
 if final_digest<>initial_digest then raise exception 'Financial facts changed';end if;
 output:=output||jsonb_build_object('fixture_rollback_verified',true,'financial_digest',final_digest);
 perform set_config('boff.dispatch_probe_receipt',output::text,true);
end $probe$;
select current_setting('boff.dispatch_probe_receipt')::jsonb as result;
`;
}

// Bounded contention check only: empty/paused DEV, four sessions at a time.
// The explicit100ms hold makes lock overlap observable; it is not throughput.
export function pausedDispatchConcurrencyProbe(expectedClaimMd5) {
  if (!/^[a-f0-9]{32}$/.test(expectedClaimMd5))
    throw Error("Exact installed claim source MD5 required");
  return `
set local statement_timeout='5s';set local lock_timeout='2s';
do $paused$
declare began timestamptz:=clock_timestamp();finished_claim timestamptz;n integer;
begin
 if public.application_environment_identity()->>'environment'is distinct from 'development' or
 public.application_environment_identity()->>'project_ref'is distinct from 'whlcnlacueweaqpsupqs'
 then raise exception 'Development identity required';end if;
 if (select md5(prosrc)from pg_proc where oid='public.claim_automation_job()'::regprocedure)<>'${expectedClaimMd5}'
 then raise exception 'Installed claim source changed';end if;
 if exists(select 1 from public.leagues where operations_enabled)or
 exists(select 1 from public.weekly_schedule where automation_enabled)or
 exists(select 1 from public.automation_jobs)or exists(select 1 from sportsbook_private.automation_dispatch_state)
 then raise exception 'Empty paused Development fixture required';end if;
 perform set_config('request.jwt.claim.role','service_role',true);
 select count(*)into n from public.claim_automation_job();finished_claim:=clock_timestamp();
 if n<>0 then raise exception 'Paused Development claimed work';end if;
 perform pg_sleep(0.1);
 perform set_config('boff.paused_dispatch_receipt',jsonb_build_object(
 'format','boff-paused-dispatch-contention-v1','backend_pid',pg_backend_pid(),
 'started_at',began,'claim_finished_at',finished_claim,'finished_at',clock_timestamp(),
 'claim_elapsed_ms',extract(epoch from(finished_claim-began))*1000,
 'intentional_transaction_hold_ms',100,'claimed',n,
 'scope','Empty paused DBA transactions; intentional lock overlap, not worker or billing throughput')::text,true);
end $paused$;
select current_setting('boff.paused_dispatch_receipt')::jsonb as result;
`;
}
