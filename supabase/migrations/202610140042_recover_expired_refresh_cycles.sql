begin;
-- An abandoned cycle must not reserve its two-hour slot after supersession.
alter table public.line_refresh_cycles drop constraint line_refresh_cycles_league_id_market_week_slot_key;
create unique index line_refresh_active_slot_key on public.line_refresh_cycles(league_id,market_week,slot)
 where status in ('staging','published','skipped');
do $migration$
declare d text; original text;
begin
 select pg_get_functiondef('public.observe_line_refresh(jsonb,text)'::regprocedure) into d;
 original:=d;
 d:=replace(d,'if p_error is not null or r.last_error is not null or r.next_due_at>now() then continue; end if;',
 'if p_error is not null or r.last_error is not null or (r.next_due_at>now() and not exists(select 1 from public.line_refresh_cycles expired where expired.league_id=s.league_id and expired.status=''staging'' and expired.created_at<=now()-interval ''20 minutes'')) then continue; end if;');
 if d=original then raise exception 'Refresh cadence anchor changed.'; end if;
 original:=d;
 d:=replace(d,'where league_id=s.league_id and status=''staging'' and created_at>now()-interval ''20 minutes''',
 'where league_id=s.league_id and market_week=w and status=''staging'' and created_at>now()-interval ''20 minutes''');
 if d=original then raise exception 'Refresh week anchor changed.'; end if;
 execute d;
end $migration$;
commit;
