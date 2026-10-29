import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { readAssessmentRows } from "../api/_lib/assessment-reads.ts";

const db = new PGlite();
const league = randomUUID(), other = randomUUID();
const rows = async (sql, args=[]) => (await db.query(sql,args)).rows;
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
    grant usage on schema public,auth to authenticated,anon;`);
  await db.exec(await fs.readFile("supabase/development/baseline-schema.sql","utf8"));
  await db.exec(await fs.readFile("supabase/migrations/20261028210237_bounded_model_review_reads.sql","utf8"));
  for (const id of [league,other]) await rows(`insert into leagues(id,name,sleeper_league_id,nfl_season,league_season)
    values($1::uuid,'Review fixture',$1::text,2026,1)`,[id]);
  const board = randomUUID();
  await rows(`insert into sportsbook_boards(id,league_id,market_week,nfl_season,league_season,opens_at,closes_at)
    values($1,$2,4,2026,1,'2026-10-07','2026-10-09')`,[board,league]);
  const opening = "11111111-1111-4111-8111-111111111111";
  const later = "22222222-2222-4222-8222-222222222222";
  const quote = {
    id: randomUUID(), market_key: "future:champion:1",kind: "future_champion",side:"win",line:null,
    metadata:{ assessment_run_id:opening,roster_id:1,fair_probability:0.25,
      expected_wins:7.2,win_distribution:{7:0.8,8:0.2},
      home_lineup:"FORBIDDEN_RAW_INPUT".repeat(10000),scoring_settings:{pts:1} },
  };
  await rows(`insert into forecast_snapshots(league_id,board_id,revision,nfl_season,market_week,board_type,opens_at,closes_at,quotes)
    values($1,$2,1,2026,4,'weekly','2026-10-07','2026-10-09',$3::jsonb)`,[league,board,JSON.stringify([quote])]);
  for (const [id,scope,at] of [[later,league,"2026-10-08"],[opening,league,"2026-10-07"],[randomUUID(),other,"2026-10-06"]]) {
    const version=(await rows("select active_id from model_controls where league_id=$1",[scope]))[0].active_id;
    await rows(`insert into model_forecast_runs(id,league_id,nfl_season,market_week,category,captured_at,phase,provenance,
      model_version,model_config,source_hash,sources,payload)
      values($1,$2,2026,4,'Season Futures',$3,'pregame','as_of',$4,'{"score_scale":1,"variance_scale":1}',
        'hash','{"raw":"FORBIDDEN_RAW_INPUT"}',$5::jsonb)`,[id,scope,at,version,JSON.stringify({quotes:[quote],models:[],pool:[]})]);
  }
  await rows(`insert into model_outcome_revisions(id,league_id,nfl_season,market_week,outcome_hash,outcome)
    values($1,$2,2026,3,'fixture','{}')`,[opening,league]);
  for (const id of [opening,later]) await rows(`insert into model_weekly_reviews(id,league_id,nfl_season,market_week,
    created_at,outcome_id,input_hash,report,comparison) values($1::uuid,$2,2026,3,'2026-10-05',$3,$1::text,'{"cutoff":"2026-10-01"}','{}')`,[id,league,opening]);
  await db.exec("set row_security=on;set role service_role;");
  const publication=(await rows("select quotes from sportsbook_model_publications where league_id=$1 and nfl_season=2026 and market_week=4",[league]))[0];
  assert.deepEqual(publication.quotes,[{market_key:quote.market_key,side:quote.side,line:null,metadata:{assessment_run_id:opening}}]);
  const futures=await rows("select id,quotes from sportsbook_model_future_openings where league_id=$1 and nfl_season=2026",[league]);
  assert.equal(futures.length,1); assert.equal(futures[0].id,opening);
  assert.equal(futures[0].quotes[0].metadata.fair_probability,0.25);
  assert.deepEqual(futures[0].quotes[0].metadata.win_distribution,{7:0.8,8:0.2});
  assert(!JSON.stringify(futures).includes("FORBIDDEN_RAW_INPUT"));
  assert(JSON.stringify(publication).length < JSON.stringify([quote]).length / 100);
  const latest=await rows("select id from sportsbook_model_latest_reviews where league_id=$1 and period<202604",[league]);
  assert.deepEqual(latest,[{id:later}],"Created-at ties use the same highest-ID latest review as the previous reader");
  for (const role of ["authenticated","anon"]) {
    await db.exec(`reset role;set role ${role};`);
    for (const view of ["sportsbook_model_publications","sportsbook_model_future_openings","sportsbook_model_latest_reviews"])
      await assert.rejects(rows(`select * from ${view}`), /permission denied/);
  }
} finally { await db.close(); }

const calls=[];
const input=[{id:"1"},{id:"2"},{id:"3"}];
const mock={from(table){const call={table,filters:[],orders:[]};calls.push(call);
  const query={select(columns){call.columns=columns;return query},eq(k,v){call.filters.push([k,v]);return query},
    order(k){call.orders.push(k);return query},range(from,to){call.range=[from,to];return query},
    then(resolve){return Promise.resolve({data:input.slice(call.range[0],call.range[1]+1),error:null}).then(resolve)}};return query}};
assert.deepEqual(await readAssessmentRows(mock,"sportsbook_model_publications",league,"id,quotes",{season:2026,week:4,pageSize:2}),input);
assert.deepEqual(calls.map(c=>c.range),[[0,1],[2,3]]);
assert(calls.every(c=>JSON.stringify(c.filters)===JSON.stringify([["league_id",league],["nfl_season",2026],["market_week",4]])));
await assert.rejects(readAssessmentRows(mock,"forecast_snapshots",league,"*"),/explicit columns/);
console.log("Worker review projections preserve publication/futures metrics, exclude raw inputs and repeated futures origins, enforce roles and bound exact-week pages.");
