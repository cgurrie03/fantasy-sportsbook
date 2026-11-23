CREATE TABLE boff_dev_internal.notification_push_keys(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), public_key text NOT NULL, private_key text NOT NULL
);
CREATE TABLE boff_dev_internal.notification_push_devices(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
 endpoint text NOT NULL UNIQUE, keys jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_push_devices_user ON boff_dev_internal.notification_push_devices(user_id);
CREATE TABLE boff_dev_internal.notification_push_receipts(
 league_id uuid, device_id uuid REFERENCES boff_dev_internal.notification_push_devices(id) ON DELETE CASCADE, event_key text,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(league_id,device_id,event_key)
);
CREATE INDEX notification_push_receipts_age ON boff_dev_internal.notification_push_receipts(created_at);
ALTER TABLE boff_dev_internal.notification_push_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE boff_dev_internal.notification_push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE boff_dev_internal.notification_push_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON boff_dev_internal.notification_push_keys,boff_dev_internal.notification_push_devices,boff_dev_internal.notification_push_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.dev_push_keys(p_public text DEFAULT NULL,p_private text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_public IS NOT NULL AND p_private IS NOT NULL THEN
  INSERT INTO boff_dev_internal.notification_push_keys(public_key,private_key)
  VALUES(p_public,p_private) ON CONFLICT DO NOTHING;
 END IF;
 RETURN (SELECT jsonb_build_object('publicKey',public_key,'privateKey',private_key)
  FROM boff_dev_internal.notification_push_keys);
END $$;

CREATE FUNCTION public.dev_push_device(p_league uuid,p_endpoint text DEFAULT NULL,p_keys jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT FROM public.league_memberships WHERE league_id=p_league AND user_id=auth.uid())
 THEN RAISE EXCEPTION 'League membership required'; END IF;
 IF p_endpoint IS NOT NULL AND p_keys IS NULL THEN
  DELETE FROM boff_dev_internal.notification_push_devices WHERE user_id=auth.uid() AND endpoint=p_endpoint;
 ELSIF p_endpoint IS NOT NULL THEN
  IF length(p_endpoint)>2000 OR p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)/'
   OR coalesce(p_keys->>'auth','') !~ '^[A-Za-z0-9_-]{22}$' OR coalesce(p_keys->>'p256dh','') !~ '^[A-Za-z0-9_-]{87}$'
  THEN RAISE EXCEPTION 'Unsupported push subscription'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('dev-notification-device'),hashtext(auth.uid()::text));
  IF NOT EXISTS(SELECT FROM boff_dev_internal.notification_push_devices WHERE user_id=auth.uid() AND endpoint=p_endpoint)
   AND (SELECT count(*) FROM boff_dev_internal.notification_push_devices WHERE user_id=auth.uid())>=5
  THEN RAISE EXCEPTION 'Up to five devices can receive notifications'; END IF;
  DELETE FROM boff_dev_internal.notification_push_devices WHERE endpoint=p_endpoint AND user_id<>auth.uid();
  INSERT INTO boff_dev_internal.notification_push_devices(user_id,endpoint,keys)
  VALUES(auth.uid(),p_endpoint,jsonb_build_object('auth',p_keys->>'auth','p256dh',p_keys->>'p256dh'))
  ON CONFLICT(endpoint) DO UPDATE SET keys=excluded.keys WHERE notification_push_devices.user_id=excluded.user_id;
 END IF;
 RETURN (SELECT jsonb_build_object('publicKey',public_key) FROM boff_dev_internal.notification_push_keys);
END $$;

CREATE FUNCTION public.dev_record_push(p_league uuid,p_device uuid,p_event text,p_expired boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_expired THEN
  DELETE FROM boff_dev_internal.notification_push_devices WHERE id=p_device;
 ELSE
  INSERT INTO boff_dev_internal.notification_push_receipts(league_id,device_id,event_key)
  SELECT p_league,p_device,p_event FROM boff_dev_internal.notification_push_devices WHERE id=p_device ON CONFLICT DO NOTHING;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.dev_push_keys(text,text),public.dev_push_device(uuid,text,jsonb),public.dev_record_push(uuid,uuid,text,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dev_push_keys(text,text),public.dev_record_push(uuid,uuid,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.dev_push_device(uuid,text,jsonb) TO authenticated;
