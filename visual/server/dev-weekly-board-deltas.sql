DO $$ BEGIN
 IF public.application_environment_identity()->>'project_ref' IS DISTINCT FROM 'whlcnlacueweaqpsupqs' THEN RAISE EXCEPTION 'Development project required'; END IF;
END $$;
CREATE TABLE boff_dev_internal.weekly_board_delta (
 league_id uuid PRIMARY KEY REFERENCES public.leagues(id),
 base_version text NOT NULL,
 version text NOT NULL,
 changes jsonb NOT NULL
);
ALTER TABLE boff_dev_internal.weekly_board_delta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.weekly_board_delta FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.dev_current_book ADD COLUMN payload_hash text;
UPDATE public.dev_current_book SET payload_hash=md5(payload::text);
CREATE FUNCTION boff_dev_internal.hash_weekly_payload() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.payload IS DISTINCT FROM OLD.payload THEN NEW.payload_hash:=md5(NEW.payload::text); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hash_weekly_payload BEFORE INSERT OR UPDATE OF payload ON public.dev_current_book
FOR EACH ROW EXECUTE FUNCTION boff_dev_internal.hash_weekly_payload();

CREATE FUNCTION boff_dev_internal.weekly_version(b public.sportsbook_boards, c public.dev_current_book) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT concat_ws(':',b.id,b.revision,b.content_version,b.status,b.phase,c.payload_hash)
$$;
CREATE FUNCTION boff_dev_internal.changed_board_rows(old_rows jsonb,new_rows jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 WITH old AS (SELECT v->>'id' id,v FROM jsonb_array_elements(coalesce(old_rows,'[]')) v),
 current AS (SELECT v->>'id' id,v FROM jsonb_array_elements(coalesce(new_rows,'[]')) v)
 SELECT jsonb_build_object('upsert',coalesce(jsonb_agg(current.v) FILTER(WHERE current.id IS NOT NULL),'[]'),
  'remove',coalesce(jsonb_agg(old.id) FILTER(WHERE current.id IS NULL),'[]'))
 FROM old FULL JOIN current USING(id) WHERE old.v IS DISTINCT FROM current.v
$$;
CREATE FUNCTION boff_dev_internal.save_weekly_delta(old_book public.dev_current_book, old_board public.sportsbook_boards,
 new_book public.dev_current_book, new_board public.sportsbook_boards, changed uuid[], removed uuid[])
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE base text; version text; changes jsonb;
BEGIN
 IF old_book.board_id IS DISTINCT FROM new_book.board_id THEN RETURN; END IF;
 base:=boff_dev_internal.weekly_version(old_board,old_book);
 version:=boff_dev_internal.weekly_version(new_board,new_book);
 IF base=version THEN RETURN; END IF;
 changes:=jsonb_build_object(
  'quotes',jsonb_build_object('upsert',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM public.sportsbook_markets q
   WHERE q.id=ANY(changed) AND q.active),'[]'),'remove',to_jsonb(removed)),
  'teams',boff_dev_internal.changed_board_rows(old_book.payload->'teams',new_book.payload->'teams'),
  'players',boff_dev_internal.changed_board_rows(old_book.payload->'players',new_book.payload->'players'),
  'payload',coalesce((SELECT jsonb_object_agg(key,value) FROM jsonb_each(new_book.payload - ARRAY['teams','players'])
   WHERE old_book.payload->key IS DISTINCT FROM value),'{}'),
  'payloadRemove',coalesce((SELECT jsonb_agg(key) FROM jsonb_object_keys(old_book.payload - ARRAY['teams','players']) key
   WHERE NOT new_book.payload ? key),'[]'));
 IF octet_length(changes::text)>=280000 THEN RETURN; END IF;
 INSERT INTO boff_dev_internal.weekly_board_delta VALUES(new_book.league_id,base,version,changes)
 ON CONFLICT(league_id) DO UPDATE SET base_version=excluded.base_version,version=excluded.version,changes=excluded.changes;
END $$;
REVOKE ALL ON FUNCTION boff_dev_internal.save_weekly_delta(public.dev_current_book,public.sportsbook_boards,public.dev_current_book,public.sportsbook_boards,uuid[],uuid[]) FROM PUBLIC,anon,authenticated,service_role;

DO $$ DECLARE body text; anchor text; BEGIN
 SELECT pg_get_functiondef('public.publish_dev_book(uuid,jsonb)'::regprocedure) INTO body;
 anchor:='policy_revision text;';
 IF strpos(body,anchor)=0 OR strpos(body,' RETURN jsonb_build_object(''board_id''')=0 THEN RAISE EXCEPTION 'Publisher definition changed'; END IF;
 body:=replace(body,anchor,anchor||' changed uuid[]:=''{}''; removed uuid[]:=''{}''; updated_book public.dev_current_book; updated_board public.sportsbook_boards;');
 body:=replace(body,'   UPDATE public.sportsbook_markets SET active=false WHERE id=ident;ident:=NULL;',
  '   removed:=array_append(removed,ident); UPDATE public.sportsbook_markets SET active=false WHERE id=ident;ident:=NULL;');
 body:=replace(body,'   ident:=gen_random_uuid();','   ident:=gen_random_uuid(); changed:=array_append(changed,ident);');
 body:=replace(body,'   UPDATE public.sportsbook_markets SET line=', E'   changed:=array_append(changed,ident);\n   UPDATE public.sportsbook_markets SET line=');
 body:=replace(body,' UPDATE public.sportsbook_markets SET active=false WHERE board_id=b.id AND active AND NOT(id=ANY(ids));',$replace$
 WITH closed AS (UPDATE public.sportsbook_markets SET active=false WHERE board_id=b.id AND active AND NOT(id=ANY(ids)) RETURNING id)
 SELECT removed||coalesce(array_agg(id),'{}') INTO removed FROM closed;
 $replace$);
 body:=replace(body,' RETURN jsonb_build_object(''board_id''',$save$
 SELECT * INTO updated_book FROM public.dev_current_book WHERE league_id=p_league;
 SELECT * INTO updated_board FROM public.sportsbook_boards WHERE id=b.id;
 PERFORM boff_dev_internal.save_weekly_delta(old,b,updated_book,updated_board,changed,removed);
 RETURN jsonb_build_object('board_id'
 $save$);
 EXECUTE body;
END $$;

CREATE FUNCTION public.dev_weekly_changes(p_league uuid,p_version text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'board',to_jsonb(b),'book',jsonb_build_object('board_id',c.board_id,'observed_at',c.observed_at,'valid_until',c.valid_until,'last_error',c.last_error),'version',v.version,
  'mode',CASE WHEN p_version=v.version THEN 'unchanged'
    WHEN d.base_version=p_version AND d.version=v.version AND octet_length(d.changes::text)<280000 THEN 'delta'
    ELSE 'snapshot' END,
  'changes',CASE WHEN d.base_version=p_version AND d.version=v.version AND octet_length(d.changes::text)<280000 THEN d.changes END,
  'futures', (SELECT jsonb_build_object('id',f.id,'revision',f.revision,'status',
    CASE WHEN s.rules_revision IS DISTINCT FROM coalesce(r.revision,0) THEN 'draft' ELSE f.status END,'quote_valid_until',f.quote_valid_until)
   FROM public.sportsbook_boards f JOIN boff_dev_internal.futures_board_state s ON s.league_id=f.league_id AND s.season=f.nfl_season
   LEFT JOIN LATERAL (SELECT revision FROM boff_dev_internal.futures_rule_versions WHERE league_id=f.league_id AND season=f.nfl_season ORDER BY revision DESC LIMIT 1) r ON true
   WHERE f.league_id=p_league AND f.nfl_season=b.nfl_season AND f.board_type='future')
 )
 FROM public.dev_current_book c JOIN public.sportsbook_boards b ON b.id=c.board_id
 CROSS JOIN LATERAL (SELECT boff_dev_internal.weekly_version(b,c) version) v
 LEFT JOIN boff_dev_internal.weekly_board_delta d ON d.league_id=c.league_id
 WHERE c.league_id=p_league
$$;
REVOKE ALL ON FUNCTION public.dev_weekly_changes(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dev_weekly_changes(uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.dev_weekly_snapshot(p_league uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('book',to_jsonb(c),'board',to_jsonb(b),'version',boff_dev_internal.weekly_version(b,c),'quotes',
  coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.sportsbook_markets q WHERE q.board_id=b.id AND q.active),'[]'))
 FROM public.dev_current_book c JOIN public.sportsbook_boards b ON b.id=c.board_id WHERE c.league_id=p_league
$$;
NOTIFY pgrst,'reload schema';

