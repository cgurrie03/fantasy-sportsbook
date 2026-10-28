# Isolated development database

Target: `whlcnlacueweaqpsupqs` only. Production is `bmvjcdgxwxqalaohpsnw`.

`baseline-schema.sql` is schema-only, with explicit ACL reconciliation for
Supabase defaults. Generate and verify it with `npm run schema:development`.
Historical migrations run only in a disposable local database; their imported
records never enter the schema artifact. The regression restores under hosted
default grants, checks API privileges and verifies all 41 tables are empty.
This verifies schema restoration, not recovery of historical financial data.

The initial hosted development install applied the baseline, then source
migrations 055–059, then `baseline-access.sql` to reconcile API grants. The
baseline now includes that access reconciliation for future empty installs.
Actual managed migration versions are recorded in handoff 13. Do not run root
`supabase db push` against this project: the old seed/import migrations are not
an installation sequence for either hosted environment.

Set the private environment marker to development, this project reference and
`https://dev.sportsbook.coopergurrie.com`. Create the separate confirmed owner
through Supabase Auth, disable public signup and anonymous sign-in, then apply
`synthetic-fixtures.sql`. That script refuses the wrong marker or missing owner.
Its 8/10-team leagues use fake provider IDs, unfunded wallets, disabled operations
and disabled automation. It never copies production records or creates Auth users.

Owner sign-in and redirect verification are separate from the schema checks.
Use Preview-only development credentials, captured mail and manual automation.
No real provider refresh or betting should be enabled for these fixtures.
