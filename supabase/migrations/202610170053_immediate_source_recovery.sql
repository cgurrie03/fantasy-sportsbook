begin;
-- A verified observation after a transient outage must not leave acceptance
-- suspended until the next two-hour slot. Recovery still reprices all families.
alter table public.line_refresh_cycles add column source_recovery boolean not null default false;
drop index public.line_refresh_active_slot_key;
create unique index line_refresh_active_slot_key on public.line_refresh_cycles(league_id,market_week,slot)
 where status in ('staging','published','skipped') and not source_recovery;

do $migration$ declare d text; old text; begin
 select pg_get_functiondef('public.observe_line_refresh(jsonb,text)'::regprocedure) into d;
 old:=d; d:=replace(d,'minutes integer; slot bigint;','minutes integer; recovering boolean; slot bigint;');
 if old=d then raise exception 'Recovery declaration anchor changed.'; end if;
 old:=d; d:=replace(d,'minutes:=case when coalesce',
 'recovering:=not s.publication_paused and p_error is null and p_status->>''reason'' is null and (r.last_error is not null or exists(select 1 from public.sportsbook_boards held where held.league_id=s.league_id and held.status=''published'' and held.closes_at>now() and (held.market_week=w or held.board_type=''future'') and (held.suspension_reason ~* ''timeout|timed out|fetch|gateway|ECONN|source unavailable|connection|aborted'' or held.quote_valid_until<=now()))); minutes:=case when coalesce');
 if old=d then raise exception 'Recovery observation anchor changed.'; end if;
 old:=d; d:=replace(d,'next_due_at=case when r.market_week<>w or minutes<>r.interval_minutes then now()',
 'next_due_at=case when recovering or r.market_week<>w or minutes<>r.interval_minutes then now()');
 if old=d then raise exception 'Recovery due-time anchor changed.'; end if;
 old:=d; d:=replace(d,'slot,weekly_board,weekly_revision','slot,source_recovery,weekly_board,weekly_revision');
 if old=d then raise exception 'Recovery cycle column anchor changed.'; end if;
 old:=d; d:=replace(d,'values(s.league_id,w,slot,b.id','values(s.league_id,w,slot,recovering,b.id');
 if old=d then raise exception 'Recovery cycle values anchor changed.'; end if;
 execute d;
end $migration$;
commit;
