import { createRoot } from "react-dom/client";
import { Sportsbook } from "./components/Sportsbook";
import type { AccountData, Membership, Team } from "./lib/accounts";
import type { Board, Market } from "./lib/markets";
import "./index.css";
import "./App.css";

const teams: Team[] = [
  {id:"t1",league_id:"review",roster_id:1,team_name:"The Rebuild",sportsbook_owner_id:"cgurrie",sportsbook_owner_name:"Cooper",co_owner_names:[],avatar_url:null,wins:3,losses:1,ties:0},
  {id:"t2",league_id:"review",roster_id:2,team_name:"Hellbean",sportsbook_owner_id:"phillipwood",sportsbook_owner_name:"Phillip",co_owner_names:[],avatar_url:null,wins:2,losses:2,ties:0},
  {id:"t3",league_id:"review",roster_id:3,team_name:"Diabloo",sportsbook_owner_id:"nellyknowsball",sportsbook_owner_name:"Nelson",co_owner_names:[],avatar_url:null,wins:1,losses:3,ties:0},
  {id:"t4",league_id:"review",roster_id:4,team_name:"Thank You Josh Allen",sportsbook_owner_id:"ben",sportsbook_owner_name:"Ben",co_owner_names:[],avatar_url:null,wins:0,losses:4,ties:0},
];
const market=(id:string,matchup:string,kind:Market["kind"],label:string,side:string,odds:number,extra:Partial<Market>={}):Market=>({id,board_id:"board",market_key:id,matchup_key:matchup,kind,label,subject:label,side,line:null,odds,boost_pct:0,team_id:null,home_team_id:null,away_team_id:null,home_projection:null,away_projection:null,featured:"",metadata:{},active:true,...extra});
const markets:Market[]=[];
function matchup(key:string,home:Team,away:Team,featured:Market["featured"],hp:number,ap:number){
 const spread=key+"-spread", total=key+"-total", ml=key+"-ml";
 markets.push(market(spread+"h",key,"spread",home.team_name+" +1.5","home",-110,{team_id:home.id,home_team_id:home.id,away_team_id:away.id,line:1.5,featured,home_projection:hp,away_projection:ap}),market(spread+"a",key,"spread",away.team_name+" -1.5","away",-110,{team_id:away.id,home_team_id:home.id,away_team_id:away.id,line:-1.5,featured,home_projection:hp,away_projection:ap}),market(total+"o",key,"match_total","Over 294.5","over",-110,{home_team_id:home.id,away_team_id:away.id,line:294.5,featured,home_projection:hp,away_projection:ap}),market(total+"u",key,"match_total","Under 294.5","under",-110,{home_team_id:home.id,away_team_id:away.id,line:294.5,featured,home_projection:hp,away_projection:ap}),market(ml+"h",key,"moneyline","Win · "+home.team_name,"home",114,{team_id:home.id,home_team_id:home.id,away_team_id:away.id,featured,home_projection:hp,away_projection:ap}),market(ml+"a",key,"moneyline","Win · "+away.team_name,"away",-134,{team_id:away.id,home_team_id:home.id,away_team_id:away.id,featured,home_projection:hp,away_projection:ap}));
}
matchup("m1",teams[0],teams[1],"Game of the Week",149.5,147.2);markets.filter(m=>m.matchup_key==="m1"&&m.kind==="moneyline").forEach(m=>m.boost_pct=25);
matchup("m2",teams[2],teams[3],"Tank Bowl",132.4,128.1);markets.filter(m=>m.matchup_key==="m2"&&(m.kind==="moneyline"||(m.kind==="match_total"&&m.side==="over"))).forEach(m=>m.boost_pct=25);
for(const [i,player] of ["Josh Allen","Justin Jefferson","Bijan Robinson","Lamar Jackson","Ja’Marr Chase","Saquon Barkley","Patrick Mahomes","CeeDee Lamb"].entries()) {
 const home=i<6?teams[0]:teams[2], away=i<6?teams[1]:teams[3], key=i<6?"m1":"m2", own=i%2===0?home:away;
 for(const side of ["over","under"]) markets.push(market(`player-${i}-${side}`,key,"player_points",`${player} ${side==='over'?'Over':'Under'} ${24-i}`,side,-110,{market_key:`player-${i}`,subject:player,line:24-i,team_id:own.id,home_team_id:home.id,away_team_id:away.id,home_projection:149.5,away_projection:147.2,metadata:{position:i%3===0?'QB':i%3===1?'WR':'RB',nfl_team:'BUF',season_average:25-i,projection:24-i,game_info:'Sun 1:00 PM vs. ATL'}}));
}
for(let n=1;n<=12;n++) markets.push(market(`count-${n}`,"","weekly_count_150",`${n} ${n===1?"Team":"Teams"} Scoring 150+`,String(n),[4500,1700,650,330,250,300,550,1100,2700,6800,15000,40000][n-1],{market_key:"weekly-count",matchup_key:null,line:n,subject:"How Many Teams Will Score 150+?"}));
for(const kind of ["weekly_any_below_100","weekly_any_200"] as const) for(const side of ["yes","no"]) markets.push(market(`${kind}-${side}`,"",kind,side==="yes"?"Yes":"No",side,side==="yes"?180:-220,{market_key:kind,matchup_key:null,subject:kind==="weekly_any_200"?"Will Any Team Score 200+?":"Will Any Team Score Below 100?"}));
const board:Board={id:"board",league_id:"review",market_week:5,nfl_season:2026,league_season:3,status:"published",revision:3,opens_at:new Date(Date.now()-3600000).toISOString(),closes_at:new Date(Date.now()+86400000).toISOString()};
const data:AccountData={leagues:[{id:"review",name:"Goldy League",league_season:3,nfl_season:2026,avatar_url:null}],teams,memberships:teams.map((t,i)=>({id:"member"+i,league_id:"review",team_id:t.id,user_id:null,invited_email:"",display_name:t.sportsbook_owner_name,role:i===0?"admin":"member"})),wallets:teams.map(t=>({team_id:t.id,balance:100})),events:[],ledger:[],tickets:[],legs:[]};
const member:Membership=data.memberships[0];
document.documentElement.dataset.theme="dark";
createRoot(document.getElementById("root")!).render(<div className="app-shell"><header className="masthead"><div className="brand"><div className="avatar">G</div><div><strong>Goldy Plays Pretend With Men</strong><span>Fantasy Sportsbook</span></div></div><div className="account-tools"><button className="theme-toggle" aria-label="Theme Preview">☼</button><span className="profile">Cooper⌄</span></div></header><Sportsbook data={data} member={member} refresh={async()=>{}} review={{board,markets,standings:[]}}/><footer>Goldy Fantasy Sportsbook · Local Review</footer></div>);
