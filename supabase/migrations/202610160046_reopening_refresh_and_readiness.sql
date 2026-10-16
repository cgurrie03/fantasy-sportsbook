begin;
create function sportsbook_private.active_reopening(p_league uuid,p_week integer) returns uuid
language sql stable security definer set search_path='' as $$
 select id from public.sportsbook_reopening_reviews where league_id=p_league and market_week=p_week and status='approved' and closes_at>now() limit 1
$$;
revoke all on function sportsbook_private.active_reopening(uuid,integer) from public,anon,authenticated,service_role;
create function sportsbook_private.maintain_reopenings(p_league uuid,p_week integer) returns void
language plpgsql security definer set search_path='' as $$
declare w public.sportsbook_reopening_reviews;
begin
 update public.sportsbook_reopening_reviews set status='expired' where league_id=p_league and status='approved' and closes_at<=now();
 update public.sportsbook_boards set status='closed' where league_id=p_league and reopening_id is not null and reopening_until<=now() and status<>'closed';
 for w in select * from public.sportsbook_reopening_reviews where league_id=p_league and market_week<>p_week and status in('approved','expired') loop
  update public.sportsbook_boards set reopening_id=null,reopening_until=null,phase='pregame',closes_at=w.original_future_closes,status=w.original_future_status,quote_valid_until=now(),suspension_reason='Waiting for the new week refresh.' where id=w.future_board and reopening_id=w.id;
  update public.sportsbook_reopening_reviews set status='expired' where id=w.id and status='approved';
 end loop;
end $$;
revoke all on function sportsbook_private.maintain_reopenings(uuid,integer) from public,anon,authenticated,service_role;

do $migration$
declare d text;old text;
begin
 select pg_get_functiondef('public.observe_line_refresh(jsonb,text)'::regprocedure) into d;old:=d;
 d:=replace(d,'select week into w from public.sportsbook_period(s.league_id);','select week into w from public.sportsbook_period(s.league_id); perform sportsbook_private.maintain_reopenings(s.league_id,w);');
 if d=old then raise exception 'Reopening maintenance anchor changed.'; end if;old:=d;
 d:=replace(d,'and (market_week=w or board_type=''future'');','and (market_week=w or board_type=''future'') and (reopening_id is null or reopening_until<=now() or r.last_error is not null);');
 if d=old then raise exception 'Reopening observation anchor changed.'; end if;
 execute d;
 select pg_get_functiondef('public.stage_line_refresh(uuid,integer,jsonb)'::regprocedure) into d;old:=d;
 d:=replace(d,'when r.week_started then','when r.week_started and sportsbook_private.active_reopening(j.league_id,j.market_week) is null then');
 if d=old then raise exception 'Reopening stage gate anchor changed.'; end if;old:=d;
 d:=replace(d,'quote_valid_until=now()+interval ''130 minutes''','quote_valid_until=least(b.closes_at,now()+interval ''130 minutes'')');
 if d=old then raise exception 'Reopening validity anchor changed.'; end if;old:=d;
 d:=replace(d,'for b in select * from public.sportsbook_boards where id in(c.weekly_board,c.future_board) order by id loop',
 'if sportsbook_private.active_reopening(j.league_id,j.market_week) is not null and exists(select 1 from public.line_refresh_stages st cross join lateral jsonb_array_elements(st.quotes) as rq(value) where st.cycle_id=c.id and (rq.value->''metadata''->>''reopening_review_id'' is distinct from sportsbook_private.active_reopening(j.league_id,j.market_week)::text or rq.value->''metadata''->>''reopening_model'' is distinct from ''between-games-conditional-v1'')) then raise exception ''All categories must use the approved reopening inputs.''; end if; for b in select * from public.sportsbook_boards where id in(c.weekly_board,c.future_board) order by id loop');
 if d=old then raise exception 'Reopening provenance anchor changed.'; end if;
 execute d;
end $migration$;

create function public.sportsbook_readiness(p_league uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only this league admin can read readiness diagnostics.'; end if;
 select jsonb_build_object(
 'runtime',(select jsonb_build_object('observed_at',observed_at,'last_success_at',last_success_at,'last_error',last_error,'next_due_at',next_due_at,'week_started',week_started,'any_in_progress',any_in_progress) from public.line_refresh_runtime where league_id=p_league),
 'boards',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'type',b.board_type,'week',b.market_week,'status',b.status,'phase',b.phase,'closes_at',b.closes_at,'suspension_reason',b.suspension_reason,'valid_until',b.quote_valid_until,'reopening_until',b.reopening_until,
 'categories',(select jsonb_agg(x) from(select m.kind,count(*) as quotes,count(*)filter(where m.metadata->>'lineup_locked'='true' or m.metadata->>'reopening_locked'='true') as locked,min(m.metadata->>'generated_at') as oldest_generated_at from public.sportsbook_markets m where m.board_id=b.id and m.active group by m.kind)x))) from public.sportsbook_boards b where b.league_id=p_league and b.nfl_season=(select nfl_season from public.leagues where id=p_league) and (b.board_type='future' or b.market_week=(select week from public.sportsbook_period(p_league)))),'[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.sportsbook_readiness(uuid) from public,anon;
grant execute on function public.sportsbook_readiness(uuid) to authenticated;
commit;
