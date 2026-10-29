begin;
-- Match the category predicate so a small Matchups read does not scan every
-- player/futures row belonging to the board.
create index sportsbook_markets_category_idx on public.sportsbook_markets(board_id,kind) where active;
-- The immutable metadata projection is pure; invoker category reads still use
-- the existing board/market RLS and never gain staff-only archive privileges.
grant execute on function sportsbook_private.member_quote_metadata(jsonb) to authenticated;
create function public.sportsbook_category_snapshot(p_league uuid,p_board uuid,p_category text) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare period record;b public.sportsbook_boards;v_markets jsonb;v_result jsonb;
begin
 if p_category not in ('Matchups','Player Points','Head to Head','Weekly Specials','Season Futures') or p_category is null
  then raise exception 'Unknown market category';end if;
 if not sportsbook_private.is_member(p_league) then return null;end if;
 select * into period from public.sportsbook_period(p_league);
 select * into b from public.sportsbook_boards where id=p_board and league_id=p_league and nfl_season=period.nfl_season
  and board_type=case when p_category='Season Futures' then 'future' else 'weekly' end
  and (p_category='Season Futures' or market_week=period.week);
 if b.id is null then return null;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'board_id',m.board_id,'market_key',m.market_key,'matchup_key',m.matchup_key,
  'kind',m.kind,'label',m.label,'subject',m.subject,'side',m.side,'line',m.line,'odds',m.odds,'boost_pct',m.boost_pct,
  'team_id',m.team_id,'home_team_id',m.home_team_id,'away_team_id',m.away_team_id,'home_projection',m.home_projection,
  'away_projection',m.away_projection,'featured',m.featured,'metadata',sportsbook_private.member_quote_metadata(m.metadata),
  'active',m.active,'market_state',m.market_state,'suspension_reason',m.suspension_reason) order by m.market_key,m.side,m.id),'[]'::jsonb)
  into v_markets from public.sportsbook_markets m where m.board_id=b.id and m.active and
   m.kind=any(case p_category
    when 'Player Points' then array['player_points','player_milestone']
    when 'Head to Head' then array['player_h2h']
    when 'Weekly Specials' then array['weekly_high','weekly_low','weekly_count_150','weekly_count_projection','weekly_average','weekly_highest_score','weekly_any_below_100','weekly_any_200']
    when 'Season Futures' then array['future_champion','future_playoffs','future_first_pick','future_win_total']
    else array['spread','moneyline','match_total','team_total','team_milestone','winning_margin'] end);
 v_result:=jsonb_build_object('week',period.week,'board',to_jsonb(b),'markets',v_markets);
 if octet_length(v_result::text)>1048576 then raise exception 'Market category exceeds its read budget';end if;
 return v_result;
end $$;
revoke all on function public.sportsbook_category_snapshot(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.sportsbook_category_snapshot(uuid,uuid,text) to authenticated;
comment on function public.sportsbook_category_snapshot(uuid,uuid,text) is
 'Member-safe, RLS-preserving category projection for an explicitly scoped current board. No full quote snapshot or unrelated category bodies are read.';
commit;
