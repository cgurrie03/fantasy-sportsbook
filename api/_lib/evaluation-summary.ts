// Additive sufficient statistics for the supported metrics. Retention eligibility
// is enforced by the leased database checkpoint and cleanup contract.
export type NumericTotals={n:number;absolute_error:number;squared_error:number;error:number;interval_n:number;covered80:number};
export function numericTotals(rows:any[]):NumericTotals {
 const result={n:0,absolute_error:0,squared_error:0,error:0,interval_n:0,covered80:0};
 for(const r of rows){
  if(!Number.isFinite(r.predicted)||!Number.isFinite(r.actual))continue;
  const e=r.predicted-r.actual;result.n++;result.absolute_error+=Math.abs(e);result.squared_error+=e*e;result.error+=e;
  if(Number.isFinite(r.sd)&&r.sd>=0){result.interval_n++;result.covered80+=Number(Math.abs(e)<=1.281551565545*r.sd);}
 }
 return result;
}
export function mergeNumericTotals(items:NumericTotals[]):NumericTotals {
 return items.reduce((a,b)=>Object.fromEntries(Object.keys(a).map(k=>[k,a[k as keyof NumericTotals]+b[k as keyof NumericTotals]])) as NumericTotals,
  {n:0,absolute_error:0,squared_error:0,error:0,interval_n:0,covered80:0});
}
export function numericMetrics(t:NumericTotals){return {n:t.n,mae:t.n?t.absolute_error/t.n:null,
 rmse:t.n?Math.sqrt(t.squared_error/t.n):null,bias:t.n?t.error/t.n:null,coverage80:t.interval_n?t.covered80/t.interval_n:null};}
export type ProbabilityTotals={n:number;brier:number;log_loss:number;bands:{n:number;predicted:number;observed:number}[]};
export function probabilityTotals(rows:any[]):ProbabilityTotals {
 const result={n:0,brier:0,log_loss:0,bands:Array.from({length:5},()=>({n:0,predicted:0,observed:0}))};
 for(const r of rows){
  if(!Number.isFinite(r.p)||r.p<0||r.p>1||![0,1].includes(r.y))continue;
  const p=Math.max(1e-6,Math.min(1-1e-6,r.p));result.n++;result.brier+=(r.p-r.y)**2;
  result.log_loss+=-r.y*Math.log(p)-(1-r.y)*Math.log(1-p);
  const bin=result.bands[Math.min(4,Math.floor(r.p*5))];bin.n++;bin.predicted+=r.p;bin.observed+=r.y;
 }
 return result;
}
export function mergeProbabilityTotals(items:ProbabilityTotals[]):ProbabilityTotals {
 const result=probabilityTotals([]);
 for(const t of items){result.n+=t.n;result.brier+=t.brier;result.log_loss+=t.log_loss;
  if(t.bands.length!==5)throw new Error('Calibration bin contract changed.');
  t.bands.forEach((b,i)=>{result.bands[i].n+=b.n;result.bands[i].predicted+=b.predicted;result.bands[i].observed+=b.observed;});}
 return result;
}
export function probabilityMetrics(t:ProbabilityTotals){return {n:t.n,brier:t.n?t.brier/t.n:null,log_loss:t.n?t.log_loss/t.n:null,
 bands:t.bands.map((b,i)=>({lo:i/5,hi:(i+1)/5,n:b.n,predicted:b.n?b.predicted/b.n:null,observed:b.n?b.observed/b.n:null}))};}

const HORIZONS=new Set(['opening','final_pregame']);
function groups(rows:any[],keys:string[]){
 if(rows.length>6000)throw new Error('Summary target budget exceeded.');
 const result=new Map<string,{key:Record<string,string>;rows:any[]}>();
 for(const row of rows){
  if(!HORIZONS.has(row.horizon))continue;
  const key=Object.fromEntries(keys.map(k=>[k,String(row[k]??'unknown')]));
  if(Object.values(key).some(v=>v.length>80))throw new Error('Summary dimension exceeded.');
  const id=JSON.stringify(key);if(!result.has(id))result.set(id,{key,rows:[]});
  result.get(id)!.rows.push(row);
  if(result.size>128)throw new Error('Summary segment budget exceeded.');
 }
 return [...result.values()];
}
export function summarizeEvaluation(report:any){
 const scoreGroups=groups(report.scores??[],['view','horizon','model_version']);
 const playerGroups=groups(report.players??[],['horizon','model_version']);
 const marketGroups=groups(report.markets??[],['kind','horizon','model_version']);
 const paired=[...scoreGroups,...playerGroups.map(g=>({...g,key:{...g.key,view:'players'}}))].map(({key,rows})=>{
  const matched=rows.filter(r=>Number.isFinite(r.sleeper_predicted));
  return {...key,missing:rows.length-matched.length,adjusted:numericTotals(matched),
   sleeper:numericTotals(matched.map(r=>({...r,predicted:r.sleeper_predicted})))};
 });
 const diagnostics=[...groups(report.categorical??[],['kind','horizon','model_version']).map(g=>({...g,type:'categorical'})),
  ...groups(report.distributions??[],['kind','horizon','model_version']).map(g=>({...g,type:'distribution'}))].map(({key,rows,type})=>({
   ...key,type,totals:numericTotals(rows),n:rows.length,ties:rows.filter(r=>r.tie).length,
   probability_n:rows.filter(r=>Number.isFinite(r.brier)&&Number.isFinite(r.log_loss)).length,
   brier:rows.reduce((s,r)=>s+(Number.isFinite(r.brier)?r.brier:0),0),log_loss:rows.reduce((s,r)=>s+(Number.isFinite(r.log_loss)?r.log_loss:0),0),
   coverage_n:rows.filter(r=>Number.isFinite(r.coverage80)).length,covered80:rows.reduce((s,r)=>s+(Number.isFinite(r.coverage80)?r.coverage80:0),0)}));
 const futures=report.futures?.opening_by_origin_week??[];
 if(futures.length>2000)throw new Error('Future summary target budget exceeded.');
 const kinds=[...new Set<string>(futures.map((r:any)=>r.kind))];
 if(kinds.length>4)throw new Error('Future summary segment budget exceeded.');
 const summary={format:'weekly-additive-v1',
  diagnostics,
  futures:kinds.map(kind=>{const rows=futures.filter((r:any)=>r.kind===kind);return {kind,generated:rows.length,pending:rows.filter((r:any)=>![0,1].includes(r.y)||!Number.isFinite(r.p)||r.p<0||r.p>1).length,
   totals:probabilityTotals(rows),wins:numericTotals(rows.filter((r:any)=>r.kind==='future_win_total'&&r.side==='over'&&Number.isFinite(r.expected_wins)&&r.y!==null)
    .map((r:any)=>({predicted:r.expected_wins,actual:r.actual_value})))}}),
  future_final:futures.length>0&&futures.every((r:any)=>[0,1].includes(r.y)&&Number.isFinite(r.p)&&r.p>=0&&r.p<=1),
  live:(report.live_horizons??[]).slice(0,4).map((r:any)=>({horizon:r.horizon,team_count:r.team_count,matchup_count:r.matchup_count,
   mae:r.mae,rmse:r.rmse,bias:r.bias,coverage80:r.coverage80,brier:r.brier,log_loss:r.log_loss,margin_mae:r.margin_mae,total_mae:r.total_mae})),
  scores:scoreGroups.map(({key,rows})=>({...key,missing:rows.length-numericTotals(rows).n,totals:numericTotals(rows)})),
  players:playerGroups.map(({key,rows})=>({...key,missing:rows.length-numericTotals(rows).n,totals:numericTotals(rows)})),paired_sleeper:paired,
  markets:marketGroups.map(({key,rows})=>({...key,generated:rows.length,locked:rows.filter(r=>r.locked).length,
   published:rows.filter(r=>r.published).length,pushes:rows.filter(r=>r.status==='PUSH').length,pending:rows.filter(r=>r.status==='OPEN').length,
   missing_probability:rows.filter(r=>!Number.isFinite(r.p)||r.p<0||r.p>1).length,
   totals:probabilityTotals(rows.filter(r=>!r.locked).map(r=>({...r,
   y:r.status==='WON'?1:r.status==='LOST'?0:null})))})),
  coverage:{selected_runs:Number(report.coverage?.selected_runs??0),locked_forecasts:Number(report.coverage?.locked_forecasts??0),
   missing_starter_forecasts:Number(report.coverage?.missing_starter_forecasts??0),unknown_source_freshness:Number(report.coverage?.unknown_source_freshness??0),
   missing_families:(report.coverage?.missing_families??[]).slice(0,4)},
  note:'Selection-level descriptive counts/errors/calibration; correlated selections are not independent trials. No arbitrary quantiles, roster reconstruction or unrestricted retraining.'};
 if(new TextEncoder().encode(JSON.stringify(summary)).length>65536)throw new Error('Weekly summary byte budget exceeded.');
 return summary;
}
export function archivedReview(summary:any){
 const score_views=summary.scores.map((r:any)=>({...r,...numericMetrics(r.totals)}));
 const sleeper_comparison=summary.paired_sleeper.map((r:any)=>({...r,paired_n:r.adjusted.n,adjusted:numericMetrics(r.adjusted),sleeper:numericMetrics(r.sleeper),
  mae_gain:r.adjusted.n?r.sleeper.absolute_error/r.sleeper.n-r.adjusted.absolute_error/r.adjusted.n:null}));
 return {row_level_retired:true,score_views,sleeper_comparison,largest_misses:[],event_errors:[],excluded:[],
  families:summary.markets.map((r:any)=>({...r,...probabilityMetrics(r.totals)})),
  categorical:summary.diagnostics.filter((r:any)=>r.type==='categorical'),distributions:summary.diagnostics.filter((r:any)=>r.type==='distribution'),
  live_horizons:summary.live,futures:{scores:summary.futures,note:'Finalized compact future metrics; correlated origin weeks are not independent trials.'},coverage:summary.coverage,
  limitations:[summary.note,'Row-level correction window is closed. Largest misses, player-level records, rosters and full trajectories expired; financial settlement remains independent.']};
}
