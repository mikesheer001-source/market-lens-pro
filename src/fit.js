// Research-only strategy fit: same execution engine and cost assumptions per symbol.
import {barDate} from './freshness.js';
export const FIT_COLUMNS=Object.freeze(['symbol','returnPct','cagrPct','sharpe','maxDD','winPct','trades','source','barDate']);
const metricKeys=new Set(['returnPct','cagrPct','sharpe','maxDD','winPct','trades']);
export function sortUniverseFit(rows,key='sharpe',descending=key!=='symbol'&&key!=='maxDD'){
  if(!FIT_COLUMNS.includes(key))throw Error('Unknown fit column: '+key);
  return [...rows].sort((a,b)=>{
    const x=metricKeys.has(key)?a.metrics?.[key]:a[key],y=metricKeys.has(key)?b.metrics?.[key]:b[key];
    const missing=v=>v==null||(typeof v==='number'&&!Number.isFinite(v))||v==='';
    if(missing(x)!==missing(y))return missing(x)?1:-1;
    if(!missing(x)){
      const cmp=metricKeys.has(key)?x-y:String(x).localeCompare(String(y));
      if(cmp)return descending?-cmp:cmp;
    }
    return a.symbol.localeCompare(b.symbol);
  });
}
export function bestUniverseFit(rows){
  return sortUniverseFit(rows,'sharpe',true).find(r=>Number.isFinite(r.metrics?.sharpe))||null;
}
export function fitAcrossUniverse({symbols,data,options,backtest,compilePine,executePine,
 strategyScript=null,sourceFor=()=>null,expectedBarDate=null}){
  if(!Array.isArray(symbols)||!symbols.length)throw Error('Choose a research universe.');
  if(typeof backtest!=='function')throw Error('Backtest engine unavailable.');
  const settings={...options,timeframe:'D'};
  let pine=null;
  if(settings.strategy==='pine-custom'){
    if(!strategyScript?.code)throw Error('Load a Pine strategy() in Script Lab first.');
    pine=compilePine(strategyScript.code);
    if(pine.mode!=='strategy')throw Error('Selected Pine script declares indicator(), not strategy().');
  }
  const rows=[];
  for(const symbol of symbols){
    const history=data instanceof Map?data.get(symbol):data?.[symbol];
    const last=Array.isArray(history)?barDate(history.at(-1)):null;
    const row={symbol,source:sourceFor(symbol)||'NO ALPACA DATA',barDate:last,
      stale:!!(expectedBarDate&&(!last||last<expectedBarDate)),metrics:null,error:null};
    if(!Array.isArray(history)||history.length<40)
      row.error=history?.length?'Insufficient OHLCV history ('+history.length+' bars)':'No OHLCV bars returned';
    else try{
      const cfg={...settings};
      if(pine)cfg.customSignals=executePine(pine,history,strategyScript.settings||{}).signals;
      const result=backtest(history,cfg);
      if(!result?.metrics||!result.curve?.length)throw Error(result?.notice||'No equity curve');
      row.metrics=result.metrics;
    }catch(e){row.error=String(e.message||e);}
    rows.push(row);
  }
  return {version:1,settings,script:pine?{...strategyScript}:null,
    expectedBarDate,runAt:new Date().toISOString(),requested:symbols.length,
    completed:rows.filter(x=>x.metrics).length,rows:sortUniverseFit(rows)};
}
