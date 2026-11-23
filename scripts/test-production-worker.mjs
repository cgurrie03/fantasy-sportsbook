import assert from 'node:assert/strict';
import {productionRunPolicy} from '../visual/server/release-worker-policy.ts';
import {workerTarget} from '../visual/server/runtime-target.ts';
const marker={environment:'production',project_ref:'bmvjcdgxwxqalaohpsnw',release_schema:'boff-person-wallets-2026-11',release_state:'prepared'};
const config={state:'prepared',season:2026,openingWeek:11,tokenHash:'a'.repeat(64),baselineAt:new Date().toISOString(),notificationsEnabled:false};
assert(productionRunPolicy(marker,config,'warmup',config.tokenHash).warmup);
assert.throws(()=>productionRunPolicy(marker,config,'scheduled',config.tokenHash),/not_active/);
for(const altered of [{...config,tokenHash:'b'.repeat(64)},{...config,state:'active'},{...config,baselineAt:'bad'},{...config,openingWeek:0},null])
 assert.throws(()=>productionRunPolicy(marker,altered,'warmup',config.tokenHash));
const activeMarker={...marker,release_state:'active'},active={...config,state:'active'};
assert.equal(productionRunPolicy(activeMarker,active,'scheduled',config.tokenHash).notificationsEnabled,false);
assert.throws(()=>productionRunPolicy(activeMarker,active,'warmup',config.tokenHash));
assert.throws(()=>productionRunPolicy(activeMarker,active,'other',config.tokenHash));
assert.equal(workerTarget({target:'production',url:'https://whlcnlacueweaqpsupqs.supabase.co',schema:marker.release_schema}),null);
assert.equal(workerTarget({target:'production',url:'https://bmvjcdgxwxqalaohpsnw.supabase.co'}),null);
console.log('PASS: Production target, token/configuration identity, prepared/active separation, baseline validation and disabled notification delivery.');
