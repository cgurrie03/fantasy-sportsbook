begin;

create schema if not exists sportsbook_private;
revoke all on schema sportsbook_private from public, anon;
grant usage on schema sportsbook_private to authenticated;

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sleeper_league_id text not null unique,
  nfl_season integer not null,
  league_season integer not null check (league_season > 0),
  avatar_url text,
  created_at timestamptz not null default now()
);
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id),
  roster_id integer not null,
  team_name text not null,
  sleeper_owner_id text not null,
  owner_name text not null,
  sportsbook_owner_id text not null,
  sportsbook_owner_name text not null,
  co_owner_ids text[] not null default '{}',
  co_owner_names text[] not null default '{}',
  avatar_url text,
  wins integer not null default 0,
  losses integer not null default 0,
  ties integer not null default 0,
  unique (league_id, roster_id),
  unique (id, league_id),
  check (cardinality(co_owner_ids) = cardinality(co_owner_names))
);
create table public.league_memberships (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id),
  team_id uuid not null,
  user_id uuid references auth.users(id),
  invited_email text not null check (invited_email = lower(trim(invited_email))),
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  sleeper_user_id text not null,
  role text not null default 'member' check (role in ('member', 'admin')),
  approved_at timestamptz not null default now(),
  foreign key (team_id, league_id) references public.teams(id, league_id),
  unique (league_id, invited_email),
  unique (team_id),
  unique (league_id, user_id)
);
create index memberships_user_idx on public.league_memberships(user_id, league_id);
create index memberships_league_idx on public.league_memberships(league_id);

create table public.wallets (
  team_id uuid primary key references public.teams(id),
  balance numeric(12,2) check (balance >= 0),
  updated_at timestamptz not null default now()
);
comment on column public.wallets.balance is 'NULL until an approved opening balance or historical migration. Never replenish pending wallets.';
create table public.balance_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.wallets(team_id),
  actor_id uuid not null references auth.users(id),
  request_id uuid not null,
  previous_balance numeric(12,2),
  new_balance numeric(12,2) not null check (new_balance >= 0),
  reason text not null check (length(trim(reason)) between 3 and 500),
  kind text not null check (kind in ('opening_balance', 'admin_adjustment')),
  created_at timestamptz not null default now(),
  unique (team_id, request_id)
);
comment on table public.balance_events is 'Append-only balance administration; these changes do not contribute to betting profit.';
create index balance_events_team_date_idx on public.balance_events(team_id, created_at desc);
create index balance_events_actor_idx on public.balance_events(actor_id);

create function sportsbook_private.is_member(p_league uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.league_memberships
    where league_id = p_league and user_id = (select auth.uid()));
$$;
create function sportsbook_private.is_admin(p_league uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.league_memberships
    where league_id = p_league and user_id = (select auth.uid()) and role = 'admin');
$$;
create function sportsbook_private.can_view_wallet(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.teams t
    join public.league_memberships m on m.league_id = t.league_id
    where t.id = p_team and m.user_id = (select auth.uid())
      and (m.team_id = p_team or m.role = 'admin'));
$$;
revoke all on function sportsbook_private.is_member(uuid), sportsbook_private.is_admin(uuid), sportsbook_private.can_view_wallet(uuid) from public, anon;
grant execute on function sportsbook_private.is_member(uuid), sportsbook_private.is_admin(uuid), sportsbook_private.can_view_wallet(uuid) to authenticated;

alter table public.leagues enable row level security;
alter table public.teams enable row level security;
alter table public.league_memberships enable row level security;
alter table public.wallets enable row level security;
alter table public.balance_events enable row level security;
create policy leagues_read on public.leagues for select to authenticated
  using (sportsbook_private.is_member(id));
create policy teams_read on public.teams for select to authenticated
  using (sportsbook_private.is_member(league_id));
create policy memberships_read on public.league_memberships for select to authenticated
  using (user_id = (select auth.uid()) or sportsbook_private.is_admin(league_id));
create policy wallets_read on public.wallets for select to authenticated
  using (sportsbook_private.can_view_wallet(team_id));
create policy balance_events_read on public.balance_events for select to authenticated
  using (sportsbook_private.can_view_wallet(team_id));
revoke all on public.leagues, public.teams, public.league_memberships, public.wallets, public.balance_events from anon, authenticated;
grant select on public.leagues, public.teams, public.league_memberships, public.wallets, public.balance_events to authenticated;

-- Link only confirmed email identities to mappings already approved by an admin.
create function public.claim_memberships() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_count integer;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select lower(email) into v_email from auth.users
    where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then raise exception 'Verify your email first'; end if;
  update public.league_memberships set user_id = auth.uid()
    where invited_email = v_email and user_id is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- This approves a mapping only. It does not send emails or create auth accounts.
create function public.approve_member(p_team uuid, p_email text, p_name text, p_sleeper_user text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_team public.teams; v_email text; v_id uuid; v_existing public.league_memberships;
begin
  select * into v_team from public.teams where id = p_team;
  if not found or not sportsbook_private.is_admin(v_team.league_id) then
    raise exception 'Admin access required';
  end if;
  v_email := lower(trim(p_email));
  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then
    raise exception 'Enter the owner name';
  end if;
  if p_sleeper_user is null or p_sleeper_user <> v_team.sportsbook_owner_id then
    raise exception 'Use the approved sportsbook owner for this team'; end if;
  -- Serialize changes to one team; never detach an existing linked account silently.
  perform 1 from public.teams where id = p_team for update;
  select * into v_existing from public.league_memberships where team_id = p_team;
  if found then
    if v_existing.invited_email <> v_email or v_existing.sleeper_user_id <> p_sleeper_user then
      raise exception 'This team is already mapped. Account reassignment requires a separate review.';
    end if;
    update public.league_memberships set display_name = trim(p_name) where id = v_existing.id;
    return v_existing.id;
  end if;
  insert into public.league_memberships(league_id, team_id, invited_email, display_name, sleeper_user_id)
    values(v_team.league_id, p_team, v_email, trim(p_name), p_sleeper_user) returning id into v_id;
  return v_id;
end;
$$;

create function public.set_team_balance(p_team uuid, p_balance numeric, p_reason text, p_request uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_league uuid; v_previous numeric; v_event public.balance_events; v_id uuid;
begin
  select league_id into v_league from public.teams where id = p_team;
  if v_league is null or not sportsbook_private.is_admin(v_league) then raise exception 'Admin access required'; end if;
  if p_balance is null or p_balance < 0 or p_balance > 9999999999.99 or p_balance <> round(p_balance, 2) then
    raise exception 'Enter a nonnegative balance with at most two decimal places'; end if;
  if p_reason is null or length(trim(p_reason)) not between 3 and 500 or p_request is null then
    raise exception 'A reason and request reference are required'; end if;
  select balance into v_previous from public.wallets where team_id = p_team for update;
  if not found then raise exception 'Wallet not found'; end if;
  select * into v_event from public.balance_events where team_id = p_team and request_id = p_request;
  if found then
    if v_event.new_balance <> p_balance or v_event.reason <> trim(p_reason) or v_event.actor_id <> auth.uid() then
      raise exception 'Request already used for a different adjustment'; end if;
    return v_event.id;
  end if;
  update public.wallets set balance = p_balance, updated_at = now() where team_id = p_team;
  insert into public.balance_events(team_id, actor_id, request_id, previous_balance, new_balance, reason, kind)
    values(p_team, auth.uid(), p_request, v_previous, p_balance, trim(p_reason),
      case when v_previous is null then 'opening_balance' else 'admin_adjustment' end) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.claim_memberships(), public.approve_member(uuid,text,text,text), public.set_team_balance(uuid,numeric,text,uuid) from public, anon;
grant execute on function public.claim_memberships(), public.approve_member(uuid,text,text,text), public.set_team_balance(uuid,numeric,text,uuid) to authenticated;

commit;
