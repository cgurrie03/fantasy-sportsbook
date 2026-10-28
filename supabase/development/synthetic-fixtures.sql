-- Development only. No provider calls, historical data or spendable balances.
begin;
do $$
declare marker jsonb; owner_id uuid := 'd320882c-8a06-443b-a2a9-2e29a0d29cdd';
  league_id uuid; team_id uuid; n integer; i integer;
begin
  marker := public.application_environment_identity();
  if marker->>'environment' <> 'development'
    or marker->>'project_ref' <> 'whlcnlacueweaqpsupqs'
    or marker->>'app_origin' <> 'https://dev.sportsbook.coopergurrie.com'
    or marker is null then raise exception 'Development fixture target rejected'; end if;
  if not exists (select 1 from auth.users where id=owner_id
    and lower(email)='cooper.gurrie@gmail.com' and email_confirmed_at is not null)
    then raise exception 'Independent development owner required'; end if;
  foreach n in array array[8,10] loop
    league_id := md5('boff-development-league-'||n)::uuid;
    insert into public.leagues(id,name,sleeper_league_id,nfl_season,league_season,
      active_week,week_anchor,sportsbook_url,operations_enabled)
    values(league_id,'Synthetic '||n||'-team league','dev-fixture-'||n,2026,1,8,
      '2026-10-27 12:00:00+00','https://dev.sportsbook.coopergurrie.com',false)
    on conflict(id) do nothing;
    if exists(select 1 from public.leagues l where l.id=league_id and l.operations_enabled)
      then raise exception 'Fixtures require disabled operations'; end if;
    for i in 1..n loop
      team_id := md5('boff-development-team-'||n||'-'||i)::uuid;
      insert into public.teams(id,league_id,roster_id,team_name,sleeper_owner_id,
        owner_name,sportsbook_owner_id,sportsbook_owner_name)
      values(team_id,league_id,i,'Test Team '||i,'dev-fixture-'||n||'-'||i,
        'Synthetic Manager '||i,'dev-fixture-'||n||'-'||i,'Synthetic Manager '||i)
      on conflict(id) do nothing;
      insert into public.wallets(team_id,balance) values(team_id,null) on conflict do nothing;
      if i=1 then
        insert into public.league_memberships(id,league_id,team_id,user_id,
          invited_email,display_name,sleeper_user_id,role)
        values(md5('boff-development-membership-'||n)::uuid,league_id,team_id,owner_id,
          'cooper.gurrie@gmail.com','Development Owner','dev-fixture-'||n||'-1',
          case when n=8 then 'admin' else 'member' end)
        on conflict(id) do nothing;
      end if;
    end loop;
    insert into public.weekly_schedule(league_id,automation_enabled)
      values(league_id,false) on conflict do nothing;
  end loop;
end $$;
commit;
