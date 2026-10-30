begin;
-- Validate active staff identities inside the existing private audit boundary;
-- no authenticated role receives direct Auth-table access or a new definer API.
create or replace function sportsbook_private.audit_staff_grant() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_schema<>'public' or tg_table_name<>'league_staff_grants' or not sportsbook_private.is_platform_owner()
  then raise exception 'Owner staff-grant trigger required';end if;
 if new.active and not exists(select 1 from auth.users where id=new.user_id and email_confirmed_at is not null)
  then raise exception 'A verified staff identity is required';end if;
 insert into public.league_staff_audit(league_id,actor_id,subject_id,reason,before_value,after_value)
 values(new.league_id,auth.uid(),new.user_id,new.reason,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end $$;
-- A financial reader's administrative scope follows the same staff capability
-- as its RPC/UI; being an operator never creates a participant account.
create or replace function sportsbook_private.can_view_wallet(p_team uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.teams t where t.id=p_team and
  (sportsbook_private.is_admin(t.league_id) or exists(select 1 from public.league_memberships m
   where m.team_id=t.id and m.user_id=(select auth.uid()))))
$$;

create or replace function public.store_promo_image(p_league uuid,p_user uuid,p_png text) returns uuid
language plpgsql security definer set search_path='' as $$
declare i uuid;
begin
 if auth.role() is distinct from 'service_role' or not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null)
  or not(exists(select 1 from sportsbook_private.platform_owners where user_id=p_user)
   or exists(select 1 from public.league_staff_grants where league_id=p_league and user_id=p_user and role='operator' and active)
   or exists(select 1 from public.league_memberships where league_id=p_league and user_id=p_user and role='admin'))
 then raise exception 'Verified league operator required.';end if;
 insert into public.promo_images(league_id,png) values(p_league,p_png) returning id into i;return i;
end $$;

-- Keep the original validated worker operation body and its project/lease
-- boundaries. Resolve an independent verified owner/operator when there is no
-- participant admin in this league; no membership or wallet is inserted.
do $$declare definition text;needle text;replacement text;begin
 select pg_get_functiondef('public.worker_operation(uuid,text,jsonb)'::regprocedure) into definition;
 needle:='if v_admin is null then raise exception ''An approved admin must sign in before automation is enabled.''; end if;';
 replacement:='if v_admin is null then
  select a.id into v_admin from auth.users a where a.email_confirmed_at is not null and
   (exists(select 1 from sportsbook_private.platform_owners where user_id=a.id)
    or exists(select 1 from public.league_staff_grants where league_id=p_league and user_id=a.id and active and role=''operator''))
   order by case when exists(select 1 from sportsbook_private.platform_owners where user_id=a.id) then 0 else 1 end,a.id limit 1;
 end if;
 if v_admin is null then raise exception ''A verified owner or league operator is required before automation is enabled.'';end if;';
 if strpos(definition,needle)=0 then raise exception 'Worker authorization source drift';end if;
 execute replace(definition,needle,replacement);
end $$;
commit;
