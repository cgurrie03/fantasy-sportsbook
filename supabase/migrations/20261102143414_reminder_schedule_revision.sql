begin;
-- Returning to a previous lead/window may resume an identical, never-attempted
-- schedule revision. Never resurrect a provider attempt or change frozen content.
do $$declare d text;needle text:='on conflict(event_key) do nothing;';begin
 select pg_get_functiondef('sportsbook_private.enqueue_weekly_jobs(timestamptz)'::regprocedure) into d;
 if strpos(d,needle)=0 then raise exception 'Relative planner conflict source drift';end if;
 execute replace(d,needle,$replacement$on conflict(event_key) do update set status='pending',scheduled_for=excluded.scheduled_for,
 expires_at=excluded.expires_at,lease_until=null,completed_at=null,summary=null
 where public.automation_jobs.status='done' and public.automation_jobs.summary->>'skipped'='true'
 and public.automation_jobs.summary->>'reason'='Reminder window changed or became unavailable';$replacement$);
 select pg_get_functiondef('public.queue_relative_reminder(uuid,integer,uuid,text,text)'::regprocedure) into d;
 if strpos(d,needle)=0 then raise exception 'Relative outbox conflict source drift';end if;
 execute replace(d,needle,$replacement$on conflict(event_key) do update set status='pending',last_error=null,terminal_at=null,lease_until=null
 where public.outbound_emails.status='skipped' and public.outbound_emails.attempts=0 and public.outbound_emails.payload is null
 and public.outbound_emails.provider_id is null and public.outbound_emails.body_retired_at is null
 and public.outbound_emails.notification_context=excluded.notification_context;$replacement$);
end $$;
commit;
