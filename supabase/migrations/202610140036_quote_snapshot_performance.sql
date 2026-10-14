begin;

-- Validate the board once, rather than re-running its RLS membership checks
-- for every quote. Keep the same member/draft-admin visibility contract.
create or replace function public.sportsbook_quote_snapshot(p_board uuid) returns jsonb
language plpgsql stable security definer set search_path='' set work_mem='16MB' as $$
declare b public.sportsbook_boards; result jsonb;
begin
 select * into b from public.sportsbook_boards where id=p_board;
 if not found or not sportsbook_private.is_member(b.league_id)
    or (b.status='draft' and not sportsbook_private.is_admin(b.league_id)) then
  return null;
 end if;
 select jsonb_build_object('board',to_jsonb(b),'markets',coalesce(
  (select jsonb_agg(to_jsonb(m) order by m.market_key,m.side)
   from public.sportsbook_markets m where m.board_id=b.id and m.active),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.sportsbook_quote_snapshot(uuid) from public,anon;
grant execute on function public.sportsbook_quote_snapshot(uuid) to authenticated;

commit;
