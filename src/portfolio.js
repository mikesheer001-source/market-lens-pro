// Equal-weight, initial-capital portfolio simulation. Reuses src/engine.js backtest
// for per-symbol fills, stop/target, borrowing, slippage and commission logic.
// No periodic rebalancing or cross-symbol order netting is implied.
const time=t=>typeof t==='number'?t:Date.parse(String(t)+'T00:00:00Z')/1000;
const finite=Number.isFinite;
export function portfolioUniverse(data,selected,minimum=40){
  const requested=[...new Set(selected)].filter(s=>typeof s==='string');
  if(!requested.length)throw Error('No symbols selected. Run a scan or choose a populated watchlist.');
  const rejected=[],eligible=[];
  for(const symbol of requested){
    const bars=data.get(symbol);
    if(!Array.isArray(bars)||bars.length<minimum){rejected.push(symbol);continue;}
    eligible.push([symbol,bars]);
  }
  if(!eligible.length)throw Error('No selected symbols have '+minimum+' or more daily bars.');
  const intersection=new Set(eligible[0][1].map(b=>time(b.time)));
  for(const [,bars] of eligible.slice(1)){const present=new Set(bars.map(b=>time(b.time)));
    for(const t of intersection)if(!present.has(t))intersection.delete(t);
  }
  const dates=[...intersection].sort((a,b)=>a-b);
  if(dates.length<minimum)throw Error('Selected symbols share only '+dates.length+' dates; need '+minimum+' aligned daily bars. Select a smaller or older-listed group.');
  const keys=new Set(dates);
  return {dates,requested,omitted:rejected,series:new Map(eligible.map(([symbol,bars])=>[symbol,bars.filter(b=>keys.has(time(b.time)))]))};
}
const annualReturnStats=(curve,initial)=>{
  if(!curve.length)return {startEquity:initial,endEquity:initial,returnPct:0,cagrPct:null,sharpe:null,maxDD:0};
  const ending=curve.at(-1).value,years=(time(curve.at(-1).time)-time(curve[0].time))/(86400*365.25);
  const daily=curve.slice(1).map((p,i)=>curve[i].value>0?p.value/curve[i].value-1:0);
  const avg=daily.reduce((v,x)=>v+x,0)/Math.max(1,daily.length);
  const variance=daily.length>1?daily.reduce((v,x)=>v+(x-avg)**2,0)/(daily.length-1):0;
  let peak=initial,maxDD=0;
  for(const pt of curve){peak=Math.max(peak,pt.value);maxDD=Math.max(maxDD,(peak-pt.value)/peak*100);}
  return {startEquity:initial,endEquity:ending,returnPct:100*(ending/initial-1),
    cagrPct:years>0&&ending>0?100*((ending/initial)**(1/years)-1):null,
    sharpe:variance>0?Math.sqrt(252)*avg/Math.sqrt(variance):null,maxDD};
};
export function runPortfolio(data,selected,options,backtestFn,getSignals=null,config={}){
  const source=portfolioUniverse(data,selected);
  const n=source.series.size,capital=Math.max(1,Number(options.capital||10000));
  const tranche=capital/n;
  const perSymbol=[],trades=[];
  for(const [symbol,bars] of source.series){
    const opts={...options,capital:tranche,timeframe:'D'};
    const chosen=typeof config.strategyForSymbol==='function'?
      config.strategyForSymbol(symbol,bars,{...opts}):null;
    if(chosen)Object.assign(opts,chosen);
    if(opts.strategy==='pine-custom'&&!opts.customSignals){
      if(typeof getSignals!=='function')throw Error('Select a compiled Pine strategy in Script Lab first.');
      opts.customSignals=getSignals(symbol,bars,config.pineParams||{});
    }
    const result=backtestFn(bars,opts);
    if(!result.curve?.length)throw Error('Insufficient overlap for '+symbol+' after split.');
    perSymbol.push({symbol,source:config.sources?.get(symbol)||'UNKNOWN',
      barDate:bars.at(-1)?.time||null,strategy:opts.strategy,
      strategyName:chosen?.strategyName||opts.strategy,
      fitSharpe:chosen?.fitSharpe??null,selectionId:chosen?.selectionId||null,
      metrics:result.metrics,curve:result.curve,trades:result.trades});
    trades.push(...result.trades.map(t=>({...t,symbol})));
  }
  const commonDates=perSymbol[0].curve.map(pt=>time(pt.time));
  const valueMaps=perSymbol.map(x=>new Map(x.curve.map(pt=>[time(pt.time),pt.value])));
  if(!perSymbol.every(x=>x.curve.length===commonDates.length&&x.curve.every((pt,i)=>time(pt.time)===commonDates[i])))
    throw Error('Portfolio equity dates did not align; cannot combine unmatched bars.');
  const curve=perSymbol[0].curve.map((pt,i)=>({time:pt.time,value:valueMaps.reduce((sum,m)=>sum+m.get(commonDates[i]),0)}));
  const symbols=[...source.series.keys()];
  const firstIndex=options.startIndex===undefined?1:Math.max(1,Math.floor(options.startIndex));
  const benchmarkCurve=curve.map((pt,i)=>{
    const index=firstIndex+i;
    return {time:pt.time,value:[...source.series.values()].reduce((v,bars)=>v+tranche*(bars[index].close/bars[firstIndex].open),0)};
  });
  const metrics=annualReturnStats(curve,capital);
  metrics.trades=perSymbol.reduce((sum,x)=>sum+x.metrics.trades,0);
  const totalWins=perSymbol.reduce((sum,x)=>sum+x.trades.filter(t=>t.pnl>0).length,0);
  metrics.winPct=metrics.trades?100*totalWins/metrics.trades:null;
  metrics.buyHoldPct=100*(benchmarkCurve.at(-1).value/capital-1);
  return {...source,symbols,weights:Object.fromEntries(symbols.map(s=>[s,1/n])),
    methodology:'Equal initial-dollar allocations; no periodic rebalancing; no cross-symbol capital netting; daily aligned closes.',
    metrics,curve,benchmarkCurve,breakdown:perSymbol.map(({symbol,source,barDate,strategy,strategyName,fitSharpe,selectionId,metrics})=>
      ({symbol,source,barDate,strategy,strategyName,fitSharpe,selectionId,...metrics})),trades,
    sourceSummary:config.sourceSummary||null};
}
export function portfolioSweepVariants(options={},pineInputs=null){
  const strategy=options.strategy||'ema-cross',candidates=[];
  if(strategy==='pine-custom'){
    if(!Array.isArray(pineInputs))throw Error('Select a Pine strategy with numeric input controls.');
    const inputs=pineInputs.filter(i=>i.type==='int'||i.type==='float').slice(0,2);
    if(!inputs.length)throw Error('Pine strategy needs numeric inputs for a parameter sweep.');
    let variants=[{}];
    for(const param of inputs){
      const d=Number(options.pineParams?.[param.name]??param.default);
      const step=param.step||Math.max(1,Math.abs(d)*.25);
      const values=[d-step,d,d+step].map(v=>param.type==='int'?Math.round(v):Math.round(v*10000)/10000)
        .filter(v=>(param.min==null||v>=param.min)&&(param.max==null||v<=param.max));
      variants=variants.flatMap(v=>[...new Set(values)].map(value=>({...v,[param.name]:value}))).slice(0,9);
    }
    return variants;
  }
  if(strategy==='ema-cross'){for(const fast of [8,15,25])for(const slow of [50,100,200])candidates.push({fast,slow});}
  else if(strategy==='rsi-revert'||strategy==='trend-rsi'){for(const buyLevel of [20,30,40])for(const sellLevel of [50,60,70])candidates.push({buyLevel,sellLevel});}
  else if(strategy==='bollinger'){for(const period of [10,20,30])for(const multiplier of [1.5,2,2.5])candidates.push({period,multiplier});}
  else for(const period of [10,20,30,55,100])candidates.push({period});
  return candidates;
}
export function runPortfolioSweep(data,symbols,options,backtestFn,getSignals=null,config={}){
  const aligned=portfolioUniverse(data,symbols,60);
  const bars=aligned.dates.length,holdout=Math.max(2,Math.floor(bars*.7)),variants=portfolioSweepVariants(options,config.pineInputs);
  const portfolioData=aligned.series;
  return variants.map(params=>{
    const pineParams=options.strategy==='pine-custom'?{...(options.pineParams||{}),...params}:null;
    const opt={...options,...(pineParams?{}:params)};
    const train=runPortfolio(portfolioData,[...portfolioData.keys()],{...opt,endIndex:holdout-1},backtestFn,getSignals,{...config,pineParams});
    const test=runPortfolio(portfolioData,[...portfolioData.keys()],{...opt,startIndex:holdout},backtestFn,getSignals,{...config,pineParams});
    return {params,train:train.metrics,test:test.metrics,n:train.symbols.length};
  }).sort((a,b)=>(b.test.returnPct||0)-(a.test.returnPct||0));
}
