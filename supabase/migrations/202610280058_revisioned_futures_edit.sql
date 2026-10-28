begin;
-- Existing-board edits accept only prices. Settlement identities and metadata
-- remain server owned; a compact member DTO is never written back as a board.
create function public.patch_future_board(p_board uuid,p_revision integer,p_updates jsonb,p_status text)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.sportsbook_boards;
begin
  select * into b from public.sportsbook_boards where id=p_board for update;
  if not found or b.board_type<>'future' or not sportsbook_private.is_admin(b.league_id)
    or b.nfl_season is distinct from (select nfl_season from public.leagues where id=b.league_id) then
    raise exception 'Only the authorized league admin can edit this futures board.';
  end if;
  if p_revision is distinct from b.revision then raise exception 'Futures changed. Reload before saving.'; end if;
  if p_status is null or p_status not in ('draft','published','closed') or p_updates is null
    or jsonb_typeof(p_updates)<>'array' or jsonb_array_length(p_updates)>1000 then
    raise exception 'Invalid futures edit.';
  end if;
  if exists(select 1 from jsonb_array_elements(p_updates) q where jsonb_typeof(q)<>'object'
    or not(q ? 'id' and q ? 'odds') or (q - 'id' - 'odds')<>'{}'::jsonb
    or jsonb_typeof(q->'odds')<>'number' or (q->>'odds')::numeric<>trunc((q->>'odds')::numeric)
    or abs((q->>'odds')::numeric) not between 100 and 10000
    or mod((q->>'odds')::numeric,50)<>0) then raise exception 'Invalid futures price fields.'; end if;
  if (select count(*) from jsonb_array_elements(p_updates))<>
     (select count(distinct (q->>'id')::uuid) from jsonb_array_elements(p_updates) q) then
    raise exception 'Duplicate futures price edits.';
  end if;
  if exists(select 1 from jsonb_array_elements(p_updates) q where not exists(
    select 1 from public.sportsbook_markets m where m.id=(q->>'id')::uuid and m.board_id=b.id
      and m.active and m.kind like 'future_%')) then raise exception 'Futures quote scope mismatch.'; end if;
  if p_status='published' and not exists(select 1 from public.sportsbook_markets where board_id=b.id and active) then
    raise exception 'Generate futures before publishing.';
  end if;
  update public.sportsbook_markets m set odds=(q.value->>'odds')::integer
    from jsonb_array_elements(p_updates) q where m.id=(q.value->>'id')::uuid
      and m.board_id=b.id and m.odds is distinct from (q.value->>'odds')::integer;
  update public.sportsbook_boards set status=p_status,revision=revision+1 where id=b.id;
  return b.id;
end;
$$;
revoke all on function public.patch_future_board(uuid,integer,jsonb,text) from public,anon;
grant execute on function public.patch_future_board(uuid,integer,jsonb,text) to authenticated;

-- Generation is a separate, full validation path with optimistic concurrency.
create function public.save_future_board_revision(p_board uuid,p_league uuid,p_revision integer,p_quotes jsonb,p_status text)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.sportsbook_boards;
begin
  if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can manage futures.'; end if;
  perform 1 from public.leagues where id=p_league for update;
  select * into b from public.sportsbook_boards where id=p_board for update;
  if found then
    if b.league_id<>p_league or b.board_type<>'future' then raise exception 'Futures board scope mismatch.'; end if;
    if p_revision is distinct from b.revision then raise exception 'Futures changed. Reload before saving.'; end if;
  elsif p_revision is not null then raise exception 'Futures board is unavailable. Reload before saving.';
  end if;
  return public.save_future_board(p_board,p_league,p_quotes,p_status);
end;
$$;
revoke all on function public.save_future_board_revision(uuid,uuid,integer,jsonb,text) from public,anon;
grant execute on function public.save_future_board_revision(uuid,uuid,integer,jsonb,text) to authenticated;
commit;
