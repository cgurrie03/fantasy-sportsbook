begin;
-- Select the newest attempt before checking its completion time. Filtering the
-- query by completion first can hide a newer pending/failed retry.
create or replace function public.confirm_scheduled_publication(p_board uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.sportsbook_boards; r public.line_refresh_runtime;
 required text[]; op text; latest_status text; oldest timestamptz; finished timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 select * into b from public.sportsbook_boards where id=p_board for update;
 if not found or b.status<>'published' or b.phase<>'pregame' or b.closes_at<=now() then return false; end if;
 select * into r from public.line_refresh_runtime where league_id=b.league_id;
 if not found or r.observed_at is null or r.observed_at<now()-interval '3 minutes' or r.last_error is not null or r.week_started or (b.board_type='weekly' and b.market_week<>r.market_week) then return false; end if;
 required:=case when b.board_type='future' then array['refresh_futures'] else array['refresh_matchups','refresh_players','refresh_specials'] end;
 foreach op in array required loop
  select status,coalesce(completed_at,created_at) into latest_status,finished
   from public.automation_jobs where league_id=b.league_id and market_week=r.market_week
    and operation=op and created_at>now()-interval '7 days' order by created_at desc limit 1;
  if latest_status is distinct from 'done' or finished is null or finished<now()-interval '130 minutes' then return false; end if;
 end loop;
 if not exists(select 1 from public.sportsbook_markets where board_id=b.id and active) or exists(select 1 from public.sportsbook_markets where board_id=b.id and active and metadata->>'generated_at' is null) then return false; end if;
 select min((metadata->>'generated_at')::timestamptz) into oldest from public.sportsbook_markets where board_id=b.id and active;
 if oldest<now()-interval '130 minutes' or oldest>now()+interval '1 minute' then return false; end if;
 update public.sportsbook_boards set suspension_reason=null,source_observed_at=r.observed_at,quote_valid_until=now()+interval '130 minutes' where id=b.id;
 return true;
end $$;
revoke all on function public.confirm_scheduled_publication(uuid) from public,anon,authenticated;
grant execute on function public.confirm_scheduled_publication(uuid) to service_role;
commit;
