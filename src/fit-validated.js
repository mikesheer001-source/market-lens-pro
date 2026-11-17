// Round 23: validated Fit across universe uses the exact leaderboard comparison
// and rolling holdout machinery, never training Sharpe to choose winners.
import {barDate} from './freshness.js';
import {validateBacktestRange,windowBacktestBars} from './date-window.js';
import {compareStrategiesInRange} from './leaderboard-range.js';
import {filterValidatedLeaderboard,validationReasons} from './validated-strategies.js';

export const NO_VALIDATED_FIT='No symbol has a validated strategy on this window';

export function rankValidatedUniverseFit(rows){
  return [...(rows||[])].sort((a,b)=>{
    const x=a.rollingMeanSharpe,y=b.rollingMeanSharpe;
    const ax=Number.isFinite(x),by=Number.isFinite(y);
    if(ax!==by)return ax?-1:1;
    if(ax&&x!==y)return y-x;
    return String(a.symbol).localeCompare(String(b.symbol));
  });
}

export function chooseValidatedUniverseStrategy(rows){
  const eligible=filterValidatedLeaderboard(rows,true);
  if(!eligible.length)return null;
  // A single-split pass may be valid even when rolling Sharpe is undefined.
  // Such symbols still count as validated, but rank BELOW numeric OOS means.
  const ranked=[...eligible].sort((a,b)=>{
    const x=a.rolling?.meanSharpe,y=b.rolling?.meanSharpe;
    const ax=Number.isFinite(x)&&Number.isFinite(a.rolling?.medianSharpe);
    const by=Number.isFinite(y)&&Number.isFinite(b.rolling?.medianSharpe);
    if(ax!==by)return ax?-1:1;
    if(ax&&x!==y)return y-x;
    return String(a.id).localeCompare(String(b.id));
  });
  return ranked[0];
}

export function validatedFitSymbolRow(symbol,leaderboard,meta={}){
  const choice=chooseValidatedUniverseStrategy(leaderboard?.rows||[]);
  if(!choice)return null;
  const rolling=choice.rolling||{};
  return {symbol,...meta,validatingStrategy:{
      id:choice.id,name:choice.name,strategy:choice.strategy,
      settings:choice.settings,script:choice.script
    },
    validationReasons:validationReasons(choice),
    strategy:choice.strategy,
    rolling:choice.rolling||null,
    // Retain the winning strategy's actual train/OOS/full metrics so CSV
    // exports match the validated symbol and never borrow in-sample picks.
    trainMetrics:choice.trainMetrics||null,
    testMetrics:choice.testMetrics||null,
    metrics:choice.metrics||null,
    validation:choice.validation||null,
    rollingMeanSharpe:Number.isFinite(rolling.meanSharpe)?rolling.meanSharpe:null,
    rollingMedianSharpe:Number.isFinite(rolling.medianSharpe)?rolling.medianSharpe:null,
    positiveWindows:rolling.positiveCount??0,
    assessableWindows:rolling.assessableCount??0,
    totalWindows:rolling.totalWindows??5,
    validatedStrategies:filterValidatedLeaderboard(leaderboard.rows,true).length};
}

export async function fitValidatedAcrossUniverse({symbols,data,options,backtest,
  compilePine,executePine,savedScripts=[],builtInExamples=[],sourceFor=()=>null,
  expectedBarDate=null,dateRange={},onProgress=()=>{},isCancelled=()=>false,
  compare=compareStrategiesInRange}){
  if(!Array.isArray(symbols)||!symbols.length)throw Error('Choose a research universe.');
  if(typeof backtest!=='function')throw Error('Backtest engine unavailable.');
  const selectedRange=validateBacktestRange(dateRange);
  const settings={...options,timeframe:'D'},rows=[],errors=[];
  let completed=0;
  for(let i=0;i<symbols.length;i++){
    if(isCancelled())throw Error('Superseded fit calculation');
    const symbol=symbols[i];
    const original=data instanceof Map?data.get(symbol):data?.[symbol];
    const history=windowBacktestBars(original||[],selectedRange,{allowEmpty:true}).bars;
    const last=barDate(history.at(-1));
    const newest=Array.isArray(original)?barDate(original.at(-1)):null;
    if(history.length>=5){
      try{
        const comparison=compare({
          symbol,bars:history,range:{},options:settings,
          source:sourceFor(symbol)||'NO ALPACA DATA',backtest,
          compilePine,executePine,savedScripts,builtInExamples
        });
        completed++;
        const chosen=validatedFitSymbolRow(symbol,comparison,{
          source:sourceFor(symbol)||'NO ALPACA DATA',barDate:last,
          stale:!!(expectedBarDate&&(!newest||newest<expectedBarDate))
        });
        if(chosen)rows.push(chosen);
      }catch(error){errors.push({symbol,error:String(error.message||error)});}
    }else if(history.length)errors.push({symbol,error:'Insufficient OHLCV history ('+history.length+' bars)'});
    onProgress(i+1,rows.length);
    // Yield between batches so the page can show progress and accept date changes.
    if(i%4===3)await new Promise(resolve=>setTimeout(resolve,0));
  }
  return {version:3,mode:'validated',settings,dateRange:selectedRange,
    expectedBarDate,runAt:new Date().toISOString(),requested:symbols.length,
    completed,validated:rows.length,rows:rankValidatedUniverseFit(rows),errors};
}
