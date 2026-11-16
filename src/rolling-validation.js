// Round 18 — five sliding chronological 70/30 windows.
// The windows occupy 40% of the selected history each, moving forward by
// 15% of the selected history. This gives five non-overlapping OOS segments:
// [0%,40%], [15%,55%], [30%,70%], [45%,85%], [60%,100%].
// The strategy/parameters are held fixed; only the OOS portion is scored.
// Different train periods overlap, so this is NOT five independent studies.
import {barDate} from './freshness.js';
import {MIN_HOLDOUT_BARS,splitValidationBars} from './validation.js';

export const ROLLING_WINDOW_COUNT=5;
export const ROLLING_WINDOW_FRACTION=0.4;

export function rollingWindows(bars,count=ROLLING_WINDOW_COUNT){
  if(!Array.isArray(bars))throw Error('Rolling validation requires chronological OHLCV bars.');
  if(!Number.isInteger(count)||count<2)throw Error('Rolling validation needs at least two windows.');
  const n=bars.length,size=Math.min(n,Math.max(5,Math.floor(n*ROLLING_WINDOW_FRACTION)));
  return Array.from({length:count},(_,index)=>{
    const startIndex=Math.round(index*(n-size)/(count-1));
    const endIndex=startIndex+size-1;
    const segment=bars.slice(startIndex,endIndex+1);
    const split=splitValidationBars(segment);
    return {index:index+1,startIndex,endIndex,windowBars:segment.length,
      trainBars:split.trainBars,testBars:split.testBars,
      trainStart:split.trainStart,trainEnd:split.trainEnd,
      testStart:split.testStart,testEnd:split.testEnd,
      windowStart:barDate(segment[0]),windowEnd:barDate(segment.at(-1)),
      testStartIndex:split.testStartIndex,
      sufficient:split.trainBars>=3&&split.testBars>=MIN_HOLDOUT_BARS};
  });
}

export function summarizeRollingSharpe(windows){
  const all=Array.isArray(windows)?windows:[];
  const included=all.filter(w=>w.sufficient&&Number.isFinite(w.sharpe));
  const scores=included.map(w=>w.sharpe).sort((a,b)=>a-b);
  const totalWindows=all.length,assessableCount=scores.length,
    positiveCount=scores.filter(n=>n>0).length;
  const meanSharpe=assessableCount?
    scores.reduce((a,b)=>a+b,0)/assessableCount:null;
  const medianSharpe=assessableCount?
    (scores[Math.floor((assessableCount-1)/2)]+scores[Math.floor(assessableCount/2)])/2:null;
  const insufficientBars=all.filter(w=>w.testBars<MIN_HOLDOUT_BARS).length;
  const unmeasurable=totalWindows-assessableCount-insufficientBars;
  const note=assessableCount===totalWindows?null:
    assessableCount===0?
      'Rolling OOS Sharpe unavailable: '+insufficientBars+' of '+totalWindows+
      ' windows have fewer than '+MIN_HOLDOUT_BARS+
      ' test bars'+(unmeasurable?' and '+unmeasurable+' have undefined Sharpe':'')+'.':
      'Only '+assessableCount+'/'+totalWindows+' windows have assessable OOS Sharpe ('+
      insufficientBars+' too short'+(unmeasurable?', '+unmeasurable+' undefined Sharpe':'')+').';
  return {meanSharpe,medianSharpe,positiveCount,assessableCount,totalWindows,
    insufficientBars,unmeasurable,note};
}

// Count exactly the same numeric metrics that the leaderboard table renders.
// The single-split 70/30 holdout is a different statistic and must not be
// labeled or implied to be a repeated rolling result.
export function rollingLeaderboardSummary(rows){
  const strategies=(rows||[]).filter(row=>row?.strategy&&row.kind!=='example-indicator');
  const assessable=strategies.filter(row=>Number.isFinite(row.rolling?.meanSharpe)&&
    Number.isFinite(row.rolling?.medianSharpe)&&row.rolling?.assessableCount>0);
  const positive=assessable.filter(row=>row.rolling.meanSharpe>0);
  const best=[...assessable].sort((a,b)=>b.rolling.meanSharpe-a.rolling.meanSharpe||
    String(a.id).localeCompare(String(b.id)))[0]||null;
  return {positive:positive.length,assessable:assessable.length,
    total:strategies.length,unassessable:strategies.length-assessable.length,best};
}

export function rollingPositiveText(rolling){
  if(!rolling)return '—';
  if(rolling.assessableCount===0)return '0/'+rolling.totalWindows+' assessable';
  return rolling.positiveCount+'/'+rolling.totalWindows+' windows positive'+
    (rolling.assessableCount<rolling.totalWindows?
      ' ('+rolling.assessableCount+'/'+rolling.totalWindows+' assessable)':'');
}

export function rollingWindowDates(windows){
  return (windows||[]).map(w=>'W'+w.index+' '+(w.windowStart||'—')+
    '–'+(w.windowEnd||'—')+' (test '+(w.testStart||'—')+
    '–'+(w.testEnd||'—')+')').join(' · ');
}

// Attach rolling metrics only to single-symbol leaderboard comparisons.
// Best-fit portfolio and Fit across universe keep their existing computational
// budgets and single-split results entirely unchanged.
export function attachRollingValidation(report,bars,{options,backtest,compilePine,executePine}){
  if(!report?.rows||typeof backtest!=='function')throw Error('A strategy comparison is required.');
  const windows=rollingWindows(bars);
  const evaluated=report.rows.map(row=>{
    if(!row.strategy||row.kind==='example-indicator')return row;
    let program=null,scriptError=null;
    if(row.strategy==='pine-custom'){
      try{program=compilePine(row.script?.code||'');}
      catch(error){scriptError=String(error.message||error);}
    }
    const perWindow=windows.map(w=>{
      const item={...w,sharpe:null,returnPct:null};
      if(!w.sufficient){
        item.note='Too few held-out bars ('+w.testBars+
          '; minimum '+MIN_HOLDOUT_BARS+').';
        return item;
      }
      if(scriptError){item.note='Pine unavailable: '+scriptError;return item;}
      try{
        const segment=bars.slice(w.startIndex,w.endIndex+1);
        const cfg={...options,timeframe:report.timeframe,strategy:row.strategy,
          startIndex:w.testStartIndex};
        if(program)cfg.customSignals=executePine(program,segment,row.script?.settings||{}).signals;
        else delete cfg.customSignals;
        const result=backtest(segment,cfg);
        item.sharpe=Number.isFinite(result.metrics?.sharpe)?result.metrics.sharpe:null;
        item.returnPct=result.metrics?.returnPct??null;
        if(item.sharpe===null)item.note='OOS Sharpe unavailable (no measurable return variability).';
      }catch(error){item.note=String(error.message||error);}
      return item;
    });
    const stats=summarizeRollingSharpe(perWindow);
    return {...row,rolling:{...stats,windows:perWindow}};
  });
  return {...report,rollingWindowCount:windows.length,rollingWindows:windows,rows:evaluated};
}
