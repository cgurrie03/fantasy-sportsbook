-- Report reads keep the original archive unchanged and obey its admin RLS.
-- Omit repeated full lineup/scoring blobs; eligible-player lists and roster
-- positions remain available for exact archived lineup-efficiency analysis.
create view public.sportsbook_report_forecast_details
with (security_invoker=true) as
select f.id,f.league_id,f.nfl_season,
 coalesce((select jsonb_agg(
   (entry.value-'metadata') || jsonb_build_object('metadata',
     coalesce(entry.value->'metadata','{}'::jsonb)-array['home_lineup','away_lineup','scoring_settings'])
   order by entry.ord)
   from jsonb_array_elements(f.quotes) with ordinality as entry(value,ord)), '[]'::jsonb) as quotes
from public.forecast_snapshots f;
revoke all on public.sportsbook_report_forecast_details from public,anon,authenticated,service_role;
grant select on public.sportsbook_report_forecast_details to authenticated;
