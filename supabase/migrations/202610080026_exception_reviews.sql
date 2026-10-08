begin;
create table public.admin_exception_reviews (
 league_id uuid not null references public.leagues(id), exception_key text not null,
 actor_id uuid not null, decision text not null check(decision in ('keep_locked','acknowledge_delivery')),
 reason text not null check(length(reason) between 5 and 500), reviewed_at timestamptz not null default now(),
 primary key(league_id,exception_key)
);
alter table public.admin_exception_reviews enable row level security;
create policy exception_admin_read on public.admin_exception_reviews for select to authenticated using(sportsbook_private.is_admin(league_id));
grant select on public.admin_exception_reviews to authenticated;
create function public.review_admin_exception(p_league uuid,p_key text,p_decision text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare old public.admin_exception_reviews;
begin
 if not sportsbook_private.is_admin(p_league) then raise exception 'Only the league admin can review exceptions.'; end if;
 if p_key is null or length(p_key) not between 3 and 200 or length(trim(p_reason)) not between 5 and 500 or p_decision not in ('keep_locked','acknowledge_delivery') or p_decision is null then raise exception 'Choose a decision and provide a reason.'; end if;
 select * into old from public.admin_exception_reviews where league_id=p_league and exception_key=p_key for update;
 insert into public.admin_exception_reviews(league_id,exception_key,actor_id,decision,reason) values(p_league,p_key,auth.uid(),p_decision,trim(p_reason))
 on conflict(league_id,exception_key) do update set actor_id=excluded.actor_id,decision=excluded.decision,reason=excluded.reason,reviewed_at=now();
 insert into public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value) values(p_league,auth.uid(),'exception_review',trim(p_reason),coalesce(to_jsonb(old),'{}'::jsonb),jsonb_build_object('key',p_key,'decision',p_decision));
end $$;
revoke all on function public.review_admin_exception(uuid,text,text,text) from public,anon;
grant execute on function public.review_admin_exception(uuid,text,text,text) to authenticated;
create function sportsbook_private.no_win_total_push() returns trigger language plpgsql set search_path='' as $$
begin
 if new.settlement_context->>'kind'='future_win_total' and new.status='PUSH' then raise exception 'Win totals cannot push; settle wins/losses or void the ticket with a reason.'; end if;
 return new;
end $$;
revoke all on function sportsbook_private.no_win_total_push() from public,anon,authenticated,service_role;
create trigger no_win_total_push before insert or update of status on public.ticket_legs for each row execute function sportsbook_private.no_win_total_push();
commit;
