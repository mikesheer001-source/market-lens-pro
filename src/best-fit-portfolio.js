// Round 15 — choose the highest finite in-sample Sharpe separately for
// each symbol, then reuse the real equal-weight, aligned daily portfolio engine.
// Same transaction costs / stops / capital assumptions as existing Backtest.
import {portfolioUniverse,runPortfolio} from './portfolio.js';
import {compareStrategies} from './leaderboard.js';
import {compareStrategiesInRange} from './leaderboard-range.js';
import {chooseValidatedUniverseStrategy,NO_VALIDATED_FIT} from './fit-validated.js';
import {validationReasons} from './validated-strategies.js';
import {windowPortfolioData,validateBacktestRange,actualPortfolioRange} from './date-window.js';
import {barDate} from './freshness.js';
export function bestSharpeStrategy(rows){
  const eligible=(rows||[]).filter(row=>
    row?.strategy&&Number.isFinite(row.trainMetrics?row.trainMetrics.sharpe:row.metrics?.sharpe)&&
    Array.isArray(row.curve)&&row.curve.length);
  eligible.sort((a,b)=>(b.trainMetrics?b.trainMetrics.sharpe:b.metrics.sharpe)-
    (a.trainMetrics?a.trainMetrics.sharpe:a.metrics.sharpe)||
    String(a.id).localeCompare(String(b.id)));
  return eligible[0]||null;
}
export function runBestFitPortfolio({data,symbols,options,backtest,
  compilePine,executePine,sources=new Map(),sourceSummary='',
  savedScripts=[],builtInExamples=[],range={},validatedOnly=false,
  compareValidated=compareStrategiesInRange}){
  if(typeof backtest!=='function')throw Error('Backtest engine unavailable.');
  const dateRange=validateBacktestRange(range);
  const filtered=windowPortfolioData(data,symbols,dateRange);
  const validationMethodology='Candidates must pass the exact leaderboard OOS rule (positive 70/30 test Sharpe with at least 30 test bars OR positive in 3 of 5 rolling windows). The winning strategy for each symbol is chosen by rolling mean OOS Sharpe, with finite means ranked ahead of unavailable means. Rolling training periods overlap. Selecting strategies using OOS data introduces selection bias: the combined full-period portfolio curve is NOT an independent out-of-sample performance estimate. Research only.';
  const emptyValidated=(requestedCount,omitted,unranked)=>({
    mode:'best-fit',fitMode:'validated',noValidated:true,
    range:{...dateRange,actualStart:null,actualEnd:null,count:0},
    requestedCount,selectedCount:requestedCount,ranked:0,
    selections:[],breakdown:[],symbols:[],weights:{},curve:[],
    benchmarkCurve:[],metrics:null,trades:[],omitted,unranked,
    sourceSummary,methodology:validationMethodology,notice:NO_VALIDATED_FIT
  });
  let aligned;
  try{aligned=portfolioUniverse(filtered,symbols);}
  catch(error){
    if(validatedOnly&&(/No selected symbols have 40 or more daily bars|Selected symbols share only/.test(String(error.message||error)))){
      const selected=[...new Set(symbols)];
      return emptyValidated(selected.length,selected,
        selected.map(symbol=>({symbol,reason:'Insufficient aligned daily bars for validation'})));
    }
    throw error;
  }
  const picks=new Map(),unranked=[],ranked=[];
  const tranche=Number(options.capital||10000)/aligned.series.size;
  for(const [symbol,bars] of aligned.series){
    try{
      const context={
        symbol,bars,source:sources.get(symbol)||'UNKNOWN',
        options:{...options,capital:tranche,timeframe:'D',side:options.side||'long'},
        backtest,compilePine,executePine,savedScripts,builtInExamples
      };
      const comparison=validatedOnly?
        compareValidated({...context,range:{}}):compareStrategies(context);
      const winner=validatedOnly?
        chooseValidatedUniverseStrategy(comparison.rows):bestSharpeStrategy(comparison.rows);
      if(!winner){unranked.push({symbol,reason:validatedOnly?
        'No validated strategy in the selected date range':
        'No strategy has a finite Sharpe on the selected window'});continue;}
      picks.set(symbol,winner);
      ranked.push({symbol,strategyId:winner.id,strategyName:winner.name,
        fitSharpe:winner.trainMetrics?.sharpe??winner.metrics.sharpe,
        fitReturnPct:winner.trainMetrics?.returnPct??winner.metrics.returnPct,
        trainMetrics:winner.trainMetrics||null,testMetrics:winner.testMetrics||null,
        validation:winner.validation||null,
        rollingMeanSharpe:Number.isFinite(winner.rolling?.meanSharpe)?winner.rolling.meanSharpe:null,
        rollingMedianSharpe:Number.isFinite(winner.rolling?.medianSharpe)?winner.rolling.medianSharpe:null,
        rollingPositiveCount:winner.rolling?.positiveCount??null,
        rollingAssessableCount:winner.rolling?.assessableCount??null,
        rollingWindowCount:winner.rolling?.totalWindows??null,
        validationReasons:validatedOnly?validationReasons(winner):[],
        source:sources.get(symbol)||'UNKNOWN',barDate:barDate(bars.at(-1))});
    }catch(error){unranked.push({symbol,reason:String(error.message||error)});}
  }
  if(!picks.size){
    if(validatedOnly)return emptyValidated(aligned.requested.length,
      [...new Set([...aligned.omitted,...unranked.map(x=>x.symbol)])],unranked);
    throw Error('No selected symbol has a rankable finite-Sharpe strategy in this date range.');
  }
  // Removing an unrankable symbol must not create a fake extra history.
  // The survivors retain the original intersection for consistent ranking
  // and combined curve dates.
  const selected=[...picks.keys()],selectedData=new Map(
    [...aligned.series].filter(([symbol])=>picks.has(symbol)));
  const compiled=new Map();
  const portfolio=runPortfolio(selectedData,selected,{...options,timeframe:'D'},backtest,null,{
    sources,sourceSummary,
    strategyForSymbol:(symbol,bars)=>{
      const picked=picks.get(symbol);
      const choice={strategy:picked.strategy,strategyName:picked.name,
        selectionId:picked.id,fitSharpe:picked.trainMetrics?.sharpe??picked.metrics.sharpe};
      if(picked.strategy==='pine-custom'){
        const script=picked.script;
        if(!script?.code)throw Error('Best-fitting Pine script is missing for '+symbol);
        let program=compiled.get(script.code);
        if(!program){program=compilePine(script.code);compiled.set(script.code,program);}
        if(program.mode!=='strategy')throw Error('Best-fitting script is not strategy(): '+picked.name);
        choice.customSignals=executePine(program,bars,
          picked.settings||script.settings||{}).signals;
      }
      return choice;
    }
  });
  return {...portfolio,mode:'best-fit',fitMode:validatedOnly?'validated':'training',
    noValidated:false,range:actualPortfolioRange(portfolio.curve,dateRange),
    requestedCount:aligned.requested.length,selectedCount:aligned.requested.length,
    ranked:ranked.length,
    selections:ranked,
    breakdown:portfolio.breakdown.map(row=>{
      const selected=picks.get(row.symbol);
      return {...row,trainMetrics:selected?.trainMetrics||null,
        testMetrics:selected?.testMetrics||null,validation:selected?.validation||null,
        rollingMeanSharpe:Number.isFinite(selected?.rolling?.meanSharpe)?selected.rolling.meanSharpe:null,
        rollingMedianSharpe:Number.isFinite(selected?.rolling?.medianSharpe)?selected.rolling.medianSharpe:null,
        rollingPositiveCount:selected?.rolling?.positiveCount??null,
        rollingAssessableCount:selected?.rolling?.assessableCount??null,
        rollingWindowCount:selected?.rolling?.totalWindows??null,
        validationReasons:validatedOnly?validationReasons(selected):[]};
    }),
    unranked,
    omitted:[...new Set([...aligned.omitted,...unranked.map(x=>x.symbol)])],
    methodology:portfolio.methodology+(validatedOnly?
      ' '+validationMethodology:
      ' Each ticker is selected ONLY by the highest finite Sharpe in its first 70% training bars across executable presets, saved Pine strategies and built-in examples. The final 30% is reserved for a separate independent-capital holdout backtest with the frozen selected strategy. Combined equity and headline performance still span the full available window (training + test); read the per-symbol OOS metrics for genuine holdout evidence. Positive OOS Sharpe is a descriptive label, not statistically rigorous proof of edge. Training selection still has selection bias and may overfit.')};
}
