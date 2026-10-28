begin;

-- No default row: each environment must be explicitly marked by its operator.
-- Do not copy this private row during a restore into a different environment.
create table sportsbook_private.application_environment (
  singleton boolean primary key default true check (singleton),
  environment text not null check (environment in ('development','production')),
  project_ref text not null check (project_ref ~ '^[a-z]{20}$'),
  app_origin text not null,
  check ((environment = 'development' and project_ref = 'whlcnlacueweaqpsupqs'
    and app_origin = 'https://dev.sportsbook.coopergurrie.com') or
    (environment = 'production' and project_ref = 'bmvjcdgxwxqalaohpsnw'
    and app_origin = 'https://sportsbook.coopergurrie.com'))
);
alter table sportsbook_private.application_environment enable row level security;
revoke all on sportsbook_private.application_environment from public, anon, authenticated, service_role;

create function public.application_environment_identity() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('environment', environment,
    'project_ref', project_ref, 'app_origin', app_origin)
  from sportsbook_private.application_environment where singleton;
$$;
revoke all on function public.application_environment_identity() from public;
grant execute on function public.application_environment_identity() to anon, authenticated, service_role;
comment on function public.application_environment_identity() is
  'Public non-secret deployment identity only. Does not grant league, wallet or staff access.';
commit;
