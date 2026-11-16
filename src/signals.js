// Strategies in Screener share the backtest engine's completed-bar, next-open
// order logic. LONG is a held long at last close; EXIT is an actual exit on the
// latest bar or an open position awaiting an exit next bar. FLAT has no position.
// The research engine's artificial end-of-sample liquidation is never EXIT.
export const SIGNAL_STATUSES=Object.freeze(['LONG','FLAT','EXIT']);
export const PRESET_SIGNAL_OPTIONS=Object.freeze([
  {id:'preset:ema-cross',name:'EMA crossover',strategy:'ema-cross'},
  {id:'preset:rsi-revert',name:'RSI mean reversion',strategy:'rsi-revert'},
  {id:'preset:trend-rsi',name:'Trend + RSI pullback',strategy:'trend-rsi'},
  {id:'preset:bollinger',name:'Bollinger mean reversion',strategy:'bollinger'},
  {id:'preset:breakout',name:'Price breakout',strategy:'breakout'}
]);
export function availableStrategySignals(savedScripts=[]){
  const options=[...PRESET_SIGNAL_OPTIONS.map(s=>({...s,kind:'preset'}))];
  const ids=new Set();
  for(const s of savedScripts){
    if(!s||typeof s.id!=='string'||typeof s.code!=='string'||typeof s.name!=='string')continue;
    if(ids.has(s.id))continue;ids.add(s.id);
    options.push({id:'pine:'+s.id,name:s.name,kind:'pine',strategy:'pine-custom',
      code:s.code,settings:{...(s.settings||{})}});
  }
  return options;
}
export function signalPosition(value){
  return value==='LONG'?'LONG':'FLAT'; // EXIT closes a previously held long.
}
export function scanSignalFlips(prior,current,{strategyId,strategyName,checkedAt=new Date().toISOString()}={}){
  const previous=prior&&typeof prior==='object'?prior:{};
  const updated={...previous},flips=[];
  for(const [symbol,result] of Object.entries(current||{})){
    if(!result||!SIGNAL_STATUSES.includes(result.status))continue;
    const next={status:result.status,position:signalPosition(result.status),
      barDate:result.barDate,source:result.source,checkedAt};
    const old=previous[symbol];
    if(old&&old.position!==next.position){
      flips.push({symbol,strategyId,strategyName,from:old.position,to:next.position,
        observedFrom:old.status,observedTo:next.status,barDate:next.barDate,
        source:next.source,checkedAt});
    }
    updated[symbol]=next;
  }
  return {states:updated,flips};
}
export function computeOneStrategySignal({
  bars,source,selection,options,backtest,compiled=null,compilePine,executePine
}){
  if(!Array.isArray(bars)||bars.length<40)return {status:'UNAVAILABLE',barDate:bars?.at(-1)?.time||null,
    source,reason:'At least 40 daily bars are required'};
  if(!selection)throw Error('Select a strategy.');
  try{
    const opts={...options,timeframe:'D',side:'long',strategy:selection.strategy};
    if(selection.kind==='pine'){
      const program=compiled||compilePine(selection.code);
      if(program.mode!=='strategy')return {status:'UNAVAILABLE',barDate:bars.at(-1).time,
        source,reason:'Saved script declares indicator(), not strategy()'};
      opts.customSignals=executePine(program,bars,selection.settings||{}).signals;
    }
    const run=backtest(bars,opts),state=run.signalState;
    if(!state||!SIGNAL_STATUSES.includes(state.status))throw Error('No terminal position state available.');
    return {status:state.status,barDate:state.barDate,source,
      positionOpen:state.positionOpen,exitReason:state.exitReason||null};
  }catch(error){return {status:'UNAVAILABLE',barDate:bars.at(-1).time,
    source,reason:String(error.message||error)};}
}
export function evaluateStrategySignals({
  data,selection,options,backtest,compilePine,executePine,sourceFor=()=>null
}){
  const result={},errors=[];
  let compiled=null;
  if(selection?.kind==='pine'){
    try{compiled=compilePine(selection.code);}catch(err){
      return {signals:{},errors:[{symbol:'ALL',reason:String(err.message||err)}]};
    }
  }
  for(const [symbol,bars] of data){
    const signal=computeOneStrategySignal({bars,selection,options,backtest,
      compilePine,executePine,compiled,source:sourceFor(symbol)});
    result[symbol]=signal;
    if(signal.status==='UNAVAILABLE')errors.push({symbol,reason:signal.reason});
  }
  return {signals:result,errors};
}
