begin;

-- Numeric report/settlement targets only; no provider, roster or model bodies.
create function sportsbook_private.report_quote(q jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select (select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(q) where key=any(array['id','market_key','matchup_key','kind','label','subject','side','line','odds',
  'boost_pct','team_id','home_team_id','away_team_id','home_projection','away_projection','featured'])) ||
 jsonb_build_object('metadata',
  coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(q->'metadata','{}'::jsonb)) where
   (key=any(array['assessment_run_id','player_id','opponent_player_id','model_version','pick_owner_name'])
     and jsonb_typeof(value)='string' and length(value#>>'{}')<=160)
   or (key=any(array['margin_lower','margin_upper','expected_team_count','roster_id','simulated_probability','fair_probability',
     'expected_wins','trials','playoff_week_start','playoff_teams']) and jsonb_typeof(value) in ('number','null'))
   or (key='lineup_locked' and jsonb_typeof(value)='boolean')),'{}'::jsonb) ||
  coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(q->'metadata','{}'::jsonb)) where
    key in ('projection_targets','win_distribution') and jsonb_typeof(value)='object'
    and (select count(*) from jsonb_each(case when jsonb_typeof(value)='object' then value else '{}'::jsonb end))<=32
    and not exists(select 1 from jsonb_each(case when jsonb_typeof(value)='object' then value else '{}'::jsonb end) x where jsonb_typeof(x.value)<>'number' or length(x.key)>80)), '{}'::jsonb));
$$;
revoke all on function sportsbook_private.report_quote(jsonb) from public,anon,authenticated,service_role;
-- Invoker report views need this pure projection function, which reads no tables.
grant execute on function sportsbook_private.report_quote(jsonb) to authenticated,service_role;

create table public.published_forecast_samples (
 id uuid primary key default gen_random_uuid(),league_id uuid not null references public.leagues(id),
 board_id uuid not null,revision integer not null,nfl_season integer not null,
 market_week integer not null check(market_week between 1 and 18),board_type text not null check(board_type in ('weekly','future')),
 horizon text not null check(horizon in ('opening','latest_pregame')),
 captured_at timestamptz not null,opens_at timestamptz not null,closes_at timestamptz not null,
 provenance text not null default 'published_snapshot' check(provenance in ('published_snapshot','existing_board_at_install')),
 quotes jsonb not null check(jsonb_typeof(quotes)='array' and octet_length(quotes::text)<=524288),
 quote_bytes integer generated always as (octet_length(quotes::text)) stored,
 foreign key(board_id,league_id) references public.sportsbook_boards(id,league_id),
 unique(league_id,nfl_season,market_week,board_type,horizon)
);
alter table public.published_forecast_samples enable row level security;
revoke all on public.published_forecast_samples from public,anon,authenticated,service_role;
grant select on public.published_forecast_samples to authenticated,service_role;
create policy publication_samples_admin on public.published_forecast_samples for select to authenticated
 using(sportsbook_private.is_admin(league_id));
create table public.published_forecast_health (
 league_id uuid primary key references public.leagues(id),captures bigint not null default 0,
 skipped bigint not null default 0,last_capture_at timestamptz,last_gap_at timestamptz,last_gap_reason text
 check(last_gap_reason in ('row_budget','byte_budget','sample_too_large','empty_board','ineligible'))
);
alter table public.published_forecast_health enable row level security;
revoke all on public.published_forecast_health from public,anon,authenticated,service_role;
grant select on public.published_forecast_health to authenticated,service_role;
create policy publication_health_admin on public.published_forecast_health for select to authenticated
 using(sportsbook_private.is_admin(league_id));

create or replace function sportsbook_private.capture_forecast(p_board uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b public.sportsbook_boards;q jsonb;bytes integer;slots integer;total_bytes bigint;old_bytes bigint;
 origin_week integer;need integer;h text;captured timestamptz:=clock_timestamp();reason text;
begin
 select * into b from public.sportsbook_boards where id=p_board for update;
 if not found or b.status<>'published' then return;end if;
 insert into public.published_forecast_health(league_id) values(b.league_id) on conflict do nothing;
 perform 1 from public.published_forecast_health where league_id=b.league_id for update;
 origin_week:=b.market_week;
 if b.board_type='future' then select week into origin_week from public.sportsbook_period(b.league_id);end if;
 if b.phase<>'pregame' or b.closes_at<=captured or origin_week not between 1 and 18 then reason:='ineligible';
 else
  select coalesce(jsonb_agg(sportsbook_private.report_quote(to_jsonb(m)) order by m.market_key,m.side),'[]'::jsonb)
   into q from public.sportsbook_markets m where m.board_id=b.id and m.active;
  bytes:=octet_length(q::text);
  if q='[]'::jsonb then reason:='empty_board';elsif bytes>524288 then reason:='sample_too_large';end if;
 end if;
 if reason is null then
  -- Same publication retry never reassigns an opening or older latest sample.
  if exists(select 1 from public.published_forecast_samples where league_id=b.league_id and nfl_season=b.nfl_season
   and market_week=origin_week and board_type=b.board_type and revision>=b.revision) then return;end if;
  select count(*),coalesce(sum(quote_bytes),0) into slots,total_bytes from public.published_forecast_samples where league_id=b.league_id;
  select 2-count(*),coalesce(sum(quote_bytes) filter(where horizon='latest_pregame'),0) into need,old_bytes
   from public.published_forecast_samples where league_id=b.league_id and nfl_season=b.nfl_season and market_week=origin_week and board_type=b.board_type;
  if slots+need>256 then reason:='row_budget';
  elsif total_bytes-old_bytes+bytes*(case when need=2 then 2 else 1 end)>16777216 then reason:='byte_budget';end if;
 end if;
 if reason is not null then
  update public.published_forecast_health set skipped=skipped+1,last_gap_at=captured,last_gap_reason=reason where league_id=b.league_id;return;
 end if;
 foreach h in array array['opening','latest_pregame'] loop
  insert into public.published_forecast_samples(league_id,board_id,revision,nfl_season,market_week,board_type,horizon,captured_at,opens_at,closes_at,provenance,quotes)
  values(b.league_id,b.id,b.revision,b.nfl_season,origin_week,b.board_type,h,captured,b.opens_at,b.closes_at,
   case when exists(select 1 from public.forecast_snapshots where board_id=b.id) then 'existing_board_at_install' else 'published_snapshot' end,q)
  on conflict(league_id,nfl_season,market_week,board_type,horizon) do update
   set board_id=excluded.board_id,revision=excluded.revision,captured_at=excluded.captured_at,
    opens_at=excluded.opens_at,closes_at=excluded.closes_at,quotes=excluded.quotes
   where published_forecast_samples.horizon='latest_pregame' and published_forecast_samples.revision<excluded.revision;
 end loop;
 update public.published_forecast_health set captures=captures+1,last_capture_at=captured where league_id=b.league_id;
end $$;
revoke all on function sportsbook_private.capture_forecast(uuid) from public,anon,authenticated,service_role;

-- Select legacy fixed horizons before expanding JSON. No conversion/deletion.
create view public.sportsbook_report_forecasts with (security_invoker=true) as
with legacy as (
 select f.*,row_number() over(partition by board_id order by revision) first_rank,
 row_number() over(partition by board_id order by revision desc) last_rank,
 row_number() over(partition by board_id order by (captured_at<=opens_at) desc,
  case when captured_at<=opens_at then revision end desc,revision) opening_rank
 from public.forecast_snapshots f
)
select id,league_id,board_id,revision,nfl_season,market_week,board_type,captured_at,opens_at,closes_at,provenance,
 case when board_type='weekly' then 'opening' else case when first_rank=1 then 'opening' else 'latest_pregame' end end as horizon,
 coalesce((select jsonb_agg(sportsbook_private.report_quote(q) order by ord) from jsonb_array_elements(quotes) with ordinality x(q,ord)),'[]'::jsonb) quotes
 from legacy where (board_type='weekly' and opening_rank=1) or (board_type='future' and (first_rank=1 or last_rank=1))
union all
select id,league_id,board_id,revision,nfl_season,market_week,board_type,captured_at,opens_at,closes_at,provenance,horizon,quotes
 from public.published_forecast_samples;
revoke all on public.sportsbook_report_forecasts from public,anon,authenticated,service_role;
grant select on public.sportsbook_report_forecasts to authenticated,service_role;

create or replace view public.sportsbook_report_forecast_details with (security_invoker=true) as
 select id,league_id,nfl_season,quotes from public.sportsbook_report_forecasts;
grant select on public.sportsbook_report_forecast_details to authenticated;

create or replace view public.sportsbook_model_publications with (security_invoker=true) as
select f.id,f.league_id,f.nfl_season,f.market_week,f.captured_at,
 coalesce((select jsonb_agg(jsonb_build_object('market_key',q->'market_key','side',q->'side','line',q->'line',
   'metadata',jsonb_build_object('assessment_run_id',q->'metadata'->'assessment_run_id')) order by ord)
 from jsonb_array_elements(f.quotes) with ordinality x(q,ord)),'[]'::jsonb) quotes
from public.sportsbook_report_forecasts f;
revoke all on public.sportsbook_model_publications from public,anon,authenticated;
grant select on public.sportsbook_model_publications to service_role;

comment on table public.published_forecast_samples is 'Bounded fixed publication horizons; full revision/roster replay retired. Summary-driven expiry is a subsequent migration; no legacy cleanup here.';
commit;
