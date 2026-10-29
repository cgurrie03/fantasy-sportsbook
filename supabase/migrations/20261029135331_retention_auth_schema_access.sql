begin;
-- Managed Auth schemas do not give postgres grant-option on USAGE. Keep the
-- JWT check in the postgres-owned API wrapper; the private implementation has
-- only transient-model data privileges and cannot access financial records.
grant boff_evaluation_retention to postgres;
alter function public.cleanup_evaluated_samples(integer) set schema sportsbook_private;
do $$declare d text;anchor text;begin
 select pg_get_functiondef('sportsbook_private.cleanup_evaluated_samples(integer)'::regprocedure) into d;
 anchor:='if auth.role() is distinct from ''service_role'' then raise exception ''Worker only.'';end if;';
 if position(anchor in d)=0 then raise exception 'Cleanup authentication anchor changed.';end if;
 execute replace(d,anchor,'-- Authentication is enforced by the sole postgres-owned public wrapper.');
end $$;
revoke all on function sportsbook_private.cleanup_evaluated_samples(integer) from public,anon,authenticated,service_role;
grant execute on function sportsbook_private.cleanup_evaluated_samples(integer) to postgres;
create function public.cleanup_evaluated_samples(p_limit integer default 2) returns jsonb
language plpgsql security definer set search_path='' set row_security='on' set statement_timeout='5s' set lock_timeout='500ms' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker only.';end if;
 return sportsbook_private.cleanup_evaluated_samples(p_limit);
end $$;
revoke all on function public.cleanup_evaluated_samples(integer) from public,anon,authenticated;
grant execute on function public.cleanup_evaluated_samples(integer) to service_role;
comment on function public.cleanup_evaluated_samples(integer) is 'Worker-authenticated wrapper for the isolated non-login cleanup role. No financial or legacy archive deletion.';
revoke boff_evaluation_retention from postgres;
commit;
