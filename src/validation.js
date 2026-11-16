// Chronological 70% training / 30% untouched holdout evaluation.
// Test accounts start with independent initial capital; historical bars
// preceding the test window are available ONLY for indicator warmup.
// The 30-bar threshold is a minimum practical gate, not statistical proof.
import {barDate} from './freshness.js';
export const MIN_HOLDOUT_BARS=30;
export function splitValidationBars(bars){
  if(!Array.isArray(bars))throw Error('Backtest OHLCV bars are required.');
  const count=bars.length,cut=Math.max(2,Math.floor(count*.7));
  const trainEnd=Math.min(count-1,cut-1),testStart=cut;
  return {trainEndIndex:trainEnd,testStartIndex:testStart,
    trainBars:Math.min(count,cut),testBars:Math.max(0,count-cut),
    trainStart:barDate(bars[0]),trainEnd:barDate(bars[trainEnd]),
    testStart:barDate(bars[testStart]),testEnd:barDate(bars.at(-1))};
}
export function validatedHoldout(testMetrics,split){
  return !!(split?.testBars>=MIN_HOLDOUT_BARS&&Number.isFinite(testMetrics?.sharpe)&&testMetrics.sharpe>0);
}
export function assessHoldout(bars,options,backtest){
  if(typeof backtest!=='function')throw Error('Backtest engine unavailable.');
  const split=splitValidationBars(bars);
  if(split.trainBars<3)throw Error('Need at least 3 training bars.');
  const training=backtest(bars,{...options,startIndex:1,endIndex:split.trainEndIndex});
  // Always evaluate the held-out return when bars exist, even if too few
  // to make a meaningful Sharpe claim.
  const testing=split.testBars>=2?
    backtest(bars,{...options,startIndex:split.testStartIndex}):null;
  const trainMetrics=training?.metrics||null,testMetrics=testing?.metrics||null;
  const insufficient=split.testBars<MIN_HOLDOUT_BARS;
  const note=insufficient?'Test window has only '+split.testBars+
    ' bars; need at least '+MIN_HOLDOUT_BARS+' to judge out-of-sample Sharpe.':
    !Number.isFinite(testMetrics?.sharpe)?
      'Out-of-sample Sharpe unavailable (no measurable return variability).':null;
  return {trainMetrics,testMetrics,validation:{...split,
    enoughTestBars:!insufficient,validated:validatedHoldout(testMetrics,split),note}};
}
export function holdoutSummary(rows){
  const ranked=(rows||[]).filter(r=>r?.strategy&&r.validation?.enoughTestBars&&
    Number.isFinite(r.testMetrics?.sharpe));
  const positive=ranked.filter(r=>r.testMetrics.sharpe>0);
  const best=[...ranked].sort((a,b)=>b.testMetrics.sharpe-a.testMetrics.sharpe||
    String(a.id).localeCompare(String(b.id)))[0]||null;
  return {positive:positive.length,assessable:ranked.length,
    total:(rows||[]).filter(r=>r?.strategy).length,best};
}
