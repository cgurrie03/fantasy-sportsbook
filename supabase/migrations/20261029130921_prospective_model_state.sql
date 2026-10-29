begin;
create table public.model_prospective_state (
 league_id uuid primary key references public.leagues(id),active_id uuid not null,
 context_hash text not null check(context_hash ~ '^[0-9a-f]{64}$'),revision integer not null default 0,
 last_hash text,updated_at timestamptz not null default clock_timestamp(),state jsonb not null,
 foreign key(league_id,active_id) references public.model_config_versions(league_id,id),
 check(octet_length(state::text)<=32768)
);
alter table public.model_prospective_state enable row level security;
revoke all on public.model_prospective_state from public,anon,authenticated,service_role;
grant select on public.model_prospective_state to authenticated,service_role;
create policy prospective_admin on public.model_prospective_state for select to authenticated using(sportsbook_private.is_admin(league_id));

create function public.save_prospective_state(p_job uuid,p_attempt integer,p_active uuid,p_revision integer,p_context text,p_hash text,p_state jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.automation_jobs;ctl public.model_controls;old public.model_prospective_state;next_state jsonb;renew boolean;frozen jsonb;period integer;rev integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker only.';end if;
 select * into strict j from public.automation_jobs where id=p_job for update;
 if j.operation<>'model_review' or j.status<>'running' or j.attempts<>p_attempt or j.lease_until<=clock_timestamp() then raise exception 'Prospective lease lost.';end if;
 if exists(select 1 from public.tickets where league_id=j.league_id and market_week=j.market_week and nfl_season=(select nfl_season from public.leagues where id=j.league_id)
  and ticket_type<>'future' and status='OPEN') then raise exception 'Settlement reconciliation pending.';end if;
 select * into strict ctl from public.model_controls where league_id=j.league_id for update;
 if ctl.active_id<>p_active then raise exception 'Active model changed.';end if;
 select * into old from public.model_prospective_state where league_id=j.league_id for update;
 if old.last_hash=p_hash and old.active_id=p_active and old.context_hash=p_context then return old.state||jsonb_build_object('revision',old.revision);end if;
 if coalesce(old.revision,0)<>p_revision then raise exception 'Prospective revision changed.';end if;
 if p_context is null or p_context !~ '^[0-9a-f]{64}$' or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or octet_length(p_state::text)>32768 then raise exception 'Invalid prospective identity/budget.';end if;
 if exists(select 1 from jsonb_object_keys(p_state) k where k not in ('active_id','context_hash','revision','training','fit_training','evidence','monitor','candidate','frozen_at','trained_period','training_weeks','last_period','finished','skipped_weeks'))
  or p_state->>'active_id' is distinct from p_active::text or p_state->>'context_hash' is distinct from p_context then raise exception 'Invalid prospective scope.';end if;
 if jsonb_typeof(p_state->'training') is distinct from 'array' or jsonb_array_length(p_state->'training')>8
  or jsonb_typeof(p_state->'fit_training') is distinct from 'array' or jsonb_array_length(p_state->'fit_training')>8
  or jsonb_typeof(p_state->'evidence') is distinct from 'array' or jsonb_array_length(p_state->'evidence')>32
  or jsonb_typeof(p_state->'monitor') is distinct from 'array' or jsonb_array_length(p_state->'monitor')>4 then raise exception 'Prospective segment budget exceeded.';end if;
 if exists(select 1 from jsonb_array_elements((p_state->'training')||(p_state->'fit_training')) w,lateral jsonb_each(w) f
  where f.key not in ('period','n','prediction','actual','z2','z_n') or jsonb_typeof(f.value)<>'number')
  or exists(select 1 from jsonb_array_elements(p_state->'monitor') w,lateral jsonb_each(w) f where f.key not in ('period','delta') or jsonb_typeof(f.value)<>'number') then raise exception 'Invalid prospective training totals.';end if;
 if exists(select 1 from jsonb_array_elements(p_state->'evidence') w,lateral jsonb_each(w) f where f.key not in
   ('period','prediction_at','phase','n','current','candidate','baseline','sleeper','market_ok') or
   (f.key in ('period','n','current','candidate','baseline','sleeper') and jsonb_typeof(f.value)<>'number'))
  or exists(select 1 from jsonb_array_elements(p_state->'evidence') w where w->>'phase' not in ('validation','holdout')
   or jsonb_typeof(w->'market_ok') is distinct from 'boolean' or (w->>'n')::integer<8) then raise exception 'Invalid prospective evidence.';end if;
 period:=(select nfl_season from public.leagues where id=j.league_id)*100+j.market_week;
 if (select count(distinct w->>'period') from jsonb_array_elements(p_state->'evidence') w)<>jsonb_array_length(p_state->'evidence')
  or (select count(distinct w->>'period') from jsonb_array_elements(p_state->'training') w)<>jsonb_array_length(p_state->'training') then raise exception 'Duplicate prospective periods.';end if;
 if exists(select 1 from jsonb_array_elements(p_state->'evidence') w where w->>'phase'='holdout') and
  ((select count(*) from jsonb_array_elements(p_state->'evidence') w where w->>'phase'='validation')<12 or
   (select coalesce(sum((w->>'n')::integer),0) from jsonb_array_elements(p_state->'evidence') w where w->>'phase'='validation')<120 or
   (select min((w->>'period')::integer) from jsonb_array_elements(p_state->'evidence') w where w->>'phase'='holdout')<=
   (select max((w->>'period')::integer) from jsonb_array_elements(p_state->'evidence') w where w->>'phase'='validation')) then raise exception 'Holdout phase is not untouched.';end if;
 if p_state->>'finished'='true' and jsonb_array_length(p_state->'evidence')<32 and
  ((select count(*) from jsonb_array_elements(p_state->'evidence') w where w->>'phase'='holdout')<4 or
   (select coalesce(sum((w->>'n')::integer),0) from jsonb_array_elements(p_state->'evidence') w where w->>'phase'='holdout')<40) then raise exception 'Prospective cycle is not complete.';end if;
 if (p_state->>'last_period')::integer<>greatest(period,coalesce((old.state->>'last_period')::integer,0)) then raise exception 'Prospective period mismatch.';end if;
 renew:=old.league_id is null or old.active_id<>p_active or old.context_hash<>p_context or
  (old.state->>'finished'='true' and (p_state->>'trained_period')::integer>(old.state->>'last_period')::integer);
 next_state:=p_state-'revision';
 if not renew and old.state->'candidate'<>'null'::jsonb and p_state->'candidate'='null'::jsonb then raise exception 'Frozen candidate cannot be abandoned before the cycle completes.';end if;
 if p_state->'candidate'<>'null'::jsonb then
  if (select count(*) from jsonb_object_keys(p_state->'candidate'))<>2 or exists(select 1 from jsonb_each(p_state->'candidate') x
    where x.key not in ('score_scale','variance_scale') or jsonb_typeof(x.value)<>'number' or x.value::numeric not between .9 and 1.1)
    or exists(select 1 from jsonb_each(p_state->'candidate') x join public.model_config_versions v on v.id=p_active
     where abs(x.value::numeric/(v.config->>x.key)::numeric-1)>.020000001) then raise exception 'Candidate parameter bounds failed.';end if;
  if renew or old.state->'candidate'='null'::jsonb then
   if (p_state->>'trained_period')::integer<>period or jsonb_array_length(p_state->'training')<>8 or jsonb_array_length(p_state->'evidence')<>0
    or p_state->'fit_training'<>p_state->'training' or (p_state->>'training_weeks')::integer<>8 then raise exception 'New candidate requires eight prior completed weeks.';end if;
   frozen:=to_jsonb(clock_timestamp());
  else
   if p_state->'candidate'<>old.state->'candidate' or p_state->'trained_period'<>old.state->'trained_period'
    or p_state->'fit_training'<>old.state->'fit_training' or p_state->'training_weeks'<>old.state->'training_weeks' then raise exception 'Frozen candidate cannot change.';end if;
   frozen:=old.state->'frozen_at';
  end if;
  next_state:=jsonb_set(next_state,'{frozen_at}',frozen);
  if exists(select 1 from jsonb_array_elements(next_state->'evidence') w where (w->>'prediction_at')::timestamptz<=(frozen#>>'{}')::timestamptz
   or (w->>'period')::integer<=(next_state->>'trained_period')::integer) then raise exception 'Evidence predates frozen candidate.';end if;
 end if;
 rev:=coalesce(old.revision,0)+1;
 insert into public.model_prospective_state(league_id,active_id,context_hash,revision,last_hash,state)
 values(j.league_id,p_active,p_context,rev,p_hash,next_state)
 on conflict(league_id) do update set active_id=excluded.active_id,context_hash=excluded.context_hash,revision=excluded.revision,
 last_hash=excluded.last_hash,state=excluded.state,updated_at=clock_timestamp();
 return next_state||jsonb_build_object('revision',rev);
end $$;
revoke all on function public.save_prospective_state(uuid,integer,uuid,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_prospective_state(uuid,integer,uuid,integer,text,text,jsonb) to service_role;

do $$declare d text;anchor text;begin
 select pg_get_functiondef('public.control_model(uuid,text,text,uuid,uuid)'::regprocedure) into d;
 anchor:='select * into strict r from public.model_weekly_reviews where id=p_review and league_id=p_league;';
 if position(anchor in d)=0 then raise exception 'Prospective promotion anchor changed.';end if;
 execute replace(d,anchor,anchor||$guard$
 if r.comparison->>'method' is distinct from 'prospective-v1' or not exists(
  select 1 from public.model_prospective_state s where s.league_id=p_league and s.active_id=c.active_id
   and s.context_hash=r.comparison->>'context_hash' and s.state->'candidate'=r.comparison->'candidate'
   and s.state->'frozen_at'=r.comparison->'frozen_at' and s.revision=(r.comparison->>'state_revision')::integer
   and (s.state->>'last_period')::integer=r.nfl_season*100+r.market_week
   and not exists(select 1 from jsonb_array_elements(s.state->'evidence') w where w->>'market_ok' is distinct from 'true'
    or (w->>'prediction_at')::timestamptz<=(s.state->>'frozen_at')::timestamptz)
   and (select count(*) from jsonb_array_elements(s.state->'evidence') w where w->>'phase'='validation')>=12
   and (select count(*) from jsonb_array_elements(s.state->'evidence') w where w->>'phase'='holdout')>=4)
  then raise exception 'Fresh frozen-candidate evidence required.';end if;
 $guard$);
end $$;
commit;
