begin;
-- Reserve future live-league activation for the platform owner, separately from league admins.
-- No client grants, onboarding RPC or admin-menu implementation is introduced here.
create table sportsbook_private.platform_owner (
 singleton boolean primary key default true check(singleton),
 membership_id uuid not null unique references public.league_memberships(id)
);
insert into sportsbook_private.platform_owner(membership_id)
select id from public.league_memberships
where league_id='13121261-5398-4391-8240-000000000003'
 and invited_email='cooper.gurrie@gmail.com' and role='admin';
do $$ begin
 if (select count(*) from sportsbook_private.platform_owner)<>1 then
  raise exception 'Verified platform owner mapping is required.';
 end if;
end $$;
create table sportsbook_private.league_launch_approvals (
 league_id uuid primary key references public.leagues(id),
 owner_membership_id uuid not null references sportsbook_private.platform_owner(membership_id),
 verified_at timestamptz not null default now(),
 verification_note text not null check(length(trim(verification_note)) between 10 and 2000)
);
alter table sportsbook_private.platform_owner enable row level security;
alter table sportsbook_private.league_launch_approvals enable row level security;
revoke all on sportsbook_private.platform_owner,sportsbook_private.league_launch_approvals from public,anon,authenticated,service_role;

-- Freeze the owner's identity mapping so another league admin cannot reassign it.
create function sportsbook_private.guard_platform_owner_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from sportsbook_private.platform_owner where membership_id=old.id) then
  if row(new.invited_email,new.role,new.league_id,new.team_id) is distinct from
     row(old.invited_email,old.role,old.league_id,old.team_id)
   or (old.user_id is not null and new.user_id is distinct from old.user_id) then
   raise exception 'Platform owner identity cannot be reassigned by league administration.';
  end if;
  if old.user_id is null and new.user_id is not null and not exists(
   select 1 from auth.users where id=new.user_id and lower(email)=old.invited_email and email_confirmed_at is not null) then
   raise exception 'Platform owner requires a verified matching email account.';
  end if;
 end if;
 return new;
end $$;
create trigger platform_owner_identity_guard before update of invited_email,role,league_id,team_id,user_id on public.league_memberships
for each row execute function sportsbook_private.guard_platform_owner_identity();

create function sportsbook_private.guard_launch_approval() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from sportsbook_private.platform_owner o
  join public.league_memberships m on m.id=o.membership_id
  where o.membership_id=new.owner_membership_id and m.user_id=auth.uid()) then
  raise exception 'Only the platform owner can approve a live league.';
 end if;
 return new;
end $$;
create trigger launch_approval_owner_guard before insert or update on sportsbook_private.league_launch_approvals
for each row execute function sportsbook_private.guard_launch_approval();
create function sportsbook_private.guard_live_league_activation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.operations_enabled then
  if tg_op='UPDATE' then
   if old.operations_enabled then return new; end if;
  end if;
  if not exists(select 1 from sportsbook_private.league_launch_approvals a
   join sportsbook_private.platform_owner o on o.membership_id=a.owner_membership_id
   where a.league_id=new.id) then
   raise exception 'Platform owner approval is required before a league goes live.';
  end if;
 end if;
 return new;
end $$;
create trigger live_league_activation_guard before insert or update of operations_enabled on public.leagues
for each row execute function sportsbook_private.guard_live_league_activation();
revoke all on function sportsbook_private.guard_launch_approval(),sportsbook_private.guard_live_league_activation(),sportsbook_private.guard_platform_owner_identity() from public,anon,authenticated;
comment on table sportsbook_private.league_launch_approvals is 'Future owner-only activation process must validate isolation, provider configuration and capacity before recording approval. No client/API onboarding exists yet.';
commit;
