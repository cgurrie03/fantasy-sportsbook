begin;
-- A category refresh carries forward the other categories. Do not deactivate
-- and rewrite every unchanged quote in the board on each category save.
do $migration$
declare d text; original text;
begin
 select pg_get_functiondef('public.save_market_board(uuid,uuid,integer,timestamptz,timestamptz,jsonb,text)'::regprocedure) into d;
 original:=d;
 d:=replace(d,'update public.sportsbook_markets set active=false where board_id=p_board;',
 'update public.sportsbook_markets m set active=false where m.board_id=p_board and m.active and not exists(select 1 from jsonb_array_elements(p_quotes) q where q->>''market_key''=m.market_key and q->>''side''=m.side);');
 if d=original then raise exception 'Board deactivation anchor changed.'; end if;
 original:=d;
 d:=replace(d,'active=true;','active=true where ROW(public.sportsbook_markets.market_key,public.sportsbook_markets.matchup_key,public.sportsbook_markets.kind,public.sportsbook_markets.label,public.sportsbook_markets.subject,public.sportsbook_markets.side,public.sportsbook_markets.line,public.sportsbook_markets.odds,public.sportsbook_markets.boost_pct,public.sportsbook_markets.team_id,public.sportsbook_markets.home_team_id,public.sportsbook_markets.away_team_id,public.sportsbook_markets.home_projection,public.sportsbook_markets.away_projection,public.sportsbook_markets.featured,public.sportsbook_markets.metadata,public.sportsbook_markets.active) IS DISTINCT FROM ROW(excluded.market_key,excluded.matchup_key,excluded.kind,excluded.label,excluded.subject,excluded.side,excluded.line,excluded.odds,excluded.boost_pct,excluded.team_id,excluded.home_team_id,excluded.away_team_id,excluded.home_projection,excluded.away_projection,excluded.featured,excluded.metadata,true);');
 if d=original then raise exception 'Board upsert anchor changed.'; end if;
 execute d;
end $migration$;
commit;

