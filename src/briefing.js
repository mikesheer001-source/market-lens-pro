// Round 13 — immutable, local-only daily research briefing.
// Daily bars and signals come from the same engines as Screener and Volatility.
import {aggregate,screenSymbol,statsFor} from './engine.js';
import {contangoPriceProxies,volatilityRow} from './volatility.js';
import {barDate,explainStaleSymbol} from './freshness.js';

export const BRIEFING_HISTORY_DAYS=7;
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
  new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export function briefingMarketDate(at=new Date().toISOString()){
  const date=new Date(at);
  if(!Number.isFinite(date.valueOf()))throw Error('Invalid briefing generation timestamp.');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date).map(p=>[p.type,p.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
}
function sourceLabel(feed){return 'ALPACA '+String(feed||'IEX').toUpperCase()+' 1Day';}
function snapAlert(alert,sourceFor,barFor){
  const symbol=String(alert.symbol||'UNKNOWN');
  const date=barDate({time:alert.lastHitBarDate||alert.lastEvaluatedAt?.slice(0,10)})||barFor(symbol)||null;
  return {id:String(alert.id||''),symbol,
    kind:alert.type==='signal'?'Strategy flip':'Price/RSI rule',
    detail:alert.type==='signal'?(String(alert.strategyName||'Strategy')+': '+String(alert.oldValue||'?')+
      ' → '+String(alert.newValue||'?')):
      (String(alert.metric||'price').toUpperCase()+' '+String(alert.op||'?')+' '+
      String(alert.threshold??'')+' · last '+String(alert.lastValue??'—')),
    status:alert.active?'Active':'Triggered · unread',
    source:sourceFor(symbol)||'IN-APP LOCAL ALERT',barDate:date};
}
export function compileDailyBriefing({
  generatedAt=new Date().toISOString(),scan,data,sources,rules=[],symbols,
  feed='iex',signalSelection='none',strategyName=null,signals=new Map(),
  flips=[],hasFlipBaseline=false,alerts=[],freshness=null,diagnostics={}
}){
  if(scan?.status!=='complete'||scan.source!=='ALPACA')
    throw Error('A completed live Alpaca scan is required. Demo and saved scans are not live briefings.');
  if(!(data instanceof Map)||!(sources instanceof Map)||!Array.isArray(symbols))
    throw Error('Live data, sources and visible universe are required.');
  const date=briefingMarketDate(generatedAt),source=sourceLabel(feed);
  const liveSymbols=symbols.filter(symbol=>sources.get(symbol)==='ALPACA'&&data.get(symbol)?.length);
  const scope=new Set(symbols);
  const rows=liveSymbols.map(symbol=>{
    const bars=data.get(symbol);
    const daily=aggregate(bars,'D'),stat=statsFor(daily);
    return {symbol,price:stat.price,rsi5:stat.rsi5,
      barDate:barDate(bars.at(-1)),source,match:screenSymbol(bars,rules).pass};
  });
  const matches=rows.filter(row=>row.match).map(({match,...row})=>row);
  const maxDate=rows.map(row=>row.barDate).filter(Boolean).sort().at(-1)||null;
  const selected=signalSelection!=='none'&&!!strategyName;
  const lookup=signals instanceof Map?signals:new Map(Object.entries(signals||{}));
  const longSignals=selected?liveSymbols.flatMap(symbol=>{
    const state=lookup.get(symbol);
    return state?.status==='LONG'?[{symbol,status:'LONG',source:state.source||source,
      barDate:barDate({time:state.barDate})||null}]:[];
  }):[];
  const validFlips=selected&&hasFlipBaseline?(flips||[]).filter(x=>scope.has(x.symbol)&&
    x.strategyId===signalSelection).map(x=>({symbol:x.symbol,from:x.from,to:x.to,
    barDate:barDate({time:x.barDate})||null,source:x.source||source})):[];
  const volData=new Map(liveSymbols.filter(x=>['VXX','VXZ','SVXY'].includes(x))
    .map(x=>[x,data.get(x)]));
  const regime=contangoPriceProxies(volData,{sources:source});
  const vxx=volatilityRow('VXX',volData.get('VXX'),volData.has('VXX')?source:'UNAVAILABLE');
  const alertItems=(Array.isArray(alerts)?alerts:[]).filter(x=>x&&(x.active===true||x.unread===true));
  const barFor=symbol=>barDate(data.get(symbol)?.at(-1));
  const sourceFor=symbol=>sources.get(symbol)==='ALPACA'?source:null;
  const activeAlerts=alertItems.slice(-50).map(x=>snapAlert(x,sourceFor,barFor));
  const stale=(freshness?.stale||[]).map(x=>({symbol:x.symbol,barDate:x.latest||null,
    reason:explainStaleSymbol(x,diagnostics[x.symbol]),source}));
  return {
    version:1,date,generatedAt,source,scanAt:scan.at||null,
    scan:{loaded:Number(scan.returned??liveSymbols.length),requested:Number(scan.requested??symbols.length),
      scope:symbols.length,matched:matches.length,barDate:maxDate,source},
    matches,
    strategy:{id:selected?signalSelection:null,name:selected?strategyName:null,
      source,barDate:longSignals.map(x=>x.barDate).filter(Boolean).sort().at(-1)||maxDate,
      baselineAvailable:selected&&hasFlipBaseline,long:longSignals,flips:validFlips},
    regime:{name:regime.regime,barDate:barDate({time:regime.asOf}),
      source,relativeReturn20:regime.relativeReturn20,
      ratioTrend20:regime.svxyVxxRatioTrend20,method:regime.method},
    vxx:{symbol:'VXX',close:vxx.close,return20:vxx.return20,
      barDate:barDate({time:vxx.asOf}),source:vxx.source},
    alerts:{items:activeAlerts,source:'LOCAL browser alerts',barDate:activeAlerts
      .map(x=>x.barDate).filter(Boolean).sort().at(-1)||maxDate},
    stale:{items:stale,source,barDate:freshness?.expected||maxDate,
      expected:freshness?.expected||null}
  };
}
const num=(value,digits=2)=>finite(value)?value.toFixed(digits):'N/A';
const money=value=>finite(value)?'$'+num(value):'N/A';
const pct=value=>finite(value)?num(value)+'%':'N/A';
export function briefingToText(b){
  if(!b||b.version!==1)throw Error('Generate a live daily briefing before copying.');
  const lines=[
    'MARKET LENS PRO — DAILY BRIEFING',
    'US market date: '+b.date,
    'Generated: '+b.generatedAt,
    'Source: '+b.source+' | latest scan bar: '+(b.scan.barDate||'N/A'),
    'Scan: '+b.scan.loaded+'/'+b.scan.requested+' symbols loaded; '+b.scan.matched+
      ' matches (scope: '+b.scan.scope+')',
    'Matches ('+b.matches.length+'): '+(b.matches.length?
      b.matches.map(x=>x.symbol+' '+money(x.price)+' RSI 5D '+num(x.rsi5,1)+
        ' ['+(x.barDate||'N/A')+']').join('; '):'None'),
    'Strategy: '+(b.strategy.name||'Not selected'),
    'LONG ('+b.strategy.long.length+'): '+(b.strategy.name?
      (b.strategy.long.map(x=>x.symbol+' ['+(x.barDate||'N/A')+']').join(', ')||'None'):
      'Unavailable — select a strategy'),
    'Flips since preceding scan: '+(!b.strategy.name?'Unavailable — select a strategy':
      !b.strategy.baselineAvailable?'No prior comparable scan':
      (b.strategy.flips.map(x=>x.symbol+' '+x.from+' → '+x.to+
        ' ['+(x.barDate||'N/A')+']').join('; ')||'None')),
    'Contango regime (PRICE-BASED PROXY; NOT VIX FUTURES CONTANGO): '+b.regime.name+
      ' | bar '+(b.regime.barDate||'N/A')+' | '+b.regime.source,
    'VXX: '+money(b.vxx.close)+' close | 20D return '+pct(b.vxx.return20)+
      ' | bar '+(b.vxx.barDate||'N/A')+' | '+b.vxx.source,
    'Active/triggered alerts ('+b.alerts.items.length+'): '+(b.alerts.items.map(x=>
      x.symbol+' '+x.detail+' ['+(x.barDate||'N/A')+']').join('; ')||'None'),
    'Stale/missing bars ('+b.stale.items.length+'): '+(b.stale.items.map(x=>
      x.symbol+' '+(x.barDate||'missing')+' — '+x.reason).join('; ')||'None'),
    'Research only; daily close/position signals are not live executions.'
  ];
  return lines.join('\n');
}
export function pruneBriefingHistory(raw,now=new Date().toISOString()){
  const today=briefingMarketDate(now);
  const cutoff=new Date(today+'T00:00:00Z');
  cutoff.setUTCDate(cutoff.getUTCDate()-(BRIEFING_HISTORY_DAYS-1));
  const min=cutoff.toISOString().slice(0,10),byDate=new Map();
  for(const row of Array.isArray(raw)?raw:[]){
    if(!row||row.version!==1||!validDate(row.date)||row.date<min||row.date>today||
      !row.scan||!Array.isArray(row.matches)||!row.strategy||!row.vxx||!row.regime)continue;
    if(!byDate.has(row.date)||String(row.generatedAt)>String(byDate.get(row.date).generatedAt))
      byDate.set(row.date,row);
  }
  return [...byDate.values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,BRIEFING_HISTORY_DAYS);
}
export function saveBriefingHistory(history,briefing,now=briefing?.generatedAt){
  if(briefing?.version!==1||!validDate(briefing.date))throw Error('Cannot save an invalid briefing.');
  return pruneBriefingHistory([briefing,...(Array.isArray(history)?history:[])],now);
}
