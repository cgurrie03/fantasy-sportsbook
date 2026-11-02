begin;
-- Tokens are generated in the owner's browser. Only their SHA-256 digest is
-- retained; neither bearer tokens nor links enter audit/outbox payloads.
create table sportsbook_private.team_invitations(
 id uuid primary key default gen_random_uuid(),league_id uuid not null references public.leagues(id),team_id uuid,
 token_digest text unique not null check(token_digest~'^[0-9a-f]{64}$'),
 invited_email text check(length(invited_email) between 3 and 254 and invited_email=lower(trim(invited_email))),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,state text not null default 'open' check(state in('open','revoked','consumed')),
 revision integer not null default 1,reason text not null check(length(reason) between 8 and 400),
 foreign key(team_id,league_id) references public.teams(id,league_id),unique(id,league_id)
);
create table sportsbook_private.team_claims(
 id uuid primary key default gen_random_uuid(),invitation_id uuid not null,league_id uuid not null,team_id uuid not null,
 user_id uuid not null references auth.users(id),verified_email text not null,display_name text not null check(length(trim(display_name)) between 1 and 80),
 state text not null default 'pending' check(state in('pending','approved','rejected','revoked','withdrawn')),
 revision integer not null default 1,created_at timestamptz not null default clock_timestamp(),reviewed_at timestamptz,
 reviewed_by uuid references auth.users(id),reason text, wallet_id uuid references public.user_wallets(id),
 unique(invitation_id,user_id),foreign key(invitation_id,league_id) references sportsbook_private.team_invitations(id,league_id),foreign key(team_id,league_id) references public.teams(id,league_id)
);
create index team_claim_user on sportsbook_private.team_claims(user_id,created_at desc,id);
create index team_claim_league on sportsbook_private.team_claims(league_id,created_at desc,id);
alter table sportsbook_private.team_invitations enable row level security;
alter table sportsbook_private.team_claims enable row level security;
revoke all on sportsbook_private.team_invitations,sportsbook_private.team_claims from public,anon,authenticated,service_role;

create function public.issue_team_invitation(p_league uuid,p_team uuid,p_email text,p_digest text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i sportsbook_private.team_invitations;begin
 if not public.league_intake_owner() then raise exception 'Verified platform owner required.';end if;
 if p_digest is null or p_digest!~'^[0-9a-f]{64}$' or (p_email is not null and (length(trim(p_email)) not between 3 and 254 or position('@' in p_email)<2))
  or p_reason is null or length(trim(p_reason)) not between 8 and 400 then raise exception 'Scoped email, token digest and review reason required.';end if;
 perform pg_advisory_xact_lock(20261102,16);
 select * into i from sportsbook_private.team_invitations where token_digest=p_digest;
 if found then
  if row(i.league_id,i.team_id,i.invited_email,i.reason) is distinct from row(p_league,p_team,lower(trim(p_email)),trim(p_reason)) then raise exception 'Invitation identifier already used with different terms.';end if;
  return jsonb_build_object('id',i.id,'expires_at',i.expires_at,'duplicate',true);
 end if;
 if not exists(select 1 from public.leagues where id=p_league) or (p_team is not null and not exists(select 1 from public.teams where id=p_team and league_id=p_league)) then raise exception 'Scoped team required.';end if;
 if (select count(*) from sportsbook_private.team_invitations where league_id=p_league)>=256
  or (select count(*) from sportsbook_private.team_invitations where league_id=p_league and state='open' and expires_at>clock_timestamp())>=32
 then raise exception 'Invitation admission budget reached; review existing invitations.';end if;
 insert into sportsbook_private.team_invitations(league_id,team_id,token_digest,invited_email,created_by,expires_at,reason)
 values(p_league,p_team,p_digest,lower(trim(p_email)),auth.uid(),clock_timestamp()+interval '7 days',trim(p_reason)) returning * into i;
 insert into public.admin_change_log(league_id,actor_id,category,before_value,after_value,reason)
 values(p_league,auth.uid(),'team_invitation','{}',jsonb_build_object('invitation_id',i.id,'team_id',p_team,'expires_at',i.expires_at),trim(p_reason));
 return jsonb_build_object('id',i.id,'expires_at',i.expires_at,'duplicate',false);
end $$;

create function public.team_invitation_preview(p_token text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare i sportsbook_private.team_invitations;e text;begin
 select lower(email) into e from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if e is null then raise exception 'Verified sign-in required.';end if;
 if p_token is null or p_token!~'^[0-9a-f]{64}$' then raise exception 'Invitation unavailable for this verified account.';end if;
 select * into i from sportsbook_private.team_invitations where token_digest=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if not found or i.state<>'open' or i.expires_at<=now() or (i.invited_email is not null and i.invited_email<>e) then raise exception 'Invitation unavailable for this verified account.';end if;
 return jsonb_build_object('league_name',(select name from public.leagues where id=i.league_id),'expires_at',i.expires_at,
 'teams',(select jsonb_agg(jsonb_build_object('id',id,'name',team_name) order by roster_id) from public.teams where league_id=i.league_id and (i.team_id is null or id=i.team_id)));
end $$;
revoke all on function public.team_invitation_preview(text) from public,anon,service_role;
grant execute on function public.team_invitation_preview(text) to authenticated;

create function public.submit_team_claim(p_token text,p_team uuid,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i sportsbook_private.team_invitations;c sportsbook_private.team_claims;e text;begin
 select lower(email) into e from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if e is null then raise exception 'Verified sign-in required.';end if;
 if p_token is null or p_token!~'^[0-9a-f]{64}$' or p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'Invitation unavailable for this verified account.';end if;
 perform pg_advisory_xact_lock(20261102,16);
 select * into i from sportsbook_private.team_invitations where token_digest=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found or (i.invited_email is not null and i.invited_email<>e) or i.state='revoked' or i.expires_at<=clock_timestamp() then raise exception 'Invitation unavailable for this verified account.';end if;
 select * into c from sportsbook_private.team_claims where invitation_id=i.id and user_id=auth.uid();
 if found then
  if c.display_name<>trim(p_name) or c.team_id is distinct from p_team then raise exception 'Existing claim has different terms.';end if;
  return jsonb_build_object('id',c.id,'state',c.state,'duplicate',true);
 end if;
 if i.state<>'open' or (i.invited_email is not null and exists(select 1 from sportsbook_private.team_claims where invitation_id=i.id))
 then raise exception 'Invitation unavailable for this verified account.';end if;
 if p_team is null or (i.team_id is not null and i.team_id<>p_team) or not exists(select 1 from public.teams where id=p_team and league_id=i.league_id) then raise exception 'Scoped team required.';end if;
 if exists(select 1 from sportsbook_private.team_claims pending_claim join sportsbook_private.team_invitations v on v.id=pending_claim.invitation_id where pending_claim.league_id=i.league_id and pending_claim.user_id=auth.uid() and pending_claim.state='pending' and v.state='open' and v.expires_at>clock_timestamp()) then raise exception 'A claim is already pending for this league.';end if;
 if exists(select 1 from public.user_wallets where league_id=i.league_id and user_id=auth.uid()) then raise exception 'Existing financial identity requires owner review.';end if;
 if (select count(*) from sportsbook_private.team_claims where league_id=i.league_id)>=256 or (select count(*) from sportsbook_private.team_claims where user_id=auth.uid())>=128 then raise exception 'Claim admission budget reached.';end if;
 insert into sportsbook_private.team_claims(invitation_id,league_id,team_id,user_id,verified_email,display_name)
 values(i.id,i.league_id,p_team,auth.uid(),e,trim(p_name)) returning * into c;
 return jsonb_build_object('id',c.id,'state','pending','duplicate',false);
end $$;

create function public.team_claim_directory(p_league uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_access boolean:=public.league_intake_owner();begin
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'Verified sign-in required.';end if;
 if p_league is not null and not owner_access then raise exception 'Verified platform owner required.';end if;
 return jsonb_build_object('invitations',case when owner_access and p_league is not null then
  (select coalesce(jsonb_agg(x order by x.created_at desc,x.id),'[]') from
   (select id,team_id,invited_email,created_at,expires_at,revision,case when state='open' and expires_at<=now() then 'expired' else state end state
    from sportsbook_private.team_invitations where league_id=p_league order by created_at desc,id limit 256)x) else '[]'::jsonb end,
 'claims',(select coalesce(jsonb_agg(x order by x.created_at desc,x.id),'[]') from
   (select c.id,c.league_id,c.team_id,c.display_name,c.verified_email,c.revision,c.created_at,c.wallet_id,
    case when c.state='pending' and (i.state='revoked' or i.expires_at<=now()) then case when i.state='revoked' then 'revoked' else 'expired' end else c.state end state,
    l.name league_name,t.team_name,c.reason
    from sportsbook_private.team_claims c join sportsbook_private.team_invitations i on i.id=c.invitation_id
    join public.leagues l on l.id=c.league_id join public.teams t on t.id=c.team_id
    where (p_league is not null and owner_access and c.league_id=p_league) or (p_league is null and c.user_id=auth.uid())
    order by c.created_at desc,c.id limit 256)x));
end $$;

create function public.review_team_claim(p_claim uuid,p_expected integer,p_action text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c sportsbook_private.team_claims;i sportsbook_private.team_invitations;r jsonb;w public.user_wallets;begin
 if not public.league_intake_owner() then raise exception 'Verified platform owner required.';end if;
 if p_action is null or p_action not in('approve','reject','revoke') or p_reason is null or length(trim(p_reason)) not between 8 and 400 then raise exception 'Explicit review decision and reason required.';end if;
 perform pg_advisory_xact_lock_shared(20261101,17);
 perform pg_advisory_xact_lock(20261102,16);
 select * into c from sportsbook_private.team_claims where id=p_claim for update;
 if not found then raise exception 'Claim unavailable.';end if;
 if c.state=(case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'revoked' end) and c.reason=trim(p_reason)
 then return jsonb_build_object('id',c.id,'state',c.state,'wallet_id',c.wallet_id,'duplicate',true);end if;
 if c.revision is distinct from p_expected then raise exception 'Claim changed; reload before reviewing.';end if;
 select * into i from sportsbook_private.team_invitations where id=c.invitation_id for update;
 if p_action in('approve','reject') then
  if c.state<>'pending' or i.state<>'open' or i.expires_at<=clock_timestamp() then raise exception 'Claim is no longer pending or invitation expired.';end if;
  if not exists(select 1 from auth.users where id=c.user_id and email_confirmed_at is not null and lower(email)=c.verified_email)
   then raise exception 'Verified claim identity changed; request a fresh review.';end if;
  if p_action='approve' then
   if exists(select 1 from public.user_wallets where league_id=c.league_id and user_id=c.user_id) then raise exception 'Existing financial identity requires explicit review.';end if;
   r:=public.approve_user_wallet(c.league_id,c.user_id,c.team_id,trim(p_reason),c.display_name);
   c.wallet_id:=(r->>'wallet_id')::uuid;
  end if;
  if i.invited_email is not null then update sportsbook_private.team_invitations set state='consumed',revision=revision+1 where id=i.id;end if;
 else
  if c.state<>'approved' then raise exception 'Only an approved claim can be revoked.';end if;
  select * into w from public.user_wallets where id=c.wallet_id for update;
  perform public.set_user_wallet_status(w.id,w.revision,'revoked',trim(p_reason));
 end if;
 update sportsbook_private.team_claims set state=case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'revoked' end,
  wallet_id=c.wallet_id,revision=revision+1,reviewed_at=clock_timestamp(),reviewed_by=auth.uid(),reason=trim(p_reason) where id=c.id returning * into c;
 insert into public.admin_change_log(league_id,actor_id,category,before_value,after_value,reason)
 values(c.league_id,auth.uid(),'team_claim',jsonb_build_object('revision',p_expected),jsonb_build_object('claim_id',c.id,'state',c.state,'wallet_id',c.wallet_id),trim(p_reason));
 return jsonb_build_object('id',c.id,'state',c.state,'wallet_id',c.wallet_id,'duplicate',false);
end $$;

create function public.revoke_team_invitation(p_invitation uuid,p_expected integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i sportsbook_private.team_invitations;begin
 if not public.league_intake_owner() then raise exception 'Verified platform owner required.';end if;
 if p_reason is null or length(trim(p_reason)) not between 8 and 400 then raise exception 'Revocation reason required.';end if;
 perform pg_advisory_xact_lock(20261102,16);
 select * into i from sportsbook_private.team_invitations where id=p_invitation for update;
 if not found or i.revision is distinct from p_expected or i.state<>'open' then raise exception 'Invitation changed or is no longer open.';end if;
 update sportsbook_private.team_invitations set state='revoked',revision=revision+1 where id=i.id;
 update sportsbook_private.team_claims set state='revoked',revision=revision+1,reason=trim(p_reason),reviewed_at=clock_timestamp(),reviewed_by=auth.uid()
 where invitation_id=i.id and state='pending';
 insert into public.admin_change_log(league_id,actor_id,category,before_value,after_value,reason)
 values(i.league_id,auth.uid(),'team_invitation',jsonb_build_object('state','open'),jsonb_build_object('invitation_id',i.id,'state','revoked'),trim(p_reason));
 return jsonb_build_object('id',i.id,'state','revoked');
end $$;
revoke all on function public.issue_team_invitation(uuid,uuid,text,text,text),public.submit_team_claim(text,uuid,text),public.team_claim_directory(uuid),public.review_team_claim(uuid,integer,text,text),public.revoke_team_invitation(uuid,integer,text) from public,anon,service_role;
grant execute on function public.issue_team_invitation(uuid,uuid,text,text,text),public.submit_team_claim(text,uuid,text),public.team_claim_directory(uuid),public.review_team_claim(uuid,integer,text,text),public.revoke_team_invitation(uuid,integer,text) to authenticated;
commit;
