// Daily OHLCV-only volatility research. Not VIX futures, VX options or a
// genuine futures term structure; ratio and relative-return readings are proxies.
import {VOLATILITY_UNIVERSE} from './universe.js';
export const VOL_TICKERS=Object.freeze(VOLATILITY_UNIVERSE.filter(x=>x!=='DEMO-VXX'));
const finite=Number.isFinite;
const percent=(a,b)=>finite(a)&&finite(b)&&b>0?100*(a/b-1):null;
export function realizedVolatility(bars,period){
  const n=Math.floor(Number(period));
  if(!Array.isArray(bars)||!Number.isInteger(n)||n<2||bars.length<n+1)return null;
  const slice=bars.slice(-n-1).map(x=>x.close);
  if(!slice.every(x=>finite(x)&&x>0))return null;
  const changes=slice.slice(1).map((v,i)=>Math.log(v/slice[i]));
  const mean=changes.reduce((v,x)=>v+x,0)/n;
  const variance=changes.reduce((sum,x)=>sum+(x-mean)**2,0)/(n-1);
  return 100*Math.sqrt(252)*Math.sqrt(variance); // annualized sample standard deviation of daily log returns
}
export function volatilityRow(symbol,bars,source){
  const count=bars?.length||0,last=bars?.at(-1),highs=bars?.slice(-252).map(b=>Number(b.high))||[];
  const maxHigh=highs.length?Math.max(...highs):null;
  return {symbol,source:source||'UNKNOWN',asOf:last?.time||null,bars:count,
    close:last?.close??null,return20:count>=21?percent(last.close,bars[count-21].close):null,
    rv20:realizedVolatility(bars,20),rv60:realizedVolatility(bars,60),
    drawdown252:count>=252&&finite(maxHigh)?percent(last.close,maxHigh):null};
}
function pairedBars(a,b,period=20){
  if(!a?.length||!b?.length)return null;
  const bMap=new Map(b.map(x=>[String(x.time),x.close]));
  const aligned=a.flatMap(x=>bMap.has(String(x.time))?[{date:x.time,a:x.close,b:bMap.get(String(x.time))}]:[]);
  if(aligned.length<period+1)return null;
  return aligned.slice(-period-1);
}
export function contangoPriceProxies(data,options={}){
  const vxx=data.get('VXX'),vxz=data.get('VXZ'),svxy=data.get('SVXY');
  const comparison=pairedBars(vxx,vxz,20),ratio=pairedBars(svxy,vxx,20);
  const relativeReturn=comparison?percent(comparison.at(-1).a,comparison[0].a)-percent(comparison.at(-1).b,comparison[0].b):null;
  // VXZ outperformance versus VXX; note this is NOT level comparison of NAVs.
  const slope=relativeReturn===null?null:-relativeReturn;
  const oldRatio=ratio?ratio[0].a/ratio[0].b:null,newRatio=ratio?ratio.at(-1).a/ratio.at(-1).b:null;
  const ratioTrend=ratio?percent(newRatio,oldRatio):null;
  const thresholdSpread=5,thresholdRatio=10;
  const regime=slope===null||ratioTrend===null?'Unavailable':
    slope>=thresholdSpread&&ratioTrend>=thresholdRatio?'Steep contango (price proxy)':
    slope<=-thresholdSpread&&ratioTrend<=-thresholdRatio?'Backwardation (price proxy)':
    'Flat or mixed (price proxy)';
  const asOf=comparison?.at(-1).date||ratio?.at(-1).date||null;
  return {relativeReturn20:slope,svxyVxxRatioTrend20:ratioTrend,regime,asOf,
    rule:'Steep contango-like: (VXZ 20D return − VXX 20D return) ≥ +5 pp AND (SVXY/VXX ratio 20D change) ≥ +10%; backwardation-like: both ≤ −5 pp and ≤ −10%; otherwise flat/mixed.',
    method:'Both are 20-session price-based performance proxies on aligned common trading dates. They are NOT measured VIX futures contango, term-structure contracts, options premiums, or actual roll yield.',
    sources:options.sources||null};
}
