# Visual application migration profile

November 18 incremental changes belong to the existing visual application schema, not the older foundation baseline. They retain their deployed version names and SQL contents here so foundation test/deployment tools do not accidentally apply them to the wrong schema.

Development already has these changes. Production uses the separately reviewed atomic artifact under `supabase/production/`; do not replay historical foundation or visual migrations into Production.
