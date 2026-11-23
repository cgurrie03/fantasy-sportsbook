import assert from 'node:assert/strict';
import handler from '../api/book.mjs';
const fetchBefore=globalThis.fetch,env={...process.env};
Object.assign(process.env,{VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'prj_X7XPj0svAnCB9TWU7JQ1EvDjSlts',SUPABASE_URL:'https://whlcnlacueweaqpsupqs.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-fixture'});
let calls=[];
globalThis.fetch=async(url,options)=>{
 const path=new URL(url).pathname;calls.push({url,path,options});
 if(path.endsWith('/user'))return Response.json({id:'11111111-1111-4111-8111-111111111111',email_confirmed_at:'2026-11-18'});
 if(path.endsWith('/league_memberships'))return Response.json([{team_id:'fixture',role:'member'}]);
 if(path.endsWith('/dev_ticket_history_page')||path.endsWith('/dev_balance_history_page')){
  assert.equal(options.headers.Authorization,'Bearer user-fixture');return Response.json({tickets:[],entries:[],next:null});
 }
 if(path.endsWith('/dev_weekly_changes'))return Response.json({mode:'unchanged',futures:null});
 if(path.endsWith('/dev_weekly_offer_changes'))return Response.json({version:'a'.repeat(32)});
 if(path.endsWith('/place_dev_ticket'))return Response.json({ticket_id:'accepted-fixture'});
 throw Error('Unexpected expensive request: '+url);
};
async function request(url,method='GET',body){
 calls=[];let status,data;await handler({url,method,body,headers:{authorization:'Bearer user-fixture'}},{setHeader(){},status(s){status=s;return this},json(d){data=d;return this}});
 return {status,data,calls};
}
try{
 for(const url of ['/api/book?version=','/api/book?version='+('a'.repeat(181)),'/api/book?offers=bad','/api/book?prices=2','/api/book?version=a&version=b','/api/book?futures=bad','/api/book?history=bad','/api/book?size=1000','/api/book?week=19','/api/book?cursor={}']){
  const r=await request(url);assert.equal(r.status,400,url);assert.equal(r.calls.length,0);
 }
 for(const body of ['{',null,[],false]){const r=await request('/api/book','POST',body);assert.equal(r.status,400);assert.equal(r.calls.length,0);}
 assert.equal((await request('/api/book','POST','x'.repeat(40000))).status,413);
 const valid={boardId:'11111111-1111-4111-8111-111111111111',requestId:'22222222-2222-4222-8222-222222222222',revision:1,picks:['33333333-3333-4333-8333-333333333333'],stake:5,futures:false};
 assert.equal((await request('/api/book','POST',JSON.stringify(valid))).status,200);
 for(const body of [{...valid,requestId:'bad'},{...valid,picks:['bad']},{...valid,revision:'1'},{...valid,stake:-1},{...valid,offerSlot:{}}]){
  const result=await request('/api/book','POST',JSON.stringify(body));assert.equal(result.status,400);assert.equal(result.calls.length,0);
 }
 const tickets=await request('/api/book?history=tickets&mine=1&status=Won&sort=stake-high&search=Allen&size=25');
 assert.equal(tickets.status,200);const p=JSON.parse(tickets.calls.at(-1).options.body);assert.equal(p.p_mine,true);assert.equal(p.p_search,'Allen');assert.equal(p.p_sort,'stake-high');
 const ledger=await request('/api/book?history=ledger');assert.equal(ledger.status,200);assert.equal(ledger.calls.some(c=>c.path.includes('dev_weekly_snapshot')),false);
 const lean=await request('/api/book?prices=1&version=valid_revision');assert.equal(lean.status,200);assert.equal(lean.data.lightweight,true);assert.equal(lean.calls.length,4);
 console.log('PASS malformed JSON/parameters rejected before reads; bounded cursor/page/filter arguments; authenticated history RPCs; unchanged board stays lightweight');
}finally{globalThis.fetch=fetchBefore;process.env=env;}
