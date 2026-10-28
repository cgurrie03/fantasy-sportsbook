begin;
alter table public.sportsbook_boards add column content_version bigint not null default 0;

-- Statement transition tables invalidate once per affected board, including
-- settlement/resolution changes that do not change its acceptance revision.
create function sportsbook_private.invalidate_board_content() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    update public.sportsbook_boards set content_version=content_version+1
      where id in(select distinct board_id from new_rows);
  elsif tg_op='DELETE' then
    update public.sportsbook_boards set content_version=content_version+1
      where id in(select distinct board_id from old_rows);
  else
    update public.sportsbook_boards set content_version=content_version+1 where id in(
      select board_id from (select * from new_rows except select * from old_rows) changed
      union select board_id from (select * from old_rows except select * from new_rows) removed);
  end if;
  return null;
end;
$$;
revoke all on function sportsbook_private.invalidate_board_content() from public,anon,authenticated,service_role;
create trigger board_content_insert after insert on public.sportsbook_markets
  referencing new table as new_rows for each statement execute function sportsbook_private.invalidate_board_content();
create trigger board_content_update after update on public.sportsbook_markets
  referencing old table as old_rows new table as new_rows for each statement execute function sportsbook_private.invalidate_board_content();
create trigger board_content_delete after delete on public.sportsbook_markets
  referencing old table as old_rows for each statement execute function sportsbook_private.invalidate_board_content();

create function public.sportsbook_board_manifest(p_league uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare period record; weekly jsonb; future jsonb;
begin
  if not sportsbook_private.is_member(p_league) then return null; end if;
  select * into period from public.sportsbook_period(p_league);
  select to_jsonb(b) into weekly from public.sportsbook_boards b
    where b.league_id=p_league and b.nfl_season=period.nfl_season
      and b.board_type='weekly' and b.market_week=period.week
      and (b.status<>'draft' or sportsbook_private.is_admin(p_league))
    order by b.id limit 1;
  select to_jsonb(b) into future from public.sportsbook_boards b
    where b.league_id=p_league and b.nfl_season=period.nfl_season
      and b.board_type='future' and (b.status<>'draft' or sportsbook_private.is_admin(p_league))
    order by b.id limit 1;
  -- Deliberately no quote/snapshot calls or market-table reads here.
  return jsonb_build_object('week',period.week,'weekly',weekly,'future',future);
end;
$$;
revoke all on function public.sportsbook_board_manifest(uuid) from public,anon;
grant execute on function public.sportsbook_board_manifest(uuid) to authenticated;
commit;
