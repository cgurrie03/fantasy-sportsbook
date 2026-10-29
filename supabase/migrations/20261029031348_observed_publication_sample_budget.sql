begin;
-- An observed 789-selection publication projects to ~615 KB. Allow it while
-- preserving the league-wide 16 MiB budget and fixed row/horizon admission.
alter table public.published_forecast_samples drop constraint published_forecast_samples_quotes_check;
alter table public.published_forecast_samples add constraint published_forecast_samples_quotes_check
 check(jsonb_typeof(quotes)='array' and octet_length(quotes::text)<=1048576);
do $$declare definition text;begin
 select pg_get_functiondef('sportsbook_private.capture_forecast(uuid)'::regprocedure) into definition;
 if position('bytes>524288' in definition)=0 then raise exception 'Publication size anchor changed.';end if;
 execute replace(definition,'bytes>524288','bytes>1048576');
end $$;
commit;
