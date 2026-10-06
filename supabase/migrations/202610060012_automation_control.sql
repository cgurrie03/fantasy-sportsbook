begin;
create function public.set_weekly_automation(p_league uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can change automation.'; end if;
 update public.weekly_schedule set automation_enabled=p_enabled,updated_at=now() where league_id=p_league;
end $$;
revoke all on function public.set_weekly_automation(uuid,boolean) from public,anon;
grant execute on function public.set_weekly_automation(uuid,boolean) to authenticated;
commit;
