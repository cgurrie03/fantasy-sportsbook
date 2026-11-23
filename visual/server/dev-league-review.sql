BEGIN;
DO $$
BEGIN
  IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN
    RAISE EXCEPTION 'Development project required';
  END IF;
END
$$;
CREATE FUNCTION public.dev_league_review_members(p_league uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT sportsbook_private.is_platform_owner() THEN
    RAISE EXCEPTION 'Platform owner access required';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', member.id, 'name', member.display_name, 'teamId', member.team_id,
      'teamName', team.team_name, 'lastSignIn', account.last_sign_in_at,
      'balance', wallet.balance, 'hasAccount', member.user_id IS NOT NULL
    ) ORDER BY member.display_name, member.id)
    FROM public.league_memberships member
    JOIN public.teams team ON team.league_id = member.league_id AND team.id = member.team_id
    LEFT JOIN auth.users account ON account.id = member.user_id
    LEFT JOIN public.user_wallets wallet ON wallet.league_id = member.league_id
      AND wallet.user_id = member.user_id AND wallet.status = 'approved'
    WHERE member.league_id = p_league
  ), '[]'::jsonb);
END
$$;
REVOKE ALL ON FUNCTION public.dev_league_review_members(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.dev_league_review_members(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
