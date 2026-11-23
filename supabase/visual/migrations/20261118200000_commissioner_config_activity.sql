DO $$ DECLARE body text;definition text;addition text:=$extra$
 UNION ALL
 SELECT 'reward:'||r.league_id||':'||r.revision,r.changed_at,'Rules',
 CASE WHEN r.revision=1 THEN 'Fantasy Reward Rules Initialized' ELSE 'Fantasy Reward Rules Changed' END,
 r.actor,coalesce((SELECT min(p.display_name) FROM boff_dev_internal.participant_links p WHERE p.league_id=r.league_id AND p.user_id=r.actor),'Commissioner'),
 r.actor,'Commissioner',NULL::uuid,NULL::integer,jsonb_build_object('Revision',r.revision)
 FROM boff_dev_internal.fantasy_reward_rule_changes r WHERE r.league_id=p_league AND r.actor IS NOT NULL
 UNION ALL
 SELECT 'futures:'||r.league_id||':'||r.season||':'||r.revision,r.created_at,'Rules',
 CASE WHEN r.revision=1 THEN 'Season Futures Rules Initialized' ELSE 'Season Futures Rules Changed' END,
 r.actor_id,coalesce((SELECT min(p.display_name) FROM boff_dev_internal.participant_links p WHERE p.league_id=r.league_id AND p.user_id=r.actor_id),'Commissioner'),
 r.actor_id,'Commissioner',NULL::uuid,NULL::integer,jsonb_build_object('Season',r.season,'Revision',r.revision)
 FROM boff_dev_internal.futures_rule_versions r WHERE r.league_id=p_league AND r.actor_id IS NOT NULL
 $extra$;
BEGIN
 IF public.application_environment_identity()->>'project_ref'<>'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development required';END IF;
 SELECT prosrc,pg_get_functiondef(oid) INTO body,definition FROM pg_proc WHERE oid='boff_dev_internal.activity_rows(uuid)'::regprocedure;
 IF strpos(body,'fantasy_reward_rule_changes')>0 THEN RAISE EXCEPTION 'Activity definition changed';END IF;
 EXECUTE replace(definition,body,body||addition);
END $$;

CREATE FUNCTION boff_dev_internal.audit_commissioner_configuration() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior jsonb;current_value jsonb;category text;
BEGIN
 IF auth.uid() IS NULL OR NOT boff_dev_internal.can_manage_members(NEW.league_id) THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='feature_settings' THEN
  prior:=OLD.settings;current_value:=NEW.settings;category:='featured_matchup_rules';
 ELSE
  prior:=CASE WHEN TG_OP='UPDATE' THEN OLD.choices ELSE NULL END;current_value:=NEW.choices;category:='league_feed_rules';
 END IF;
 IF prior IS NOT DISTINCT FROM current_value THEN RETURN NEW;END IF;
 INSERT INTO public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value)
 VALUES(NEW.league_id,auth.uid(),category,CASE category WHEN 'featured_matchup_rules' THEN 'Featured matchup or rivalry settings saved' ELSE 'League feed preferences saved' END,
 jsonb_build_object('settings',prior),jsonb_build_object('settings',current_value));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.audit_commissioner_configuration() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER audit_feature_settings AFTER UPDATE ON boff_dev_internal.feature_settings FOR EACH ROW
 WHEN(OLD.settings IS DISTINCT FROM NEW.settings) EXECUTE FUNCTION boff_dev_internal.audit_commissioner_configuration();
CREATE TRIGGER audit_feed_preferences AFTER INSERT OR UPDATE ON boff_dev_internal.league_feed_preferences FOR EACH ROW
 EXECUTE FUNCTION boff_dev_internal.audit_commissioner_configuration();
