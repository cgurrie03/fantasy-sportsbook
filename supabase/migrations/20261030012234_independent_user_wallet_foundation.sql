begin;
-- Expansion only: does not switch acceptance, settle an existing ticket, copy
-- balances, infer historical ownership or fabricate a fantasy-team membership.
create table public.user_wallets(
 id uuid primary key default gen_random_uuid(),league_id uuid not null references public.leagues(id),
 user_id uuid not null references auth.users(id),team_id uuid not null,
 display_name text not null check(length(trim(display_name)) between 1 and 80),
 balance numeric(12,2) check(balance>=0 and balance::text not in ('NaN','Infinity','-Infinity')),status text not null default 'approved' check(status in ('approved','revoked')),
 revision integer not null default 1,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(league_id,user_id),unique(id,league_id,team_id),
 foreign key(team_id,league_id) references public.teams(id,league_id)
);
alter table public.tickets add column user_wallet_id uuid,add column bettor_display_name text check(length(bettor_display_name) between 1 and 80);
alter table public.tickets add constraint ticket_user_wallet_scope foreign key(user_wallet_id,league_id,team_id)
 references public.user_wallets(id,league_id,team_id);
alter table public.tickets add constraint ticket_user_wallet_identity unique(id,user_wallet_id);
create index tickets_user_wallet_date on public.tickets(user_wallet_id,placed_at desc,id) where user_wallet_id is not null;
create table public.user_wallet_entries(
 id uuid primary key default gen_random_uuid(),wallet_id uuid not null,league_id uuid not null,team_id uuid not null,
 ticket_id uuid,event_key text not null check(length(event_key) between 1 and 200),request_key uuid,
 kind text not null check(kind in ('opening','legacy_transfer_in','wager','settlement','weekly_replenishment','void_refund','adjustment')),
 amount numeric(12,2) not null,balance_before numeric(12,2),balance_after numeric(12,2) not null check(balance_after>=0),
 reason text not null check(length(reason) between 1 and 500),metadata jsonb not null default '{}' check(octet_length(metadata::text)<=2048),
 created_at timestamptz not null default clock_timestamp(),unique(wallet_id,event_key),unique(wallet_id,request_key),
 check(balance_before is null or balance_after=balance_before+amount),
 check(amount::text not in ('NaN','Infinity','-Infinity') and balance_after::text not in ('NaN','Infinity','-Infinity')
  and (balance_before is null or balance_before::text not in ('NaN','Infinity','-Infinity'))),
 foreign key(wallet_id,league_id,team_id) references public.user_wallets(id,league_id,team_id),
 foreign key(ticket_id,wallet_id) references public.tickets(id,user_wallet_id)
);
create index user_wallet_entries_page on public.user_wallet_entries(wallet_id,created_at desc,id);
create table sportsbook_private.user_wallet_approvals(
 id uuid primary key default gen_random_uuid(),wallet_id uuid not null references public.user_wallets(id),
 actor uuid not null references auth.users(id),reason text not null check(length(reason) between 8 and 500),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.user_wallets enable row level security;
alter table public.user_wallet_entries enable row level security;
alter table sportsbook_private.user_wallet_approvals enable row level security;
revoke all on public.user_wallets,public.user_wallet_entries,sportsbook_private.user_wallet_approvals from public,anon,authenticated,service_role;
grant select on public.user_wallets,public.user_wallet_entries to authenticated,service_role;
create policy user_wallet_read on public.user_wallets for select to authenticated
 using((user_id=(select auth.uid()) and status='approved') or sportsbook_private.is_admin(league_id));
create policy user_wallet_entries_read on public.user_wallet_entries for select to authenticated
 using(exists(select 1 from public.user_wallets w where w.id=wallet_id and ((w.user_id=(select auth.uid()) and w.status='approved') or sportsbook_private.is_admin(w.league_id))));
create function sportsbook_private.user_wallet_identity_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if row(new.id,new.league_id,new.user_id,new.team_id,new.created_at) is distinct from row(old.id,old.league_id,old.user_id,old.team_id,old.created_at)
 then raise exception 'Financial account identity is immutable; review a separate migration.';end if;
 return new;
end $$;
revoke all on function sportsbook_private.user_wallet_identity_guard() from public,anon,authenticated,service_role;
create trigger user_wallet_identity before update on public.user_wallets for each row execute function sportsbook_private.user_wallet_identity_guard();
create trigger user_wallet_ledger_immutable before update or delete on public.user_wallet_entries for each row execute function sportsbook_private.promo_snapshot_immutable();
create trigger user_wallet_approval_immutable before update or delete on sportsbook_private.user_wallet_approvals for each row execute function sportsbook_private.promo_snapshot_immutable();

create function public.approve_user_wallet(p_league uuid,p_user uuid,p_team uuid,p_reason text,p_display_name text default 'Participant') returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.user_wallets;begin
 if not sportsbook_private.is_platform_owner() or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
  then raise exception 'Platform owner approval required.';end if;
 if p_display_name is null or length(trim(p_display_name)) not between 1 and 80 then raise exception 'Reviewed participant display name required.';end if;
 if p_reason is null or length(trim(p_reason)) not between 8 and 500 then raise exception 'Record the reviewed financial-account approval reason.';end if;
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null)
  or not exists(select 1 from public.teams where id=p_team and league_id=p_league) then raise exception 'Verified user and scoped team required.';end if;
 perform 1 from public.leagues where id=p_league for update;
 select * into w from public.user_wallets where league_id=p_league and user_id=p_user;
 if found then
  if w.team_id<>p_team or w.status<>'approved' then raise exception 'Existing financial identity requires explicit review; it cannot be reassigned.';end if;
  return jsonb_build_object('wallet_id',w.id,'duplicate',true,'funding_pending',w.balance is null);
 end if;
 if (select count(*) from public.user_wallets where league_id=p_league)>=128 then raise exception 'Financial account count budget reached.';end if;
 insert into public.user_wallets(league_id,user_id,team_id,display_name) values(p_league,p_user,p_team,trim(p_display_name)) returning * into w;
 insert into sportsbook_private.user_wallet_approvals(wallet_id,actor,reason) values(w.id,auth.uid(),trim(p_reason));
 return jsonb_build_object('wallet_id',w.id,'duplicate',false,'funding_pending',true);
end $$;
revoke all on function public.approve_user_wallet(uuid,uuid,uuid,text,text) from public,anon,service_role;
grant execute on function public.approve_user_wallet(uuid,uuid,uuid,text,text) to authenticated;

-- No automatic migration of another owner's money. Explicit primary-owner cash
-- transfers use a compare-and-set amount and an immutable exactly-once receipt.
alter table public.wallet_ledger drop constraint wallet_ledger_kind_check;
alter table public.wallet_ledger add constraint wallet_ledger_kind_check check(kind in
 ('historical_opening','settlement','weekly_replenishment','wager','void_refund','account_transfer_out'));
create function public.initialize_user_wallet(p_league uuid,p_user uuid,p_mode text,p_expected_legacy numeric,p_reason text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.user_wallets;old_balance numeric;entry public.user_wallet_entries;value numeric;begin
 if not sportsbook_private.is_platform_owner() or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
  then raise exception 'Platform owner approval required.';end if;
 if p_request is null or p_mode is null or p_mode not in ('zero','transfer_legacy') or p_reason is null or length(trim(p_reason)) not between 8 and 500
 then raise exception 'Explicit initialization mode, request identifier and review reason required.';end if;
 select * into w from public.user_wallets where league_id=p_league and user_id=p_user for update;
 if not found or w.status<>'approved' then raise exception 'Approved financial account required.';end if;
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then raise exception 'Verified account required before initialization.';end if;
 select * into entry from public.user_wallet_entries where wallet_id=w.id and event_key='initialize';
 if found then
  if entry.request_key<>p_request or entry.metadata->>'mode'<>p_mode or entry.metadata->'expected_legacy' is distinct from coalesce(to_jsonb(p_expected_legacy),'null'::jsonb)
  then raise exception 'Financial initialization already used another request or terms.';end if;
  return jsonb_build_object('wallet_id',w.id,'duplicate',true,'balance',w.balance);
 end if;
 if w.balance is not null then raise exception 'Initialized balance lacks its receipt; review required.';end if;
 if p_mode='transfer_legacy' then
  if not exists(select 1 from public.league_memberships where league_id=p_league and team_id=w.team_id and user_id=p_user)
  then raise exception 'Legacy cash requires the existing primary participant and explicit owner approval.';end if;
  select balance into old_balance from public.wallets where team_id=w.team_id for update;
  if not found or old_balance is null or p_expected_legacy is distinct from old_balance then raise exception 'Legacy cash changed or remains pending; review again.';end if;
  if exists(select 1 from public.tickets where team_id=w.team_id and status='OPEN') then raise exception 'Open legacy liabilities require a separately reviewed routing migration.';end if;
  value:=old_balance;
  update public.wallets set balance=0,updated_at=clock_timestamp() where team_id=w.team_id;
  insert into public.wallet_ledger(team_id,event_key,kind,amount,balance_before,balance_after,reason)
   values(w.team_id,'account:transfer:'||w.id,'account_transfer_out',-value,value,0,trim(p_reason));
 else
  if p_expected_legacy is not null then raise exception 'Zero initialization cannot claim a legacy balance.';end if;
  value:=0;
 end if;
 update public.user_wallets set balance=value,updated_at=clock_timestamp() where id=w.id;
 insert into public.user_wallet_entries(wallet_id,league_id,team_id,event_key,request_key,kind,amount,balance_before,balance_after,reason,metadata)
 values(w.id,w.league_id,w.team_id,'initialize',p_request,case when p_mode='transfer_legacy' then 'legacy_transfer_in' else 'opening' end,value,null,value,trim(p_reason),
  jsonb_build_object('mode',p_mode,'expected_legacy',p_expected_legacy,'actor_id',auth.uid()));
 return jsonb_build_object('wallet_id',w.id,'duplicate',false,'balance',value);
end $$;
revoke all on function public.initialize_user_wallet(uuid,uuid,text,numeric,text,uuid) from public,anon,service_role;
grant execute on function public.initialize_user_wallet(uuid,uuid,text,numeric,text,uuid) to authenticated;
comment on table public.user_wallets is 'Independent per-user/per-league finance expansion. Pending cash until explicit owner initialization. Does not activate betting or reattribute historical team tickets.';
commit;
