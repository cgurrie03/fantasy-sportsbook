CREATE FUNCTION public.dev_revoke_member_invitation(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i boff_dev_internal.member_invitations;
BEGIN
 SELECT * INTO i FROM boff_dev_internal.member_invitations WHERE id=p_id FOR UPDATE;
 IF i.id IS NULL OR NOT boff_dev_internal.can_manage_members(i.league_id) THEN RAISE EXCEPTION 'Commissioner access required'; END IF;
 IF i.status<>'pending' THEN RAISE EXCEPTION 'Invitation is no longer pending'; END IF;
 UPDATE boff_dev_internal.member_invitations SET status='revoked' WHERE id=p_id;
 INSERT INTO public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value)
 VALUES(i.league_id,auth.uid(),'member_invitation','Commissioner canceled pending invitation',jsonb_build_object('invitation_id',i.id,'status','pending'),jsonb_build_object('invitation_id',i.id,'status','revoked'));
END $$;
REVOKE ALL ON FUNCTION public.dev_revoke_member_invitation(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_revoke_member_invitation(uuid) TO authenticated;
CREATE FUNCTION boff_dev_internal.audit_member_invitation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value)
 VALUES(NEW.league_id,NEW.issuer,'member_invitation',NEW.reason,'{}',jsonb_build_object('invitation_id',NEW.id,'team_id',NEW.team_id,'sleeper_id',NEW.sleeper_id,'expires_at',NEW.expires_at));
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.audit_member_invitation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER audit_member_invitation AFTER INSERT ON boff_dev_internal.member_invitations FOR EACH ROW EXECUTE FUNCTION boff_dev_internal.audit_member_invitation();
NOTIFY pgrst,'reload schema';
