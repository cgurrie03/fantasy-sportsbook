begin;
-- Member screens need display/availability/compatibility fields, not a repeated
-- model research record on every selection. Stored quotes and archives stay intact.
create function sportsbook_private.member_quote_metadata(p_metadata jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,case
  when key='reopening_events' and jsonb_typeof(value)='array' then
   coalesce((select jsonb_agg(jsonb_build_object('id',e->'id','state',e->'state','starts_at',e->'starts_at')) from jsonb_array_elements(value)e),'[]'::jsonb)
  else value end),'{}'::jsonb)
 from jsonb_each(p_metadata) where key=any(array[
  'player_id','position','nfl_team','season_average','projection','expected_points','game_info','cutoff_at','generated_at',
  'left_player','right_player','slot','slot_index','margin_lower','margin_upper',
  'expected_wins','pick_owner_name','pick_owner_team_id','simulated_probability',
  'projection_targets','expected_team_count','lineup_locked','lock_reason','resolved',
  'reopening_locked','reopening_lock_reason','reopening_events'
 ]);
$$;
revoke all on function sportsbook_private.member_quote_metadata(jsonb) from public,anon,authenticated;

create or replace function public.sportsbook_current_snapshot(p_league uuid,p_type text default 'weekly') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare period record; board_id uuid; snapshot jsonb; member_markets jsonb;
begin
 if p_type not in ('weekly','future') then raise exception 'Unknown board type.'; end if;
 if not sportsbook_private.is_member(p_league) then return null; end if;
 select * into period from public.sportsbook_period(p_league);
 select b.id into board_id from public.sportsbook_boards b
  where b.league_id=p_league and b.nfl_season=period.nfl_season and b.board_type=p_type
   and (p_type='future' or b.market_week=period.week)
  order by b.market_week desc,b.id limit 1;
 snapshot:=case when board_id is null then null else public.sportsbook_quote_snapshot(board_id) end;
 select coalesce(jsonb_agg(q||jsonb_build_object('metadata',sportsbook_private.member_quote_metadata(q->'metadata'))),'[]'::jsonb)
  into member_markets from jsonb_array_elements(coalesce(snapshot->'markets','[]'::jsonb))q;
 return jsonb_build_object('week',period.week,'board',snapshot->'board','markets',member_markets);
end $$;
revoke all on function public.sportsbook_current_snapshot(uuid,text) from public,anon;
grant execute on function public.sportsbook_current_snapshot(uuid,text) to authenticated;
commit;
