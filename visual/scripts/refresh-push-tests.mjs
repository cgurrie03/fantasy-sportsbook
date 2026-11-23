import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRefreshGate} from '../src/refreshPolicy.ts';
import {pushTarget} from '../server/push-target.ts';
const gate=createRefreshGate();
assert.equal(gate.begin(0,true),false,'hidden tabs perform no polling');
assert.equal(gate.begin(0,false,true),false,'placement cannot race a refresh');
assert.equal(gate.begin(0),true);
assert.equal(gate.begin(60000),false,'a slow request cannot overlap');
gate.finish(60000,false);
assert.equal(gate.begin(119999),false);
assert.equal(gate.begin(120000),true);
gate.finish(120000,false);
assert.equal(gate.begin(239999),false,'second failure backs off to two minutes');
assert.equal(gate.begin(240000),true);
gate.finish(240000,false);
assert.equal(gate.begin(479999),false);
assert.equal(gate.begin(480000),true);
gate.finish(480000,false);
assert.equal(gate.begin(779999),false);
assert.equal(gate.begin(780000),true,'retry delay caps at five minutes');
gate.finish(780000,true);
assert.equal(gate.begin(784999),false,'duplicate focus/visibility events stay fenced');
assert.equal(gate.begin(840000),true,'success restores the minute cadence');
const ticket='11111111-1111-4111-8111-111111111111';
assert.equal(pushTarget('settled','settled:'+ticket),'/1312126153980391424/my-bets?ticket='+ticket);
assert.equal(pushTarget('leg','leg:'+ticket+':2'),'/1312126153980391424/my-bets?ticket='+ticket);
assert.equal(pushTarget('settled','settled:https://evil.test'),'/1312126153980391424/my-bets');
const handlers={},shown=[],opened=[],navigated=[];
let existing=[];
const context={URL,self:{location:{origin:'https://dev.sportsbook.coopergurrie.com'},
 addEventListener:(name,fn)=>handlers[name]=fn,
 registration:{showNotification:async(title,options)=>shown.push({title,options})},
 clients:{matchAll:async()=>existing,openWindow:async url=>opened.push(url)}}};
vm.runInNewContext(fs.readFileSync('visual/public/notifications-sw.js','utf8'),context);
let completion;
handlers.push({data:{json:()=>({title:'Ticket Settled',url:pushTarget('settled','settled:'+ticket),tag:'settled:'+ticket})},waitUntil:p=>completion=p});
await completion;
assert.equal(shown[0].options.data.url,'https://dev.sportsbook.coopergurrie.com'+pushTarget('settled','settled:'+ticket));
handlers.notificationclick({notification:{close(){},data:shown[0].options.data},waitUntil:p=>completion=p});
await completion;assert.equal(opened[0],shown[0].options.data.url);
existing=[{url:'https://dev.sportsbook.coopergurrie.com/',navigate:async url=>navigated.push(url),focus:async()=>navigated.push('focused')}];
handlers.notificationclick({notification:{close(){},data:{url:'https://evil.test/phish'}},waitUntil:p=>completion=p});
await completion;
assert.deepEqual(navigated,['https://dev.sportsbook.coopergurrie.com/1312126153980391424/matchups','focused']);
console.log('PASS: refresh outage/recovery, overlap/visibility fences, ticket push destinations and external-URL rejection');
let sendFailure,sendCount=0,notificationPayload;
const pushExports={};
vm.runInNewContext(ts.transpile(fs.readFileSync('visual/server/notification-push.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),{
 exports:pushExports,URL,require:name=>name.includes('push-target')?{pushTarget}:{__esModule:true,default:{
  sendNotification:async(_subscription,payload)=>{sendCount++;notificationPayload=JSON.parse(payload);if(sendFailure)throw sendFailure;}
 }},
});
const recorded=[],db=async(path,method,body)=>recorded.push({path,method,body});
const device={id:'fixture',endpoint:'https://web.push.apple.com/test',keys:{auth:'fixture',p256dh:'fixture'}};
await pushExports.deliverPush(db,'league','settled:'+ticket,device,{},'Ticket Settled');
assert.equal(notificationPayload.url,pushTarget('settled','settled:'+ticket));
assert.equal(recorded.length,1);assert.equal(recorded[0].body.p_expired,false);
for(const statusCode of [404,410]){
 sendFailure={statusCode};await pushExports.deliverPush(db,'league','settled:'+ticket,device,{},'Ticket Settled');
 assert.equal(recorded.at(-1).body.p_expired,true);
}
sendFailure={statusCode:503};const before=recorded.length;
await assert.rejects(pushExports.deliverPush(db,'league','settled:'+ticket,device,{},'Ticket Settled'));
assert.equal(recorded.length,before,'temporary delivery failures remain retryable');
const previousCount=sendCount;
await pushExports.deliverPush(db,'league','opening:key',{...device,endpoint:'https://127.0.0.1/test'},{},'Test');
assert.equal(sendCount,previousCount,'unapproved endpoints cannot send requests');
console.log('PASS: push payload, delivery receipt, expired subscription cleanup, retry preservation and endpoint restriction');
