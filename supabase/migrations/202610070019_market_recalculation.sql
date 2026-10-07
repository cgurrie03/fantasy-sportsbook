-- Quote identity is the board, market key and side. Inactive quotes may return
-- after lineup changes; preserve their IDs and all accepted ticket snapshots.
do $$
declare definition text; original text;
begin
 select pg_get_functiondef('public.save_market_board(uuid,uuid,integer,timestamptz,timestamptz,jsonb,text)'::regprocedure) into definition;
 original:=definition;
 definition:=replace(definition,'on conflict(id) do update set market_key=excluded.market_key',
   'on conflict(board_id,market_key,side) do update set market_key=excluded.market_key');
 if definition=original then raise exception 'Market quote upsert anchor changed.'; end if;
 execute definition;
end $$;
