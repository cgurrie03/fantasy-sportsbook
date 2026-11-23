-- Dev storage foundation. Applied only to whlcnlacueweaqpsupqs.
DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs'
 OR public.application_environment_identity()->>'environment' IS DISTINCT FROM 'development' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;
CREATE TABLE public.receipt_context_values(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 league_id uuid NOT NULL REFERENCES public.leagues(id),
 fingerprint bytea NOT NULL CHECK(octet_length(fingerprint)=32),
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=262144),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(league_id,fingerprint)
);
CREATE TABLE public.receipt_context_bundles(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 league_id uuid NOT NULL REFERENCES public.leagues(id),
 fingerprint bytea NOT NULL CHECK(octet_length(fingerprint)=32),
 refs jsonb NOT NULL CHECK(jsonb_typeof(refs)='object' AND octet_length(refs::text)<=8192),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(league_id,fingerprint)
);
ALTER TABLE public.receipt_context_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_context_bundles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receipt_context_values,public.receipt_context_bundles FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.receipt_context_values,public.receipt_context_bundles TO authenticated,service_role;
CREATE POLICY receipt_values_member ON public.receipt_context_values FOR SELECT TO authenticated USING(sportsbook_private.is_member(league_id));
CREATE POLICY receipt_bundles_member ON public.receipt_context_bundles FOR SELECT TO authenticated USING(sportsbook_private.is_member(league_id));
ALTER TABLE public.ticket_legs ADD COLUMN context_bundle_id bigint REFERENCES public.receipt_context_bundles(id) ON DELETE RESTRICT;
CREATE INDEX ticket_leg_context_bundle ON public.ticket_legs(context_bundle_id) WHERE context_bundle_id IS NOT NULL;

CREATE FUNCTION sportsbook_private.expand_receipt_context(p_context jsonb,p_bundle bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.receipt_context_bundles;kv record;field_payload jsonb;meta jsonb;
BEGIN
 IF p_bundle IS NULL THEN RETURN p_context;END IF;
 SELECT * INTO b FROM public.receipt_context_bundles WHERE id=p_bundle;
 IF NOT FOUND THEN RAISE EXCEPTION 'Receipt context is unavailable';END IF;
 meta:=coalesce(p_context->'metadata','{}'::jsonb);
 FOR kv IN SELECT key,(value#>>'{}')::bigint AS id FROM jsonb_each(b.refs) LOOP
  SELECT payload INTO field_payload FROM public.receipt_context_values WHERE league_id=b.league_id AND id=kv.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt evidence is unavailable';END IF;
  meta:=meta||jsonb_build_object(kv.key,field_payload);
 END LOOP;
 RETURN jsonb_set(p_context,'{metadata}',meta,true);
END $$;
REVOKE ALL ON FUNCTION sportsbook_private.expand_receipt_context(jsonb,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION sportsbook_private.expand_receipt_context(jsonb,bigint) TO authenticated,service_role;

CREATE FUNCTION sportsbook_private.receipt_context_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Receipt evidence is immutable';END IF;
 IF TG_TABLE_NAME='receipt_context_values' AND EXISTS(
  SELECT 1 FROM public.receipt_context_bundles b CROSS JOIN LATERAL jsonb_each(b.refs) r
   WHERE b.league_id=OLD.league_id AND (r.value#>>'{}')::bigint=OLD.id
 ) THEN RAISE EXCEPTION 'Receipt evidence is referenced';END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER receipt_values_immutable BEFORE UPDATE OR DELETE ON public.receipt_context_values FOR EACH ROW EXECUTE FUNCTION sportsbook_private.receipt_context_immutable();
CREATE TRIGGER receipt_bundles_immutable BEFORE UPDATE ON public.receipt_context_bundles FOR EACH ROW EXECUTE FUNCTION sportsbook_private.receipt_context_immutable();
REVOKE ALL ON FUNCTION sportsbook_private.receipt_context_immutable() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION sportsbook_private.compact_receipt_context() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE league uuid;original jsonb;meta jsonb;inline jsonb:='{}';refs jsonb:='{}';kv record;v_id bigint;b_id bigint;h bytea;check_value jsonb;
 core text[]:=ARRAY['player_id','opponent_player_id','margin_lower','margin_upper','expected_team_count','projection_targets','roster_id','group_position','starter_ids','lineup_player_ids','settlement_rule','rule_version','accepted_targets'];
BEGIN
 IF TG_OP='UPDATE' AND OLD.context_bundle_id IS NOT NULL AND NEW.settlement_context IS NOT DISTINCT FROM OLD.settlement_context AND NEW.context_bundle_id IS NOT DISTINCT FROM OLD.context_bundle_id THEN RETURN NEW;END IF;
 IF TG_OP='INSERT' AND NEW.context_bundle_id IS NOT NULL THEN RAISE EXCEPTION 'Provide full accepted context, not a context reference';END IF;
 SELECT league_id INTO STRICT league FROM public.tickets WHERE id=NEW.ticket_id;
 IF NEW.context_bundle_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.receipt_context_bundles WHERE id=NEW.context_bundle_id AND league_id=league) THEN RAISE EXCEPTION 'Receipt context outside league';END IF;
 original:=sportsbook_private.expand_receipt_context(NEW.settlement_context,NEW.context_bundle_id);
 IF original IS NULL OR jsonb_typeof(original->'metadata') IS DISTINCT FROM 'object' THEN RETURN NEW;END IF;
 -- Unknown market contracts stay inline until their settlement dependencies are reviewed.
 IF coalesce(original->>'kind','') <> ALL(ARRAY['moneyline','spread','match_total','team_total','player_points','player_h2h','player_milestone','team_milestone','winning_margin','weekly_high','weekly_low','weekly_count_150','weekly_any_below_100','weekly_any_200','weekly_count_projection','weekly_average','weekly_highest_score','future_champion','future_playoffs','future_first_pick','future_win_total']) THEN RETURN NEW;END IF;
 SELECT league_id INTO STRICT league FROM public.tickets WHERE id=NEW.ticket_id;
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtext('boff.receipt.storage'),pg_catalog.hashtext(league::text));
 meta:=original->'metadata';
 FOR kv IN SELECT key,value FROM jsonb_each(meta) LOOP
  IF kv.key=ANY(core) OR (pg_column_size(kv.value)<128 AND kv.key<>ALL(ARRAY['scoring_settings','roster_positions','price_policy','model_config'])) THEN inline:=inline||jsonb_build_object(kv.key,kv.value);CONTINUE;END IF;
  h:=pg_catalog.sha256(convert_to(kv.value::text,'UTF8'));
  INSERT INTO public.receipt_context_values(league_id,fingerprint,payload) VALUES(league,h,kv.value)
   ON CONFLICT(league_id,fingerprint) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN SELECT id,payload INTO v_id,check_value FROM public.receipt_context_values WHERE league_id=league AND fingerprint=h;
   IF check_value IS DISTINCT FROM kv.value THEN RAISE EXCEPTION 'Receipt context fingerprint collision';END IF;END IF;
  refs:=refs||jsonb_build_object(kv.key,v_id);
 END LOOP;
 IF refs='{}'::jsonb THEN RETURN NEW;END IF;
 h:=pg_catalog.sha256(convert_to(refs::text,'UTF8'));
 INSERT INTO public.receipt_context_bundles(league_id,fingerprint,refs) VALUES(league,h,refs)
  ON CONFLICT(league_id,fingerprint) DO NOTHING RETURNING id INTO b_id;
 IF b_id IS NULL THEN SELECT b.id,b.refs INTO b_id,check_value FROM public.receipt_context_bundles b WHERE b.league_id=league AND b.fingerprint=h;
  IF check_value IS DISTINCT FROM refs THEN RAISE EXCEPTION 'Receipt bundle fingerprint collision';END IF;END IF;
 NEW.context_bundle_id:=b_id;
 NEW.settlement_context:=jsonb_set(original,'{metadata}',inline,true);
 IF sportsbook_private.expand_receipt_context(NEW.settlement_context,b_id) IS DISTINCT FROM original THEN RAISE EXCEPTION 'Lossless receipt compaction failed';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zzzz_storage_compact_receipt BEFORE INSERT OR UPDATE OF settlement_context,context_bundle_id ON public.ticket_legs
 FOR EACH ROW EXECUTE FUNCTION sportsbook_private.compact_receipt_context();
REVOKE ALL ON FUNCTION sportsbook_private.compact_receipt_context() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION sportsbook_private.preserve_accepted_terms() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE old_terms jsonb;new_terms jsonb;
BEGIN
 IF TG_TABLE_NAME='ticket_legs' THEN
  old_terms:=to_jsonb(OLD)-ARRAY['status','actual_value','result_evidence','context_bundle_id','settlement_context'];
  new_terms:=to_jsonb(NEW)-ARRAY['status','actual_value','result_evidence','context_bundle_id','settlement_context'];
  IF old_terms IS DISTINCT FROM new_terms OR
   sportsbook_private.expand_receipt_context(OLD.settlement_context,OLD.context_bundle_id) IS DISTINCT FROM sportsbook_private.expand_receipt_context(NEW.settlement_context,NEW.context_bundle_id)
   THEN RAISE EXCEPTION 'Accepted leg terms are immutable.';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','actual_payout','settled_at','ticket_type','net_profit']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['status','actual_payout','settled_at','ticket_type','net_profit']) THEN RAISE EXCEPTION 'Accepted ticket terms are immutable.';END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE VIEW public.ticket_legs_with_evidence WITH (security_invoker=true) AS
 SELECT id,ticket_id,leg_number,selection,market_type,matchup,accepted_odds,accepted_line,status,actual_value,result_evidence,
 market_quote_id,accepted_decimal_odds,sportsbook_private.expand_receipt_context(settlement_context,context_bundle_id) AS settlement_context
 FROM public.ticket_legs;
REVOKE ALL ON public.ticket_legs_with_evidence FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ticket_legs_with_evidence TO authenticated,service_role;
COMMENT ON VIEW public.ticket_legs_with_evidence IS 'On-demand lossless evidence. Normal ticket browsing uses compact ticket_legs.';
-- Current-only numeric forecasts. Existing compact evaluation samples and summaries
-- remain the calibration path; full legacy archive tables cannot grow in dev.
-- A current view reuses the existing compact samples: it does not store another
-- copy of their payloads. Existing sample admission and evaluated-sample expiry
-- preserve the bounded opening/latest evidence needed for model improvement.
CREATE VIEW public.storage_current_forecasts WITH(security_invoker=true) AS
 SELECT DISTINCT ON(league_id,category) league_id,category,nfl_season,market_week,captured_at AS observed_at,payload
 FROM(
  SELECT league_id,category,nfl_season,market_week,captured_at,payload FROM public.model_evaluation_samples
  UNION ALL
  SELECT league_id,'Live'::text,nfl_season,market_week,captured_at,payload FROM public.live_forecast_samples
 ) samples
 ORDER BY league_id,category,nfl_season DESC,market_week DESC,captured_at DESC;
REVOKE ALL ON public.storage_current_forecasts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.storage_current_forecasts TO authenticated,service_role;

CREATE TABLE public.opening_market_benchmarks(
 league_id uuid NOT NULL REFERENCES public.leagues(id),nfl_season integer NOT NULL,market_week integer NOT NULL,
 market_key text NOT NULL,kind text NOT NULL CHECK(kind IN ('spread','moneyline','match_total')),
 source_quote_id uuid NOT NULL,home_team_id uuid,away_team_id uuid,team_id uuid,side text NOT NULL,
 line numeric,odds integer NOT NULL,captured_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(league_id,nfl_season,market_week,market_key)
);
ALTER TABLE public.opening_market_benchmarks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.opening_market_benchmarks FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.opening_market_benchmarks TO authenticated,service_role;
CREATE POLICY opening_benchmarks_member ON public.opening_market_benchmarks FOR SELECT TO authenticated USING(sportsbook_private.is_member(league_id));
CREATE OR REPLACE FUNCTION sportsbook_private.capture_forecast(p_board uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.sportsbook_boards;
BEGIN
 SELECT * INTO b FROM public.sportsbook_boards WHERE id=p_board;
 IF NOT FOUND OR b.status<>'published' OR b.phase<>'pregame' OR b.board_type<>'weekly' OR b.closes_at<=clock_timestamp() THEN RETURN;END IF;
 INSERT INTO public.opening_market_benchmarks(league_id,nfl_season,market_week,market_key,kind,source_quote_id,home_team_id,away_team_id,team_id,side,line,odds)
 SELECT b.league_id,b.nfl_season,b.market_week,coalesce(m.metadata->>'ui_group',m.market_key)||':'||m.side,m.kind,m.id,m.home_team_id,m.away_team_id,m.team_id,m.side,m.line,m.odds
 FROM public.sportsbook_markets m WHERE m.board_id=b.id AND m.active AND m.kind IN ('spread','moneyline','match_total') AND m.metadata->>'alternate' IS DISTINCT FROM 'true'
 ON CONFLICT(league_id,nfl_season,market_week,market_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION sportsbook_private.capture_forecast(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION sportsbook_private.reject_archive_growth() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Full forecast archives are disabled in dev; use compact evaluation/current stores';END $$;
CREATE TRIGGER storage_no_raw_model BEFORE INSERT OR UPDATE ON public.model_forecast_runs FOR EACH ROW EXECUTE FUNCTION sportsbook_private.reject_archive_growth();
CREATE TRIGGER storage_no_raw_live BEFORE INSERT OR UPDATE ON public.live_forecast_runs FOR EACH ROW EXECUTE FUNCTION sportsbook_private.reject_archive_growth();
CREATE TRIGGER storage_no_raw_snapshots BEFORE INSERT OR UPDATE ON public.forecast_snapshots FOR EACH ROW EXECUTE FUNCTION sportsbook_private.reject_archive_growth();
CREATE TRIGGER storage_no_report_snapshots BEFORE INSERT OR UPDATE ON public.published_forecast_samples FOR EACH ROW EXECUTE FUNCTION sportsbook_private.reject_archive_growth();
REVOKE ALL ON FUNCTION sportsbook_private.reject_archive_growth() FROM PUBLIC,anon,authenticated,service_role;

-- One score observation per league/season/week already exists. Keep only numeric
-- score inputs and explicit freshness/finality fields, never provider bodies.
CREATE FUNCTION sportsbook_private.compact_shared_progress() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE body jsonb;players jsonb;teams jsonb;
BEGIN
 IF jsonb_typeof(NEW.payload->'teams') IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.payload->'players') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Numeric score maps required';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(NEW.payload->'teams') WHERE jsonb_typeof(value)<>'number')
 OR EXISTS(SELECT 1 FROM jsonb_each(NEW.payload->'players') WHERE jsonb_typeof(value)<>'number') THEN RAISE EXCEPTION 'Invalid score observation';END IF;
 SELECT coalesce(jsonb_object_agg(t.id::text,NEW.payload->'teams'->t.id::text),'{}') INTO teams FROM public.teams t
 WHERE t.league_id=NEW.league_id AND NEW.payload->'teams' ? t.id::text;
 SELECT coalesce(jsonb_object_agg(p.id,NEW.payload->'players'->p.id),'{}') INTO players FROM (
  SELECT DISTINCT v.id FROM public.ticket_legs l JOIN public.tickets t ON t.id=l.ticket_id
  CROSS JOIN LATERAL (VALUES(l.settlement_context->'metadata'->>'player_id'),(l.settlement_context->'metadata'->>'opponent_player_id')) v(id)
  WHERE t.league_id=NEW.league_id AND t.nfl_season=NEW.nfl_season AND t.market_week=NEW.market_week
   AND t.status='OPEN' AND l.status='OPEN' AND v.id IS NOT NULL
 ) p WHERE NEW.payload->'players' ? p.id;
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO body FROM jsonb_each(NEW.payload)
 WHERE key IN ('week_final','provider_observed_at','observation_note');
 NEW.payload:=body||jsonb_build_object('teams',teams,'players',players);
 IF octet_length(NEW.payload::text)>65536 THEN RAISE EXCEPTION 'Shared progress exceeds byte budget';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER storage_progress BEFORE INSERT OR UPDATE OF payload ON public.ticket_score_observations FOR EACH ROW EXECUTE FUNCTION sportsbook_private.compact_shared_progress();
REVOKE ALL ON FUNCTION sportsbook_private.compact_shared_progress() FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.promo_offers ALTER COLUMN image_id DROP NOT NULL;
CREATE FUNCTION sportsbook_private.no_persistent_art() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Persistent promo/share images are disabled in dev; generate images on demand';END $$;
CREATE TRIGGER storage_no_persistent_art BEFORE INSERT ON public.promo_images FOR EACH ROW EXECUTE FUNCTION sportsbook_private.no_persistent_art();
REVOKE ALL ON FUNCTION sportsbook_private.no_persistent_art() FROM PUBLIC,anon,authenticated,service_role;

CREATE SCHEMA IF NOT EXISTS boff_dev_internal;
REVOKE ALL ON SCHEMA boff_dev_internal FROM PUBLIC,anon,authenticated;
CREATE TABLE boff_dev_internal.storage_maintenance_state(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),last_run_at timestamptz,last_result jsonb NOT NULL DEFAULT '{}'
);
ALTER TABLE boff_dev_internal.storage_maintenance_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.storage_maintenance_state FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO boff_dev_internal.storage_maintenance_state(singleton) VALUES(true);
CREATE FUNCTION boff_dev_internal.storage_maintenance(p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='15s' SET lock_timeout='500ms' AS $$
DECLARE lim integer:=least(100,greatest(1,coalesce(p_limit,25)));q record;fk record;protected boolean;used boolean;
 quotes integer:=0;bundles integer:=0;values_removed integer:=0;progress integer:=0;run_result jsonb;old_role text;
BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Dev project required';END IF;
 IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('boff.storage.maintenance')) THEN RETURN jsonb_build_object('skipped','busy');END IF;
 -- Existing retention routines preserve event keys, financial rows and pending failures.
 old_role:=current_setting('request.jwt.claim.role',true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 run_result:=public.cleanup_routine_payloads(lim)||public.cleanup_terminal_refresh_payloads(least(lim,10))||public.cleanup_evaluated_samples(least(lim,10));
 PERFORM set_config('request.jwt.claim.role',coalesce(old_role,''),true);
 FOR q IN SELECT m.id FROM public.sportsbook_markets m JOIN public.sportsbook_boards b ON b.id=m.board_id
  WHERE NOT m.active AND b.closes_at<now()-interval '7 days'
   AND (b.board_type='weekly' OR (b.status='closed' AND m.metadata->>'resolved'='true' AND NOT EXISTS(SELECT 1 FROM public.tickets t WHERE t.league_id=b.league_id AND t.nfl_season=b.nfl_season AND t.status='OPEN')))
   AND NOT EXISTS(SELECT 1 FROM public.ticket_legs l WHERE l.market_quote_id=m.id)
   AND NOT EXISTS(SELECT 1 FROM public.promo_offers o WHERE to_jsonb(o)::text LIKE '%'||m.id::text||'%')
   AND NOT EXISTS(SELECT 1 FROM public.sportsbook_reopening_reviews r WHERE to_jsonb(r)::text LIKE '%'||m.id::text||'%')
   AND NOT EXISTS(SELECT 1 FROM public.line_refresh_stages s WHERE to_jsonb(s)::text LIKE '%'||m.id::text||'%')
  ORDER BY b.closes_at,m.id LIMIT lim FOR UPDATE OF m SKIP LOCKED LOOP
  protected:=false;
  -- Any FK reference protects a quote, even if its FK would cascade or set null.
  FOR fk IN SELECT c.conrelid::regclass AS rel,a.attname AS col FROM pg_catalog.pg_constraint c
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
   WHERE c.contype='f' AND c.confrelid='public.sportsbook_markets'::regclass LOOP
   EXECUTE format('select exists(select 1 from %s where %I=$1)',fk.rel,fk.col) INTO used USING q.id;
   IF used THEN protected:=true;EXIT;END IF;
  END LOOP;
  IF protected OR EXISTS(SELECT 1 FROM public.promo_offers o WHERE to_jsonb(o)::text LIKE '%'||q.id::text||'%')
   OR EXISTS(SELECT 1 FROM public.sportsbook_reopening_reviews r WHERE to_jsonb(r)::text LIKE '%'||q.id::text||'%')
   OR EXISTS(SELECT 1 FROM public.line_refresh_stages s WHERE to_jsonb(s)::text LIKE '%'||q.id::text||'%') THEN CONTINUE;END IF;
  DELETE FROM public.sportsbook_markets WHERE id=q.id;quotes:=quotes+1;
 END LOOP;
 FOR q IN SELECT league_id FROM (SELECT league_id FROM public.receipt_context_bundles UNION SELECT league_id FROM public.receipt_context_values) scopes ORDER BY league_id LIMIT lim LOOP
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('boff.receipt.storage'),pg_catalog.hashtext(q.league_id::text)) THEN CONTINUE;END IF;
  WITH due AS(SELECT b.id FROM public.receipt_context_bundles b WHERE b.league_id=q.league_id AND b.created_at<now()-interval '7 days'
   AND NOT EXISTS(SELECT 1 FROM public.ticket_legs l WHERE l.context_bundle_id=b.id) ORDER BY b.id LIMIT lim)
  DELETE FROM public.receipt_context_bundles b USING due WHERE b.id=due.id;
  GET DIAGNOSTICS lim=ROW_COUNT;bundles:=bundles+lim;lim:=least(100,greatest(1,coalesce(p_limit,25)));
  WITH due AS(SELECT v.id FROM public.receipt_context_values v WHERE v.league_id=q.league_id AND v.created_at<now()-interval '7 days'
   AND NOT EXISTS(SELECT 1 FROM public.receipt_context_bundles b CROSS JOIN LATERAL jsonb_each(b.refs) r WHERE b.league_id=v.league_id AND (r.value#>>'{}')::bigint=v.id)
   ORDER BY v.id LIMIT lim)
  DELETE FROM public.receipt_context_values v USING due WHERE v.id=due.id;
  GET DIAGNOSTICS lim=ROW_COUNT;values_removed:=values_removed+lim;lim:=least(100,greatest(1,coalesce(p_limit,25)));
 END LOOP;
 WITH due AS(SELECT o.league_id,o.nfl_season,o.market_week FROM public.ticket_score_observations o JOIN public.leagues l ON l.id=o.league_id
  WHERE o.fetched_at<now()-interval '14 days' AND (o.nfl_season<>l.nfl_season OR o.market_week<>l.active_week)
   AND NOT EXISTS(SELECT 1 FROM public.tickets t WHERE t.league_id=o.league_id AND t.nfl_season=o.nfl_season AND t.market_week=o.market_week AND t.status='OPEN')
  ORDER BY o.fetched_at LIMIT lim)
 DELETE FROM public.ticket_score_observations o USING due d WHERE (o.league_id,o.nfl_season,o.market_week)=(d.league_id,d.nfl_season,d.market_week);
 GET DIAGNOSTICS progress=ROW_COUNT;
 run_result:=run_result||jsonb_build_object('obsolete_quotes',quotes,'orphan_context_bundles',bundles,'orphan_context_values',values_removed,'old_progress_rows',progress,'batch_limit',least(100,greatest(1,coalesce(p_limit,25))));
 -- pg_cron is absent in the local test engine. Hosted history is bounded too.
 IF to_regclass('cron.job_run_details') IS NOT NULL THEN
  EXECUTE $history$delete from cron.job_run_details where jobid in (select jobid from cron.job where jobname='boff-storage-maintenance') and end_time<now()-interval '24 hours'$history$;
 END IF;
 UPDATE boff_dev_internal.storage_maintenance_state SET last_run_at=clock_timestamp(),last_result=run_result WHERE singleton;
 RETURN run_result;
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.storage_maintenance(integer) FROM PUBLIC,anon,authenticated,service_role;
-- Backfill is lossless and guarded by the original financial immutability contract.
UPDATE public.ticket_legs SET settlement_context=settlement_context WHERE context_bundle_id IS NULL AND jsonb_typeof(settlement_context->'metadata')='object';

NOTIFY pgrst, 'reload schema';
