import assert from 'node:assert/strict';
import {numericTotals,numericMetrics,mergeNumericTotals,probabilityTotals,probabilityMetrics,mergeProbabilityTotals,summarizeEvaluation} from '../api/_lib/evaluation-summary.ts';
const rows=[{predicted:9,actual:10,sd:1},{predicted:20,actual:10,sd:2},{predicted:-2,actual:-3,sd:null}];
const aggregate=mergeNumericTotals([numericTotals(rows.slice(0,1)),numericTotals(rows.slice(1))]);
assert.deepEqual(aggregate,numericTotals(rows));
assert.equal(numericMetrics(aggregate).mae,4);
assert.equal(numericMetrics(aggregate).rmse,Math.sqrt(102/3));
assert.equal(numericMetrics(aggregate).bias,10/3);
assert.equal(numericMetrics(aggregate).coverage80,0.5);
assert.equal(numericMetrics(numericTotals([])).mae,null);
const binary=[{p:0,y:0},{p:1,y:1},{p:0.6,y:0},{p:0.8,y:1},{p:0.1,y:null},{p:1.2,y:1}];
const p=probabilityMetrics(mergeProbabilityTotals([probabilityTotals(binary.slice(0,1)),probabilityTotals(binary.slice(1))]));
assert.equal(p.n,4);assert(Math.abs(p.brier-0.1)<1e-12);assert.equal(p.bands[4].n,2);
assert(Number.isFinite(p.log_loss));
assert.deepEqual(mergeProbabilityTotals([probabilityTotals(binary)]),probabilityTotals(binary));
const report={scores:rows.map(r=>({...r,view:'actual_starters',horizon:'opening',model_version:'frozen',sleeper_predicted:10,
 raw:'FORBIDDEN_BODY',team_id:'not-required'})),players:[],markets:[{kind:'moneyline',horizon:'opening',model_version:'frozen',p:0.6,status:'WON',locked:false},
 {kind:'moneyline',horizon:'opening',model_version:'frozen',p:0.1,status:'PUSH',locked:false}],coverage:{selected_runs:2,missing_families:['Player Points']}};
const summary=summarizeEvaluation(report);
assert(!JSON.stringify(summary).includes('FORBIDDEN_BODY'));assert(!JSON.stringify(summary).includes('not-required'));
assert.equal(summary.markets[0].totals.n,1);assert.equal(summary.paired_sleeper[0].missing,0);
assert.equal(summary.markets[0].pushes,1);assert.equal(summary.markets[0].generated,2);
assert.equal(summary.scores[0].totals.n,3);
assert.throws(()=>summarizeEvaluation({...report,scores:Array(6001).fill(report.scores[0])}),/target budget/);
assert.throws(()=>summarizeEvaluation({...report,scores:Array.from({length:129},(_,i)=>({...report.scores[0],model_version:String(i)}))}),/segment budget/);
console.log('Additive summary counts, unequal-week weighting, RMSE/bias/coverage, probability boundaries, push exclusion, five-bin calibration, missingness and row/segment budgets passed. Retention is not activated.');
