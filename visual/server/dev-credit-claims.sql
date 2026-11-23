BEGIN;

DO $$
BEGIN
  IF public.application_environment_identity()->>'project_ref'
     IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN
    RAISE EXCEPTION 'Development project required';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS boff_dev_internal.credit_claim_state (
  wallet_id uuid PRIMARY KEY REFERENCES public.user_wallets(id),
  last_claim_at timestamptz NOT NULL
);
ALTER TABLE boff_dev_internal.credit_claim_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.credit_claim_state FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dev_credit_claim(p_league uuid, p_request uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  wallet public.user_wallets;
  last_claim timestamptz;
  claim_time timestamptz;
  weekly_refresh_at timestamptz;
  local_claim_time timestamp;
  open_weekly numeric;
  open_futures numeric;
  claim_amount integer;
  previous_amount numeric;
  eligibility numeric;
BEGIN
  IF public.application_environment_identity()->>'project_ref'
     IS DISTINCT FROM 'whlcnlacueweaqpsupqs' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Development sign-in required';
  END IF;

  SELECT w.* INTO wallet FROM public.user_wallets w
  WHERE w.league_id = p_league AND w.user_id = auth.uid()
    AND w.status = 'approved' AND w.balance IS NOT NULL
    AND EXISTS (
      SELECT FROM public.league_memberships m
      WHERE m.league_id = w.league_id AND m.user_id = w.user_id
    )
  FOR UPDATE OF w;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved league wallet required'; END IF;

  SELECT COALESCE(sum(stake) FILTER (WHERE ticket_type IS DISTINCT FROM 'future'), 0),
         COALESCE(sum(stake) FILTER (WHERE ticket_type = 'future'), 0)
  INTO open_weekly, open_futures
  FROM public.tickets
  WHERE user_wallet_id = wallet.id AND status = 'OPEN';

  SELECT last_claim_at INTO last_claim
  FROM boff_dev_internal.credit_claim_state WHERE wallet_id = wallet.id;

  claim_time := clock_timestamp();
  local_claim_time := claim_time AT TIME ZONE 'America/New_York';
  weekly_refresh_at := (
    date_trunc('week', local_claim_time - interval '2 days 6 hours')
    + interval '2 days 6 hours'
  ) AT TIME ZONE 'America/New_York';
  eligibility := wallet.balance + open_weekly;
  claim_amount := CASE
    WHEN eligibility >= 100 THEN 0
    WHEN last_claim IS NULL OR last_claim < weekly_refresh_at
      OR claim_time >= last_claim + interval '24 hours' THEN 50
    WHEN claim_time >= last_claim + interval '2 hours' THEN 10
    ELSE 0 END;

  IF p_request IS NOT NULL THEN
    SELECT amount INTO previous_amount FROM public.user_wallet_entries
    WHERE wallet_id = wallet.id AND event_key = 'credit-claim:' || p_request;
    IF previous_amount IS NULL THEN
      IF claim_amount = 0 THEN RAISE EXCEPTION 'A credit claim is unavailable'; END IF;
      INSERT INTO public.user_wallet_entries (
        wallet_id, league_id, team_id, event_key, kind, amount,
        balance_before, balance_after, reason, created_at
      ) VALUES (
        wallet.id, wallet.league_id, wallet.team_id, 'credit-claim:' || p_request,
        'adjustment', claim_amount, wallet.balance, wallet.balance + claim_amount,
        'Free credit claim', claim_time
      );
      UPDATE public.user_wallets
      SET balance = balance + claim_amount, updated_at = claim_time WHERE id = wallet.id
      RETURNING * INTO wallet;
      INSERT INTO boff_dev_internal.credit_claim_state (wallet_id, last_claim_at)
      VALUES (wallet.id, claim_time)
      ON CONFLICT (wallet_id) DO UPDATE SET last_claim_at = EXCLUDED.last_claim_at;
      last_claim := claim_time;
      eligibility := wallet.balance + open_weekly;
      previous_amount := claim_amount;
      claim_amount := 0;
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'balance', wallet.balance, 'openNonFutures', open_weekly, 'openFutures', open_futures,
    'available', claim_amount, 'claimed', previous_amount, 'eligibleBalance', eligibility,
    'lastClaimAt', last_claim, 'serverTime', claim_time,
    'nextWeeklyRefreshAt', ((weekly_refresh_at AT TIME ZONE 'America/New_York') + interval '1 week')
      AT TIME ZONE 'America/New_York'
  );
END
$$;

REVOKE ALL ON FUNCTION public.dev_credit_claim(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.dev_credit_claim(uuid, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
