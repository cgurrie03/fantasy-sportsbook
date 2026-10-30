begin;
-- Grant after ownership transfer: the managed non-superuser postgres wrapper
-- must retain explicit EXECUTE after ALTER OWNER normalizes the former-owner ACL.
grant boff_routine_retention to postgres;
set local role boff_routine_retention;
grant execute on function sportsbook_private.cleanup_routine_payloads(integer) to postgres;
reset role;
revoke boff_routine_retention from postgres;
commit;
