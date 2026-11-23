DO $$ DECLARE body text; anchor text:='declare q public.sportsbook_markets;begin'; BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
 SELECT pg_get_functiondef('sportsbook_private.policy_publication_guard()'::regprocedure) INTO body;
 IF strpos(body,anchor)=0 THEN RAISE EXCEPTION 'Publication guard definition changed'; END IF;
 EXECUTE replace(body,anchor,anchor||E'\n IF NEW.board_type = ''weekly'' AND NEW.status <> ''published'' THEN RETURN NULL; END IF;'
  || E'\n IF NEW.board_type = ''weekly'' AND TG_OP = ''UPDATE'' AND OLD.status = NEW.status AND OLD.content_version = NEW.content_version AND OLD.revision = NEW.revision AND OLD.league_id = NEW.league_id AND OLD.nfl_season = NEW.nfl_season AND OLD.market_week = NEW.market_week THEN RETURN NULL; END IF;');
END $$;
