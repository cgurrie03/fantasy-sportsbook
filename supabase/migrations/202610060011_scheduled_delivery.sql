begin;
create table public.automation_jobs (
 id uuid primary key default gen_random_uuid(), league_id uuid not null references public.leagues,
 event_key text not null unique, operation text not null, market_week integer not null,
 status text not null default 'pending' check(status in ('pending','running','done','failed')),
 attempts integer not null default 0, lease_until timestamptz, summary jsonb, last_error text,
 created_at timestamptz not null default now(), completed_at timestamptz
);
create index automation_jobs_claim_idx on public.automation_jobs(status,lease_until,created_at);
create table public.outbound_emails (
 id uuid primary key default gen_random_uuid(), league_id uuid not null references public.leagues,
 event_key text not null unique, kind text not null check(kind in ('opening','reminder','recap','attention','confirmation')),
 recipient text not null, team_id uuid references public.teams, ticket_id uuid references public.tickets,
 market_week integer not null, payload jsonb,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','needs_review','skipped')),
 attempts integer not null default 0, provider_id text, last_error text, lease_until timestamptz,
 first_attempt_at timestamptz, created_at timestamptz not null default now(), sent_at timestamptz
);
create index outbound_email_claim_idx on public.outbound_emails(status,lease_until,created_at);
alter table public.automation_jobs enable row level security;
alter table public.outbound_emails enable row level security;
revoke all on public.automation_jobs,public.outbound_emails from public,anon,authenticated;
grant select on public.automation_jobs,public.outbound_emails to authenticated;
grant select,insert,update on public.automation_jobs,public.outbound_emails to service_role;
create policy automation_admin_read on public.automation_jobs for select to authenticated using(sportsbook_private.is_admin(league_id));
create policy outbound_admin_read on public.outbound_emails for select to authenticated using(sportsbook_private.is_admin(league_id));

-- Only the server credential can enter this bridge. Browser roles retain the existing admin checks.
create function public.worker_operation(p_league uuid,p_operation text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_admin uuid; v_result jsonb; v_board uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 select user_id into v_admin from public.league_memberships where league_id=p_league and role='admin' and user_id is not null limit 1;
 if v_admin is null then raise exception 'An approved admin must sign in before automation is enabled.'; end if;
 perform set_config('request.jwt.claim.sub',v_admin::text,true);
 if p_operation='settle' then
  if not exists(select 1 from public.tickets where id=(p_args->>'ticket')::uuid and league_id=p_league) then raise exception 'Ticket league mismatch.'; end if;
  return public.settle_weekly_ticket((p_args->>'ticket')::uuid,p_args->'results');
 elsif p_operation='replenish' then return public.replenish_weekly_balances(p_league,(p_args->>'season')::int,(p_args->>'week')::int);
 elsif p_operation='save_board' then
  v_board:=public.save_market_board((p_args->>'board')::uuid,p_league,(p_args->>'week')::int,(p_args->>'opens')::timestamptz,(p_args->>'closes')::timestamptz,p_args->'quotes',p_args->>'status');
  return to_jsonb(v_board);
 else raise exception 'Unknown worker operation.'; end if;
end $$;
revoke all on function public.worker_operation(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.worker_operation(uuid,text,jsonb) to service_role;
grant execute on function public.sportsbook_period(uuid) to service_role;

-- Queue the confirmation in the same transaction as accepting the ticket.
create function sportsbook_private.queue_confirmation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.outbound_emails(league_id,event_key,kind,recipient,team_id,ticket_id,market_week)
 select league_id,'confirmation:'||id,'confirmation',new.recipient,team_id,id,market_week from public.tickets where id=new.ticket_id
 on conflict(event_key) do nothing;
 return new;
end $$;
create trigger ticket_confirmation_outbox after insert on public.email_deliveries for each row execute function sportsbook_private.queue_confirmation();

create function public.claim_outbound_emails() returns setof public.outbound_emails
language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 -- Resend idempotency expires after 24 hours. Ambiguous older sends need human review.
 update public.outbound_emails set status='needs_review',last_error='Retry window expired; verify provider delivery before resending.'
 where status in ('sending','failed','pending') and first_attempt_at<now()-interval '23 hours';
 return query update public.outbound_emails set status='sending',attempts=attempts+1,lease_until=now()+interval '5 minutes',first_attempt_at=coalesce(first_attempt_at,now())
 where id in(select id from public.outbound_emails where status in ('pending','failed','sending') and attempts<5 and coalesce(lease_until,'-infinity')<now() order by created_at for update skip locked limit 4) returning *;
end $$;
revoke all on function public.claim_outbound_emails() from public,anon,authenticated;
grant execute on function public.claim_outbound_emails() to service_role;

create function public.claim_automation_job() returns setof public.automation_jobs
language plpgsql security definer set search_path='' as $$
declare s record; d timestamp:=now() at time zone 'America/New_York'; dow int; t time; op text; due time; days int; w int; key text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server worker only.'; end if;
 dow:=extract(isodow from d); t:=d::time;
 for s in select * from public.weekly_schedule where automation_enabled loop
  select week into w from public.sportsbook_period(s.league_id);
  for op,due,days in select * from (values
   ('settlement', (s.job_times->>'settlement')::time,2),('recheck',(s.job_times->>'recheck')::time,2),
   ('replenishment',(s.job_times->>'replenishment')::time,2),
   ('generate_matchups',(s.job_times->>'generation')::time,2),('generate_players',(s.job_times->>'generation')::time,2),('generate_specials',(s.job_times->>'generation')::time,2),
   ('refresh_matchups',(s.job_times->>'refresh')::time,3),('refresh_players',(s.job_times->>'refresh')::time,3),('refresh_specials',(s.job_times->>'refresh')::time,3),
   ('publish',s.opening_time,3),('reminder',s.reminder_time,4),('cutoff',(s.job_times->>'cutoff')::time,4),('recap',s.recap_time,2)
  ) x(op,due,days) loop
   if dow=days and t>=due and d < d::date+due+interval '2 hours' then
    key:=s.league_id||':'||d::date||':'||op;
    insert into public.automation_jobs(league_id,event_key,operation,market_week) values(s.league_id,key,op,w) on conflict(event_key) do nothing;
   end if;
  end loop;
 end loop;
 return query update public.automation_jobs set status='running',attempts=attempts+1,lease_until=now()+interval '5 minutes'
 where id in(select j.id from public.automation_jobs j join public.weekly_schedule cfg using(league_id)
 where cfg.automation_enabled and j.status in ('pending','failed','running') and j.attempts<4 and coalesce(j.lease_until,'-infinity')<now() and j.created_at>now()-interval '2 hours'
 order by j.created_at,case j.operation when 'settlement' then 0 when 'recheck' then 1 when 'replenishment' then 2 when 'recap' then 6 else 3 end,j.event_key for update of j skip locked limit 1) returning *;
end $$;
revoke all on function public.claim_automation_job() from public,anon,authenticated;
grant execute on function public.claim_automation_job() to service_role;
grant select on public.leagues,public.teams,public.league_memberships,public.wallets,public.wallet_ledger,public.tickets,public.ticket_legs,public.sportsbook_boards,public.sportsbook_markets,public.weekly_schedule,public.weekly_execution_runs to service_role;
grant update(wins,losses,ties) on public.teams to service_role;
grant update(status) on public.sportsbook_boards to service_role;
commit;
