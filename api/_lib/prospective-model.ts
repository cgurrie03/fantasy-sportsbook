import {BASELINE,GATES,validConfig,blockInterval,replaySafety} from './model-assessment.js';
import type {Config} from './model-assessment.js';
const avg=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
export interface TrainingWeek {period:number;n:number;prediction:number;actual:number;z2:number;z_n:number;}
export interface PairWeek {period:number;prediction_at:string;phase:'validation'|'holdout';n:number;
 current:number;candidate:number;baseline:number;sleeper:number;market_ok:boolean;}
export interface ProspectiveState {active_id:string;context_hash:string;revision:number;training:TrainingWeek[];fit_training:TrainingWeek[];evidence:PairWeek[];
 monitor:{period:number;delta:number}[];candidate:Config|null;frozen_at:string|null;trained_period:number;training_weeks:number;
 last_period:number;finished:boolean;skipped_weeks:number;}
export function initialState(active_id:string,context_hash:string):ProspectiveState {
 return {active_id,context_hash,revision:0,training:[],fit_training:[],evidence:[],monitor:[],candidate:null,frozen_at:null,
  trained_period:0,training_weeks:0,last_period:0,finished:false,skipped_weeks:0};
}
const replacePeriod=<T extends {period:number}>(xs:T[],value:T,limit:number)=>[...xs.filter(x=>x.period!==value.period),value]
 .sort((a,b)=>a.period-b.period).slice(-limit);
function fit(training:TrainingWeek[],current:Config):Config {
 const prediction=training.reduce((s,w)=>s+w.prediction,0)*current.score_scale,actual=training.reduce((s,w)=>s+w.actual,0);
 const shrink=training.length/(training.length+GATES.shrinkage_weeks),zn=training.reduce((s,w)=>s+w.z_n,0);
 const z=zn?training.reduce((s,w)=>s+w.z2,0)/zn:1;
 const bounded=(old:number,delta:number)=>Math.max(.9,Math.min(1.1,old*(1+Math.max(-GATES.max_step,Math.min(GATES.max_step,delta)))));
 return {score_scale:bounded(current.score_scale,prediction?(actual/prediction-1)*shrink:0),
  variance_scale:bounded(current.variance_scale,(Math.sqrt(z)-1)*shrink)};
}
// The only replay is of this week's retained numeric moments using parameters
// already frozen before prediction time. No historical inputs are consulted.
export function advanceProspective(previous:ProspectiveState|null,args:{active_id:string;context_hash:string;period:number;
 current:Config;report:any;runs:any[];outcome:any;team_count:number}):ProspectiveState {
 const reset=!previous||previous.active_id!==args.active_id||previous.context_hash!==args.context_hash;
 const state=structuredClone(reset?initialState(args.active_id,args.context_hash):previous!);
 state.revision=previous?.revision??0;
 const {period,current,report}=args;
 if(state.finished&&period>state.last_period){state.candidate=null;state.frozen_at=null;state.evidence=[];state.finished=false;}
 const rows=(report.scores??[]).filter((r:any)=>r.view==='actual_starters'&&r.horizon==='opening'&&r.model_version===args.active_id);
 const valid=rows.length===args.team_count&&rows.length>=8&&new Set(rows.map((r:any)=>r.team_id)).size===rows.length&&
  rows.every((r:any)=>[r.predicted,r.actual,r.sleeper_predicted,r.sd,r.model_config?.score_scale,r.model_config?.variance_scale].every(Number.isFinite)&&r.sd>0);
 if(!valid){if(period>state.last_period)state.skipped_weeks++;state.last_period=Math.max(period,state.last_period);return state;}
 const predictionAt=args.runs.filter(r=>r.category==='Matchups').map(r=>r.captured_at).sort()[0];
 const training:TrainingWeek={period,n:rows.length,prediction:rows.reduce((s:number,r:any)=>s+r.predicted/r.model_config.score_scale,0),
  actual:rows.reduce((s:number,r:any)=>s+r.actual,0),z_n:rows.length,
  z2:rows.reduce((s:number,r:any)=>s+((r.predicted/r.model_config.score_scale*current.score_scale-r.actual)/
   (r.sd/r.model_config.variance_scale*current.variance_scale))**2,0)};
 state.training=replacePeriod(state.training,training,8);
 const error=(scale:number)=>avg(rows.map((r:any)=>Math.abs(r.predicted/r.model_config.score_scale*scale-r.actual)));
 state.monitor=replacePeriod(state.monitor,{period,delta:error(current.score_scale)-error(1)},4);
 if(state.candidate&&state.frozen_at&&predictionAt&&Date.parse(predictionAt)>Date.parse(state.frozen_at)&&period>state.trained_period){
  const old=state.evidence.find(w=>w.period===period);
  if(old||period>=state.last_period){
   const validation=state.evidence.filter(w=>w.phase==='validation');
   const phase=old?.phase??(validation.length>=GATES.validation_weeks&&validation.reduce((s,w)=>s+w.n,0)>=GATES.min_observations?'holdout':'validation');
   const safety=replaySafety({week:period%100,report,runs:args.runs,outcome:args.outcome},state.candidate,current);
   state.evidence=replacePeriod(state.evidence,{period,prediction_at:predictionAt,phase,n:rows.length,current:error(current.score_scale),
    candidate:error(state.candidate.score_scale),baseline:error(1),sleeper:avg(rows.map((r:any)=>Math.abs(r.sleeper_predicted-r.actual))),
    market_ok:safety.passed&&!(report.coverage?.missing_families?.length)},32);
  }
 }else if(!state.candidate&&state.training.length>=GATES.train_weeks&&period>=state.last_period){
  state.candidate=fit(state.training,current);state.fit_training=structuredClone(state.training);state.frozen_at=null;state.trained_period=period;state.training_weeks=state.training.length;
 }
 state.last_period=Math.max(period,state.last_period);
 const holdout=state.evidence.filter(w=>w.phase==='holdout');
 state.finished=holdout.length>=GATES.holdout_weeks&&holdout.reduce((s,w)=>s+w.n,0)>=GATES.min_holdout_observations||state.evidence.length>=32;
 return state;
}
export function prospectiveComparison(state:ProspectiveState,current:Config,paused:boolean,period:number){
 const reasons:string[]=[];
 if(paused)reasons.push('Automatic improvement is paused.');
 if(!state.candidate||!state.frozen_at)reasons.push('Waiting for eight completed training weeks and a server-frozen candidate.');
 if(state.candidate&&!validConfig(state.candidate,current))reasons.push('Parameter bounds failed.');
 if(period<state.last_period)reasons.push('Historical correction cannot initiate a new promotion.');
 const tests=(['validation','holdout'] as const).map(phase=>{
  const weeks=state.evidence.filter(w=>w.phase===phase),count=weeks.reduce((s,w)=>s+w.n,0);
  const gain=weeks.map(w=>w.current-w.candidate),frozen=weeks.map(w=>w.baseline-w.candidate),sleeper=weeks.map(w=>w.sleeper-w.candidate);
  const interval=blockInterval(gain),frozen_interval=blockInterval(frozen),sleeper_interval=blockInterval(sleeper);
  const enough=weeks.length>=(phase==='validation'?12:4)&&count>=(phase==='validation'?120:40);
  const sleeper_passed=enough&&sleeper_interval.low!==null&&sleeper_interval.low>=0;
  const time_ok=Boolean(state.frozen_at)&&weeks.every(w=>w.period>state.trained_period&&Date.parse(w.prediction_at)>Date.parse(state.frozen_at!));
  const pass=enough&&time_ok&&interval.low!==null&&interval.low>0&&frozen_interval.low!==null&&frozen_interval.low>=0&&sleeper_passed&&
   avg(gain)>=avg(weeks.map(w=>w.current))*GATES.min_relative_gain&&weeks.every(w=>w.market_ok);
  if(!pass)reasons.push(`${phase}: fresh sample, confidence, Sleeper or market-regression gates not met.`);
  return {phase,weeks:weeks.length,observations:count,mae_gain:weeks.length?avg(gain):null,interval,frozen_interval,sleeper_observations:count,
   sleeper_mae_gain:weeks.length?avg(sleeper):null,sleeper_interval,sleeper_passed,pass};
 });
 return {method:'prospective-v1',candidate:state.candidate??BASELINE,current,gates:GATES,training_weeks:state.training_weeks,
  require_sleeper:true,frozen_at:state.frozen_at,context_hash:state.context_hash,trained_period:state.trained_period,
  state_revision:state.revision,tests,passed:!reasons.length,reasons,decision:reasons.length?
   'Current model retained; collecting fresh evidence for the frozen candidate.':'Frozen candidate passed every fresh-evidence gate.',
  scope:'Weekly team pregame only; Sleeper benchmark required. Player, live and futures configurations remain frozen.'};
}
