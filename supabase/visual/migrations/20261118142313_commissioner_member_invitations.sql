DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' <> 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;
CREATE TABLE boff_dev_internal.member_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid UNIQUE NOT NULL,
 league_id uuid NOT NULL REFERENCES public.leagues(id), team_id uuid NOT NULL REFERENCES public.teams(id),
 sleeper_id text NOT NULL, co_manager boolean NOT NULL, expected uuid, email text NOT NULL,
 token_digest text UNIQUE NOT NULL CHECK(token_digest ~ '^[a-f0-9]{64}$'),
 issuer uuid NOT NULL REFERENCES auth.users(id), reason text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked')),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 account_id uuid REFERENCES auth.users(id), captured_at timestamptz,
 CHECK(length(email)<=254), CHECK(length(reason) BETWEEN 8 AND 400)
);
CREATE INDEX member_invitations_league_pending ON boff_dev_internal.member_invitations(league_id,status,created_at DESC);
ALTER TABLE boff_dev_internal.member_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.member_invitations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.dev_prepare_member_invitation(p_league uuid,p_team uuid,p_sleeper text,p_co boolean,p_expected uuid,p_email text,p_reason text,p_request uuid,p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE invitation boff_dev_internal.member_invitations; target jsonb; linked uuid; account auth.users; team public.teams;
BEGIN
 IF NOT boff_dev_internal.can_manage_members(p_league) THEN RAISE EXCEPTION 'Commissioner access required'; END IF;
 IF p_request IS NULL OR p_co IS NULL OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$'
 OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 400 OR length(trim(coalesce(p_email,''))) NOT BETWEEN 3 AND 254
 OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('member-invite:'||p_league,0));
 DELETE FROM boff_dev_internal.member_invitations WHERE expires_at<now()-interval '30 days';
 SELECT * INTO team FROM public.teams WHERE id=p_team AND league_id=p_league;
 SELECT value INTO target FROM public.dev_live_cache c CROSS JOIN LATERAL jsonb_array_elements(c.payload->'metadata'->'teams')
 WHERE c.key=(SELECT 'league:'||sleeper_league_id FROM public.leagues WHERE id=p_league) AND (value->>'rosterId')::integer=team.roster_id;
 IF target IS NULL OR (NOT p_co AND target->>'ownerId' IS DISTINCT FROM p_sleeper)
 OR (p_co AND NOT EXISTS(SELECT FROM jsonb_array_elements(target->'coManagers') m WHERE m->>'id'=p_sleeper))
 THEN RAISE EXCEPTION 'Sleeper manager changed. Refresh the member list'; END IF;
 IF p_co THEN SELECT user_id INTO linked FROM boff_dev_internal.co_manager_links WHERE league_id=p_league AND team_id=p_team AND sleeper_user_id=p_sleeper;
 ELSE SELECT id INTO linked FROM public.league_memberships WHERE league_id=p_league AND team_id=p_team;
 END IF;
 IF linked IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Member mapping changed. Refresh before inviting'; END IF;
 IF NOT p_co AND EXISTS(SELECT FROM public.league_memberships WHERE id=linked AND role='admin') THEN RAISE EXCEPTION 'Commissioner replacement needs platform owner review'; END IF;
 SELECT * INTO invitation FROM boff_dev_internal.member_invitations WHERE request_id=p_request;
 IF FOUND THEN
  IF invitation.issuer<>auth.uid() OR invitation.league_id<>p_league OR invitation.team_id<>p_team OR invitation.sleeper_id<>p_sleeper
   OR invitation.co_manager<>p_co OR invitation.email<>lower(trim(p_email)) OR invitation.expected IS DISTINCT FROM p_expected
   OR invitation.token_digest<>p_digest OR invitation.reason<>trim(p_reason) THEN RAISE EXCEPTION 'Invitation request already used'; END IF;
 ELSE
  IF EXISTS(SELECT FROM boff_dev_internal.member_invitations WHERE league_id=p_league AND sleeper_id=p_sleeper AND created_at>now()-interval '60 seconds')
   OR (SELECT count(*) FROM boff_dev_internal.member_invitations WHERE league_id=p_league AND issuer=auth.uid() AND created_at>now()-interval '1 day')>=32
   THEN RAISE EXCEPTION 'Invitation limit reached. Wait before trying again'; END IF;
  UPDATE boff_dev_internal.member_invitations SET status='revoked' WHERE league_id=p_league AND team_id=p_team AND sleeper_id=p_sleeper AND status='pending';
  INSERT INTO boff_dev_internal.member_invitations(request_id,league_id,team_id,sleeper_id,co_manager,expected,email,token_digest,issuer,reason)
  VALUES(p_request,p_league,p_team,p_sleeper,p_co,p_expected,lower(trim(p_email)),p_digest,auth.uid(),trim(p_reason)) RETURNING * INTO invitation;
 END IF;
 SELECT * INTO account FROM auth.users WHERE lower(email)=invitation.email AND deleted_at IS NULL;
 RETURN jsonb_build_object('id',invitation.id,'leagueId',p_league,'leagueName',(SELECT name FROM public.leagues WHERE id=p_league),
  'teamName',team.team_name,'coManager',p_co,'email',invitation.email,'accountId',account.id,'verified',account.email_confirmed_at IS NOT NULL,
  'leagueAvatar',(SELECT c.payload->'metadata'->>'avatar' FROM public.dev_live_cache c WHERE c.key=(SELECT 'league:'||sleeper_league_id FROM public.leagues WHERE id=p_league)),
  'teamAvatar',target->>'avatar','expires',invitation.expires_at,'captured',invitation.captured_at IS NOT NULL,'status',invitation.status);
END $$;

CREATE FUNCTION public.dev_pending_member_invitations(p_league uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT boff_dev_internal.can_manage_members(p_league) THEN RAISE EXCEPTION 'Commissioner access required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'teamId',i.team_id,'team',t.team_name,'sleeperId',i.sleeper_id,
 'coManager',i.co_manager,'expected',i.expected,'email',i.email,'expires',i.expires_at,'captured',i.captured_at IS NOT NULL) ORDER BY i.created_at DESC)
 FROM boff_dev_internal.member_invitations i JOIN public.teams t ON t.id=i.team_id WHERE i.league_id=p_league AND i.status='pending' AND i.expires_at>now()),'[]');
END $$;

CREATE FUNCTION public.dev_capture_member_invitation(p_id uuid,p_digest text,p_account uuid,p_subject text,p_html text,p_text text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i boff_dev_internal.member_invitations; verified boolean;
BEGIN
 SELECT * INTO i FROM boff_dev_internal.member_invitations WHERE id=p_id AND token_digest=p_digest FOR UPDATE;
 IF i.id IS NULL OR i.status<>'pending' OR i.expires_at<=now() THEN RAISE EXCEPTION 'Invitation expired or revoked'; END IF;
 IF NOT EXISTS(SELECT FROM auth.users WHERE id=p_account AND lower(email)=i.email AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Recipient identity changed'; END IF;
 IF length(p_subject)>300 OR octet_length(p_html)>96000 OR octet_length(p_text)>16000 THEN RAISE EXCEPTION 'Invalid invitation email'; END IF;
 SELECT email_confirmed_at IS NOT NULL INTO verified FROM auth.users WHERE id=p_account;
 INSERT INTO boff_dev_internal.notification_capture(league_id,user_id,event_key,kind,subject,html,plain_text)
 VALUES(i.league_id,p_account,'invitation:'||i.id,CASE WHEN verified THEN 'invite-existing' ELSE 'invite-new' END,p_subject,p_html,p_text)
 ON CONFLICT DO NOTHING;
 UPDATE boff_dev_internal.member_invitations SET captured_at=coalesce(captured_at,now()),account_id=p_account WHERE id=i.id;
END $$;

CREATE FUNCTION public.dev_accept_member_invitation(p_token text,p_accept boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i boff_dev_internal.member_invitations; account auth.users; original_claims text; result jsonb;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invitation unavailable'; END IF;
 SELECT * INTO account FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL AND deleted_at IS NULL AND coalesce(banned_until,'-infinity')<=now();
 IF account.id IS NULL THEN RAISE EXCEPTION 'Verify your email and sign in first'; END IF;
 SELECT * INTO i FROM boff_dev_internal.member_invitations WHERE token_digest=encode(sha256(convert_to(p_token,'UTF8')),'hex') FOR UPDATE;
 IF i.id IS NULL OR i.email<>lower(account.email) THEN RAISE EXCEPTION 'Sign in with the email address that received this invitation'; END IF;
 IF i.status='revoked' OR i.expires_at<=now() THEN RAISE EXCEPTION 'Invitation expired or revoked. Ask your commissioner to resend'; END IF;
 IF i.status='accepted' AND NOT EXISTS(SELECT FROM boff_dev_internal.participant_links WHERE league_id=i.league_id AND user_id=account.id AND team_id=i.team_id)
 THEN RAISE EXCEPTION 'League access has been revoked'; END IF;
 IF NOT EXISTS(SELECT FROM public.league_memberships m WHERE m.league_id=i.league_id AND m.user_id=i.issuer AND m.role='admin')
  AND NOT EXISTS(SELECT FROM sportsbook_private.platform_owners WHERE user_id=i.issuer) THEN RAISE EXCEPTION 'Commissioner must review this invitation'; END IF;
 IF p_accept AND i.status='pending' THEN
  UPDATE boff_dev_internal.member_invitations SET status='accepted' WHERE id=i.id;
  original_claims:=current_setting('request.jwt.claims',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',i.issuer,'role','authenticated')::text,true);
  IF i.co_manager THEN result:=public.dev_change_co_manager(i.league_id,i.team_id,i.sleeper_id,i.expected,i.email,i.reason);
  ELSE result:=public.dev_change_commissioner_member(i.league_id,i.team_id,i.expected,i.email,i.reason);
  END IF;
  PERFORM set_config('request.jwt.claims',coalesce(original_claims,''),true);
 END IF;
 RETURN jsonb_build_object('league',(SELECT name FROM public.leagues WHERE id=i.league_id),'team',(SELECT team_name FROM public.teams WHERE id=i.team_id),
  'leaguePath',(SELECT '/'||sleeper_league_id||'/matchups' FROM public.leagues WHERE id=i.league_id),'accepted',p_accept OR i.status='accepted');
END $$;

CREATE FUNCTION boff_dev_internal.revoke_pending_member_invitations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='league_memberships' THEN
  UPDATE boff_dev_internal.member_invitations SET status='revoked' WHERE league_id=coalesce(NEW.league_id,OLD.league_id) AND team_id=coalesce(NEW.team_id,OLD.team_id) AND NOT co_manager AND status='pending';
 ELSE
  UPDATE boff_dev_internal.member_invitations SET status='revoked' WHERE league_id=coalesce(NEW.league_id,OLD.league_id) AND team_id=coalesce(NEW.team_id,OLD.team_id) AND sleeper_id=coalesce(NEW.sleeper_user_id,OLD.sleeper_user_id) AND status='pending';
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER invalidate_pending_primary_invites AFTER INSERT OR UPDATE OR DELETE ON public.league_memberships FOR EACH ROW EXECUTE FUNCTION boff_dev_internal.revoke_pending_member_invitations();
CREATE TRIGGER invalidate_pending_co_invites AFTER INSERT OR UPDATE OR DELETE ON boff_dev_internal.co_manager_links FOR EACH ROW EXECUTE FUNCTION boff_dev_internal.revoke_pending_member_invitations();

REVOKE ALL ON FUNCTION public.dev_prepare_member_invitation(uuid,uuid,text,boolean,uuid,text,text,uuid,text),public.dev_pending_member_invitations(uuid),public.dev_accept_member_invitation(text,boolean),public.dev_capture_member_invitation(uuid,text,uuid,text,text,text),boff_dev_internal.revoke_pending_member_invitations() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_prepare_member_invitation(uuid,uuid,text,boolean,uuid,text,text,uuid,text),public.dev_pending_member_invitations(uuid),public.dev_accept_member_invitation(text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dev_capture_member_invitation(uuid,text,uuid,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
