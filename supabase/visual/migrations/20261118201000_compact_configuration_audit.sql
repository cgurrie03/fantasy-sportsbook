DO $$BEGIN IF public.application_environment_identity()->>'project_ref'<>'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development required';END IF;END $$;
CREATE OR REPLACE FUNCTION boff_dev_internal.audit_commissioner_configuration() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior jsonb;current_value jsonb;category text;changed jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT boff_dev_internal.can_manage_members(NEW.league_id) THEN RETURN NEW;END IF;
 IF TG_TABLE_NAME='feature_settings' THEN
  prior:=OLD.settings;current_value:=NEW.settings;category:='featured_matchup_rules';
 ELSE
  prior:=CASE WHEN TG_OP='UPDATE' THEN OLD.choices ELSE NULL END;current_value:=NEW.choices;category:='league_feed_rules';
 END IF;
 IF prior IS NOT DISTINCT FROM current_value THEN RETURN NEW;END IF;
 SELECT jsonb_agg(key ORDER BY key) INTO changed FROM(
 SELECT jsonb_object_keys(coalesce(prior,'{}')) AS key UNION SELECT jsonb_object_keys(current_value))x
 WHERE prior->key IS DISTINCT FROM current_value->key;
 INSERT INTO public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value)
 VALUES(NEW.league_id,auth.uid(),category,CASE category WHEN 'featured_matchup_rules' THEN 'Featured matchup or rivalry settings saved' ELSE 'League feed preferences saved' END,
 jsonb_build_object('settings_md5',md5(prior::text)),jsonb_build_object('settings_md5',md5(current_value::text),'changed_fields',changed));
 RETURN NEW;
END $$;
DO $$DECLARE body text;BEGIN
 IF public.application_environment_identity()->>'project_ref'<>'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development required';END IF;
 SELECT pg_get_functiondef('boff_dev_internal.activity_rows(uuid)'::regprocedure) INTO body;
 IF strpos(body,'jsonb_build_object(''Category'',a.category,''Reason'',a.reason)')=0 THEN RAISE EXCEPTION 'Activity definition changed';END IF;
 EXECUTE replace(body,'jsonb_build_object(''Category'',a.category,''Reason'',a.reason)',
 'jsonb_build_object(''Category'',a.category,''Reason'',a.reason,''Changed Fields'',(SELECT string_agg(value,'', '') FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(a.after_value->''changed_fields'')=''array'' THEN a.after_value->''changed_fields'' ELSE ''[]'' END)))');
END $$;
