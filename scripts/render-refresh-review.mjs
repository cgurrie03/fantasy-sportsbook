import fs from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const { Sportsbook }=await server.ssrLoadModule('/src/components/Sportsbook.tsx');
 const teams=[{id:'a',roster_id:1,team_name:'The 20 Year Rebuild',wins:3,losses:1,ties:0},{id:'b',roster_id:2,team_name:'Puka’s rehab facility',wins:2,losses:2,ties:0}];
 const member={id:'review',league_id:'review',team_id:'a',display_name:'Cooper',role:'admin'};
 const data={teams,memberships:[member],wallets:[{team_id:'a',balance:100}],tickets:[],legs:[],ledger:[],leagues:[]};
 const board={id:'review-board',league_id:'review',market_week:5,nfl_season:2026,league_season:3,status:'published',revision:7,opens_at:'2026-10-07T12:00:00Z',closes_at:'2026-10-09T00:00:00Z',phase:'live',suspension_reason:'Live betting is unavailable while remaining-points pricing is being verified.'};
 const markets=[['spread','a',-4.5,-110],['spread','b',4.5,-110],['moneyline','a',null,-150],['moneyline','b',null,130],['match_total','over',250.5,-110],['match_total','under',250.5,-110]].map(([kind,side,line,odds],i)=>({id:'q'+i,board_id:board.id,market_key:kind,matchup_key:'a-b',kind,side,line,odds,label:kind==='match_total'?`${side} ${line}`:`${teams.find(t=>t.id===side)?.team_name}${line===null?'':` ${line>0?'+':''}${line}`}`,subject:'Week 5',team_id:kind==='match_total'?null:side,home_team_id:'a',away_team_id:'b',home_projection:127.5,away_projection:123,boost_pct:0,featured:'',metadata:{},active:true}));
 const review={board,markets,standings:[]};
 const props={data,member,review,refresh:async()=>{}};
 const html=renderToString(React.createElement(Sportsbook,props));
 fs.writeFileSync('stage1-refresh-review.html',`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scheduled Lines and Live Safety Preview</title><link rel="stylesheet" href="/src/index.css"><link rel="stylesheet" href="/src/App.css"><link rel="stylesheet" href="/src/components/Sportsbook.css"></head><body><div class="app-shell"><header class="masthead"><div class="brand"><div><strong>Goldy Plays Pretend With Men</strong><span>Fantasy Sportsbook</span></div></div></header><div id="root">${html}</div></div><script id="props" type="application/json">${JSON.stringify(props).replaceAll('<','\\u003c')}</script><script type="module">import React from 'react';import{hydrateRoot}from'react-dom/client';import{Sportsbook}from'/src/components/Sportsbook.tsx';const props=JSON.parse(document.getElementById('props').textContent);hydrateRoot(document.getElementById('root'),React.createElement(Sportsbook,{...props,refresh:async()=>{}}));</script></body></html>`);
 console.log('Generated local review with illustrative markets. No tickets or emails can be created.');
} finally {await server.close();}
