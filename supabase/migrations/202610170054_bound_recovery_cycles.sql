begin;
-- Coalesce recovery while its four jobs run; do not move the next due time
-- backwards or attempt unapproved live pricing after the window closes.
do $migration$ declare d text; old text; begin
 select pg_get_functiondef('public.observe_line_refresh(jsonb,text)'::regprocedure) into d; old:=d;
 d:=replace(d,'recovering:=not s.publication_paused and p_error is null',
 'recovering:=not s.publication_paused and (not (coalesce((p_status->>''week_started'')::boolean,false) or (r.market_week=w and r.week_started)) or sportsbook_private.active_reopening(s.league_id,w) is not null) and not exists(select 1 from public.line_refresh_cycles active_cycle where active_cycle.league_id=s.league_id and active_cycle.market_week=w and active_cycle.status=''staging'' and active_cycle.created_at>now()-interval ''20 minutes'') and p_error is null');
 if d=old then raise exception 'Recovery coalescing anchor changed.'; end if;
 execute d;
end $migration$;
commit;
