-- READ ONLY. Run only against the named Production project. No Auth credentials,
-- email bodies, provider secrets or session material are exported by this query.
begin isolation level repeatable read read only;
set local statement_timeout='20s';
set local timezone='UTC';
with members as (
 select m.id,m.league_id,m.team_id,m.user_id,m.sleeper_user_id,m.role,
   encode(extensions.digest(lower(trim(m.invited_email)),'sha256'),'hex') email_fingerprint,
   a.id matched_auth_id,a.email_confirmed_at is not null verified
 from public.league_memberships m left join auth.users a
 on lower(trim(a.email))=lower(trim(m.invited_email))
), data as (select jsonb_build_object(
 'format','boff-production-migration-inventory-v1',
 'project_ref','bmvjcdgxwxqalaohpsnw','captured_at',statement_timestamp(),
 'leagues',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from
   (select id,name,sleeper_league_id,nfl_season,league_season,active_week,operations_enabled from leagues)x),
 'teams',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from
   (select id,league_id,roster_id,sleeper_owner_id,co_owner_ids,sportsbook_owner_id from teams)x),
 'members',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') from members m),
 'wallets',(select coalesce(jsonb_agg(to_jsonb(w) order by w.team_id),'[]') from wallets w),
 'tickets',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from
   (select id,league_id,team_id,nfl_season,league_season,market_week,placement_week,
     placed_at,ticket_type,status,stake,accepted_combined_odds,accepted_potential_payout,
     actual_payout,net_profit,settled_at,source_batch,legacy_ticket_id,
     source_record->>'legacy_user_id' legacy_user_id,request_key from tickets)x),
 'legs',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from
   (select id,ticket_id,leg_number,selection,market_type,matchup,accepted_odds,
     accepted_line,accepted_decimal_odds,status,actual_value,result_evidence,market_quote_id from ticket_legs)x),
 'ledger',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from
   (select id,team_id,ticket_id,event_key,kind,amount,balance_before,balance_after,created_at from wallet_ledger)x),
 'mail_status',(select coalesce(jsonb_agg(to_jsonb(x) order by x.status),'[]') from
   (select status,count(*) records from outbound_emails group by status)x)
) payload)
select payload from data;
commit;
