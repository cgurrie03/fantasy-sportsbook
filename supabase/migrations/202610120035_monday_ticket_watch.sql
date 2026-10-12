begin;
alter table public.outbound_emails drop constraint outbound_emails_kind_check;
alter table public.outbound_emails add constraint outbound_emails_kind_check
 check(kind in ('opening','reminder','recap','attention','confirmation','monday_watch'));
-- Preserve later interval scheduling, tenant isolation, authorization, and atomic claiming.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.claim_automation_job()'::regprocedure) into definition;
 if position('''monday_watch''' in definition) = 0 then
  if position('(''recap'',s.recap_time,2)' in definition) = 0 then
   raise exception 'Scheduler anchor missing; Monday schedule was not installed.';
  end if;
  definition := replace(definition, '(''recap'',s.recap_time,2)',
   '(''recap'',s.recap_time,2),(''monday_watch'',''17:00''::time,1)');
  execute definition;
 end if;
end $$;
commit;
