begin;
alter table public.weekly_schedule add column activation_requested boolean not null default false;
alter table public.weekly_schedule add column worker_probe_id bigint;
create or replace function public.set_weekly_automation(p_league uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can change automation.'; end if;
 -- Enabling first verifies the deployed server. Disabling stops work immediately.
 update public.weekly_schedule set automation_enabled=false,activation_requested=p_enabled,worker_probe_id=null,updated_at=now() where league_id=p_league;
end $$;
commit;
