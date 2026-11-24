// Chart intervals and upstream resolution. Hour buckets never cross NYSE sessions.
export const CHART_FRAMES=[['1m','1m'],['5m','5m'],['15m','15m'],['2H','2H'],['4H','4H'],['8H','8H'],['D','1D'],['W','1W'],['M','1M']];
export const INTRADAY_MINUTES=Object.freeze({'1m':1,'5m':5,'15m':15,'2H':120,'4H':240,'8H':480});
export const isIntraday=tf=>Object.hasOwn(INTRADAY_MINUTES,tf);
export const sourceResolution=tf=>tf==='1m'?'1Min':tf==='5m'?'5Min':'15Min';
export const resolutionDays=resolution=>resolution==='1Min'?7:resolution==='5Min'?30:120;
export function selectedFrames(saved,current){
  const ids=Array.isArray(saved)?saved:CHART_FRAMES.map(([id])=>id);
  const rows=CHART_FRAMES.filter(([id])=>ids.includes(id)||id===current);
  return rows.length?rows:CHART_FRAMES;
}
