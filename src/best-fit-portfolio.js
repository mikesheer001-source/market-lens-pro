// Round 15 — choose the highest finite in-sample Sharpe separately for
// each symbol, then reuse the real equal-weight, aligned daily portfolio engine.
// Same transaction costs / stops / capital assumptions as existing Backtest.
import {portfolioUniverse,runPortfolio} from './portfolio.js';
import {compareStrategies} from './leaderboard.js';
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
  savedScripts=[],builtInExamples=[],range={}}){
  if(typeof backtest!=='function')throw Error('Backtest engine unavailable.');
  const dateRange=validateBacktestRange(range);
  const filtered=windowPortfolioData(data,symbols,dateRange);
  const aligned=portfolioUniverse(filtered,symbols);
  const picks=new Map(),unranked=[],ranked=[];
  const tranche=Number(options.capital||10000)/aligned.series.size;
  for(const [symbol,bars] of aligned.series){
    try{
      const comparison=compareStrategies({
        symbol,bars,source:sources.get(symbol)||'UNKNOWN',
        options:{...options,capital:tranche,timeframe:'D',side:options.side||'long'},
        backtest,compilePine,executePine,savedScripts,builtInExamples
      });
      const winner=bestSharpeStrategy(comparison.rows);
      if(!winner){unranked.push({symbol,reason:'No strategy has a finite Sharpe on the selected window'});continue;}
      picks.set(symbol,winner);
      ranked.push({symbol,strategyId:winner.id,strategyName:winner.name,
        fitSharpe:winner.trainMetrics?.sharpe??winner.metrics.sharpe,
        fitReturnPct:winner.trainMetrics?.returnPct??winner.metrics.returnPct,
        trainMetrics:winner.trainMetrics||null,testMetrics:winner.testMetrics||null,
        validation:winner.validation||null,
        source:sources.get(symbol)||'UNKNOWN',barDate:barDate(bars.at(-1))});
    }catch(error){unranked.push({symbol,reason:String(error.message||error)});}
  }
  if(!picks.size)throw Error('No selected symbol has a rankable finite-Sharpe strategy in this date range.');
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
  return {...portfolio,mode:'best-fit',range:actualPortfolioRange(portfolio.curve,dateRange),
    requestedCount:aligned.requested.length,ranked:ranked.length,
    selections:ranked,
    breakdown:portfolio.breakdown.map(row=>{
      const selected=picks.get(row.symbol);
      return {...row,trainMetrics:selected?.trainMetrics||null,
        testMetrics:selected?.testMetrics||null,validation:selected?.validation||null};
    }),
    unranked,
    omitted:[...new Set([...aligned.omitted,...unranked.map(x=>x.symbol)])],
    methodology:portfolio.methodology+
      ' Each ticker is selected ONLY by the highest finite Sharpe in its first 70% training bars across executable presets, saved Pine strategies and built-in examples. The final 30% is reserved for a separate independent-capital holdout backtest with the frozen selected strategy. Combined equity and headline performance still span the full available window (training + test); read the per-symbol OOS metrics for genuine holdout evidence. Positive OOS Sharpe is a descriptive label, not statistically rigorous proof of edge. Training selection still has selection bias and may overfit.'};
}
