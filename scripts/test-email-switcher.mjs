import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import validator from 'amphtml-validator';
import nodemailer from 'nodemailer';
import {renderLeagueSwitcherEmail,readerDropdown,renderLeagueReport,switchableEmailKinds} from '../visual/server/email-switcher.ts';

const origin='https://dev.sportsbook.coopergurrie.com';
const first={id:'11111111-1111-4111-8111-111111111111',name:'goldy plays pretend with men',path:'/123',week:10,details:true,teamId:'a',
 payload:{teams:[{id:'a',name:'Seaside Sharks',avatar:'abc',observed:150,projection:140,matchupId:'1'},{id:'b',name:'Copper Owls',observed:120,projection:130,matchupId:'1'}]},
 edition:{balance:75,claim:50,openStakes:10,futureStakes:20,performance:{Won:3,Lost:1}}};
const second={...first,id:'22222222-2222-4222-8222-222222222222',name:'Harbor League',path:'/456',payload:{teams:first.payload.teams.map(team=>({...team,name:team.id==='a'?'Harbor Hawks':'Forest Foxes'}))},edition:{...first.edition,balance:82}};
const ampValidator=await validator.getInstance();
for(const kind of switchableEmailKinds)for(const details of [false,true]){
 const rows=[{...first,details},{...second,details}];
 const message=renderLeagueSwitcherEmail(rows,kind,origin,first.id);
 const result=ampValidator.validateString(message.amp,'AMP4EMAIL');
 assert.equal(result.status,'PASS',JSON.stringify(result.errors));
 assert.ok(!message.html.includes('Harbor League'),'HTML fallback contains only one league');
 assert.ok(message.html.includes('/communications?kind='+kind));
 assert.equal((message.amp.match(/<section/g)||[]).length,2);
 assert.ok(message.amp.includes("focus.league != '1'"));
 assert.ok(message.amp.includes('AMP.setState({focus:{league:event.targetOption,menu:false}})'));
 assert.ok(message.amp.includes('amp-img'));
 assert.ok(Buffer.byteLength(message.amp)<200000);
 if(kind==='opening'&&details){
  await fs.writeFile('work/email-switcher.amp.html',message.amp);
  await fs.writeFile('work/email-reader-fixture.json',JSON.stringify({rows,kind}));
 }
 const reader=readerDropdown(renderLeagueReport(rows[1],kind,origin).html,rows,second.id);
 assert.equal(renderLeagueReport({...rows[1],details:false},kind,origin).html,renderLeagueReport({...rows[1],details:true},kind,origin).html,'Legacy brief flag cannot select a different template');
 assert.ok(reader.includes('value="'+second.id+'" selected'));
 assert.ok(reader.includes('Harbor Hawks'));
 assert.ok(!reader.includes('Seaside Sharks'));
}
assert.throws(()=>renderLeagueSwitcherEmail([second],'opening',origin,first.id),/primary/);
const hostile={...first,name:'League <script>alert(1)</script> & "One"'};
const safe=renderLeagueSwitcherEmail([hostile,second],'opening',origin,first.id);
assert.ok(!safe.amp.includes('<script>alert'));
assert.ok(safe.amp.includes('&lt;script&gt;'));
const large={...first,edition:{...first.edition,offers:Array.from({length:2000},()=>({slot:'x',title:'A long offer name',percent:25,picks:[]}))}};
assert.ok(Buffer.byteLength(renderLeagueSwitcherEmail([large,second],'opening',origin,first.id).amp)<200000);
const message=renderLeagueSwitcherEmail([first,second],'opening',origin,first.id);
const transport=nodemailer.createTransport({streamTransport:true,buffer:true,disableFileAccess:true,disableUrlAccess:true});
const composed=await transport.sendMail({from:'Boff <test@example.invalid>',to:'recipient@example.invalid',subject:message.subject,text:message.text,html:message.html,amp:message.amp,headers:{'Resend-Idempotency-Key':'fixture/1'}});
const mime=composed.message.toString();
assert.ok(mime.includes('multipart/alternative'));
assert.ok(mime.indexOf('Content-Type: text/plain')<mime.indexOf('Content-Type: text/x-amp-html'));
assert.ok(mime.indexOf('Content-Type: text/x-amp-html')<mime.indexOf('Content-Type: text/html'));
assert.ok(mime.includes('Resend-Idempotency-Key: fixture/1'));
console.log('PASS: all four full reports, legacy brief flags normalized, AMP validation, league isolation, escaping, size limit, and MIME fallbacks. No emails sent.');
