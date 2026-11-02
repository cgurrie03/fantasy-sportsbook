begin;
-- Wallet/ticket policy v1. Existing pricing, eligibility, opening-funds approval,
-- schedule and settlement contracts remain separate; no experimental activation.
create table sportsbook_private.league_policy_versions(
 id uuid primary key default gen_random_uuid(),league_id uuid not null references public.leagues(id),revision integer not null,
 nfl_season integer not null check(nfl_season between 2020 and 2100),market_week integer not null check(market_week between 1 and 18),
 overrides jsonb not null check(octet_length(overrides::text)<=1024),actor uuid not null references auth.users(id),
 reason text not null check(length(reason) between 8 and 400),created_at timestamptz not null default clock_timestamp(),
 unique(league_id,revision),unique(league_id,nfl_season,market_week)
);
alter table sportsbook_private.league_policy_versions enable row level security;
revoke all on sportsbook_private.league_policy_versions from public,anon,authenticated,service_role;
create trigger league_policy_immutable before update or delete on sportsbook_private.league_policy_versions for each row execute function sportsbook_private.promo_snapshot_immutable();
create function sportsbook_private.wallet_policy_defaults() returns jsonb language sql immutable set search_path='' as $$
 select '{"minimum_stake":1,"maximum_picks":10,"weekly_target":100,"futures_cash_floor":25}'::jsonb
$$;
create function sportsbook_private.wallet_policy(p_league uuid,p_season integer,p_week integer) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('contract','wallet-ticket-policy-v1','defaults_version',1,'revision',coalesce(v.revision,0),
 'effective_season',v.nfl_season,'effective_week',v.market_week,'values',sportsbook_private.wallet_policy_defaults()||coalesce(v.overrides,'{}'::jsonb))
 from (select 1) anchor left join lateral(select revision,nfl_season,market_week,overrides from sportsbook_private.league_policy_versions
 where league_id=p_league and (nfl_season,market_week)<=(p_season,p_week) order by nfl_season desc,market_week desc limit 1)v on true
$$;
revoke all on function sportsbook_private.wallet_policy_defaults(),sportsbook_private.wallet_policy(uuid,integer,integer) from public,anon,authenticated,service_role;

create function public.wallet_policy_review(p_league uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare period record;begin
 if not public.league_intake_owner() then raise exception 'Verified platform owner required.';end if;
 select * into period from public.sportsbook_period(p_league);
 if period.nfl_season is null then raise exception 'Selected league unavailable.';end if;
 return jsonb_build_object('season',period.nfl_season,'week',period.week,'latest_revision',coalesce((select max(revision) from sportsbook_private.league_policy_versions where league_id=p_league),0),
 'current',sportsbook_private.wallet_policy(p_league,period.nfl_season,period.week),
 'versions',(select coalesce(jsonb_agg(v order by v.revision desc),'[]') from
 (select revision,nfl_season,market_week,overrides,reason,created_at from sportsbook_private.league_policy_versions where league_id=p_league order by revision desc limit 64)v));
end $$;
create function sportsbook_private.validate_wallet_policy(p_overrides jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare effective jsonb;k text;v jsonb;begin
 if p_overrides is null or jsonb_typeof(p_overrides)<>'object' or octet_length(p_overrides::text)>1024
 then raise exception 'Typed policy overrides required.';end if;
 for k,v in select * from jsonb_each(p_overrides) loop
  if k not in('minimum_stake','maximum_picks','weekly_target','futures_cash_floor') or jsonb_typeof(v)<>'number' or (v#>>'{}')::numeric<>round((v#>>'{}')::numeric,2)
  then raise exception 'Unsupported policy key or whole-cent value.';end if;
 end loop;
 effective:=sportsbook_private.wallet_policy_defaults()||p_overrides;
 if (effective->>'minimum_stake')::numeric not between 1 and 10000 or (effective->>'maximum_picks')::numeric not between 2 and 10
  or (effective->>'maximum_picks')::numeric<>trunc((effective->>'maximum_picks')::numeric)
  or (effective->>'weekly_target')::numeric not between 1 and 10000 or (effective->>'futures_cash_floor')::numeric not between 0 and (effective->>'weekly_target')::numeric
 then raise exception 'Policy values exceed supported limits or cash-floor dependencies.';end if;
 return effective;
end $$;
revoke all on function sportsbook_private.validate_wallet_policy(jsonb) from public,anon,authenticated,service_role;
create function public.save_wallet_policy(p_league uuid,p_expected integer,p_season integer,p_week integer,p_overrides jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare period record;last_revision integer;prior jsonb;begin
 if not public.league_intake_owner() then raise exception 'Verified platform owner required.';end if;
 if p_reason is null or length(trim(p_reason)) not between 8 and 400 then raise exception 'Policy review reason required.';end if;
 perform sportsbook_private.validate_wallet_policy(p_overrides);
 perform pg_advisory_xact_lock(20261101,17);
 perform 1 from public.leagues where id=p_league for update;
 if not found then raise exception 'Selected league unavailable.';end if;
 select * into period from public.sportsbook_period(p_league);
 if p_season is null or p_week is null or p_season not between period.nfl_season and period.nfl_season+1 or p_week not between 1 and 18
  or (p_season,p_week)<(period.nfl_season,period.week) then raise exception 'Policy must take effect in a current or future supported period.';end if;
 if exists(select 1 from public.leagues where id=p_league and operations_enabled) or exists(select 1 from public.weekly_schedule where league_id=p_league and automation_enabled)
 then raise exception 'Pause operations and automation before reviewing policy.';end if;
 select coalesce(max(revision),0) into last_revision from sportsbook_private.league_policy_versions where league_id=p_league;
 -- Lost-response retries return the original receipt; changed terms never reuse it.
 if exists(select 1 from sportsbook_private.league_policy_versions where league_id=p_league and revision=p_expected+1 and nfl_season=p_season and market_week=p_week and overrides=p_overrides and reason=trim(p_reason) and actor=auth.uid())
 then return jsonb_build_object('revision',p_expected+1,'duplicate',true);end if;
 if p_expected is distinct from last_revision then raise exception 'Policy changed; reload before saving.';end if;
 if last_revision>=64 then raise exception 'Policy history admission budget reached.';end if;
 if exists(select 1 from sportsbook_private.league_policy_versions where league_id=p_league and (nfl_season,market_week)>=(p_season,p_week)) then raise exception 'Policy effective periods must increase; review the scheduled version.';end if;
 if exists(select 1 from public.tickets where league_id=p_league and ticket_type<>'future' and status<>'VOIDED' and (nfl_season,market_week)>=(p_season,p_week))
 then raise exception 'Accepted tickets already exist in the requested policy period; choose a later period.';end if;
 prior:=sportsbook_private.wallet_policy(p_league,p_season,p_week);
 insert into sportsbook_private.league_policy_versions(league_id,revision,nfl_season,market_week,overrides,actor,reason)
 values(p_league,last_revision+1,p_season,p_week,p_overrides,auth.uid(),trim(p_reason));
 insert into public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value)
 values(p_league,auth.uid(),'wallet_policy',trim(p_reason),prior,sportsbook_private.wallet_policy(p_league,p_season,p_week));
 return jsonb_build_object('revision',last_revision+1,'duplicate',false);
end $$;
revoke all on function public.wallet_policy_review(uuid),public.save_wallet_policy(uuid,integer,integer,integer,jsonb,text) from public,anon,service_role;
grant execute on function public.wallet_policy_review(uuid),public.save_wallet_policy(uuid,integer,integer,integer,jsonb,text) to authenticated;

alter table public.tickets add column policy_snapshot jsonb check(policy_snapshot is null or octet_length(policy_snapshot::text)<=2048);
create function sportsbook_private.capture_ticket_policy() returns trigger language plpgsql security definer set search_path='' as $$
declare period record;begin
 if tg_op='UPDATE' then
  if new.policy_snapshot is distinct from old.policy_snapshot then raise exception 'Accepted policy snapshot is immutable.';end if;return new;
 end if;
 if new.source_batch is not null then new.policy_snapshot:=null;return new;end if;
 perform pg_advisory_xact_lock_shared(20261101,17);
 select * into period from public.sportsbook_period(new.league_id);
 new.policy_snapshot:=sportsbook_private.wallet_policy(new.league_id,new.nfl_season,case when new.ticket_type='future' then period.week else new.market_week end);
 if new.stake<(new.policy_snapshot->'values'->>'minimum_stake')::numeric then raise exception 'Wager is below the effective league minimum.';end if;
 return new;
end $$;
create trigger capture_ticket_policy before insert or update of policy_snapshot on public.tickets for each row execute function sportsbook_private.capture_ticket_policy();
create function sportsbook_private.check_ticket_policy_picks() returns trigger language plpgsql security definer set search_path='' as $$
declare t public.tickets;begin
 if tg_table_name='tickets' then select * into t from public.tickets where id=new.id;else select * into t from public.tickets where id=new.ticket_id;end if;
 if t.policy_snapshot is not null and (select count(*) from public.ticket_legs where ticket_id=t.id)>(t.policy_snapshot->'values'->>'maximum_picks')::integer then raise exception 'Ticket exceeds the effective league pick limit.';end if;
 return null;
end $$;
create constraint trigger ticket_policy_pick_limit after insert on public.tickets deferrable initially deferred for each row execute function sportsbook_private.check_ticket_policy_picks();
create constraint trigger leg_policy_pick_limit after insert on public.ticket_legs deferrable initially deferred for each row execute function sportsbook_private.check_ticket_policy_picks();
revoke all on function sportsbook_private.capture_ticket_policy(),sportsbook_private.check_ticket_policy_picks() from public,anon,authenticated,service_role;

-- Keep current financial routing/receipts and adjust only the target calculation.
do $patch$declare signature text;d text;begin
 foreach signature in array array['sportsbook_private.legacy_replenish_weekly_balances(uuid,integer,integer)','sportsbook_private.user_replenish_weekly_balances(uuid,integer,integer)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  if position('target:=greatest(25,100-committed);' in d)=0 then raise exception 'Replenishment policy anchor changed: %',signature;end if;
  d:=replace(d,'target:=greatest(25,100-committed);','target:=greatest((sportsbook_private.wallet_policy(p_league,p_season,p_week)->''values''->>''futures_cash_floor'')::numeric,(sportsbook_private.wallet_policy(p_league,p_season,p_week)->''values''->>''weekly_target'')::numeric-committed);');
  execute d;
 end loop;
end $patch$;
-- Reuse existing tiny, freshly authorized reads; no new per-viewer polling.
create function public.current_wallet_policy(p_league uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare period record;begin
 if not sportsbook_private.is_member(p_league) then raise exception 'League access required.';end if;
 select * into period from public.sportsbook_period(p_league);
 return sportsbook_private.wallet_policy(p_league,period.nfl_season,period.week);
end $$;
revoke all on function public.current_wallet_policy(uuid) from public,anon,service_role;
grant execute on function public.current_wallet_policy(uuid) to authenticated;
do $capability$declare d text;begin
 d:=pg_get_functiondef('public.league_capabilities(uuid)'::regprocedure);
 if position($anchor$'wallet_model',case$anchor$ in d)=0 then raise exception 'Capability policy anchor changed.';end if;
 d:=replace(d,$anchor$'wallet_model',case$anchor$,$new$'policy',public.current_wallet_policy(l.id),'wallet_model',case$new$);
 execute d;
end $capability$;
alter function public.sportsbook_board_manifest(uuid) rename to policy_base_board_manifest;
alter function public.policy_base_board_manifest(uuid) set schema sportsbook_private;
revoke all on function sportsbook_private.policy_base_board_manifest(uuid) from public,anon,authenticated,service_role;
create function public.sportsbook_board_manifest(p_league uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;period record;begin
 r:=sportsbook_private.policy_base_board_manifest(p_league);if r is null then return null;end if;
 select * into period from public.sportsbook_period(p_league);
 return r||jsonb_build_object('policy',sportsbook_private.wallet_policy(p_league,period.nfl_season,period.week));
end $$;
revoke all on function public.sportsbook_board_manifest(uuid) from public,anon,service_role;
grant execute on function public.sportsbook_board_manifest(uuid) to authenticated;
alter function public.weekly_finance_wallets(uuid,integer,integer) rename to policy_base_finance_wallets;
alter function public.policy_base_finance_wallets(uuid,integer,integer) set schema sportsbook_private;
revoke all on function sportsbook_private.policy_base_finance_wallets(uuid,integer,integer) from public,anon,authenticated,service_role;
create function public.weekly_finance_wallets(p_league uuid,p_season integer,p_week integer) returns jsonb language sql stable security definer set search_path='' as $$
 select sportsbook_private.policy_base_finance_wallets(p_league,p_season,p_week)||jsonb_build_object('policy',sportsbook_private.wallet_policy(p_league,p_season,p_week))
$$;
revoke all on function public.weekly_finance_wallets(uuid,integer,integer) from public,anon;
grant execute on function public.weekly_finance_wallets(uuid,integer,integer) to authenticated,service_role;
commit;
