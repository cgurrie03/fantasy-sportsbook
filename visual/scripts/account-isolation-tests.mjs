import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import handler from '../api/book.mjs';

const originalFetch=globalThis.fetch;
const previousEnv={...process.env};
Object.assign(process.env,{VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'prj_X7XPj0svAnCB9TWU7JQ1EvDjSlts',SUPABASE_URL:'https://whlcnlacueweaqpsupqs.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-service'});
async function book({id='member-a',admin=false,wallet=true}={}) {
 const calls=[];const walletId='wallet-'+id;
 globalThis.fetch=async(url,options)=>{
  const parsed=new URL(url),path=parsed.pathname;calls.push({path,query:parsed.searchParams,options});
  let body=[];
  if(path==='/auth/v1/user')body={id,email:id+'@example.invalid',email_confirmed_at:'2026-11-17'};
  else if(path.endsWith('/league_memberships'))body=[{team_id:'shared-team',display_name:id,role:admin?'admin':'member'}];
  else if(path.endsWith('/user_wallets'))body=wallet?[{id:walletId,balance:75,status:'approved'}]:[];
  else if(path.endsWith('/user_wallet_entries')){
   assert.equal(parsed.searchParams.get('wallet_id'),'eq.'+walletId,'personal history must use the exact authenticated wallet');
   assert.equal(options.headers.Authorization,'Bearer user-token','personal entries must retain caller RLS');
   body=[{id:'own-entry',wallet_id:walletId}];
  } else if(path.endsWith('/wallet_ledger'))throw Error('Unowned legacy ledger must never be read for personal history');
  else if(path.endsWith('/dev_weekly_snapshot'))body={board:{nfl_season:2026,market_week:11},book:{payload:{}}};
  else if(path.includes('/rpc/'))body={};
  return new Response(JSON.stringify(body),{status:200});
 };
 let status,data;const response={setHeader(){},status(s){status=s;return this},json(d){data=d;return this}};
 await handler({method:'GET',url:'/api/book',headers:{authorization:'Bearer user-token'}},response);
 assert.equal(status,200,JSON.stringify(data));
 assert.deepEqual(data.ledger,[],'History must be deferred rather than included on every board read');
 assert.equal(calls.some(c=>c.path.endsWith('/user_wallet_entries')),false);
 assert.equal(data.user.email,id+'@example.invalid');
 assert.equal(calls.some(c=>c.path.endsWith('/wallet_ledger')),false);
 return data;
}
try {
 await book();await book({id:'co-manager-b'});await book({id:'replacement-c'});await book({id:'owner',admin:true});await book({id:'no-wallet',wallet:false});
 console.log('PASS: member/co-manager/replacement/owner startup defers personal history; no legacy ledger read; verified email returned');
} finally {globalThis.fetch=originalFetch;process.env=previousEnv;}

const storage=new Map([['boff-visual-profile',JSON.stringify({name:'Previous Account',email:'private@example.invalid'})]]);
const exports={};vm.runInNewContext(ts.transpile(fs.readFileSync('visual/src/accountState.ts','utf8'),{module:ts.ModuleKind.CommonJS}),{exports,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
const a={id:'account-a',name:'Alice',email:'alice@example.invalid'},b={id:'account-b',name:'Bob',email:'bob@example.invalid'};
assert.equal(exports.accountProfile(a).name,'Alice');assert.equal(storage.has('boff-visual-profile'),false);
exports.saveAccountProfile(a,'Alice Custom');
assert.equal(exports.accountProfile(b).name,'Bob');assert.equal(exports.accountProfile(b).email,b.email);
assert.equal(exports.accountProfile(a).name,'Alice Custom');
storage.set(exports.accountStorageKey('profile',b.id),JSON.stringify({name:'Bob Custom',email:a.email}));
assert.equal(exports.accountProfile(b).email,b.email,'cached email must never override verified Auth email');
exports.clearAccountState(a.id);assert.equal(exports.accountProfile(a).name,'Alice');assert.equal(exports.accountProfile(b).name,'Bob Custom');
storage.set(exports.accountStorageKey('profile',a.id),'broken');assert.equal(exports.accountProfile(a).name,'Alice');
console.log('PASS: legacy profile discarded, names account-scoped, cached email ignored, sign-out clears only current profile, malformed storage tolerated');
