begin;
-- Resolve the current period, board and coherent member-safe quotes in one
-- round trip, preserving the existing membership and draft-admin authorization.
create function public.sportsbook_current_snapshot(p_league uuid,p_type text default 'weekly') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare period record; board_id uuid; snapshot jsonb;
begin
 if p_type not in ('weekly','future') then raise exception 'Unknown board type.'; end if;
 if not sportsbook_private.is_member(p_league) then return null; end if;
 select * into period from public.sportsbook_period(p_league);
 select b.id into board_id from public.sportsbook_boards b
  where b.league_id=p_league and b.nfl_season=period.nfl_season and b.board_type=p_type
   and (p_type='future' or b.market_week=period.week)
  order by b.market_week desc,b.id limit 1;
 snapshot:=case when board_id is null then null else public.sportsbook_quote_snapshot(board_id) end;
 return jsonb_build_object('week',period.week,'board',snapshot->'board','markets',coalesce(snapshot->'markets','[]'::jsonb));
end $$;
revoke all on function public.sportsbook_current_snapshot(uuid,text) from public,anon;
grant execute on function public.sportsbook_current_snapshot(uuid,text) to authenticated;
commit;
