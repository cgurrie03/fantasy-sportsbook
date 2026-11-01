begin;
alter table public.leagues add column provider_contract jsonb check(provider_contract is null or octet_length(provider_contract::text)<=32768);
alter table public.teams alter column sleeper_owner_id drop not null,alter column sportsbook_owner_id drop not null;
create table public.league_intake_drafts(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),request_key uuid not null,
 source_league_id text not null check(source_league_id~'^[0-9]{1,32}$'),payload_md5 text not null,
 source jsonb not null check(octet_length(source::text)<=65536),capabilities jsonb not null check(octet_length(capabilities::text)<=16384),
 state text not null default 'draft' check(state in('draft','imported','expired')),revision integer not null default 1,
 imported_league_id uuid unique references public.leagues(id),import_options jsonb,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '7 days',
 unique(owner_id,request_key),check(state<>'imported' or imported_league_id is not null)
);
alter table public.league_intake_drafts enable row level security;
revoke all on public.league_intake_drafts from public,anon,authenticated,service_role;
grant select on public.league_intake_drafts to authenticated;
create function public.league_intake_owner() returns boolean language sql stable security definer set search_path='' as $$
 select sportsbook_private.is_platform_owner() and exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
$$;
revoke all on function public.league_intake_owner() from public,anon,service_role;
grant execute on function public.league_intake_owner() to authenticated;
create policy intake_owner_read on public.league_intake_drafts for select to authenticated
 using(owner_id=(select auth.uid()) and (select public.league_intake_owner()));
create function sportsbook_private.validate_intake_source(s jsonb,r jsonb) returns void language plpgsql immutable set search_path='' as $$
declare t jsonb;k text;v jsonb;begin
 if jsonb_typeof(s) is distinct from 'object' or not s ?& array['contract','provider','league_id','name','season','status','total_rosters','scoring','positions','settings','teams'] or jsonb_typeof(s->'season') is distinct from 'number' or jsonb_typeof(s->'total_rosters') is distinct from 'number' or jsonb_typeof(s->'name') is distinct from 'string' or s->>'contract' is distinct from 'sleeper-nfl-intake-v1' or s->>'provider' is distinct from 'sleeper'
  or coalesce(s->>'league_id','')!~'^[0-9]{1,32}$' or (s->>'season')::integer not between 2000 and 2099
  or length(trim(s->>'name')) not between 1 and 80 or jsonb_typeof(s->'teams')<>'array'
  or jsonb_array_length(s->'teams') not between 2 and 32 or jsonb_array_length(s->'teams')<>(s->>'total_rosters')::integer
 then raise exception 'Normalized provider contract is incomplete.';end if;
 if exists(select 1 from jsonb_object_keys(s) key where key not in('contract','provider','league_id','name','season','status','total_rosters','scoring','positions','settings','teams'))
 then raise exception 'Unknown provider contract field.';end if;
 foreach k in array array['scoring','settings'] loop
  if jsonb_typeof(s->k) is distinct from 'object' or (select count(*) from jsonb_object_keys(s->k)) not between 1 and 128 then raise exception 'Numeric provider rules required.';end if;
  if exists(select 1 from jsonb_object_keys(s->k) key where key!~'^[a-z][a-z0-9_]{0,63}$') then raise exception 'Unsupported provider rule key.';end if;
  for v in select value from jsonb_each(s->k) loop
   if jsonb_typeof(v)<>'number' or abs((v#>>'{}')::numeric)>(case k when 'scoring' then 1000 else 1000000000 end) then raise exception 'Unsupported numeric provider rule.';end if;
  end loop;
 end loop;
 if jsonb_typeof(s->'positions') is distinct from 'array' or jsonb_array_length(s->'positions') not between 1 and 48 then raise exception 'Provider positions required.';end if;
 if (select count(distinct x->>'roster_id') from jsonb_array_elements(s->'teams') x)<>jsonb_array_length(s->'teams') then raise exception 'Duplicate provider roster.';end if;
 for t in select value from jsonb_array_elements(s->'teams') loop
  if not t ?& array['roster_id','team_name','owner_id','owner_name','co_owner_ids','co_owner_names','wins','losses','ties'] or jsonb_typeof(t->'roster_id') is distinct from 'number' or jsonb_typeof(t->'team_name') is distinct from 'string' or jsonb_typeof(t->'owner_name') is distinct from 'string' or jsonb_typeof(t->'owner_id') not in ('string','null') or (t->>'roster_id')::integer not between 1 and 1000 or length(trim(t->>'team_name')) not between 1 and 80
   or length(trim(t->>'owner_name')) not between 1 and 80
   or (t->>'owner_id' is not null and t->>'owner_id'!~'^[0-9]{1,32}$')
   or jsonb_typeof(t->'co_owner_ids')<>'array' or jsonb_typeof(t->'co_owner_names')<>'array'
   or jsonb_array_length(t->'co_owner_ids')>16 or jsonb_array_length(t->'co_owner_ids')<>jsonb_array_length(t->'co_owner_names')
  then raise exception 'Provider team shape is incomplete.';end if;
  foreach k in array array['wins','losses','ties'] loop
   if jsonb_typeof(t->k) is distinct from 'number' or (t->>k)::integer not between 0 and 100 then raise exception 'Provider standings are incomplete.';end if;
  end loop;
 end loop;
 if jsonb_typeof(r) is distinct from 'object' or not r ?& array['contract','admission','issues','families'] or r->>'contract' is distinct from 'sleeper-nfl-intake-v1' or r->>'admission' is distinct from 'review_required'
  or jsonb_typeof(r->'issues')<>'array' or jsonb_array_length(r->'issues')>32
  or jsonb_typeof(r->'families')<>'array' or jsonb_array_length(r->'families') not between 1 and 16
 then raise exception 'A versioned capability review is required; intake cannot approve activation.';end if;
end $$;
revoke all on function sportsbook_private.validate_intake_source(jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.save_league_intake_draft(p_request uuid,p_source jsonb,p_capabilities jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.league_intake_drafts;h text;begin
 if not public.league_intake_owner() then raise exception 'Verified platform owner required.';end if;
 if p_request is null or p_source is null or p_capabilities is null or octet_length(p_source::text)>65536 or octet_length(p_capabilities::text)>16384 then raise exception 'Intake request exceeds its budget.';end if;
 perform sportsbook_private.validate_intake_source(p_source,p_capabilities);
 perform pg_advisory_xact_lock(20261101,16);
 h:=md5(jsonb_build_object('source',p_source,'capabilities',p_capabilities)::text);
 select * into d from public.league_intake_drafts where owner_id=auth.uid() and request_key=p_request;
 if found then
  if d.payload_md5<>h then raise exception 'Intake request already used with different provider data.';end if;
  return jsonb_build_object('id',d.id,'revision',d.revision,'state',d.state,'duplicate',true);
 end if;
 update public.league_intake_drafts set state='expired',source='{}',capabilities='{}',revision=revision+1 where owner_id=auth.uid() and state='draft' and expires_at<=clock_timestamp();
 if (select count(*) from public.league_intake_drafts where owner_id=auth.uid() and state='draft')>=4
  or (select count(*) from public.league_intake_drafts)>=64 then raise exception 'Intake draft admission budget reached.';end if;
 insert into public.league_intake_drafts(owner_id,request_key,source_league_id,payload_md5,source,capabilities)
 values(auth.uid(),p_request,p_source->>'league_id',h,p_source,p_capabilities) returning * into d;
 return jsonb_build_object('id',d.id,'revision',d.revision,'state',d.state,'duplicate',false);
end $$;
revoke all on function public.save_league_intake_draft(uuid,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.save_league_intake_draft(uuid,jsonb,jsonb) to authenticated;
create function public.import_league_intake_draft(p_draft uuid,p_expected integer,p_league_season integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.league_intake_drafts;l uuid:=gen_random_uuid();t jsonb;team uuid;options jsonb;begin
 if not public.league_intake_owner() then raise exception 'Verified platform owner required.';end if;
 if p_league_season is null or p_league_season not between 1 and 100 or p_reason is null or length(trim(p_reason)) not between 8 and 400 then raise exception 'Reviewed league season and reason required.';end if;
 perform pg_advisory_xact_lock(20261101,16);
 select * into d from public.league_intake_drafts where id=p_draft and owner_id=auth.uid() for update;
 if not found then raise exception 'Intake draft unavailable.';end if;
 options:=jsonb_build_object('league_season',p_league_season,'reason',trim(p_reason));
 if d.state='imported' then
  if d.import_options is distinct from options then raise exception 'Import already used different reviewed terms.';end if;
  return jsonb_build_object('league_id',d.imported_league_id,'duplicate',true,'operations_enabled',false);
 end if;
 if p_expected is distinct from d.revision or d.state<>'draft' or d.expires_at<=clock_timestamp() then raise exception 'Intake draft changed or expired.';end if;
 if exists(select 1 from public.leagues where sleeper_league_id=d.source_league_id) then raise exception 'This provider league already exists; review renewal separately.';end if;
 if (select count(*) from public.leagues)>=32 then raise exception 'League admission budget reached.';end if;
 perform sportsbook_private.validate_intake_source(d.source,d.capabilities);
 insert into public.leagues(id,name,sleeper_league_id,nfl_season,league_season,active_week,week_anchor,operations_enabled,provider_contract)
 values(l,d.source->>'name',d.source_league_id,(d.source->>'season')::integer,p_league_season,1,clock_timestamp(),false,
  jsonb_build_object('version',1,'source',d.source-'teams','capabilities',d.capabilities,'review_status','pending'));
 for t in select value from jsonb_array_elements(d.source->'teams') loop
  team:=gen_random_uuid();
  insert into public.teams(id,league_id,roster_id,team_name,sleeper_owner_id,owner_name,sportsbook_owner_id,sportsbook_owner_name,co_owner_ids,co_owner_names,wins,losses,ties)
  values(team,l,(t->>'roster_id')::integer,t->>'team_name',t->>'owner_id',t->>'owner_name',t->>'owner_id',t->>'owner_name',
   array(select jsonb_array_elements_text(t->'co_owner_ids')),array(select jsonb_array_elements_text(t->'co_owner_names')),(t->>'wins')::integer,(t->>'losses')::integer,(t->>'ties')::integer);
  insert into public.wallets(team_id,balance) values(team,null) on conflict(team_id) do nothing;
 end loop;
 insert into public.weekly_schedule(league_id,automation_enabled,publication_paused,opening_email,reminder_email,recap_email)
 values(l,false,true,false,false,false) on conflict(league_id) do nothing;
 update public.league_intake_drafts set state='imported',imported_league_id=l,import_options=options,source='{}',capabilities='{}',revision=revision+1 where id=d.id;
 insert into public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value)
 values(l,auth.uid(),'league_intake',trim(p_reason),'{}',jsonb_build_object('draft_id',d.id,'source_md5',d.payload_md5,'provider_contract','sleeper-nfl-intake-v1','operations_enabled',false));
 return jsonb_build_object('league_id',l,'duplicate',false,'operations_enabled',false);
end $$;
revoke all on function public.import_league_intake_draft(uuid,integer,integer,text) from public,anon,service_role;
grant execute on function public.import_league_intake_draft(uuid,integer,integer,text) to authenticated;
-- Import does not assert rule support. A later reviewed capability/policy workflow
-- must replace this quarantine guard before any imported league can operate.
create function sportsbook_private.intake_operation_guard() returns trigger language plpgsql set search_path='' as $$begin
 if new.provider_contract is not null and new.operations_enabled then raise exception 'Imported league capability and policy approval are pending.';end if;return new;
end $$;
revoke all on function sportsbook_private.intake_operation_guard() from public,anon,authenticated,service_role;
create trigger intake_operation_guard before insert or update of operations_enabled,provider_contract on public.leagues for each row execute function sportsbook_private.intake_operation_guard();
-- Small prospective draft payloads expire through the existing bounded worker
-- maintenance boundary. Stable request hashes and import/audit identities remain.
grant select(id,expires_at,state,revision) on public.league_intake_drafts to boff_routine_retention;
grant update(source,capabilities,state,revision) on public.league_intake_drafts to boff_routine_retention;
create policy intake_cleanup_read on public.league_intake_drafts for select to boff_routine_retention using(true);
create policy intake_cleanup_update on public.league_intake_drafts for update to boff_routine_retention
 using(state='draft' and expires_at<=clock_timestamp()) with check(state='expired' and source='{}'::jsonb and capabilities='{}'::jsonb);
create function sportsbook_private.cleanup_intake_drafts(p_limit integer) returns integer
language plpgsql security definer set search_path='' set row_security='on' set statement_timeout='2s' set lock_timeout='200ms' as $$
declare retired integer;begin
 with due as(select id from public.league_intake_drafts where state='draft' and expires_at<=clock_timestamp()
  order by expires_at,id limit least(25,greatest(1,coalesce(p_limit,10))) for update skip locked)
 update public.league_intake_drafts d set source='{}',capabilities='{}',state='expired',revision=revision+1 from due where d.id=due.id;
 get diagnostics retired=row_count;return retired;
end $$;
revoke all on function sportsbook_private.cleanup_intake_drafts(integer) from public,anon,authenticated,service_role;
grant create on schema sportsbook_private to boff_routine_retention;
grant boff_routine_retention to postgres;
alter function sportsbook_private.cleanup_intake_drafts(integer) owner to boff_routine_retention;
set local role boff_routine_retention;
grant execute on function sportsbook_private.cleanup_intake_drafts(integer) to postgres;
reset role;
revoke create on schema sportsbook_private from boff_routine_retention;
revoke boff_routine_retention from postgres;
create or replace function public.cleanup_routine_payloads(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='3s' set lock_timeout='200ms' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker only.';end if;
 return sportsbook_private.cleanup_routine_payloads(p_limit)||jsonb_build_object('retired_intake_drafts',sportsbook_private.cleanup_intake_drafts(p_limit));
end $$;
revoke all on function public.cleanup_routine_payloads(integer) from public,anon,authenticated;
grant execute on function public.cleanup_routine_payloads(integer) to service_role;
commit;
