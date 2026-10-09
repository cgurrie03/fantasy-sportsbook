begin;
-- Deployment configuration is data. New leagues stay closed until their rollout is verified.
alter table public.leagues add column sportsbook_url text check(sportsbook_url ~ '^https://[^[:space:]]+$');
alter table public.leagues add column email_sender text check(email_sender !~ '[\r\n]');
alter table public.leagues add column operations_enabled boolean not null default false;
update public.leagues set sportsbook_url='https://sportsbook.coopergurrie.com/',
 email_sender='sportsbook@coopergurrie.com', operations_enabled=true
 where id='13121261-5398-4391-8240-000000000003';
comment on column public.leagues.operations_enabled is 'Service-only rollout gate. Enable a new league only after isolation, provider/configuration, recipient and capacity checks pass.';
grant update(sportsbook_url,email_sender,operations_enabled) on public.leagues to service_role;

alter table public.tickets add constraint tickets_id_team_key unique(id,team_id);
alter table public.tickets add constraint tickets_id_league_team_key unique(id,league_id,team_id);
alter table public.wallet_ledger add constraint ledger_ticket_team_fk foreign key(ticket_id,team_id) references public.tickets(id,team_id);
alter table public.outbound_emails add constraint outbox_team_league_fk foreign key(team_id,league_id) references public.teams(id,league_id);
alter table public.outbound_emails add constraint outbox_ticket_league_team_fk foreign key(ticket_id,league_id,team_id) references public.tickets(id,league_id,team_id);
create index outbox_team_league_idx on public.outbound_emails(team_id,league_id);
create index outbox_ticket_scope_idx on public.outbound_emails(ticket_id,league_id,team_id) where ticket_id is not null;
alter table public.sportsbook_boards add constraint boards_id_league_key unique(id,league_id);
alter table public.forecast_snapshots add constraint forecast_board_league_fk foreign key(board_id,league_id) references public.sportsbook_boards(id,league_id);
alter table public.line_refresh_cycles add constraint cycles_id_league_key unique(id,league_id);
alter table public.line_refresh_cycles add constraint cycle_weekly_league_fk foreign key(weekly_board,league_id) references public.sportsbook_boards(id,league_id);
alter table public.line_refresh_cycles add constraint cycle_future_league_fk foreign key(future_board,league_id) references public.sportsbook_boards(id,league_id);
alter table public.automation_jobs add constraint job_cycle_league_fk foreign key(refresh_cycle_id,league_id) references public.line_refresh_cycles(id,league_id);
create index cycle_weekly_league_idx on public.line_refresh_cycles(weekly_board,league_id) where weekly_board is not null;
create index cycle_future_league_idx on public.line_refresh_cycles(future_board,league_id) where future_board is not null;

create function sportsbook_private.guard_market_league() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_league uuid;
begin
 select league_id into v_league from public.sportsbook_boards where id=new.board_id;
 if exists(select 1 from (values(new.team_id),(new.home_team_id),(new.away_team_id)) x(id)
   where x.id is not null and not exists(select 1 from public.teams where id=x.id and league_id=v_league)) then
  raise exception 'Market teams must belong to this league.';
 end if;
 return new;
end $$;
create trigger market_league_guard before insert or update of board_id,team_id,home_team_id,away_team_id on public.sportsbook_markets
for each row execute function sportsbook_private.guard_market_league();

create function sportsbook_private.guard_report_league() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if jsonb_typeof(new.results) is distinct from 'object' or exists(
  select 1 from jsonb_object_keys(new.results) k where not exists(
   select 1 from public.teams t where t.id::text=k and t.league_id=new.league_id)) then
  raise exception 'Report result teams must belong to this league.';
 end if;
 return new;
end $$;
create trigger report_league_guard before insert or update of league_id,results on public.league_result_weeks
for each row execute function sportsbook_private.guard_report_league();

create function sportsbook_private.guard_outbox_recipient() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.team_id is null or not exists(select 1 from public.league_memberships m
   where m.league_id=new.league_id and m.team_id=new.team_id and m.invited_email=new.recipient
     and (new.kind<>'attention' or m.role='admin')) then
  raise exception 'Email recipient must match the approved league membership.';
 end if;
 if new.payload is not null and (new.payload->'to' is distinct from jsonb_build_array(new.recipient)
   or new.payload ? 'cc' or new.payload ? 'bcc') then
  raise exception 'Email payload recipients must match the outbox recipient.';
 end if;
 return new;
end $$;
create trigger outbox_recipient_guard before insert or update of league_id,team_id,ticket_id,recipient,payload on public.outbound_emails
for each row execute function sportsbook_private.guard_outbox_recipient();

create function sportsbook_private.guard_league_rollout() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.automation_enabled and not exists(
   select 1 from public.leagues where id=new.league_id and operations_enabled) then
  raise exception 'League operations are disabled pending verified rollout.';
 end if;
 return new;
end $$;
-- Separate triggers avoid accessing a field that is absent on tickets.
create function sportsbook_private.guard_ticket_rollout() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.source_batch is null and not exists(select 1 from public.leagues where id=new.league_id and operations_enabled) then
  raise exception 'League operations are disabled pending verified rollout.';
 end if;
 return new;
end $$;
create trigger ticket_rollout_guard before insert on public.tickets for each row execute function sportsbook_private.guard_ticket_rollout();
create trigger schedule_rollout_guard before insert or update of automation_enabled,league_id on public.weekly_schedule for each row execute function sportsbook_private.guard_league_rollout();
revoke all on function sportsbook_private.guard_market_league(),sportsbook_private.guard_report_league(),sportsbook_private.guard_outbox_recipient(),sportsbook_private.guard_league_rollout(),sportsbook_private.guard_ticket_rollout() from public,anon,authenticated;

create function public.claim_scoped_outbound_emails(p_ticket uuid default null) returns setof public.outbound_emails
language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 update public.outbound_emails set status='needs_review',last_error='Retry window expired; verify provider delivery before resending.'
 where status in ('sending','failed','pending') and first_attempt_at<now()-interval '23 hours' and (p_ticket is null or ticket_id=p_ticket);
 return query update public.outbound_emails set status='sending',attempts=attempts+1,lease_until=now()+interval '5 minutes',first_attempt_at=coalesce(first_attempt_at,now())
 where id in(select id from public.outbound_emails where status in ('pending','failed','sending') and attempts<5
 and (p_ticket is null or ticket_id=p_ticket) and coalesce(lease_until,'-infinity')<now()
 order by created_at for update skip locked limit 4) returning *;
end $$;
revoke all on function public.claim_scoped_outbound_emails(uuid) from public,anon,authenticated;
grant execute on function public.claim_scoped_outbound_emails(uuid) to service_role;
commit;
