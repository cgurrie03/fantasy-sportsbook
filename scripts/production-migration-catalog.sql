-- Read-only schema/ACL comparison. Hash function bodies rather than exporting
-- code that may include retired integration configuration or credentials.
select jsonb_build_object(
 'columns',(select coalesce(jsonb_agg(to_jsonb(x) order by x.table_schema,x.table_name,x.ordinal_position),'[]') from
   (select table_schema,table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default
    from information_schema.columns where table_schema in ('public','sportsbook_private','boff_dev_internal'))x),
 'relations',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'rls',c.relrowsecurity,'acl',c.relacl::text) order by n.nspname,c.relname),'[]')
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','sportsbook_private','boff_dev_internal') and c.relkind in ('r','v','m','S')),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,'definition',pg_get_constraintdef(k.oid)) order by n.nspname,c.relname,k.conname),'[]')
   from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','sportsbook_private','boff_dev_internal')),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'returns',pg_get_function_result(p.oid),'security_definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text,'definition_hash',md5(pg_get_functiondef(p.oid))) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]')
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','sportsbook_private','boff_dev_internal') and p.prokind='f'),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname),'[]') from pg_policies p where schemaname in ('public','sportsbook_private','boff_dev_internal')),
 'indexes',(select coalesce(jsonb_agg(to_jsonb(x) order by schemaname,tablename,indexname),'[]') from pg_indexes x where schemaname in ('public','sportsbook_private','boff_dev_internal')),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid)) order by n.nspname,c.relname,t.tgname),'[]')
   from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','sportsbook_private','boff_dev_internal'))
) catalog;
