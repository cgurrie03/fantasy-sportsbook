begin;

-- Worker-only projections. RLS remains enforced by the underlying relations;
-- invoker views do not confer access to archived inputs or other leagues.
create view public.sportsbook_model_publications with (security_invoker=true) as
select f.id,f.league_id,f.nfl_season,f.market_week,f.captured_at,
 coalesce((select jsonb_agg(jsonb_build_object(
   'market_key',q->'market_key','side',q->'side','line',q->'line',
   'metadata',jsonb_build_object('assessment_run_id',q->'metadata'->'assessment_run_id')) order by ord)
   from jsonb_array_elements(f.quotes) with ordinality as x(q,ord)), '[]'::jsonb) as quotes
from public.forecast_snapshots f;

-- One designated opening forecast per origin week replaces all-refresh
-- futures trajectories in model review. Long-horizon rows remain correlated.
create view public.sportsbook_model_future_openings with (security_invoker=true) as
select r.id,r.league_id,r.nfl_season,r.market_week,r.captured_at,r.category,
 coalesce((select jsonb_agg(jsonb_build_object(
   'id',q->'id','market_key',q->'market_key','kind',q->'kind','side',q->'side','line',q->'line',
   'metadata',jsonb_build_object('roster_id',q->'metadata'->'roster_id',
     'fair_probability',q->'metadata'->'fair_probability','expected_wins',q->'metadata'->'expected_wins',
     'win_distribution',q->'metadata'->'win_distribution')) order by ord)
   from jsonb_array_elements(r.payload->'quotes') with ordinality as x(q,ord)), '[]'::jsonb) as quotes
from (select distinct on (league_id,nfl_season,market_week)
  id,league_id,nfl_season,market_week,captured_at,category,payload
  from public.model_forecast_runs where category='Season Futures'
  order by league_id,nfl_season,market_week,captured_at,id) r;

create view public.sportsbook_model_latest_reviews with (security_invoker=true) as
select distinct on (league_id,nfl_season,market_week)
 id,league_id,nfl_season,market_week,nfl_season*100+market_week as period,
 created_at,outcome_id,report
from public.model_weekly_reviews
order by league_id,nfl_season,market_week,created_at desc,id desc;

revoke all on public.sportsbook_model_publications,public.sportsbook_model_future_openings,
 public.sportsbook_model_latest_reviews from public,anon,authenticated,service_role;
grant select on public.sportsbook_model_publications,public.sportsbook_model_future_openings,
 public.sportsbook_model_latest_reviews to service_role;
comment on view public.sportsbook_model_publications is 'Worker-only publication coverage, excluding full quotes and model inputs. Filter by exact league/season/week.';
comment on view public.sportsbook_model_future_openings is 'Worker-only fixed opening horizons by origin week. Not complete refresh or line-movement history.';
commit;
