begin;
-- A season board keeps its original market_week. Placement functions also mark
-- ticket_type='future' only after INSERT. New wagers therefore resolve policy by
-- server-recorded placement_week, not by either of those market attributes.
do $$begin
 if position('case when new.ticket_type=''future'' then period.week else new.market_week end' in pg_get_functiondef('sportsbook_private.capture_ticket_policy()'::regprocedure))=0
 then raise exception 'Ticket policy capture changed; review before applying the placement-period fix.';end if;
end $$;
create or replace function sportsbook_private.capture_ticket_policy() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.policy_snapshot is distinct from old.policy_snapshot then raise exception 'Accepted policy snapshot is immutable.';end if;
  return new;
 end if;
 if new.source_batch is not null then new.policy_snapshot:=null;return new;end if;
 perform pg_advisory_xact_lock_shared(20261101,17);
 new.policy_snapshot:=sportsbook_private.wallet_policy(new.league_id,new.nfl_season,new.placement_week);
 if new.stake<(new.policy_snapshot->'values'->>'minimum_stake')::numeric then raise exception 'Wager is below the effective league minimum.';end if;
 return new;
end $$;
revoke all on function sportsbook_private.capture_ticket_policy() from public,anon,authenticated,service_role;
comment on function sportsbook_private.capture_ticket_policy() is 'Capture immutable new-wager policy by server placement period; preserve historical imports and accepted snapshots.';
commit;
