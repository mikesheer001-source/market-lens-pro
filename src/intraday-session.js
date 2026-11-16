import {expectedNyseBarDate} from './freshness.js';

// Use New York's calendar to validate *intraday* bar freshness. An UTC date
// alone can fall on the wrong trading day for after-hours exchanges.
export function readableBarDate(value){
  const raw=value&&typeof value==='object'?(value.time??value.t):value;
  if(typeof raw==='string'&&/^\d{4}-\d{2}-\d{2}/.test(raw))return raw.slice(0,10);
  const numeric=typeof raw==='number'?raw:Number(raw);
  if(Number.isFinite(numeric)&&numeric>0){
    const ms=numeric<1e12?numeric*1000:numeric;
    const date=new Date(ms);
    if(Number.isFinite(date.getTime()))return date.toISOString().slice(0,10);
  }
  return '—';
}
export function nyIntradaySession(value){
  const raw=value&&typeof value==='object'?(value.time??value.t):value;
  const n=typeof raw==='number'?raw:Date.parse(raw);
  const ms=typeof raw==='number'?(n<1e12?n*1000:n):n;
  if(!Number.isFinite(ms))return null;
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms)).map(p=>[p.type,p.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
}
export function normalizeStartupPreferences(saved={}){
  const mode=saved.mode==='live'?'live':'demo';
  const lastDemoSymbol=typeof saved.lastDemoSymbol==='string'&&saved.lastDemoSymbol.startsWith('DEMO-')?
    saved.lastDemoSymbol:'DEMO-SPY';
  const lastLiveSymbol=typeof saved.lastLiveSymbol==='string'&&/^[A-Z0-9.^-]{1,20}$/.test(saved.lastLiveSymbol)?
    saved.lastLiveSymbol:'VXX';
  const lastBacktestSymbol=typeof saved.lastBacktestSymbol==='string'&&saved.lastBacktestSymbol?
    saved.lastBacktestSymbol:null;
  const lastSymbol=typeof saved.lastSymbol==='string'&&saved.lastSymbol?saved.lastSymbol:null;
  const tab=['screener','charts','backtest','optimize','scripts','data','volatility'].includes(saved.tab)?
    saved.tab:'screener';
  const liveCandidate=[lastBacktestSymbol,lastSymbol,lastLiveSymbol].find(x=>x&&!x.startsWith('DEMO-'));
  return {mode,tab,lastDemoSymbol,lastLiveSymbol,lastBacktestSymbol,lastSymbol,
    selectedSymbol:mode==='live'?(liveCandidate||lastLiveSymbol):
      (lastBacktestSymbol?.startsWith('DEMO-')?lastBacktestSymbol:
       lastSymbol?.startsWith('DEMO-')?lastSymbol:lastDemoSymbol)};
}
export function intradayCacheFresh(entry,{symbol,feed,expected=expectedNyseBarDate(),now=Date.now(),maxAgeMs=300000}={}){
  if(!entry||entry.source!=='ALPACA'||entry.symbol!==symbol||entry.feed!==feed||
    !Array.isArray(entry.bars)||entry.bars.length===0)return false;
  const latest=nyIntradaySession(entry.bars.at(-1));
  if(!latest||latest<expected)return false;
  const age=now-Number(entry.fetchedAt);
  return Number.isFinite(age)&&age>=0&&age<=maxAgeMs;
}
export function intradayFetchDecision({timeframe,mode,source,symbol,entry,feed='iex',
  expected=expectedNyseBarDate(),now=Date.now(),maxAgeMs=300000}={}){
  if(timeframe!=='2H'&&timeframe!=='15m')return 'daily';
  if(mode!=='live'||source!=='ALPACA')return 'unavailable';
  if(intradayCacheFresh(entry,{symbol,feed,expected,now,maxAgeMs}))return 'cached';
  return 'fetch';
}
