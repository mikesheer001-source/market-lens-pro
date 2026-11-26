// Local presentation preferences. Never publish browser-specific chart clutter settings.
export const CHART_WORKSPACE_KEY='market-lens-pro-chart-workspace-tools-v1';
export const CHART_WORKSPACE_DEFAULTS=Object.freeze({
  watchlist:false,scan:false,backtest:false,alerts:false,options:false,scripts:false,data:false,
  trades:true,pine:true,alertLevels:false,strikes:false,optionsPnl:false
});
export function normalizeChartWorkspace(raw={}){
  return Object.fromEntries(Object.entries(CHART_WORKSPACE_DEFAULTS).map(([key,value])=>
    [key,typeof raw?.[key]==='boolean'?raw[key]:value]));
}
export function readChartWorkspace(storage){
  try{return normalizeChartWorkspace(JSON.parse(storage.getItem(CHART_WORKSPACE_KEY)||'{}'));}
  catch{return normalizeChartWorkspace();}
}
export function writeChartWorkspace(storage,prefs){
  try{storage.setItem(CHART_WORKSPACE_KEY,JSON.stringify(normalizeChartWorkspace(prefs)));}catch{}
}
// Alert thresholds are daily-close rules, not intraday triggers or price predictions.
export function chartAlertLevels(alerts,symbol){
  return (alerts||[]).filter(a=>a.symbol===symbol&&a.type!=='signal'&&a.metric==='price'&&
    Number.isFinite(a.threshold)&&a.threshold>0&&['>','<'].includes(a.op))
    .map(a=>({price:a.threshold,label:'Daily alert '+a.op+' '+a.threshold,active:!!a.active}));
}
// Contract strikes / user-entered strike assumptions are not quotes. Never infer them.
export function chartOptionLevels(snapshot,symbol){
  if(snapshot?.symbol!==symbol)return [];
  const grouped=new Map();
  for(const leg of snapshot.legs||[]){
    if(!Number.isFinite(leg.strike)||leg.strike<=0||!['call','put'].includes(leg.type)||!['buy','sell'].includes(leg.side))continue;
    const label=(leg.side==='buy'?'B':'S')+(leg.type==='call'?'C':'P');
    const labels=grouped.get(leg.strike)||new Set();labels.add(label);grouped.set(leg.strike,labels);
  }
  return [...grouped].sort(([a],[b])=>a-b).map(([price,labels])=>({price,label:'Strike '+[...labels].join('/')}));
}
export function matchingTradeMarkers(markers,bars){
  const stamp=time=>typeof time==='object'?JSON.stringify(time):String(time);
  const times=new Set(bars.map(bar=>stamp(bar.time)));
  return markers.filter(marker=>times.has(stamp(marker.time)));
}
