begin;

create or replace function public.account_wallet_report(p_league uuid,p_team uuid default null,p_cursor jsonb default null,p_limit integer default 40)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_hash text;v_as_of timestamptz;v_date timestamptz;v_source text;v_id uuid;v_result jsonb;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'League admin required';end if;
 if p_limit is null or p_limit not between 1 and 50 or (p_team is not null and not exists(select 1 from public.teams where id=p_team and league_id=p_league))
  then raise exception 'Invalid wallet report scope';end if;
 if (select count(*) from public.teams where league_id=p_league)>128 then raise exception 'League exceeds wallet report summary budget';end if;
 v_hash:=md5(p_league::text||coalesce(p_team::text,'all')||(select auth.uid())::text);
 if p_cursor is not null and p_cursor<>'null'::jsonb then
  if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>2048 or p_cursor->>'scope' is distinct from v_hash
   or not(p_cursor ?& array['as_of','date','source','id']) then raise exception 'Invalid wallet report cursor';end if;
  v_as_of:=(p_cursor->>'as_of')::timestamptz;v_date:=(p_cursor->>'date')::timestamptz;v_source:=p_cursor->>'source';v_id:=(p_cursor->>'id')::uuid;
  if v_as_of is null or v_date is null or v_source is null or v_source not in ('ledger','adjustment','user_ledger') or v_id is null
   or v_as_of>now()+interval '1 second' or v_as_of<now()-interval '1 day' then raise exception 'Wallet report cursor expired; refresh report';end if;
 else v_as_of:=now();end if;
 with entries as materialized (
  select l.id,l.team_id,l.created_at,l.kind,l.reason,l.balance_before,l.balance_after,'ledger' source,null::uuid wallet_id,null::text display_name
   from public.wallet_ledger l join public.teams t on t.id=l.team_id where t.league_id=p_league and (p_team is null or t.id=p_team) and l.created_at<=v_as_of
  union all
  select e.id,e.team_id,e.created_at,e.kind,e.reason,e.previous_balance,e.new_balance,'adjustment',null::uuid,null::text
   from public.balance_events e join public.teams t on t.id=e.team_id where t.league_id=p_league and (p_team is null or t.id=p_team) and e.created_at<=v_as_of
 union all
  select e.id,e.team_id,e.created_at,e.kind,e.reason,e.balance_before,e.balance_after,'user_ledger',e.wallet_id,w.display_name
   from public.user_wallet_entries e join public.user_wallets w on w.id=e.wallet_id
   where e.league_id=p_league and (p_team is null or e.team_id=p_team) and e.created_at<=v_as_of
 ), page as materialized (
  select * from entries where v_id is null or created_at<v_date or (created_at=v_date and (source,id)>(v_source,v_id))
   order by created_at desc,source,id limit p_limit+1
 ), visible as materialized (select * from page order by created_at desc,source,id limit p_limit), cash as (
  select team_id,coalesce(sum(greatest(balance_after-balance_before,0)) filter(where balance_before is not null and kind not in ('historical_opening','opening_balance','opening','account_transfer_out','legacy_transfer_in')),0) credits,
   coalesce(sum(greatest(balance_before-balance_after,0)) filter(where balance_before is not null and kind not in ('historical_opening','opening_balance','opening','account_transfer_out','legacy_transfer_in')),0) debits
   from entries group by team_id
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(v) order by created_at desc,source,id) from visible v),'[]'::jsonb),
  'total',(select count(*) from entries),'by_team',coalesce((select jsonb_agg(to_jsonb(c) order by team_id) from cash c),'[]'::jsonb),'as_of',v_as_of,
  'next',case when (select count(*) from page)>p_limit then
   (select jsonb_build_object('scope',v_hash,'as_of',v_as_of,'date',created_at,'source',source,'id',id) from visible order by created_at,source desc,id desc limit 1) else null end) into v_result;
 if octet_length(v_result::text)>262144 then raise exception 'Wallet report page byte budget exceeded';end if;
 return v_result;
end $$;



create function public.weekly_finance_wallets(p_league uuid,p_season integer,p_week integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare enabled boolean;rows jsonb;result jsonb;
begin
 if auth.role() is distinct from 'service_role' and not sportsbook_private.is_admin(p_league) then raise exception 'League operator required.';end if;
 if p_season is null or p_season not between 2020 and 2100 or p_week is null or p_week not between 1 and 18 then raise exception 'Invalid financial preview period.';end if;
 select exists(select 1 from sportsbook_private.user_finance_modes where league_id=p_league and user_finance_modes.enabled) into enabled;
 if enabled then
  if (select count(*) from public.user_wallets where league_id=p_league)>128 then raise exception 'Financial preview account budget reached.';end if;
  select coalesce(jsonb_agg(jsonb_build_object('wallet_id',w.id,'team_id',w.team_id,'user_id',w.user_id,'balance',w.balance,'display_name',w.display_name,
   'legacy_primary',exists(select 1 from public.league_memberships m where m.league_id=p_league and m.team_id=w.team_id and m.user_id=w.user_id),
   'processed',exists(select 1 from public.user_wallet_entries e where e.wallet_id=w.id and e.event_key='weekly:replenish:'||p_season||':'||p_week||':'||w.id)) order by w.id),'[]'::jsonb) into rows
  from public.user_wallets w join auth.users a on a.id=w.user_id where w.league_id=p_league and w.status='approved' and a.email_confirmed_at is not null;
 else
  if (select count(*) from public.teams where league_id=p_league)>128 then raise exception 'Financial preview team budget reached.';end if;
  select coalesce(jsonb_agg(jsonb_build_object('wallet_id',null,'team_id',w.team_id,'balance',w.balance,'legacy_primary',true,
   'processed',exists(select 1 from public.wallet_ledger e where e.team_id=w.team_id and e.event_key='weekly:replenish:'||p_season||':'||p_week||':'||w.team_id)) order by w.team_id),'[]'::jsonb) into rows
  from public.wallets w join public.teams t on t.id=w.team_id where t.league_id=p_league;
 end if;
 result:=jsonb_build_object('wallet_model',case when enabled then 'user' else 'legacy' end,'wallets',rows);
 if octet_length(result::text)>65536 then raise exception 'Financial preview byte budget reached.';end if;
 return result;
end $$;
revoke all on function public.weekly_finance_wallets(uuid,integer,integer) from public,anon;
grant execute on function public.weekly_finance_wallets(uuid,integer,integer) to authenticated,service_role;

create function public.user_leaderboard(p_league uuid) returns table(wallet_id uuid,team_id uuid,display_name text,bets_placed bigint,bets_won bigint,bets_lost bigint,bets_push bigint,total_wagered numeric,total_payout numeric,net_profit numeric,roi numeric,win_percentage numeric,biggest_parlay_legs bigint,biggest_parlay_odds integer,biggest_payout numeric,current_balance numeric,open_stakes numeric,settled_stakes numeric,balance_visible boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if not sportsbook_private.is_member(p_league) or not sportsbook_private.user_finance_enabled(p_league) then raise exception 'Approved user-finance league access required.';end if;
 if (select count(*) from public.user_wallets w where w.league_id=p_league)>128 then raise exception 'Standings account budget reached.';end if;
 return query
 select w.id,w.team_id,w.display_name,count(b.id),count(b.id) filter(where b.status='WON'),count(b.id) filter(where b.status='LOST'),count(b.id) filter(where b.status='PUSH'),
  coalesce(sum(b.stake),0),coalesce(sum(b.actual_payout),0),coalesce(sum(b.net_profit) filter(where b.status<>'OPEN'),0),
  coalesce(100*sum(b.net_profit) filter(where b.status<>'OPEN')/nullif(sum(b.stake) filter(where b.status<>'OPEN'),0),0),
  coalesce(100.0*count(b.id) filter(where b.status='WON')/nullif(count(b.id) filter(where b.status in ('WON','LOST')),0),0),
  coalesce(max((select count(*) from public.ticket_legs l where l.ticket_id=b.id)) filter(where b.status='WON'),0),
  max(b.accepted_combined_odds) filter(where b.status='WON'),coalesce(max(b.actual_payout),0),
  case when w.user_id=auth.uid() or sportsbook_private.is_admin(p_league) then w.balance else null end,
  coalesce(sum(b.stake) filter(where b.status='OPEN'),0),coalesce(sum(b.stake) filter(where b.status in ('WON','LOST','PUSH')),0),
  (w.user_id=auth.uid() or sportsbook_private.is_admin(p_league))
 from public.user_wallets w left join public.tickets b on b.user_wallet_id=w.id and b.status<>'VOIDED'
 where w.league_id=p_league group by w.id,w.team_id,w.display_name,w.user_id,w.balance
 order by 10 desc,4 desc,w.id;
end $$;
revoke all on function public.user_leaderboard(uuid) from public,anon,service_role;
grant execute on function public.user_leaderboard(uuid) to authenticated;


create function sportsbook_private.user_finance_cutover_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if old.enabled and (tg_op='DELETE' or not new.enabled) and (
  exists(select 1 from public.user_wallet_entries where league_id=old.league_id)
  or exists(select 1 from public.user_wallets where league_id=old.league_id and balance is not null))
 then raise exception 'Funded user-finance cutover requires a separately reviewed migration; application rollback cannot revert financial identity.';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function sportsbook_private.user_finance_cutover_guard() from public,anon,authenticated,service_role;
create trigger user_finance_cutover before update or delete on sportsbook_private.user_finance_modes for each row execute function sportsbook_private.user_finance_cutover_guard();
do $guard$declare d text;pos integer;begin
 select pg_get_functiondef('public.set_team_balance(uuid,numeric,text,uuid)'::regprocedure) into d;pos:=position('begin' in d);
 if pos=0 then raise exception 'Legacy balance guard anchor changed.';end if;
 d:=overlay(d placing $insert$begin
 if exists(select 1 from public.teams t join sportsbook_private.user_finance_modes f on f.league_id=t.league_id where t.id=p_team and f.enabled)
 then raise exception 'This league uses per-user financial accounts; legacy team cash cannot be edited through this action.';end if;
 $insert$ from pos for 5);execute d;
end $guard$;

-- Fresh identities for participant mail. Operators already have financial
-- review access; members cannot enumerate another user's email address.
create function sportsbook_private.financial_mail_audience(p_league uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not sportsbook_private.user_finance_enabled(p_league) then return null;end if;
 if (select count(*) from public.user_wallets where league_id=p_league)>128 then raise exception 'Financial email audience budget exceeded.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'league_id',w.league_id,'team_id',w.team_id,
   'user_id',w.user_id,'invited_email',a.email,'display_name',w.display_name) order by w.id),'[]') into result
 from public.user_wallets w join auth.users a on a.id=w.user_id
 where w.league_id=p_league and w.status='approved' and a.email_confirmed_at is not null;
 if octet_length(result::text)>65536 then raise exception 'Financial email audience byte budget exceeded.';end if;
 return result;
end $$;
revoke all on function sportsbook_private.financial_mail_audience(uuid) from public,anon,authenticated,service_role;
create function public.financial_email_audience(p_league uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Mail worker only.';end if;
 return sportsbook_private.financial_mail_audience(p_league);
end $$;
revoke all on function public.financial_email_audience(uuid) from public,anon,authenticated;
grant execute on function public.financial_email_audience(uuid) to service_role;

-- Preserve the existing reviewed reopening requirements, replacing only its
-- audience in user mode. The event key uses the immutable wallet identity.
do $audience$declare d text;needle text;begin
 select pg_get_functiondef('public.queue_reopening_announcement(uuid)'::regprocedure) into d;
 needle:='from public.league_memberships m where m.league_id=w.league_id on conflict(event_key) do nothing;';
 if strpos(d,needle)=0 then raise exception 'Reopening audience source drift';end if;
 d:=replace(d,needle,$replace$from (
   select id,invited_email,team_id from public.league_memberships where league_id=w.league_id
     and not sportsbook_private.user_finance_enabled(w.league_id)
   union all select x.id,x.invited_email,x.team_id from jsonb_to_recordset(
     coalesce(sportsbook_private.financial_mail_audience(w.league_id),'[]'::jsonb))
     as x(id uuid,invited_email text,team_id uuid)
 ) m on conflict(event_key) do nothing;$replace$);
 execute d;
end $audience$;

-- Read-only owner review; this deliberately does not enable routing, operations,
-- scheduled jobs, mail delivery or opening funds. Production adoption remains a
-- separate exact-source review rather than a parameter on this development RPC.
create function public.user_finance_cutover_preflight(p_league uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare identity jsonb;l public.leagues;result jsonb;blockers jsonb:='[]';
 v_mail integer;v_jobs integer;v_unverified integer;v_accounts integer;v_legacy_open integer;v_pending integer;
begin
 if not sportsbook_private.is_platform_owner() or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
 then raise exception 'Verified platform owner required.';end if;
 identity:=public.application_environment_identity();
 if identity->>'environment' is distinct from 'development' or identity->>'project_ref' is distinct from 'whlcnlacueweaqpsupqs'
 then raise exception 'Independent development environment required.';end if;
 select * into l from public.leagues where id=p_league;
 if not found then raise exception 'Selected league unavailable.';end if;
 if l.operations_enabled then blockers:=blockers||'"League operations must remain disabled"'::jsonb;end if;
 if exists(select 1 from public.weekly_schedule where league_id=p_league and automation_enabled)
 then blockers:=blockers||'"Scheduled automation must remain disabled"'::jsonb;end if;
 select count(*) into v_mail from public.outbound_emails where league_id=p_league and status not in ('sent','captured','skipped');
 select count(*) into v_jobs from public.automation_jobs where league_id=p_league and status<>'done';
 select count(*),count(*) filter(where balance is null) into v_accounts,v_pending from public.user_wallets where league_id=p_league and status='approved';
 select count(*) into v_unverified from public.user_wallets w left join auth.users a on a.id=w.user_id
  where w.league_id=p_league and w.status='approved' and (a.id is null or a.email_confirmed_at is null);
 select count(*) into v_legacy_open from public.tickets where league_id=p_league and user_wallet_id is null and status='OPEN';
 if v_mail>0 then blockers:=blockers||'"Resolve pending or ambiguous mail without changing saved payloads"'::jsonb;end if;
 if v_jobs>0 then blockers:=blockers||'"Resolve queued, running or failed jobs"'::jsonb;end if;
 if v_accounts=0 or v_accounts>128 then blockers:=blockers||'"Review between 1 and 128 approved financial accounts"'::jsonb;end if;
 if v_unverified>0 then blockers:=blockers||'"Financial account verification is incomplete"'::jsonb;end if;
 result:=jsonb_build_object('league_id',p_league,'ready',jsonb_array_length(blockers)=0,'blockers',blockers,
  'routing_enabled',sportsbook_private.user_finance_enabled(p_league),'approved_accounts',v_accounts,
  'funding_pending',v_pending,'legacy_open_tickets',v_legacy_open,'unresolved_mail',v_mail,'unresolved_jobs',v_jobs,
  'opening_funds_moved',false,'activation_performed',false,
  'legacy_liability_policy','Legacy tickets retain their ledger; open liabilities block primary opening transfer.');
 return result;
end $$;
revoke all on function public.user_finance_cutover_preflight(uuid) from public,anon,service_role;
grant execute on function public.user_finance_cutover_preflight(uuid) to authenticated;

commit;
