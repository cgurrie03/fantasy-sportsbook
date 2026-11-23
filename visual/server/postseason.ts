export type BracketGame={m:number;r:number;p?:number;t1?:number|null;t2?:number|null;t1_from?:{w?:number;l?:number};t2_from?:{w?:number;l?:number}};
export function ordinal(n:number){const mod=n%100;return n+(mod>=11&&mod<=13?'th':({1:'st',2:'nd',3:'rd'}[n%10]||'th'))}
// Read the bracket graph, not a fixed league size or assumed number of teams per round.
export function bracketLabel(game:BracketGame,bracket:BracketGame[],kind:'playoffs'|'consolation'|'toilet'){
 const root=kind==='playoffs'?'Playoffs':kind==='toilet'?'Toilet Bowl':'Consolation';
 if(game.p){if(game.p===1)return kind==='playoffs'?'Championship':root+' Final';return `${root} · ${ordinal(game.p)} Place`;}
 const final=bracket.find(g=>g.p===1);if(!final)return `${root} · Round ${game.r}`;
 const seen=new Set<number>();function distance(node:BracketGame,target:number):number|null{if(node.m===target)return 0;if(seen.has(node.m))return null;seen.add(node.m);const inputs=[node.t1_from,node.t2_from].map(x=>kind==='toilet'?x?.l:x?.w).filter((x):x is number=>typeof x==='number');for(const id of inputs){const prev=bracket.find(g=>g.m===id);if(prev){const d=distance(prev,target);if(d!==null)return d+1;}}return null;}
 const d=distance(final,game.m);return d===1?`${root} · Semifinal`:d===2?`${root} · Quarterfinal`:`${root} · Round ${game.r}`;
}
export function findBracketGame(bracket:BracketGame[],a:number,b:number,round?:number){return bracket.find(g=>(round==null||g.r===round)&&[g.t1,g.t2].includes(a)&&[g.t1,g.t2].includes(b));}
