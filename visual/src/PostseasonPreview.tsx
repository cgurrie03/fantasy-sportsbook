import {useState} from "react";
import source from "./postseason-source.json";
import {bracketLabel,ordinal} from "./postseason";
import type {BracketGame} from "./postseason";
import {teams} from "./model";
import {Avatar} from "./Markets";
import {PageHeading} from "./ui";
export function PostseasonPreview(){
 const [round,setRound]=useState(1),[lower,setLower]=useState<'consolation'|'toilet'>('consolation');
 return <div className="postseason-review"><PageHeading title="Postseason Review"/><p className="live-pricing-note">Real 2025 bracket and regular-season seeds · Current team names shown for recognition. No featured boosts.</p>
 <div className="board-toolbar"><div className="segmented">{[1,2,3].map(n=><button key={n} className={n===round?'active':''} onClick={()=>setRound(n)}>Round {n}</button>)}</div><label className="field">Lower Bracket <select aria-label="Lower Bracket Format" value={lower} onChange={e=>setLower(e.target.value as typeof lower)}><option value="consolation">Consolation (Actual League)</option><option value="toilet">Toilet Bowl (Label Preview)</option></select></label></div>
 {lower==='toilet'&&<p className="live-pricing-note">Label example only. These real matchups came from a consolation bracket; a toilet bowl requires Sleeper's actual loser-advancing bracket.</p>}
 <div className="postseason-games">{([{kind:'playoffs',games:source.winners},{kind:lower,games:source.losers}] as {kind:'playoffs'|'consolation'|'toilet';games:BracketGame[]}[]).flatMap(({kind,games})=>games.filter(g=>g.r===round&&g.t1&&g.t2).map(g=><section className="panel postseason-game" key={kind+g.m}><header><strong>{bracketLabel(g,games,kind)}</strong><span>2025 · Round {g.r}</span></header><div className="postseason-pair">{[g.t1,g.t2].map((roster,i)=>{const t=teams.find(t=>t.roster_id===roster);const seed=source.seeds[String(roster) as keyof typeof source.seeds];return <div key={roster} className="postseason-team">{i===1&&<span className="postseason-vs">vs</span>}{t&&<Avatar team={t}/>}<span><strong>{t?.name||`Team ${roster}`}</strong><small>{ordinal(seed)} Seed</small></span></div>})}</div></section>))}</div>
 </div>
}
