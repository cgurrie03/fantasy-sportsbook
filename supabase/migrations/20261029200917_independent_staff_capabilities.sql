begin;
create table sportsbook_private.platform_owners(
 user_id uuid primary key references auth.users(id),
 created_at timestamptz not null default now()
);
alter table sportsbook_private.platform_owners enable row level security;
revoke all on sportsbook_private.platform_owners from public,anon,authenticated,service_role;
grant select on sportsbook_private.platform_owners to authenticated;
create policy own_owner_binding on sportsbook_private.platform_owners for select to authenticated using(user_id=(select auth.uid()));
create function sportsbook_private.is_platform_owner() returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from sportsbook_private.platform_owners where user_id=(select auth.uid()))
$$;
revoke all on function sportsbook_private.is_platform_owner() from public,anon,service_role;
grant execute on function sportsbook_private.is_platform_owner() to authenticated;
create function sportsbook_private.platform_owner_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then
  if (select count(*) from sportsbook_private.platform_owners)<=1 then raise exception 'The last platform owner cannot be removed';end if;
  return old;
 end if;
 if tg_op='UPDATE' and new.user_id<>old.user_id then raise exception 'Insert the verified successor before removing an owner';end if;
 if not exists(select 1 from auth.users where id=new.user_id and email_confirmed_at is not null)
  then raise exception 'A verified independent Auth identity is required';end if;
 return new;
end $$;
revoke all on function sportsbook_private.platform_owner_guard() from public,anon,authenticated,service_role;
create trigger platform_owner_guard before insert or update or delete on sportsbook_private.platform_owners
 for each row execute function sportsbook_private.platform_owner_guard();
-- Reuse only an existing protected owner designation, never an arbitrary admin
-- row/email/commissioner link. Empty installs require explicit verified bootstrap.
insert into sportsbook_private.platform_owners(user_id)
 select m.user_id from sportsbook_private.platform_owner old
 join public.league_memberships m on m.id=old.membership_id
 join auth.users a on a.id=m.user_id where a.email_confirmed_at is not null;

create table public.league_staff_grants(
 league_id uuid not null references public.leagues(id),
 user_id uuid not null references auth.users(id),
 role text not null check(role in('viewer','operator')),
 active boolean not null default true,
 revision integer not null default 1 check(revision>0),
 reason text not null check(length(trim(reason)) between 5 and 500),
 created_by uuid not null references auth.users(id),
 updated_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(league_id,user_id)
);
alter table public.league_staff_grants enable row level security;
revoke all on public.league_staff_grants from public,anon,authenticated,service_role;
grant select,insert,update on public.league_staff_grants to authenticated;
create policy staff_grant_read on public.league_staff_grants for select to authenticated
 using(user_id=(select auth.uid()) or (select sportsbook_private.is_platform_owner()));
create policy staff_grant_insert on public.league_staff_grants for insert to authenticated
 with check((select sportsbook_private.is_platform_owner()));
create policy staff_grant_update on public.league_staff_grants for update to authenticated
 using((select sportsbook_private.is_platform_owner())) with check((select sportsbook_private.is_platform_owner()));

create table public.league_staff_audit(
 id uuid primary key default gen_random_uuid(),
 league_id uuid not null references public.leagues(id),
 actor_id uuid not null references auth.users(id),
 subject_id uuid not null references auth.users(id),
 reason text not null check(length(trim(reason)) between 5 and 500),
 before_value jsonb,
 after_value jsonb not null,
 created_at timestamptz not null default now(),
 check(octet_length(coalesce(before_value,'null'::jsonb)::text)+octet_length(after_value::text)<=8192)
);
alter table public.league_staff_audit enable row level security;
revoke all on public.league_staff_audit from public,anon,authenticated,service_role;
grant select on public.league_staff_audit to authenticated;
create policy staff_audit_owner_read on public.league_staff_audit for select to authenticated using((select sportsbook_private.is_platform_owner()));
create index league_staff_audit_page_idx on public.league_staff_audit(league_id,created_at desc,id);

create function sportsbook_private.staff_grant_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not sportsbook_private.is_platform_owner() then raise exception 'Platform owner required';end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-grants:'||new.league_id::text,0));
 if tg_op='INSERT' then
  if not exists(select 1 from public.league_staff_grants where league_id=new.league_id and user_id=new.user_id)
   and (select count(*) from public.league_staff_grants where league_id=new.league_id)>=128 then raise exception 'Staff grant admission budget reached';end if;
  new.created_by:=auth.uid();new.created_at:=clock_timestamp();new.revision:=1;
 else
  if new.league_id<>old.league_id or new.user_id<>old.user_id then raise exception 'Staff grant identity is immutable';end if;
  new.created_by:=old.created_by;new.created_at:=old.created_at;new.revision:=old.revision+1;
 end if;
 new.updated_by:=auth.uid();new.updated_at:=clock_timestamp();return new;
end $$;
revoke all on function sportsbook_private.staff_grant_guard() from public,anon,authenticated,service_role;
create trigger staff_grant_guard before insert or update on public.league_staff_grants for each row execute function sportsbook_private.staff_grant_guard();

-- Narrow append-only audit sink: callers can neither fabricate actor/time nor
-- update/delete audit rows. It can only run as this table's write trigger.
create function sportsbook_private.audit_staff_grant() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_schema<>'public' or tg_table_name<>'league_staff_grants' or not sportsbook_private.is_platform_owner()
  then raise exception 'Owner staff-grant trigger required';end if;
 insert into public.league_staff_audit(league_id,actor_id,subject_id,reason,before_value,after_value)
 values(new.league_id,auth.uid(),new.user_id,new.reason,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end $$;
revoke all on function sportsbook_private.audit_staff_grant() from public,anon,authenticated,service_role;
create trigger staff_grant_audit after insert or update on public.league_staff_grants for each row execute function sportsbook_private.audit_staff_grant();

create function public.set_league_staff(p_league uuid,p_user uuid,p_role text,p_active boolean,p_reason text,p_expected integer default null) returns integer
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.league_staff_grants;v_revision integer;
begin
 if not sportsbook_private.is_platform_owner() then raise exception 'Platform owner required';end if;
 perform pg_advisory_xact_lock(hashtextextended('staff-grants:'||p_league::text,0));
 select * into r from public.league_staff_grants where league_id=p_league and user_id=p_user for update;
 if (r.revision is null and p_expected is not null) or (r.revision is not null and p_expected is distinct from r.revision)
  then raise exception 'Staff access changed; refresh before saving';end if;
 insert into public.league_staff_grants(league_id,user_id,role,active,reason,created_by,updated_by)
 values(p_league,p_user,p_role,p_active,p_reason,auth.uid(),auth.uid())
 on conflict(league_id,user_id) do update set role=excluded.role,active=excluded.active,reason=excluded.reason
 returning revision into v_revision;
 return v_revision;
end $$;
revoke all on function public.set_league_staff(uuid,uuid,text,boolean,text,integer) from public,anon,service_role;
grant execute on function public.set_league_staff(uuid,uuid,text,boolean,text,integer) to authenticated;

-- Preserve the established private lookup boundary, extending view/operations
-- only. Actual betting still resolves a real participant membership + wallet.
create or replace function sportsbook_private.is_member(p_league uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select sportsbook_private.is_platform_owner()
 or exists(select 1 from public.league_staff_grants where league_id=p_league and user_id=(select auth.uid()) and active)
 or exists(select 1 from public.league_memberships where league_id=p_league and user_id=(select auth.uid()))
$$;
create or replace function sportsbook_private.is_admin(p_league uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select sportsbook_private.is_platform_owner()
 or exists(select 1 from public.league_staff_grants where league_id=p_league and user_id=(select auth.uid()) and active and role='operator')
 or exists(select 1 from public.league_memberships where league_id=p_league and user_id=(select auth.uid()) and role='admin')
$$;
create function public.league_capabilities(p_league uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('league_id',l.id,'view',true,'admin',sportsbook_private.is_admin(l.id),
  'configure',sportsbook_private.is_platform_owner(),'platform_owner',sportsbook_private.is_platform_owner(),
  'bet',exists(select 1 from public.league_memberships m join public.wallets w on w.team_id=m.team_id
   where m.league_id=l.id and m.user_id=(select auth.uid()) and w.balance is not null),
  'team_id',(select m.team_id from public.league_memberships m where m.league_id=l.id and m.user_id=(select auth.uid())))
 from public.leagues l where l.id=p_league
$$;
revoke all on function public.league_capabilities(uuid) from public,anon,service_role;
grant execute on function public.league_capabilities(uuid) to authenticated;
create function public.account_access() returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
 select coalesce(jsonb_agg(public.league_capabilities(l.id) order by l.id),'[]'::jsonb) into result
 from (select id from public.leagues order by id limit 129) l;
 if jsonb_array_length(result)>128 or octet_length(result::text)>32768 then raise exception 'Access directory exceeds its read budget';end if;
 return result;
end $$;
revoke all on function public.account_access() from public,anon,service_role;
grant execute on function public.account_access() to authenticated;

-- Tighten every existing configuration/admission entry point atomically while
-- preserving the validated bodies and their newer model-promotion protections.
do $$declare signature text;definition text;needle text;begin
 foreach signature in array array[
  'public.save_league_identity(uuid,text,text,text)',
  'public.configure_weekly_schedule(uuid,boolean,boolean,boolean,boolean,time,time,time)',
  'public.configure_weekly_schedule_v2(uuid,boolean,boolean,boolean,boolean,time,time,time,jsonb)',
  'public.set_weekly_automation(uuid,boolean)',
  'public.control_model(uuid,text,text,uuid,uuid)',
  'public.approve_member(uuid,text,text,text)'] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  needle:=case when signature like 'public.approve_member%' then 'sportsbook_private.is_admin(v_team.league_id)' else 'sportsbook_private.is_admin(p_league)' end;
  if strpos(definition,needle)=0 then raise exception 'Owner configuration guard source drift: %',signature;end if;
  definition:=replace(definition,needle,'sportsbook_private.is_platform_owner()');
  definition:=replace(replace(replace(definition,'Only the league admin can','Only the platform owner can'),'League admin only.','Platform owner only.'),'Admin access required','Platform owner access required');
  execute definition;
 end loop;
end $$;

-- Owner binding deliberately remains an explicit verified bootstrap operation.
-- Do not infer platform ownership from a commissioner link or an admin claim.
commit;
