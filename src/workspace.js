// Browser-only workspace state helpers for scans, named watchlists and alerts.
// Data and alert evaluation remain entirely local; no remote alert delivery.
export const WATCHLIST_LIMIT = 16;
export const SCAN_LIMIT = 20;
export const ALERT_LIMIT = 50;

export function restoreWatchlists(settings={}){
  const fromSaved=Array.isArray(settings.watchlists)?settings.watchlists:[];
  const cleaned=fromSaved.filter(x=>x&&typeof x.id==='string'&&typeof x.name==='string')
    .slice(0,WATCHLIST_LIMIT).map(x=>({
      id:x.id,name:x.name.slice(0,80),symbols:[...new Set((Array.isArray(x.symbols)?x.symbols:[]).filter(s=>typeof s==='string'))]
    }));
  if(!cleaned.length)cleaned.push({id:'default',name:'My watchlist',symbols:[...(settings.watch||[])]});
  const chosen=cleaned.find(x=>x.id===settings.watchlistId)||cleaned[0];
  return {watchlists:cleaned,watchlistId:chosen.id,watch:new Set(chosen.symbols)};
}
export function watchlistChange(watchlists,id,symbol){
  return watchlists.map(w=>w.id===id?{...w,symbols:w.symbols.includes(symbol)?w.symbols.filter(s=>s!==symbol):[...w.symbols,symbol]}:w);
}
export function validateAlert({symbol,metric,op,threshold}){
  if(!/^[A-Z0-9][A-Z0-9.^_-]{0,19}$/.test(String(symbol||'')))throw Error('Choose a valid symbol');
  if(!['price','rsi'].includes(metric))throw Error('Choose Price or RSI');
  if(!['>','<'].includes(op))throw Error('Choose Above or Below');
  if(!Number.isFinite(Number(threshold)))throw Error('Enter a finite threshold');
  if(metric==='rsi'&&(Number(threshold)<0||Number(threshold)>100))throw Error('RSI level must be between 0 and 100');
  return {symbol,metric,op,threshold:Number(threshold)};
}
export function checkAlerts(alerts,data,statsFor,aggregate,checkedAt=new Date().toISOString()){
  const hits=[],updated=alerts.map(alert=>{
    if(!alert||alert.type==='signal'||!data.has(alert.symbol))return alert;
    const bars=data.get(alert.symbol);if(!bars?.length)return alert;
    const daily=statsFor(aggregate(bars,'D'));
    const value=alert.metric==='price'?daily.price:daily.rsi;
    if(!Number.isFinite(value))return {...alert,lastEvaluatedAt:checkedAt};
    const active=alert.op==='>'?value>alert.threshold:value<alert.threshold;
    const fired=active&&!alert.active;
    if(fired)hits.push({...alert,value,barDate:bars.at(-1).time,checkedAt});
    return {...alert,active,unread:fired?true:alert.unread===true,lastValue:value,
      lastEvaluatedAt:checkedAt,lastHitAt:fired?checkedAt:alert.lastHitAt||null,
      lastHitBarDate:fired?bars.at(-1).time:alert.lastHitBarDate||null};
  });
  return {alerts:updated,hits};
}
export function makeScanSnapshot(rows,options={}){
  return {
    id:String(options.id||'scan-'+Date.now()),name:String(options.name||'Saved scan').slice(0,100),
    savedAt:options.savedAt||new Date().toISOString(),
    source:options.source||'DEMO',
    rules:JSON.parse(JSON.stringify(options.rules||[])),universeFilter:options.universeFilter||'all',
    query:options.query||'',showOnlyMatches:!!options.showOnlyMatches,showWatch:!!options.showWatch,
    sort:options.sort||'symbol',ascending:options.ascending!==false,
    // Copy computed indicator stats: a saved scan never pretends to be fresh market data.
    rows:rows.slice(0,200).map(({symbol,d,w,evalResult,source,latestBar:sourceLatestBar,signal:sourceSignal})=>({
      symbol,d:{...d},w:{...w},evalResult:{pass:!!evalResult.pass,fails:[...(evalResult.fails||[])]},source,
      latestBar:sourceLatestBar??null,signal:sourceSignal??null
    }))
  };
}
export function analysisSnapshot({result,sweep,symbol,tf,strategy,source,savedAt=new Date().toISOString()}){
  return {version:1,savedAt,symbol,tf,strategy,source,result:result||null,sweep:sweep||null};
}
export function restoreAnalysis(raw){
  if(!raw||raw.version!==1||typeof raw.symbol!=='string')return null;
  if(!raw.result&&!raw.sweep)return null;
  return raw;
}
