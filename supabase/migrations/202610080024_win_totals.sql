begin;
alter table public.sportsbook_markets drop constraint sportsbook_markets_kind_check;
alter table public.sportsbook_markets add constraint sportsbook_markets_kind_check check(kind in ('spread','moneyline','match_total','team_total','player_points','weekly_high','weekly_low','weekly_count_150','weekly_any_below_100','weekly_any_200','weekly_count_projection','weekly_average','weekly_highest_score','future_champion','future_playoffs','future_first_pick','future_win_total'));
alter table public.sportsbook_markets add constraint win_total_half_line check(kind<>'future_win_total' or (line is not null and line>=0.5 and line<=17.5 and mod(line,1)=0.5 and side in ('over','under')));
do $$ declare d text; original text;
begin
 select pg_get_functiondef('public.save_future_board(uuid,uuid,jsonb,text)'::regprocedure) into d;
 d:=replace(d,'''future_champion'',''future_playoffs'',''future_first_pick''','''future_champion'',''future_playoffs'',''future_first_pick'',''future_win_total''');
 d:=replace(d,'(q->>''kind''<>''future_playoffs'' and q->>''side'' is distinct from q->>''team_id'')','(q->>''kind'' not in (''future_playoffs'',''future_win_total'') and q->>''side'' is distinct from q->>''team_id'') or (q->>''kind''=''future_win_total'' and q->>''side'' not in (''over'',''under''))');
 d:=replace(d,'q->>''side'',null,(q->>''odds'')','q->>''side'',(q->>''line'')::numeric,(q->>''odds'')');
 d:=replace(d,'set label=excluded.label,subject=excluded.subject,odds=excluded.odds','set label=excluded.label,subject=excluded.subject,line=excluded.line,odds=excluded.odds');
 execute d;
 select pg_get_functiondef('public.place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid)'::regprocedure) into d;
 original:=d;
 d:=replace(d,'and kind<>''future_playoffs'') then raise exception ''League Winner and #1 Pick are standalone bets. Only playoff picks can be parlayed together.'';',
 'and kind not in (''future_playoffs'',''future_win_total'')) then raise exception ''League Winner and #1 Pick are standalone bets.''; end if;
 if v_board.board_type=''future'' and cardinality(p_picks)>1 and (select count(distinct kind) from public.sportsbook_markets where id=any(p_picks))<>1 then raise exception ''Playoff and win-total parlays must remain separate.'';');
 if d=original then raise exception 'Futures guard anchor changed.'; end if;
 execute d;
 select pg_get_functiondef('public.resolve_future_markets(uuid,text[])'::regprocedure) into d;
 execute replace(d,'''future_champion'',''future_playoffs'',''future_first_pick''','''future_champion'',''future_playoffs'',''future_first_pick'',''future_win_total''');
end $$;
create or replace function public.label_future_leg() returns trigger language plpgsql set search_path='' as $$
begin
 new.market_type:=case new.settlement_context->>'kind' when 'future_champion' then 'League Winner' when 'future_playoffs' then 'Make / Miss Playoffs' when 'future_first_pick' then '#1 Pick' when 'future_win_total' then 'Regular-season Wins' else new.market_type end;
 return new;
end $$;
commit;
