CREATE OR REPLACE FUNCTION boff_dev_internal.feature_weekly_quotes(
 p_quotes jsonb, p_teams jsonb, p_week integer, p_regular_weeks integer, p_boost integer, p_playoff_teams integer
) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 WITH teams AS (
  SELECT t.*, rank() OVER (
   ORDER BY (wins + 0.5*ties)/greatest(1,games) DESC,
    "pointsFor" DESC, "pointsAgainst" DESC
  ) AS standing
  FROM jsonb_to_recordset(p_teams) AS t(
   id uuid, wins numeric, ties numeric, games numeric, "pointsFor" numeric, "pointsAgainst" numeric
  )
 ), matchups AS (
  SELECT quote->>'matchup_key' AS matchup,
   (a.wins + h.wins + 0.5*(a.ties+h.ties))/greatest(1,a.games+h.games) AS record,
   a."pointsFor"+h."pointsFor" AS points,
   least(a.standing,h.standing) AS best_standing,
   abs((quote->>'away_projection')::numeric-(quote->>'home_projection')::numeric) AS spread,
   (quote->>'line')::numeric AS total
  FROM jsonb_array_elements(p_quotes) AS q(quote)
  JOIN teams a ON a.id=(quote->>'away_team_id')::uuid
  JOIN teams h ON h.id=(quote->>'home_team_id')::uuid
  WHERE quote->>'kind'='match_total' AND quote->>'side'='over'
   AND quote->'metadata'->>'alternate' IS DISTINCT FROM 'true'
 ), ranked AS (
  SELECT *, count(*) OVER () / 2 AS feature_cap,
   0.50*coalesce((record-min(record) OVER w)/nullif(max(record) OVER w-min(record) OVER w,0),0.5)
   +0.25*coalesce((points-min(points) OVER w)/nullif(max(points) OVER w-min(points) OVER w,0),0.5)
   +0.15*(1-coalesce((spread-min(spread) OVER w)/nullif(max(spread) OVER w-min(spread) OVER w,0),0.5))
   +0.10*coalesce((total-min(total) OVER w)/nullif(max(total) OVER w-min(total) OVER w,0),0.5) AS rating
  FROM matchups WINDOW w AS ()
 ), tank AS (
  SELECT matchup, 'Tank Bowl'::text AS featured FROM ranked
  WHERE p_week>p_regular_weeks/2 AND p_week<=p_regular_weeks AND round(record*100,1)<=33.3
   AND p_playoff_teams BETWEEN 1 AND jsonb_array_length(p_teams)
   AND best_standing > p_playoff_teams
  ORDER BY rating DESC, matchup LIMIT (SELECT max(feature_cap) FROM ranked)
 ), game AS (
  SELECT matchup, 'Game of the Week'::text AS featured FROM ranked r
  WHERE p_week<=p_regular_weeks AND r.feature_cap>(SELECT count(*) FROM tank)
   AND NOT EXISTS(SELECT 1 FROM tank t WHERE t.matchup=r.matchup)
  ORDER BY rating DESC, matchup LIMIT 1
 ), features AS (
  SELECT * FROM tank UNION ALL SELECT * FROM game
 )
 SELECT jsonb_agg(
  quote || jsonb_build_object(
   'featured', CASE WHEN eligible THEN f.featured ELSE '' END,
   'boost_pct', CASE WHEN eligible THEN p_boost ELSE 0 END
  ) ORDER BY ordinality
 )
 FROM jsonb_array_elements(p_quotes) WITH ORDINALITY AS q(quote, ordinality)
 LEFT JOIN features f ON f.matchup=quote->>'matchup_key'
 CROSS JOIN LATERAL (
  SELECT p_boost>0 AND quote->'metadata'->>'alternate' IS DISTINCT FROM 'true'
   AND ((f.featured='Game of the Week' AND quote->>'kind'='moneyline')
     OR (f.featured='Tank Bowl' AND quote->>'kind'='match_total' AND quote->>'side'='over')) AS eligible
 ) e;
$$;
REVOKE ALL ON FUNCTION boff_dev_internal.feature_weekly_quotes(jsonb,jsonb,integer,integer,integer,integer)
FROM PUBLIC, anon, authenticated, service_role;
