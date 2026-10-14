begin;
create or replace function public.save_market_board(p_board uuid,p_league uuid,p_week integer,p_opens timestamptz,p_closes timestamptz,p_quotes jsonb,p_status text default 'draft') returns uuid
language plpgsql security definer set search_path='' set work_mem='16MB' set statement_timeout='45s' as $$
declare v_league public.leagues; v_board public.sportsbook_boards;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can manage markets.'; end if;
 if p_status is null or p_quotes is null or p_status not in ('draft','published','closed') or jsonb_typeof(p_quotes)<>'array' or jsonb_array_length(p_quotes)>1500 then raise exception 'Invalid market board.'; end if;
 if p_status='published' and (p_closes<=now() or jsonb_array_length(p_quotes)=0) then raise exception 'Add markets and a future cutoff before publishing.'; end if;
 select * into v_league from public.leagues where id=p_league;
 select * into v_board from public.sportsbook_boards where id=p_board for update;
 if found and (v_board.league_id<>p_league or v_board.market_week<>p_week or v_board.board_type<>'weekly') then raise exception 'Board identity does not match this league and week.'; end if;
 -- Validate the complete replacement before any quote changes.
 if exists(select 1 from jsonb_array_elements(p_quotes) q join public.sportsbook_markets m on m.id=(q->>'id')::uuid where m.board_id<>p_board) then raise exception 'A quote belongs to a different board.'; end if;
 if exists(select 1 from jsonb_array_elements(p_quotes) q cross join lateral (values(nullif(q->>'team_id','')::uuid),(nullif(q->>'home_team_id','')::uuid),(nullif(q->>'away_team_id','')::uuid)) x(id) where x.id is not null and not exists(select 1 from public.teams t where t.id=x.id and t.league_id=p_league)) then raise exception 'Market teams must belong to this league.'; end if;
 if exists(select 1 from jsonb_array_elements(p_quotes) q where (q->>'boost_pct')::int=25 and not ((q->>'featured'='Game of the Week' and q->>'kind'='moneyline') or (q->>'featured'='Tank Bowl' and (q->>'kind'='moneyline' or (q->>'kind'='match_total' and q->>'side'='over'))))) then raise exception 'This selection is not eligible for the featured boost.'; end if;
 insert into public.sportsbook_boards(id,league_id,market_week,nfl_season,league_season,opens_at,closes_at,status)
 values(p_board,p_league,p_week,v_league.nfl_season,v_league.league_season,p_opens,p_closes,p_status)
 on conflict(id) do update set opens_at=excluded.opens_at,closes_at=excluded.closes_at,status=excluded.status,revision=public.sportsbook_boards.revision+1;
 update public.sportsbook_markets m set active=false where m.board_id=p_board and m.active and not exists(select 1 from jsonb_array_elements(p_quotes) q where q->>'market_key'=m.market_key and q->>'side'=m.side);
 insert into public.sportsbook_markets(id,board_id,market_key,matchup_key,kind,label,subject,side,line,odds,boost_pct,team_id,home_team_id,away_team_id,home_projection,away_projection,featured,metadata)
 select q.id,p_board,q.market_key,nullif(q.matchup_key,''),q.kind,q.label,q.subject,q.side,q.line,q.odds,coalesce(q.boost_pct,0),q.team_id,q.home_team_id,q.away_team_id,q.home_projection,q.away_projection,coalesce(q.featured,''),coalesce(q.metadata,'{}'::jsonb)
 from jsonb_to_recordset(p_quotes) as q(id uuid,market_key text,matchup_key text,kind text,label text,subject text,side text,line numeric,odds integer,boost_pct integer,team_id uuid,home_team_id uuid,away_team_id uuid,home_projection numeric,away_projection numeric,featured text,metadata jsonb)
 on conflict(board_id,market_key,side) do update set market_key=excluded.market_key,matchup_key=excluded.matchup_key,kind=excluded.kind,label=excluded.label,subject=excluded.subject,side=excluded.side,line=excluded.line,odds=excluded.odds,boost_pct=excluded.boost_pct,team_id=excluded.team_id,home_team_id=excluded.home_team_id,away_team_id=excluded.away_team_id,home_projection=excluded.home_projection,away_projection=excluded.away_projection,featured=excluded.featured,metadata=excluded.metadata,active=true
 where ROW(public.sportsbook_markets.market_key,public.sportsbook_markets.matchup_key,public.sportsbook_markets.kind,public.sportsbook_markets.label,public.sportsbook_markets.subject,public.sportsbook_markets.side,public.sportsbook_markets.line,public.sportsbook_markets.odds,public.sportsbook_markets.boost_pct,public.sportsbook_markets.team_id,public.sportsbook_markets.home_team_id,public.sportsbook_markets.away_team_id,public.sportsbook_markets.home_projection,public.sportsbook_markets.away_projection,public.sportsbook_markets.featured,public.sportsbook_markets.metadata,public.sportsbook_markets.active) IS DISTINCT FROM ROW(excluded.market_key,excluded.matchup_key,excluded.kind,excluded.label,excluded.subject,excluded.side,excluded.line,excluded.odds,excluded.boost_pct,excluded.team_id,excluded.home_team_id,excluded.away_team_id,excluded.home_projection,excluded.away_projection,excluded.featured,excluded.metadata,true);
 perform sportsbook_private.capture_forecast(p_board);
 return p_board;
end $$;
commit;

