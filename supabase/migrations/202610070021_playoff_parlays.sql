do $$
declare definition text; original text;
begin
 select pg_get_functiondef('public.place_sportsbook_ticket(uuid,integer,uuid[],numeric,uuid)'::regprocedure) into definition;
 original:=definition;
 definition:=replace(definition,
 'if v_board.board_type=''future'' and cardinality(p_picks)<>1 then raise exception ''Season Futures are standalone bets.''; end if;',
 'if v_board.board_type=''future'' and cardinality(p_picks)>1 and exists(select 1 from public.sportsbook_markets where id=any(p_picks) and kind<>''future_playoffs'') then raise exception ''League Winner and #1 Pick are standalone bets. Only playoff picks can be parlayed together.''; end if;');
 if definition=original then raise exception 'Futures placement guard anchor changed.'; end if;
 execute definition;
end $$;
