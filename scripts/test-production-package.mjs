import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {sqlStatements} from './lib/sql-statements.mjs';
import {sqlTokens} from './lib/sql-tokens.mjs';
const examples=[
 ["select ';';select 2;",2],
 ["DO $$BEGIN PERFORM ';';END $$;select 1;",2],
 ['select "semi;colon";/* outer; /* inner; */ */ select 2;',2],
 ["-- skip;\nselect E'one\\\'two;';select 2;",2],
 ["CREATE FUNCTION x() RETURNS void AS $fn$BEGIN PERFORM 'a;';END $fn$ LANGUAGE plpgsql;",1],
];
for(const [text,n] of examples)assert.equal(sqlStatements(text).length,n);
for(const text of ["DO $$broken", "select 'broken", '/* broken'])assert.throws(()=>sqlStatements(text));
const file='supabase/production/migrations/20261120152909_production_release_schema_and_legacy_routing.sql';
const sql=await fs.readFile(file,'utf8'),statements=sqlStatements(sql),tokens=statements.map(sqlTokens);
assert.equal(tokens.filter(t=>t.join('')==='begin;').length,1);assert.equal(tokens.filter(t=>t.join('')==='commit;').length,1);
assert(tokens.some(t=>t.includes("'Pause the legacy Production scheduler before schema upgrade'"))===false,'Dollar bodies must remain opaque tokens');
for(const t of tokens){
 const command=t[0];
 assert(!['delete','truncate','copy'].includes(command),'Upgrade contains top-level data deletion/import');
 if(command==='insert')assert(t.join(' ').includes('sportsbook_private'),'Upgrade copies application/financial rows automatically');
 if(command==='select')assert(!t.join(' ').includes('cron . schedule'),'Upgrade schedules a worker automatically');
}
assert(sql.includes('suppress_production_notifications'));assert(sql.includes('production_legacy_routes'));
assert(!sql.includes('CREATE TABLE public.tickets'),'Upgrade recreates original tickets');
console.log('PASS: SQL splitter quotes/comments; one atomic transaction; no top-level application import/deletion, automatic funding, or cron scheduling; Production profile and legacy mail fence retained.');
