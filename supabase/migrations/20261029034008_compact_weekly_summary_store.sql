begin;
create function sportsbook_private.numeric_total_valid(t jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text;v numeric;n numeric;begin
 if jsonb_typeof(t) is distinct from 'object' or (select count(*) from jsonb_object_keys(t))<>6 then return false;end if;
 foreach k in array array['n','absolute_error','squared_error','error','interval_n','covered80'] loop
  if jsonb_typeof(t->k) is distinct from 'number' then return false;end if;
  v:=(t->>k)::numeric;
  if (k<>'error' and v<0) or (k in ('n','interval_n','covered80') and v<>trunc(v)) then return false;end if;
 end loop;
 n:=(t->>'n')::numeric;
 return (t->>'interval_n')::numeric<=n and (t->>'covered80')::numeric<=(t->>'interval_n')::numeric
  and abs((t->>'error')::numeric)<=(t->>'absolute_error')::numeric+.000001
  and power((t->>'absolute_error')::numeric,2)<=n*(t->>'squared_error')::numeric+.000001;
end;
$$;
revoke all on function sportsbook_private.numeric_total_valid(jsonb) from public,anon,authenticated,service_role;
create function sportsbook_private.probability_total_valid(t jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text;b jsonb;n numeric;bins numeric:=0;v numeric;begin
 if jsonb_typeof(t) is distinct from 'object' or (select count(*) from jsonb_object_keys(t))<>4
  or jsonb_typeof(t->'bands') is distinct from 'array' or jsonb_array_length(t->'bands')<>5 then return false;end if;
 foreach k in array array['n','brier','log_loss'] loop
  if jsonb_typeof(t->k) is distinct from 'number' or (t->>k)::numeric<0 then return false;end if;
 end loop;
 n:=(t->>'n')::numeric;
 if n<>trunc(n) or (t->>'brier')::numeric>n+.000001 then return false;end if;
 for b in select value from jsonb_array_elements(t->'bands') loop
  if jsonb_typeof(b) is distinct from 'object' or (select count(*) from jsonb_object_keys(b))<>3 then return false;end if;
  foreach k in array array['n','predicted','observed'] loop
   if jsonb_typeof(b->k) is distinct from 'number' or (b->>k)::numeric<0 then return false;end if;
   v:=(b->>k)::numeric;
   if k in ('n','observed') and v<>trunc(v) then return false;end if;
  end loop;
  if (b->>'predicted')::numeric>(b->>'n')::numeric+.000001 or (b->>'observed')::numeric>(b->>'n')::numeric then return false;end if;
  bins:=bins+(b->>'n')::numeric;
 end loop;
 return bins=n;
end;
$$;
revoke all on function sportsbook_private.probability_total_valid(jsonb) from public,anon,authenticated,service_role;
create table public.model_evaluation_summaries (
 league_id uuid not null references public.leagues(id),nfl_season integer not null,
 market_week integer not null check(market_week between 1 and 18),
 context_hash text not null check(context_hash ~ '^[0-9a-f]{64}$'),
 input_hash text not null check(input_hash ~ '^[0-9a-f]{64}$'),
 read_started_at timestamptz not null,known_at timestamptz not null default clock_timestamp(),
 revision integer not null default 1,summary jsonb not null,
 primary key(league_id,nfl_season,market_week),
 check(summary->>'format'='weekly-additive-v1' and octet_length(summary::text)<=65536)
);
alter table public.model_evaluation_summaries enable row level security;
revoke all on public.model_evaluation_summaries from public,anon,authenticated,service_role;
grant select on public.model_evaluation_summaries to authenticated,service_role;
create policy evaluation_summary_admin on public.model_evaluation_summaries for select to authenticated
 using(sportsbook_private.is_admin(league_id));

create function public.save_evaluation_summary(p_job uuid,p_attempt integer,p_context text,p_hash text,p_started timestamptz,p_summary jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare j public.automation_jobs;old public.model_evaluation_summaries;result integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker only.';end if;
 select * into strict j from public.automation_jobs where id=p_job for update;
 if j.operation<>'model_review' or j.status<>'running' or j.attempts<>p_attempt or j.lease_until<=clock_timestamp() then raise exception 'Summary lease lost.';end if;
 if not exists(select 1 from public.model_weekly_reviews r join public.model_outcome_revisions o on o.id=r.outcome_id and o.league_id=r.league_id
  where r.league_id=j.league_id and r.nfl_season=(select nfl_season from public.leagues where id=j.league_id) and r.market_week=j.market_week
   and r.input_hash=p_hash and r.report->>'summary_context_hash'=p_context and r.report->>'status'='complete'
   and o.outcome->>'final'='true' and o.outcome->>'completed_period'='true' and o.outcome->>'confirmed_games_final'='true') then raise exception 'Confirmed scoped review required for summary.';end if;
 if p_context is null or p_context !~ '^[0-9a-f]{64}$' or p_hash is null or p_hash !~ '^[0-9a-f]{64}$'
  or p_started is null or p_started<clock_timestamp()-interval '20 minutes' or p_started>clock_timestamp()+interval '30 seconds' then raise exception 'Invalid summary identity/time.';end if;
 if jsonb_typeof(p_summary) is distinct from 'object' or jsonb_typeof(p_summary->'coverage') is distinct from 'object'
  or jsonb_typeof(p_summary->'coverage'->'missing_families') is distinct from 'array'
  or p_summary->>'format' is distinct from 'weekly-additive-v1' or octet_length(p_summary::text)>65536 then raise exception 'Invalid summary byte/format budget.';end if;
 if exists(select 1 from unnest(array['scores','players','paired_sleeper','markets']) f(k)
  where jsonb_typeof(p_summary->k) is distinct from 'array' or jsonb_array_length(p_summary->k)>256) then raise exception 'Invalid summary segment budget.';end if;
 -- Defend the compact contract even against a malformed worker: object keys and
 -- all leaves are primitive, with only the declared nested count/bin shapes.
 if exists(select 1 from jsonb_object_keys(p_summary) k where k not in ('format','scores','players','paired_sleeper','markets','coverage','note','diagnostics','futures','future_final','live')) then raise exception 'Unexpected summary field.';end if;
 if jsonb_typeof(p_summary->'diagnostics') is distinct from 'array' or jsonb_array_length(p_summary->'diagnostics')>256
  or jsonb_typeof(p_summary->'futures') is distinct from 'array' or jsonb_array_length(p_summary->'futures')>4
  or jsonb_typeof(p_summary->'live') is distinct from 'array' or jsonb_array_length(p_summary->'live')>4
  or jsonb_typeof(p_summary->'future_final') is distinct from 'boolean' then raise exception 'Invalid diagnostic summary budget.';end if;
 if exists(select 1 from jsonb_array_elements(p_summary->'diagnostics') w,lateral jsonb_each(w) f where
  f.key not in ('kind','horizon','model_version','type','totals','n','ties','probability_n','brier','log_loss','coverage_n','covered80')
  or (f.key in ('n','ties','probability_n','brier','log_loss','coverage_n','covered80') and (jsonb_typeof(f.value)<>'number' or f.value::numeric<0)))
  or exists(select 1 from jsonb_array_elements(p_summary->'diagnostics') w where sportsbook_private.numeric_total_valid(w->'totals') is distinct from true
   or w->>'type' not in ('categorical','distribution')) then raise exception 'Invalid diagnostic totals.';end if;
 if exists(select 1 from jsonb_array_elements(p_summary->'futures') w,lateral jsonb_each(w) f where f.key not in ('kind','generated','pending','totals','wins'))
  or exists(select 1 from jsonb_array_elements(p_summary->'futures') w where sportsbook_private.probability_total_valid(w->'totals') is distinct from true
   or sportsbook_private.numeric_total_valid(w->'wins') is distinct from true or w->>'kind' not in ('future_champion','future_playoffs','future_first_pick','future_win_total')
   or jsonb_typeof(w->'generated') is distinct from 'number' or jsonb_typeof(w->'pending') is distinct from 'number'
   or (w->>'generated')::numeric<0 or (w->>'pending')::numeric<0 or (w->>'pending')::numeric+(w->'totals'->>'n')::numeric<>(w->>'generated')::numeric) then raise exception 'Invalid future totals.';end if;
 if p_summary->>'future_final'='true' and (jsonb_array_length(p_summary->'futures')=0 or exists(select 1 from jsonb_array_elements(p_summary->'futures') w where (w->>'pending')::integer<>0)) then raise exception 'Unresolved future summary cannot be final.';end if;
 if exists(select 1 from jsonb_array_elements(p_summary->'live') w,lateral jsonb_each(w) f where
  f.key not in ('horizon','team_count','matchup_count','mae','rmse','bias','coverage80','brier','log_loss','margin_mae','total_mae')
  or jsonb_typeof(f.value) not in ('number','null')) or exists(select 1 from jsonb_array_elements(p_summary->'live') w where
   (w->>'horizon')::integer not between 0 and 3) then raise exception 'Invalid live totals.';end if;
 if exists(select 1 from jsonb_array_elements((p_summary->'scores')||(p_summary->'players')) row,
  lateral jsonb_object_keys(row) k where k not in ('view','horizon','model_version','missing','totals')) then raise exception 'Unexpected numeric summary field.';end if;
 if exists(select 1 from jsonb_array_elements((p_summary->'scores')||(p_summary->'players')) row
  where sportsbook_private.numeric_total_valid(row->'totals') is distinct from true) then raise exception 'Invalid additive numeric totals.';end if;
 if exists(select 1 from jsonb_array_elements(p_summary->'paired_sleeper') row,lateral jsonb_object_keys(row) k
  where k not in ('view','horizon','model_version','missing','adjusted','sleeper')) or
  exists(select 1 from jsonb_array_elements(p_summary->'paired_sleeper') row where
   sportsbook_private.numeric_total_valid(row->'adjusted') is distinct from true or sportsbook_private.numeric_total_valid(row->'sleeper') is distinct from true)
  then raise exception 'Invalid paired Sleeper totals.';end if;
 if exists(select 1 from jsonb_array_elements(p_summary->'markets') row,
  lateral jsonb_object_keys(row) k where k not in ('kind','horizon','model_version','generated','locked','published','pushes','pending','missing_probability','totals')) then raise exception 'Unexpected probability summary field.';end if;
 if exists(select 1 from jsonb_array_elements(p_summary->'markets') row where jsonb_typeof(row->'totals'->'bands') is distinct from 'array' or jsonb_array_length(row->'totals'->'bands')<>5) then raise exception 'Invalid calibration bin contract.';end if;
 if exists(select 1 from jsonb_array_elements(p_summary->'markets') row,lateral jsonb_each(row->'totals') t
  where t.key not in ('n','brier','log_loss','bands') or (t.key<>'bands' and (jsonb_typeof(t.value)<>'number' or t.value::numeric<0)))
  or exists(select 1 from jsonb_array_elements(p_summary->'markets') row,lateral jsonb_array_elements(row->'totals'->'bands') b,lateral jsonb_each(b) t
   where t.key not in ('n','predicted','observed') or jsonb_typeof(t.value)<>'number' or t.value::numeric<0)
  then raise exception 'Invalid probability totals.';end if;
 if exists(select 1 from jsonb_array_elements(p_summary->'markets') row cross join lateral unnest(array['n','brier','log_loss']) f(k)
  where jsonb_typeof(row->'totals'->k) is distinct from 'number') then raise exception 'Missing probability totals.';end if;
 if exists(select 1 from jsonb_array_elements(p_summary->'markets') row where sportsbook_private.probability_total_valid(row->'totals') is distinct from true)
  then raise exception 'Invalid bounded calibration totals.';end if;
 if exists(select 1 from jsonb_array_elements((p_summary->'scores')||(p_summary->'players')||(p_summary->'markets')||(p_summary->'paired_sleeper')||(p_summary->'diagnostics')) row,
  lateral jsonb_each(row) d where d.key in ('kind','view','horizon','model_version') and (jsonb_typeof(d.value)<>'string' or length(d.value#>>'{}')>80)) then raise exception 'Invalid summary dimensions.';end if;
 if exists(select 1 from jsonb_array_elements((p_summary->'scores')||(p_summary->'players')||(p_summary->'markets')||(p_summary->'paired_sleeper')||(p_summary->'diagnostics')) row
  where row->>'horizon' is null or row->>'horizon' not in ('opening','final_pregame') or not exists
   (select 1 from public.model_config_versions where league_id=j.league_id and id=(row->>'model_version')::uuid)) then raise exception 'Summary context outside league.';end if;
 if exists(select 1 from jsonb_array_elements((p_summary->'scores')||(p_summary->'players')||(p_summary->'paired_sleeper')) row
  where jsonb_typeof(row->'missing') is distinct from 'number' or (row->>'missing')::numeric<0 or (row->>'missing')::numeric<>trunc((row->>'missing')::numeric))
  or exists(select 1 from jsonb_array_elements(p_summary->'paired_sleeper') row where row->'adjusted'->'n'<>row->'sleeper'->'n') then raise exception 'Invalid summary missingness.';end if;
 if exists(select 1 from jsonb_each(p_summary->'coverage') t where t.key not in ('selected_runs','locked_forecasts','missing_starter_forecasts','unknown_source_freshness','missing_families')
  or (t.key<>'missing_families' and (jsonb_typeof(t.value)<>'number' or t.value::numeric<0)))
  or jsonb_array_length(p_summary->'coverage'->'missing_families')>4
  or exists(select 1 from jsonb_array_elements(p_summary->'coverage'->'missing_families') f where f#>>'{}' not in ('Matchups','Player Points','Weekly Specials','Season Futures'))
  or length(p_summary->>'note')>400 then raise exception 'Invalid summary coverage contract.';end if;
 -- This lock is already used by configuration changes; it serializes all
 -- summary revisions for this league and avoids first-insert races.
 perform 1 from public.model_controls where league_id=j.league_id for update;
 select * into old from public.model_evaluation_summaries where league_id=j.league_id
  and nfl_season=(select nfl_season from public.leagues where id=j.league_id) and market_week=j.market_week for update;
 if found then
  if old.input_hash=p_hash then
   if old.summary<>p_summary or old.context_hash<>p_context then raise exception 'Summary identity collision.';end if;
   return old.revision;
  end if;
  if old.read_started_at>=p_started then return old.revision;end if;
  if old.summary=p_summary and old.context_hash=p_context then return old.revision;end if;
 end if;
 insert into public.model_evaluation_summaries(league_id,nfl_season,market_week,context_hash,input_hash,read_started_at,summary)
 values(j.league_id,(select nfl_season from public.leagues where id=j.league_id),j.market_week,p_context,p_hash,p_started,p_summary)
 on conflict(league_id,nfl_season,market_week) do update set context_hash=excluded.context_hash,input_hash=excluded.input_hash,
 read_started_at=excluded.read_started_at,known_at=clock_timestamp(),summary=excluded.summary,revision=model_evaluation_summaries.revision+1
 returning revision into result;
 return result;
end $$;
revoke all on function public.save_evaluation_summary(uuid,integer,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.save_evaluation_summary(uuid,integer,text,text,timestamptz,jsonb) to service_role;
comment on table public.model_evaluation_summaries is 'Latest corrected bounded additive weekly metrics. No automatic sample expiry is authorized by this migration.';
commit;
