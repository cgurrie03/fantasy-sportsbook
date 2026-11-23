-- Read-only postflight after the upgrade/configuration. No secret values or command bodies.
BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT jsonb_build_object(
 'environment',public.application_environment_identity(),
 'runtime',(SELECT jsonb_build_object('season',season,'openingWeek',opening_week,'configuredAt',configured_at,
   'notificationsEnabled',notifications_enabled) FROM sportsbook_private.production_worker_runtime WHERE singleton),
 'legacySchedulerActive',EXISTS(SELECT FROM cron.job WHERE jobname='sportsbook-weekly-worker' AND active),
 'releaseSchedulers',(SELECT count(*) FROM cron.job WHERE jobname='boff-production-live-refresh'),
 'releaseSchedulerActive',EXISTS(SELECT FROM cron.job WHERE jobname='boff-production-live-refresh' AND active),
 'unfinishedLegacyJobs',(SELECT count(*) FROM public.automation_jobs WHERE league_id='13121261-5398-4391-8240-000000000003' AND status NOT IN('done','canceled')),
 'board',(SELECT jsonb_build_object('id',b.id,'season',b.nfl_season,'week',b.market_week,'revision',b.revision,'status',b.status,
   'observedAt',c.observed_at,'validUntil',c.valid_until,'fresh',c.valid_until>clock_timestamp() AND c.last_error IS NULL,
   'closesAt',b.closes_at,'lastError',c.last_error,'activeQuotes',(SELECT count(*) FROM public.sportsbook_markets m WHERE m.board_id=b.id AND m.active))
  FROM public.dev_current_book c JOIN public.sportsbook_boards b ON b.id=c.board_id WHERE c.league_id='13121261-5398-4391-8240-000000000003'),
 'mailSuppressionInstalled',EXISTS(SELECT FROM pg_trigger WHERE tgname='suppress_production_notifications' AND tgrelid='public.outbound_emails'::regclass),
 'personWallets',(SELECT count(*) FROM public.user_wallets WHERE league_id='13121261-5398-4391-8240-000000000003'),
 'futureRoutes',(SELECT count(*) FROM sportsbook_private.production_legacy_routes)
) AS postflight;
COMMIT;
