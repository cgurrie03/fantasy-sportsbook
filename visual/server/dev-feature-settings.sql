DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;

CREATE TABLE boff_dev_internal.feature_settings (
 league_id uuid REFERENCES public.leagues(id), season integer, revision integer NOT NULL,
 settings jsonb NOT NULL, PRIMARY KEY(league_id,season)
);
ALTER TABLE boff_dev_internal.feature_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.feature_settings FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.dev_feature_settings(p_league uuid,p_season integer,p_revision integer DEFAULT NULL,p_settings jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE stored boff_dev_internal.feature_settings; team_count integer; season_now integer;
BEGIN
 IF auth.uid() IS NULL OR NOT (sportsbook_private.is_platform_owner() OR EXISTS(
  SELECT FROM public.league_memberships WHERE league_id=p_league AND user_id=auth.uid() AND role='admin'
 )) THEN RAISE EXCEPTION 'Commissioner access required'; END IF;
 SELECT nfl_season INTO STRICT season_now FROM public.leagues WHERE id=p_league;
 IF season_now IS DISTINCT FROM p_season THEN RAISE EXCEPTION 'Select the current season'; END IF;
 IF p_settings IS NOT NULL THEN
  SELECT count(*) INTO team_count FROM public.teams WHERE league_id=p_league;
  IF jsonb_typeof(p_settings)<>'object' OR octet_length(p_settings::text)>24000
   OR p_settings->>'schema' IS DISTINCT FROM '2'
   OR jsonb_typeof(p_settings->'rivals') IS DISTINCT FROM 'array'
   OR jsonb_typeof(p_settings->'plans') IS DISTINCT FROM 'object'
   OR jsonb_typeof(p_settings->'enabled') IS DISTINCT FROM 'object'
   OR jsonb_typeof(p_settings->'cutoffs') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'Invalid featured matchup settings'; END IF;
  IF jsonb_array_length(p_settings->'rivals')>team_count*3/2 OR EXISTS(
   SELECT FROM jsonb_array_elements(p_settings->'rivals') pair WHERE
    CASE WHEN jsonb_typeof(pair)<>'array' THEN true WHEN jsonb_array_length(pair)<>2 THEN true ELSE
     pair->>0=pair->>1 OR NOT EXISTS(SELECT FROM public.teams WHERE league_id=p_league AND id::text=pair->>0)
      OR NOT EXISTS(SELECT FROM public.teams WHERE league_id=p_league AND id::text=pair->>1) END
  ) OR EXISTS(
   SELECT FROM jsonb_array_elements(p_settings->'rivals') pair
   GROUP BY least(pair->>0,pair->>1),greatest(pair->>0,pair->>1) HAVING count(*)>1
  ) OR EXISTS(
   SELECT FROM jsonb_array_elements(p_settings->'rivals') pair CROSS JOIN LATERAL jsonb_array_elements_text(pair) team
   GROUP BY team HAVING count(*)>3
  ) THEN RAISE EXCEPTION 'Choose up to three unique rivals per team'; END IF;
  IF EXISTS(SELECT FROM jsonb_each(p_settings->'enabled') e WHERE jsonb_typeof(e.value)<>'boolean')
   OR EXISTS(SELECT FROM jsonb_each(p_settings->'cutoffs') c WHERE jsonb_typeof(c.value)<>'number')
   OR EXISTS(SELECT FROM jsonb_each(p_settings->'plans') w WHERE w.key !~ '^([1-9]|1[0-8])$'
    OR jsonb_typeof(w.value->'overrides') IS DISTINCT FROM 'object'
    OR jsonb_typeof(w.value->'playoffModes') IS DISTINCT FROM 'object')
  THEN RAISE EXCEPTION 'Invalid featured matchup rules'; END IF;
  IF EXISTS(
   SELECT FROM jsonb_each(p_settings->'plans') w CROSS JOIN LATERAL jsonb_each_text(w.value->'overrides') o
   WHERE o.key !~ '^([0-9]+|sleeper-[0-9]+-[0-9]+-[0-9]+)$'
    OR o.value NOT IN ('championship','playoff','rivalry','revenge','upset','streak','tank','game')
  ) OR EXISTS(
   SELECT FROM jsonb_each(p_settings->'plans') w CROSS JOIN LATERAL jsonb_each_text(w.value->'playoffModes') m
   WHERE m.value IS NULL OR m.value NOT IN ('auto','both','away-racing','home-racing')
  ) THEN RAISE EXCEPTION 'Invalid matchup preset'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('dev-feature-settings'),hashtext(p_league::text));
  SELECT * INTO stored FROM boff_dev_internal.feature_settings WHERE league_id=p_league AND season=p_season;
  IF p_revision IS DISTINCT FROM COALESCE(stored.revision,0) THEN RAISE EXCEPTION 'Settings changed. Reopen the tab and try again.'; END IF;
  IF stored.settings IS DISTINCT FROM p_settings THEN
   INSERT INTO boff_dev_internal.feature_settings VALUES(p_league,p_season,coalesce(stored.revision,0)+1,p_settings)
   ON CONFLICT(league_id,season) DO UPDATE SET revision=excluded.revision,settings=excluded.settings RETURNING * INTO stored;
   UPDATE public.dev_live_cache SET next_refresh_at=now() WHERE key='nfl' OR key=(SELECT 'league:'||sleeper_league_id FROM public.leagues WHERE id=p_league);
   PERFORM boff_dev_internal.request_live_refresh();
  END IF;
 ELSE
  SELECT * INTO stored FROM boff_dev_internal.feature_settings WHERE league_id=p_league AND season=p_season;
 END IF;
 RETURN jsonb_build_object('revision',coalesce(stored.revision,0),'settings',stored.settings);
END $$;
REVOKE ALL ON FUNCTION public.dev_feature_settings(uuid,integer,integer,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.dev_feature_settings(uuid,integer,integer,jsonb) TO authenticated;
CREATE FUNCTION boff_dev_internal.apply_feature_settings(
 league uuid, season integer, quotes jsonb, teams jsonb, week integer, regular_weeks integer, max_boost integer, playoff_spots integer
) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
WITH config AS (
 SELECT coalesce((SELECT settings FROM boff_dev_internal.feature_settings s WHERE s.league_id=league AND s.season=apply_feature_settings.season),'{}') settings
), team_rows AS (
 SELECT t.*,row_number() OVER (ORDER BY (wins+.5*ties)/greatest(games,1) DESC,"pointsFor" DESC,id) seed
 FROM jsonb_to_recordset(teams) t(id text,roster_id integer,wins numeric,ties numeric,games numeric,"pointsFor" numeric,streak text,matchup_id text)
), facts AS (
 SELECT q->>'matchup_key' matchup,a.id away,h.id home,a.seed away_seed,h.seed home_seed,
  a.wins+.5*a.ties away_wins,h.wins+.5*h.ties home_wins,
  (a.wins+h.wins+.5*(a.ties+h.ties))/greatest(1,a.games+h.games) win_rate,a."pointsFor"+h."pointsFor" points,
  (q->>'away_projection')::numeric away_projection,(q->>'home_projection')::numeric home_projection,
  (q->>'line')::numeric total,
  coalesce(substring(a.streak from '^([0-9]+)W$')::integer,substring(a.streak from '^W([0-9]+)$')::integer,0) away_streak,
  coalesce(substring(h.streak from '^([0-9]+)W$')::integer,substring(h.streak from '^W([0-9]+)$')::integer,0) home_streak,
  'sleeper-'||week||'-'||least(a.roster_id,h.roster_id)||'-'||greatest(a.roster_id,h.roster_id) pair_key
 FROM jsonb_array_elements(quotes) q
 JOIN team_rows a ON a.id=q->>'away_team_id' JOIN team_rows h ON h.id=q->>'home_team_id'
 WHERE q->>'kind'='match_total' AND q->>'side'='over' AND (q->'metadata'->>'alternate') IS DISTINCT FROM 'true'
), ranked AS (
 SELECT f.*,abs(away_projection-home_projection) spread,
  count(*) OVER ()/2 cap,
  coalesce((f.win_rate-min(f.win_rate) OVER w)/nullif(max(f.win_rate) OVER w-min(f.win_rate) OVER w,0),.5)*.50
  +coalesce((f.points-min(f.points) OVER w)/nullif(max(f.points) OVER w-min(f.points) OVER w,0),.5)*.25
  +(1-coalesce((abs(away_projection-home_projection)-min(abs(away_projection-home_projection)) OVER w)/nullif(max(abs(away_projection-home_projection)) OVER w-min(abs(away_projection-home_projection)) OVER w,0),.5))*.15
  +coalesce((f.total-min(f.total) OVER w)/nullif(max(f.total) OVER w-min(f.total) OVER w,0),.5)*.10 rating,
  CASE WHEN away_projection<home_projection THEN away WHEN home_projection<away_projection THEN home END underdog,
  settings,settings->'plans'->week::text plan
 FROM facts f CROSS JOIN config WINDOW w AS ()
), contexts AS (
 SELECT r.*,prior.margin,
  (SELECT wins+.5*ties FROM team_rows WHERE seed=playoff_spots) cutoff_wins,
  (SELECT count(*) FROM team_rows) league_size,
  coalesce(plan->'overrides'->pair_key,plan->'overrides'->matchup) override,
  coalesce(plan->'playoffModes'->>pair_key,plan->'playoffModes'->>matchup,'auto') playoff_mode,
  c.payload->'featureFinalists' finalists,
  c.payload->'rewardEvidence' IS NOT NULL playoff_evidence,
  coalesce(c.payload->'rewardEvidence'->'clinchWeeks','{}') clinched,
  coalesce(c.payload->'rewardEvidence'->'eliminationWeeks','{}') eliminated
 FROM ranked r
 LEFT JOIN public.leagues l ON l.id=league
 LEFT JOIN public.dev_live_cache c ON c.key='league:'||l.sleeper_league_id
 LEFT JOIN LATERAL (
  SELECT (w.results->r.away->>'points')::numeric-(w.results->r.home->>'points')::numeric margin
  FROM public.league_result_weeks w WHERE w.league_id=league AND w.nfl_season=season AND w.final AND w.market_week<week
   AND w.results->r.away->>'matchup_id'=w.results->r.home->>'matchup_id'
  ORDER BY w.market_week DESC LIMIT 1
 ) prior ON true
), candidates AS (
 SELECT c.*, rules.*,
  (SELECT roster_id::text FROM team_rows WHERE id=c.away) away_roster,
  (SELECT roster_id::text FROM team_rows WHERE id=c.home) home_roster
 FROM contexts c CROSS JOIN LATERAL (SELECT
  coalesce((settings->'cutoffs'->>'playoffGap')::numeric,1) playoff_gap,
  coalesce((settings->'cutoffs'->>'streakWins')::numeric,5) streak_goal
 ) rules
), choices AS (
 SELECT c.*, choice.kind,choice.priority
 FROM candidates c CROSS JOIN LATERAL (
  SELECT kind,priority FROM (VALUES
   ('championship',1,finalists @> jsonb_build_array(away_roster::integer,home_roster::integer)),
   ('playoff',2,playoff_evidence AND week>=regular_weeks-coalesce((settings->'cutoffs'->>'playoffWeeks')::integer,4)+1 AND
     (NOT (clinched ? away_roster OR eliminated ? away_roster) AND abs(away_wins-cutoff_wins)<=playoff_gap
      OR NOT (clinched ? home_roster OR eliminated ? home_roster) AND abs(home_wins-cutoff_wins)<=playoff_gap)),
   ('rivalry',3,EXISTS(SELECT FROM jsonb_array_elements(coalesce(settings->'rivals','[]')) pair WHERE pair @> jsonb_build_array(away,home))),
   ('revenge',4,margin<>0 AND abs(margin)<=coalesce((settings->'cutoffs'->>'revengeMargin')::numeric,10)),
   ('upset',5,underdog IS NOT NULL AND week>=coalesce((settings->'cutoffs'->>'upsetStart')::integer,4)
    AND (CASE WHEN underdog=away THEN away_seed ELSE home_seed END)>floor(league_size*coalesce((settings->'cutoffs'->>'upsetOutside')::numeric,50)/100)
    AND (CASE WHEN underdog=away THEN home_seed ELSE away_seed END)<=ceil(league_size*coalesce((settings->'cutoffs'->>'upsetTop')::numeric,25)/100)
    AND spread*100/greatest(.1,away_projection,home_projection)<=coalesce((settings->'cutoffs'->>'upsetGap')::numeric,10)),
   ('streak',6,greatest(away_streak,home_streak)>=streak_goal),
   ('tank',7,week>=coalesce((settings->'cutoffs'->>'tankStart')::integer,regular_weeks/2+1) AND
    round(win_rate*100,1)<=coalesce((settings->'cutoffs'->>'tankPct')::numeric,33.3) AND least(away_seed,home_seed)>playoff_spots),
   ('game',8,true)
  ) kinds(kind,priority,eligible)
  WHERE CASE WHEN override IS NOT NULL THEN override #>> '{}' = kind
    ELSE week<=regular_weeks AND eligible AND coalesce((settings->'enabled'->>kind)::boolean,true) END
  AND (kind<>'revenge' OR margin<>0) AND (kind<>'upset' OR underdog IS NOT NULL)
  ORDER BY priority LIMIT 1
 ) choice
), capped AS (
 SELECT *,count(*) FILTER(WHERE override IS NULL AND kind<>'rivalry') OVER (ORDER BY priority,rating DESC,matchup) slot,
  row_number() OVER (PARTITION BY kind,(override IS NULL) ORDER BY rating DESC,matchup) kind_slot
 FROM choices
), features AS (
 SELECT *,CASE kind WHEN 'game' THEN 'Game of the Week' WHEN 'tank' THEN 'Tank Bowl'
  WHEN 'rivalry' THEN 'Rivalry' WHEN 'upset' THEN 'Upset Watch' WHEN 'revenge' THEN 'Revenge Game'
  WHEN 'streak' THEN 'Streak Breaker' WHEN 'championship' THEN 'Championship Rematch' ELSE 'Playoff Race' END label
 FROM capped WHERE override IS NOT NULL OR kind='rivalry' OR (slot<=cap AND (kind<>'game' OR kind_slot=1))
)
SELECT jsonb_agg(q || jsonb_build_object('featured',CASE WHEN ok THEN f.label ELSE '' END,
 'boost_pct',CASE WHEN ok THEN least(max_boost,CASE f.kind WHEN 'championship' THEN 50 WHEN 'game' THEN 25 WHEN 'tank' THEN 25 WHEN 'streak' THEN 25 ELSE 35 END) ELSE 0 END,
 'metadata',coalesce(q->'metadata','{}') || CASE WHEN ok THEN jsonb_build_object('feature_source',CASE WHEN f.override IS NULL THEN 'Automatic' ELSE 'Commissioner' END) ELSE '{}'::jsonb END) ORDER BY ord)
FROM jsonb_array_elements(quotes) WITH ORDINALITY item(q,ord)
LEFT JOIN features f ON f.matchup=q->>'matchup_key'
CROSS JOIN LATERAL (SELECT max_boost>0 AND f.kind IS NOT NULL AND (q->'metadata'->>'alternate') IS DISTINCT FROM 'true' AND (
 CASE WHEN f.kind='tank' THEN q->>'kind'='match_total' AND q->>'side'='over'
 ELSE q->>'kind'='moneyline' AND CASE f.kind
  WHEN 'upset' THEN q->>'team_id'=f.underdog
  WHEN 'revenge' THEN q->>'team_id'=CASE WHEN f.margin<0 THEN f.away ELSE f.home END
  WHEN 'streak' THEN CASE WHEN greatest(f.away_streak,f.home_streak)<f.streak_goal
    THEN q->>'team_id'=CASE WHEN f.away_streak>=f.home_streak THEN f.home ELSE f.away END
    ELSE (f.away_streak>=f.streak_goal AND q->>'team_id'=f.home) OR (f.home_streak>=f.streak_goal AND q->>'team_id'=f.away) END
  WHEN 'playoff' THEN CASE f.playoff_mode WHEN 'away-racing' THEN q->>'team_id'=f.home WHEN 'home-racing' THEN q->>'team_id'=f.away WHEN 'both' THEN true
    ELSE CASE WHEN (NOT (f.clinched ? f.away_roster OR f.eliminated ? f.away_roster) AND abs(f.away_wins-f.cutoff_wins)<=f.playoff_gap)
      AND (NOT (f.clinched ? f.home_roster OR f.eliminated ? f.home_roster) AND abs(f.home_wins-f.cutoff_wins)<=f.playoff_gap) THEN true
      WHEN NOT (f.clinched ? f.away_roster OR f.eliminated ? f.away_roster) AND abs(f.away_wins-f.cutoff_wins)<=f.playoff_gap THEN q->>'team_id'=f.home
      WHEN NOT (f.clinched ? f.home_roster OR f.eliminated ? f.home_roster) AND abs(f.home_wins-f.cutoff_wins)<=f.playoff_gap THEN q->>'team_id'=f.away
      ELSE false END END
  ELSE true END END)) eligible(ok)
$$;
REVOKE ALL ON FUNCTION boff_dev_internal.apply_feature_settings(uuid,integer,jsonb,jsonb,integer,integer,integer,integer) FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.sportsbook_markets DROP CONSTRAINT sportsbook_markets_featured_check;
ALTER TABLE public.sportsbook_markets ADD CONSTRAINT sportsbook_markets_featured_check
 CHECK(featured IN ('','Game of the Week','Tank Bowl','Championship Rematch','Playoff Race','Rivalry','Revenge Game','Upset Watch','Streak Breaker'));

DO $$ DECLARE body text; anchor text; BEGIN
 SELECT pg_get_functiondef('sportsbook_private.check_policy_quote(public.sportsbook_markets)'::regprocedure) INTO body;
 anchor:=' if coalesce(q.metadata';
 IF strpos(body,anchor)=0 THEN RAISE EXCEPTION 'Policy guard definition changed'; END IF;
 EXECUTE replace(body,anchor, $rule$
 IF b.board_type='weekly' AND q.featured IN ('Championship Rematch','Playoff Race','Rivalry','Revenge Game','Upset Watch','Streak Breaker')
 AND q.kind='moneyline' THEN expected:=least((v->>'featured_boost_pct')::integer,
  CASE q.featured WHEN 'Championship Rematch' THEN 50 WHEN 'Streak Breaker' THEN 25 ELSE 35 END); END IF;
 IF b.board_type='weekly' AND q.featured IN ('Game of the Week','Tank Bowl') THEN expected:=least(expected,25); END IF;
 $rule$||anchor);
 SELECT pg_get_functiondef('public.publish_dev_book(uuid,jsonb)'::regprocedure) INTO body;
 anchor:='boff_dev_internal.feature_weekly_quotes(';
 IF strpos(body,anchor)=0 THEN RAISE EXCEPTION 'Publisher definition changed'; END IF;
 EXECUTE replace(body,anchor,'boff_dev_internal.apply_feature_settings(p_league,(p_book->>''season'')::integer,');
END $$;
NOTIFY pgrst,'reload schema';
