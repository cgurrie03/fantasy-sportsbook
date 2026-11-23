import { league } from "./model";
import { createContext, useContext, useState } from "react";
import type { Pick } from "./model";
export function selectionConflict(p: Pick, selected: Pick[]): string {
  if (selected.some(s => s.id === p.id)) return "";
  if (selected.length >= 10) return "Your slip has 10 selections. Remove one to add another.";
  if (selected.some(s => (s.kind === "future") !== (p.kind === "future"))) return "Futures and weekly picks use separate tickets.";
  if (p.kind === "future" && selected.length && (!["future_playoffs","future_win_total"].includes(p.family) || selected.some(s=>s.family!==p.family))) return "Only picks from the same playoff or win-total market type can be combined.";
  const overlap = selected.find(s => (s.matchupId && s.matchupId === p.matchupId && [s.family,p.family].includes("position_group")) || (s.group === p.group && (s.family === p.family || (["spread","moneyline"].includes(s.family) && ["spread","moneyline"].includes(p.family)))));
  return overlap ? `Cannot combine with ${overlap.label}. Remove that selection to use this market.` : "";
}
export const InteractionContext = createContext({enabled:false, conflicts:false, selected:[] as Pick[], explain:(_message:string)=>{}});
export function useInteractionPreview(){ return useContext(InteractionContext); }
// Isolated, bounded visual prototype. Approval is required before account persistence/rule expansion.
export function usePropFavorites(){
  const [ids,setIds] = useState<string[]>(()=>{try{return JSON.parse(sessionStorage.getItem(`boff-prop-preview-${league.leagueId}-${league.week}`)||"[]").slice(0,100)}catch{return []}});
  function toggle(id:string){setIds(prev=>{const next=prev.includes(id)?prev.filter(x=>x!==id):[...prev,id].slice(-100);sessionStorage.setItem(`boff-prop-preview-${league.leagueId}-${league.week}`,JSON.stringify(next));return next;});}
  return {ids,toggle};
}
