begin;
create function public.communication_identity_review(p_league uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$declare l public.leagues;begin
 if not public.league_intake_owner()then raise exception 'Verified platform owner required.';end if;
 select * into l from public.leagues where id=p_league;if not found then raise exception 'Selected league unavailable.';end if;
 return jsonb_build_object('league_id',l.id,'sportsbook_url',l.sportsbook_url,'email_sender',l.email_sender,'revision_hash',encode(sha256(convert_to(jsonb_build_array(l.sportsbook_url,l.email_sender)::text,'UTF8')),'hex'),'required_origin',public.application_environment_identity()->>'app_origin');
end $$;
create function public.save_communication_identity(p_league uuid,p_expected text,p_url text,p_sender text,p_reason text)returns jsonb language plpgsql security definer set search_path=''as $$declare l public.leagues;origin text;begin
 if not public.league_intake_owner()then raise exception 'Verified platform owner required.';end if;
 if p_reason is null or length(trim(p_reason))not between 8 and 400 then raise exception 'Communication review reason required.';end if;
 origin:=public.application_environment_identity()->>'app_origin';
 if p_url is null or length(p_url)>2048 or p_url!~'^https://[a-zA-Z0-9.-]+(:[0-9]+)?(/[^[:space:]]*)?$'or p_url~'[\\]'or substring(p_url from '^(https://[^/]+)')is distinct from origin then raise exception 'Use the exact HTTPS application origin for this environment.';end if;
 if p_sender is null or length(p_sender)>254 or p_sender!~'^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'then raise exception 'Verified sender email address required.';end if;
 select * into l from public.leagues where id=p_league for update;if not found then raise exception 'Selected league unavailable.';end if;
 if l.operations_enabled or exists(select 1 from public.weekly_schedule where league_id=p_league and automation_enabled)then raise exception 'Pause operations and automation before communication identity changes.';end if;
 if l.sportsbook_url=p_url and l.email_sender=p_sender then return public.communication_identity_review(p_league);end if;
 if p_expected is distinct from encode(sha256(convert_to(jsonb_build_array(l.sportsbook_url,l.email_sender)::text,'UTF8')),'hex')then raise exception 'Communication identity changed; reload before saving.';end if;
 update public.leagues set sportsbook_url=p_url,email_sender=p_sender where id=p_league;
 insert into public.admin_change_log(league_id,actor_id,category,reason,before_value,after_value)values(p_league,auth.uid(),'communication_identity',trim(p_reason),jsonb_build_object('sportsbook_url',l.sportsbook_url,'email_sender',l.email_sender),jsonb_build_object('sportsbook_url',p_url,'email_sender',p_sender));
 return public.communication_identity_review(p_league);
end $$;
revoke all on function public.communication_identity_review(uuid),public.save_communication_identity(uuid,text,text,text,text)from public,anon,service_role;
grant execute on function public.communication_identity_review(uuid),public.save_communication_identity(uuid,text,text,text,text)to authenticated;
commit;
