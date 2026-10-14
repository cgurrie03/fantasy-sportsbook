begin;
-- Claims are brief; serialize them so two simultaneous worker requests cannot
-- both observe an empty writer lane for the same league.
do $migration$
declare d text; original text;
begin
 select pg_get_functiondef('public.claim_automation_job()'::regprocedure) into d;
 original:=d;
 d:=replace(d,'return query update public.automation_jobs set status=''running''',
 'perform pg_advisory_xact_lock(hashtext(''sportsbook-job-claim'')); return query update public.automation_jobs set status=''running''');
 if d=original then raise exception 'Job claim anchor changed.'; end if;
 original:=d;
 d:=replace(d,'and j.created_at>now()-interval ''2 hours''',
 'and j.created_at>now()-interval ''2 hours'' and (j.operation !~ ''^(generate_|refresh_|interval_|publish$)'' or not exists(select 1 from public.automation_jobs busy where busy.league_id=j.league_id and busy.id<>j.id and busy.status=''running'' and busy.lease_until>now() and busy.operation ~ ''^(generate_|refresh_|interval_|publish$)''))');
 if d=original then raise exception 'Job writer-lane anchor changed.'; end if;
 execute d;
end $migration$;
commit;

