import {isDevelopment} from "./environment";
import React from "react";
import {createRoot} from "react-dom/client";
import {auth,bookRequest,receipt} from "./live";
import {DevSignIn} from "./DevSignIn";
import {clearAccountState} from "./accountState";
import "./styles.css";
import "./refinements.css";
import "./brand.css";
import {BoffScreen,StatusPanel} from "./BrandedState";
try{document.documentElement.dataset.theme=localStorage.getItem("boff-visual-theme")==="dark"?"dark":"light";}catch{}
const root=createRoot(document.getElementById("root")!);
async function start(){
 root.render(<BoffScreen><StatusPanel title="Connecting To Your League" kind="loading" heading="h1">Loading your teams, markets and account.</StatusPanel></BoffScreen>);
 const {data:{session}}=await auth.auth.getSession();
 let activeUser=session?.user.id;
 auth.auth.onAuthStateChange((event,next)=>{
  if(event==="INITIAL_SESSION" || next?.user.id===activeUser) return;
  clearAccountState(activeUser);
  activeUser=next?.user.id;
  delete (window as any).__boffLive;
  root.render(<DevSignIn/>);
  if(next) location.reload();
 });
 if(location.pathname==='/join'){
  const {MemberInvitation}=await import('./MemberInvitation');root.render(<MemberInvitation/>);return;
 }
 if(!session){root.render(<DevSignIn/>);return;}
 if(location.pathname==="/communications"){
  const {EmailReader}=await import("./EmailReader");root.render(<EmailReader/>);return;
 }
 try{
  const data=await bookRequest();(window as any).__boffLive=data;
  if(activeUser!==session.user.id){delete (window as any).__boffLive;return;}
  const [{default:fixture},{default:players}]=await Promise.all([import("./data.json"),import("./players.json")]);
  const payload=data.book.payload;
  Object.assign(fixture,{week:data.board.market_week,season:data.board.nfl_season,league:payload.leagueName,avatar:payload.leagueAvatar,teams:payload.teams,markets:data.quotes.filter((q:any)=>["spread","moneyline","match_total"].includes(q.kind)&&!q.metadata?.alternate).map((q:any)=>({id:q.id,away:q.away_team_id,home:q.home_team_id,kind:q.kind,line:q.line,odds:q.odds,side:q.side,boost:q.boost_pct,matchup:q.matchup_key,team_id:q.team_id,featured:q.featured,ui_id:q.metadata.ui_id,away_projection:q.away_projection,home_projection:q.home_projection})),provenance:isDevelopment?"Live Sleeper · Dev":"Live Sleeper",rosterSnapshot:"Current Week",playerContext:{season:data.board.nfl_season,throughWeek:data.board.market_week-1,gameContextWeek:data.board.market_week,scoring:"Current Sleeper Scoring"},rosterPositions:payload.positions,finalScores:payload.teams.map((t:any)=>({roster:t.roster_id,points:t.observed})),regularSeasonWeeks:payload.regularSeasonWeeks,offerCutoffs:{earliestGame:payload.firstGame,sundayGame:payload.firstGame}});
  players.splice(0,players.length,...payload.players);
  const model=await import("./model");model.exampleTickets.splice(0,model.exampleTickets.length,...data.tickets.map((t:any)=>receipt(t,data)));
  const {installRouting}=await import("./routing");installRouting();
  const {default:App}=await import("./App");if(activeUser!==session.user.id)return;root.render(<React.StrictMode><App/></React.StrictMode>);
 }catch(e){
  const access=/not mapped|not linked|not authorized|access.*revoked/i.test((e as Error).message);
  root.render(<BoffScreen><StatusPanel title={access?"League Access Required":"League Unavailable"} kind={access?"access":"error"} heading="h1"
   action={<><button className="button primary" onClick={()=>location.reload()}>Retry</button><button className="button secondary" onClick={async()=>{await auth.auth.signOut();location.reload();}}>Sign Out</button></>}>
   {access?"This account isn’t linked to this league. Ask your commissioner for an invitation, or sign in with the invited email.":"We couldn’t load your league. Check your connection and try again."}
  </StatusPanel></BoffScreen>);
 }
}
start().catch(()=>root.render(<BoffScreen><StatusPanel kind="error" heading="h1" title="Connection Unavailable" action={<button className="button primary" onClick={()=>location.reload()}>Retry</button>}>We couldn’t connect to your account. Check your connection and try again.</StatusPanel></BoffScreen>));
