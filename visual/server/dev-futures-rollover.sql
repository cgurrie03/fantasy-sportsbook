DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Dev only'; END IF;
END $$;

CREATE FUNCTION boff_dev_internal.apply_futures_season_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 wallet public.user_wallets;
 carry numeric;
 target numeric;
 event text;
BEGIN
 IF NEW.board_type<>'future' THEN
  IF NEW.status='published' AND EXISTS(
    SELECT FROM public.sportsbook_boards b JOIN public.sportsbook_markets m ON m.board_id=b.id
    WHERE b.league_id=NEW.league_id AND b.nfl_season=NEW.nfl_season AND b.board_type='future'
      AND m.kind='future_champion' AND m.metadata->>'dev_futures'='true' AND m.metadata->>'resolved'='true'
  ) THEN
   RAISE EXCEPTION 'Fantasy playoffs have ended. This betting season is paused';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.status='closed' AND EXISTS(
   SELECT FROM public.sportsbook_markets m WHERE m.board_id=NEW.id AND m.kind='future_champion'
    AND m.metadata->>'dev_futures'='true' AND m.metadata->>'resolved'='true'
 ) THEN
  UPDATE public.sportsbook_boards SET status='closed',quote_valid_until=clock_timestamp()
   WHERE league_id=NEW.league_id AND nfl_season=NEW.nfl_season AND board_type='weekly' AND status='published';
  RETURN NEW;
 END IF;
 IF NEW.status<>'published' OR NOT EXISTS(
  SELECT FROM public.sportsbook_boards WHERE league_id=NEW.league_id AND nfl_season=NEW.nfl_season-1 AND board_type='future'
 ) THEN RETURN NEW; END IF;
 IF EXISTS(SELECT FROM public.tickets WHERE league_id=NEW.league_id AND nfl_season=NEW.nfl_season-1 AND status='OPEN') THEN
  RAISE EXCEPTION 'Resolve prior-season tickets before opening the new season';
 END IF;
 FOR wallet IN SELECT w.* FROM public.user_wallets w WHERE w.league_id=NEW.league_id AND w.status='approved'
  AND w.balance IS NOT NULL AND EXISTS (SELECT FROM public.league_memberships m WHERE m.league_id=w.league_id AND m.user_id=w.user_id)
  ORDER BY w.id FOR UPDATE OF w
 LOOP
  event:='season-opening:'||NEW.nfl_season||':'||wallet.id;
  IF EXISTS(SELECT FROM public.user_wallet_entries e WHERE e.wallet_id=wallet.id AND e.event_key=event) THEN CONTINUE; END IF;
  SELECT COALESCE(sum(actual_payout),0) INTO carry FROM public.tickets
   WHERE league_id=NEW.league_id AND nfl_season=NEW.nfl_season-1 AND user_wallet_id=wallet.id
    AND status='WON' AND ticket_type='future';
  target:=100+carry;
  INSERT INTO public.user_wallet_entries(wallet_id,league_id,team_id,event_key,kind,amount,balance_before,balance_after,reason,metadata)
  VALUES(wallet.id,wallet.league_id,wallet.team_id,event,'adjustment',target-wallet.balance,wallet.balance,target,
   'Season starting balance and futures winnings',jsonb_build_object('season',NEW.nfl_season,'startingBalance',100,'futuresPayout',carry));
  UPDATE public.user_wallets SET balance=target,updated_at=clock_timestamp() WHERE id=wallet.id;
  DELETE FROM boff_dev_internal.credit_claim_state WHERE wallet_id=wallet.id;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.apply_futures_season_transition() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER dev_futures_season_transition BEFORE UPDATE OF status ON public.sportsbook_boards
 FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
 EXECUTE FUNCTION boff_dev_internal.apply_futures_season_transition();

CREATE FUNCTION boff_dev_internal.schedule_futures_rule_refresh() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.dev_live_cache c SET payload=c.payload-'futuresAt'
 FROM public.leagues l WHERE l.id=NEW.league_id AND c.key='league:'||l.sleeper_league_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.schedule_futures_rule_refresh() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER schedule_futures_rule_refresh AFTER INSERT ON boff_dev_internal.futures_rule_versions
 FOR EACH ROW EXECUTE FUNCTION boff_dev_internal.schedule_futures_rule_refresh();
