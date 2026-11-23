DO $$ DECLARE body text; update_anchor text:='AND (m.odds IS DISTINCT FROM'; BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
 SELECT pg_get_functiondef('public.publish_dev_book(uuid,jsonb)'::regprocedure) INTO body;
 body:=replace(body,chr(13),'');
 IF strpos(body,update_anchor)=0 OR strpos(body,'ELSE' || chr(10) || '   UPDATE public.sportsbook_markets SET line=')=0
 THEN RAISE EXCEPTION 'Weekly publisher definition changed'; END IF;
 body:=replace(body,'rev integer;deadline timestamptz;','rev integer;deadline timestamptz; policy_revision text;');
 body:=replace(body,' UPDATE public.sportsbook_boards SET status=''draft'',revision=rev',
 E' policy_revision:=sportsbook_private.sportsbook_policy(p_league,(p_book->>''season'')::integer,(p_book->>''week'')::integer)->>''revision'';\n IF old.board_id=b.id AND old.source_hash=h AND b.status=''published'' AND b.phase=(CASE WHEN (p_book->''payload''->>''gamesActive'')::boolean THEN ''live'' ELSE ''pregame'' END)
'
 || E' AND NOT EXISTS(SELECT 1 FROM public.sportsbook_markets m0 WHERE m0.board_id=b.id AND m0.active
'
 || E'   AND coalesce(m0.metadata->>''sportsbook_policy_revision'',''0'') IS DISTINCT FROM policy_revision) THEN
'
 || E'  UPDATE public.sportsbook_boards SET source_observed_at=(p_book->>''observed_at'')::timestamptz,quote_valid_until=deadline,suspension_reason=NULL WHERE id=b.id;
'
 || E'  UPDATE public.dev_current_book SET payload=CASE WHEN payload=p_book->''payload'' THEN payload ELSE p_book->''payload'' END, observed_at=(p_book->>''observed_at'')::timestamptz,valid_until=deadline,last_error=NULL WHERE league_id=p_league;
'
 || E'  RETURN jsonb_build_object(''board_id'',b.id,''revision'',rev,''quotes'',jsonb_array_length(p_book->''quotes''));
'
 || E' END IF;
 UPDATE public.sportsbook_boards SET status=''draft'',revision=rev');
 body:=replace(body,'''sportsbook_policy_revision'',sportsbook_private.sportsbook_policy(p_league,(p_book->>''season'')::integer,(p_book->>''week'')::integer)->>''revision''','''sportsbook_policy_revision'',policy_revision');
 body:=replace(body,'ELSE' || chr(10) || '   UPDATE public.sportsbook_markets SET line=',
 E'ELSIF ROW(m.line,m.odds,m.label,m.subject,m.home_projection,m.away_projection,m.metadata,m.boost_pct,m.featured,m.market_state::text) IS DISTINCT FROM ROW((q->>''line'')::numeric,(q->>''odds'')::integer,q->>''label'',q->>''subject'',(q->>''home_projection'')::numeric,(q->>''away_projection'')::numeric,q->''metadata'',(q->>''boost_pct'')::integer,q->>''featured'',''open''::text) THEN\n   UPDATE public.sportsbook_markets SET line=');
 body:=replace(body,' PERFORM sportsbook_private.capture_forecast(b.id);',
  E' IF nullif(p_book->''payload''->>''firstGame'','''')::timestamptz > clock_timestamp() THEN
  PERFORM sportsbook_private.capture_forecast(b.id);
 END IF;');
 EXECUTE body;
END $$;
CREATE INDEX IF NOT EXISTS dev_active_quote_lookup ON public.sportsbook_markets(board_id,(coalesce(metadata->>'quote_key',metadata->>'ui_id'))) WHERE active;

