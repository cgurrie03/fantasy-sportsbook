import assert from 'node:assert/strict';
import {prepareConfirmations} from '../visual/lib/confirmation-capture.mjs';
import {createEmailBoard,renderAccountEmail,renderNotificationEmail,renderSignInPrototype,renderLeagueInvitation,emailKinds} from '../visual/server/notification-templates.ts';
const origin='https://sportsbook.coopergurrie.com',league='goldy plays pretend with men';
const teams=[{id:'a',name:'Team A',avatar:'a',matchupId:1,wins:5,losses:2,projection:140},{id:'b',name:'Team B',avatar:'b',matchupId:1,wins:4,losses:3,projection:130}];
const board=createEmailBoard({teams,leagueAvatar:'league'},[],origin,'/123','a',league);
const ticket={id:'11111111-1111-4111-8111-111111111111',status:'OPEN',stake:10,odds:264,potentialReturn:36.4,legs:[
 {game:{key:'1',current:false,teams:teams.map(t=>({name:t.name,score:150}))},selection:'Team A -3.5',status:'OPEN',odds:-110,market:'Spread'},
 {selection:'Over 270.5',status:'OPEN',odds:-110,market:'Match Total'}]};
board.edition={tickets:[ticket],balance:50,openStakes:10,futureStakes:5,claim:50,quotes:[],offers:[],rewards:[]};
const confirmation=renderAccountEmail('confirmation',board,{Week:12},ticket);
assert.equal(confirmation.subject,'Bet Confirmation · '+league);
assert(!confirmation.html.includes('Final Scores'));
assert(!confirmation.html.includes('Current progress unavailable'));
assert(confirmation.html.includes('Matchup'));
assert(confirmation.html.includes('Week 12'));
assert.equal((confirmation.html.match(/>View Your Bet</g)||[]).length,1);
assert(confirmation.html.includes('my-bets?ticket='+ticket.id));
assert(confirmation.html.indexOf('View Your Bet')>confirmation.html.indexOf('Potential Return'));
const captures=[];
const context={ticketId:ticket.id,leagueId:'league',userId:'user',teamId:'a',leagueName:league,path:'/123',week:12,payload:{teams},edition:{tickets:[ticket]}};
await prepareConfirmations(async(path,body)=>captures.push({path,body}),[context],{createEmailBoard,renderAccountEmail},origin);
assert.equal(captures[0].body.p_key,'confirmation:'+ticket.id);
assert.equal(captures[0].body.p_user,'user');assert.equal(captures[0].body.p_league,'league');
assert(captures[0].body.p_html.includes('my-bets?ticket='+ticket.id));
await assert.rejects(prepareConfirmations(async()=>assert.fail('Mismatched ticket captured'),[{...context,ticketId:'different'}],{createEmailBoard,renderAccountEmail},origin),/confirmation_ticket_unavailable/);
const messages=emailKinds.map(kind=>renderNotificationEmail(kind,true,{Week:12},origin,'/123',league,board));
const boosted=renderNotificationEmail('opening',true,{Week:12},origin,'/123',league,{...board,edition:{...board.edition,quotes:[{teamId:'a',matchup:'1',kind:'moneyline',side:'home',odds:150,boost:25,featured:'Playoff Race'}]}});
assert(boosted.html.includes('25% Boost'));
assert(!boosted.html.includes('25% Profit Boost'));
messages.push(confirmation,renderAccountEmail('attention',board,{Issue:'Missing result evidence'}),renderSignInPrototype(origin,30,true,league,board));
for(const existingAccount of [false,true])messages.push(renderLeagueInvitation({leagueName:league,teamName:'Team A',role:'Manager',url:origin+'/invite',board,existingAccount}));
for(const message of messages){
 assert(message.html.includes(league));assert(message.html.includes('Public Sans'));
 assert(message.html.includes('bgcolor="#ffffff"'));
 assert(message.html.includes('@media(prefers-color-scheme:dark)'));
 assert(!message.html.includes('undefined'));
 assert(Buffer.byteLength(message.html)<100000,'HTML risks inbox clipping');
 assert(message.html.includes('https://sportsbook.coopergurrie.com/'));
}
console.log('PASS: ten active templates, exact league capitalization, full format, confirmation accepted-term display, one direct ticket CTA, shared typography, HTML bounds and links. No emails sent.');
