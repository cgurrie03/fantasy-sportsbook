-- The final stage atomically archives and saves both weekly and futures boards.
alter function public.stage_line_refresh(uuid,integer,jsonb) set statement_timeout='45s';
alter function public.stage_line_refresh(uuid,integer,jsonb) set work_mem='16MB';
-- The dispatcher is provisioned only in hosted environments with pg_net/Vault.
do $migration$
declare d text;
begin
 if to_regprocedure('sportsbook_private.dispatch_weekly_worker()') is not null then
  select pg_get_functiondef('sportsbook_private.dispatch_weekly_worker()'::regprocedure) into d;
  if position('timeout_milliseconds:=60000' in d)=0 then raise exception 'Dispatcher timeout anchor changed.'; end if;
  execute replace(d,'timeout_milliseconds:=60000','timeout_milliseconds:=130000');
 end if;
end $migration$;
