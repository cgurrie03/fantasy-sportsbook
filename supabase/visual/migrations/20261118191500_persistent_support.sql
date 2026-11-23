DO $$ BEGIN IF public.application_environment_identity()->>'project_ref'<>'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development required';END IF;END $$;
CREATE TABLE boff_dev_internal.support_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,request_key uuid NOT NULL,payload_md5 text NOT NULL,
 category text NOT NULL CHECK(category IN('Feedback','Question','Bug Report','Feature Suggestion')),
 message text NOT NULL CHECK(length(message) BETWEEN 10 AND 2000),page text NOT NULL CHECK(length(page)<=200),
 requester_name text NOT NULL,team_name text NOT NULL,
 status text NOT NULL DEFAULT 'New' CHECK(status IN('New','In Progress','Resolved','Closed')),
 revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,request_key)
);
CREATE INDEX support_user_created ON boff_dev_internal.support_requests(user_id,created_at DESC,id DESC);
CREATE INDEX support_league_created ON boff_dev_internal.support_requests(league_id,created_at DESC,id DESC);
CREATE INDEX support_status_created ON boff_dev_internal.support_requests(status,created_at DESC,id DESC);
CREATE TABLE boff_dev_internal.support_updates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL REFERENCES boff_dev_internal.support_requests(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,from_status text,to_status text NOT NULL,note text NOT NULL DEFAULT '' CHECK(length(note)<=1000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_updates_request ON boff_dev_internal.support_updates(request_id,created_at,id);
ALTER TABLE boff_dev_internal.support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE boff_dev_internal.support_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.support_requests,boff_dev_internal.support_updates FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION boff_dev_internal.require_verified_support() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Verified sign-in required';END IF;
 RETURN auth.uid();
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.require_verified_support() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.dev_submit_support(p_league uuid,p_category text,p_message text,p_page text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=boff_dev_internal.require_verified_support();r boff_dev_internal.support_requests;fingerprint text;person text;team text;
BEGIN
 IF NOT sportsbook_private.is_member(p_league) THEN RAISE EXCEPTION 'League access required';END IF;
 IF p_request IS NULL OR p_category IS NULL OR p_category NOT IN('Feedback','Question','Bug Report','Feature Suggestion') OR p_message IS NULL
 OR length(trim(p_message)) NOT BETWEEN 10 AND 2000 OR p_page IS NULL OR length(p_page)>200 OR p_page!~'^/[^?#]*$' OR p_page~'[[:cntrl:]]' OR p_page LIKE '//%'
 THEN RAISE EXCEPTION 'Choose a category and enter a message of 10–2,000 characters';END IF;
 fingerprint:=md5(jsonb_build_object('league',p_league,'category',p_category,'message',trim(p_message),'page',p_page)::text);
 PERFORM pg_advisory_xact_lock(hashtextextended('boff-support:'||actor,0));
 SELECT * INTO r FROM boff_dev_internal.support_requests WHERE user_id=actor AND request_key=p_request;
 IF FOUND THEN
 IF r.payload_md5<>fingerprint THEN RAISE EXCEPTION 'This submission identifier already belongs to a different request';END IF;
 RETURN jsonb_build_object('id',r.id,'status',r.status,'createdAt',r.created_at,'duplicate',true);END IF;
 SELECT * INTO r FROM boff_dev_internal.support_requests WHERE user_id=actor AND payload_md5=fingerprint AND created_at>now()-interval '24 hours' ORDER BY created_at DESC LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('id',r.id,'status',r.status,'createdAt',r.created_at,'duplicate',true);END IF;
 IF(SELECT count(*) FROM boff_dev_internal.support_requests WHERE user_id=actor AND created_at>now()-interval '10 minutes')>=5
 OR(SELECT count(*) FROM boff_dev_internal.support_requests WHERE user_id=actor AND created_at>now()-interval '24 hours')>=20
 OR(SELECT count(*) FROM boff_dev_internal.support_requests WHERE user_id=actor AND status IN('New','In Progress'))>=100
 THEN RAISE EXCEPTION 'Submission limit reached. Please wait before sending another request';END IF;
 SELECT p.display_name,t.team_name INTO person,team FROM boff_dev_internal.participant_links p JOIN public.teams t ON t.id=p.team_id
 WHERE p.user_id=actor AND p.league_id=p_league ORDER BY p.team_id LIMIT 1;
 person:=coalesce(person,'Platform Owner');team:=coalesce(team,'League Administration');
 INSERT INTO boff_dev_internal.support_requests(league_id,user_id,request_key,payload_md5,category,message,page,requester_name,team_name)
 VALUES(p_league,actor,p_request,fingerprint,p_category,trim(p_message),p_page,person,team) RETURNING * INTO r;
 INSERT INTO boff_dev_internal.support_updates(request_id,actor_id,to_status) VALUES(r.id,actor,'New');
 RETURN jsonb_build_object('id',r.id,'status',r.status,'createdAt',r.created_at,'duplicate',false);
END $$;
REVOKE ALL ON FUNCTION public.dev_submit_support(uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_submit_support(uuid,text,text,text,uuid) TO authenticated;

CREATE FUNCTION public.dev_support_requests(p_owner boolean DEFAULT false,p_league uuid DEFAULT NULL,p_status text DEFAULT 'All',p_member uuid DEFAULT NULL,
 p_cursor jsonb DEFAULT NULL,p_size integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=boff_dev_internal.require_verified_support();result jsonb;
BEGIN
 IF p_owner IS NULL OR (p_owner AND NOT sportsbook_private.is_platform_owner()) THEN RAISE EXCEPTION 'Platform owner access required';END IF;
 IF p_status IS NULL OR p_status NOT IN('All','New','In Progress','Resolved','Closed') OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 100
 OR (NOT p_owner AND p_member IS NOT NULL AND p_member<>actor)
 OR(p_cursor IS NOT NULL AND(jsonb_typeof(p_cursor)<>'object' OR length(p_cursor::text)>256 OR NOT p_cursor?'time' OR NOT p_cursor?'id'))
 THEN RAISE EXCEPTION 'Invalid support filters';END IF;
 WITH scope AS MATERIALIZED(SELECT r.*,l.name AS league_name FROM boff_dev_internal.support_requests r JOIN public.leagues l ON l.id=r.league_id WHERE p_owner OR r.user_id=actor),
 filtered AS(SELECT * FROM scope WHERE(p_league IS NULL OR league_id=p_league) AND(p_status='All' OR status=p_status) AND(p_member IS NULL OR user_id=p_member)),
 candidates AS MATERIALIZED(SELECT * FROM filtered WHERE p_cursor IS NULL OR(created_at,id)<((p_cursor->>'time')::timestamptz,(p_cursor->>'id')::uuid)
 ORDER BY created_at DESC,id DESC LIMIT p_size+1),
 page AS(SELECT * FROM candidates ORDER BY created_at DESC,id DESC LIMIT p_size)
 SELECT jsonb_build_object('requests',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'leagueId',league_id,'league',league_name,'name',requester_name,'team',team_name,
 'category',category,'preview',left(message,180),'status',status,'created',created_at,'updated',updated_at,'revision',revision) ORDER BY created_at DESC,id DESC) FROM page),'[]'),
 'next',CASE WHEN(SELECT count(*) FROM candidates)>p_size THEN(SELECT jsonb_build_object('time',created_at,'id',id) FROM page ORDER BY created_at ASC,id ASC LIMIT 1) ELSE NULL END,
 'count',(SELECT count(*) FROM filtered),'newCount',(SELECT count(*) FROM scope WHERE status='New'),
 'leagues',coalesce((SELECT jsonb_agg(jsonb_build_object('id',league_id,'name',name) ORDER BY name) FROM(SELECT league_id,max(league_name) AS name FROM scope GROUP BY league_id)x),'[]'),
 'members',coalesce((SELECT jsonb_agg(jsonb_build_object('id',user_id,'name',name) ORDER BY name) FROM(SELECT user_id,max(requester_name) AS name FROM scope WHERE p_league IS NULL OR league_id=p_league GROUP BY user_id)x),'[]')) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.dev_support_requests(boolean,uuid,text,uuid,jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_support_requests(boolean,uuid,text,uuid,jsonb,integer) TO authenticated;

CREATE FUNCTION public.dev_support_request(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=boff_dev_internal.require_verified_support();r boff_dev_internal.support_requests;owner boolean:=sportsbook_private.is_platform_owner();
BEGIN
 SELECT * INTO r FROM boff_dev_internal.support_requests WHERE id=p_id AND(owner OR user_id=actor);
 IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable';END IF;
 RETURN jsonb_build_object('id',r.id,'category',r.category,'message',r.message,'status',r.status,'revision',r.revision,'page',r.page,'created',r.created_at,
 'name',r.requester_name,'team',r.team_name,'league',(SELECT name FROM public.leagues WHERE id=r.league_id),'canManage',owner,
 'email',CASE WHEN owner THEN(SELECT email FROM auth.users WHERE id=r.user_id) ELSE NULL END,
 'updates',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'from',from_status,'to',to_status,'note',note,'created',created_at) ORDER BY created_at,id)
 FROM boff_dev_internal.support_updates WHERE request_id=r.id),'[]'));
END $$;
REVOKE ALL ON FUNCTION public.dev_support_request(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_support_request(uuid) TO authenticated;

CREATE FUNCTION public.dev_update_support(p_id uuid,p_revision integer,p_status text,p_note text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=boff_dev_internal.require_verified_support();r boff_dev_internal.support_requests;
BEGIN
 IF NOT sportsbook_private.is_platform_owner() THEN RAISE EXCEPTION 'Platform owner access required';END IF;
 IF p_status IS NULL OR p_status NOT IN('New','In Progress','Resolved','Closed') OR p_note IS NULL OR length(p_note)>1000 THEN RAISE EXCEPTION 'Invalid status update';END IF;
 SELECT * INTO r FROM boff_dev_internal.support_requests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable';END IF;
 IF p_revision IS DISTINCT FROM r.revision THEN RAISE EXCEPTION 'Request changed. Refresh before saving';END IF;
 IF p_status=r.status THEN RETURN public.dev_support_request(p_id);END IF;
 IF(SELECT count(*) FROM boff_dev_internal.support_updates WHERE request_id=p_id)>=100 THEN RAISE EXCEPTION 'Request update limit reached';END IF;
 UPDATE boff_dev_internal.support_requests SET status=p_status,revision=revision+1,updated_at=now() WHERE id=p_id;
 INSERT INTO boff_dev_internal.support_updates(request_id,actor_id,from_status,to_status,note) VALUES(p_id,actor,r.status,p_status,trim(p_note));
 RETURN public.dev_support_request(p_id);
END $$;
REVOKE ALL ON FUNCTION public.dev_update_support(uuid,integer,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_update_support(uuid,integer,text,text) TO authenticated;

CREATE FUNCTION public.dev_support_notice() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=boff_dev_internal.require_verified_support();
BEGIN
 IF NOT sportsbook_private.is_platform_owner() THEN RETURN jsonb_build_object('count',0);END IF;
 RETURN jsonb_build_object('count',(SELECT count(*) FROM boff_dev_internal.support_requests WHERE status='New'));
END $$;
REVOKE ALL ON FUNCTION public.dev_support_notice() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_support_notice() TO authenticated;
NOTIFY pgrst,'reload schema';
