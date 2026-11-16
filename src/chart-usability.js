// Round 20: pure Chart Lab UI state and indicator math, shared by the
// existing footer and the on-chart settings editor. No DOM or chart globals.
import {ema,sma,rsi} from './engine.js';

export const INDICATOR_SETTINGS=Object.freeze({
  ema20:{label:'EMA A',periods:[['ema20Len','Period',2,500]]},
  ema50:{label:'EMA B',periods:[['ema50Len','Period',2,500]]},
  ema200:{label:'EMA C',periods:[['ema200Len','Period',2,500]]},
  sma20:{label:'SMA',periods:[['sma20Len','Period',2,500]]},
  bollinger:{label:'Bollinger',periods:[['bollPeriod','Period',2,500]]},
  volume:{label:'Volume',periods:[]},
  rsi:{label:'RSI',periods:[['rsiPeriod','Period',2,100]]},
  macd:{label:'MACD',periods:[
    ['macdFast','Fast',2,500],['macdSlow','Slow',2,500],
    ['macdSignal','Signal',2,500]]}
});
export const INDICATOR_ORDER=Object.freeze(Object.keys(INDICATOR_SETTINGS));
export const MACD_DEFAULTS=Object.freeze({macdFast:12,macdSlow:26,macdSignal:9});

export function nextFullscreenState(current,mode){
  return typeof mode==='boolean'?mode:!Boolean(current);
}
export function updateChartField(chart,field,value){
  const current={...chart},indicator=INDICATOR_SETTINGS[field];
  if(indicator) return {...current,[field]:Boolean(value)};
  for(const spec of Object.values(INDICATOR_SETTINGS)){
    const setting=spec.periods.find(([name])=>name===field);
    if(!setting)continue;
    const n=Number(value);
    if(!Number.isFinite(n))return current;
    return {...current,[field]:Math.min(setting[3],Math.max(setting[2],Math.round(n)))};
  }
  throw Error('Unknown chart indicator field: '+field);
}
export function updateIndicatorSetting(chart,indicator,field,value){
  const spec=INDICATOR_SETTINGS[indicator];
  if(!spec)throw Error('Unknown indicator: '+indicator);
  if(field==='enabled')return updateChartField(chart,indicator,value);
  if(!spec.periods.some(([name])=>name===field))
    throw Error('Unknown '+indicator+' setting: '+field);
  return updateChartField(chart,field,value);
}
export function chartScaleOptions(){
  // TradingView Lightweight Charts v5 uses built-in price-axis pointer
  // interactions. No custom drag handlers, which could break touch scroll.
  return {mouseWheel:true,pinch:true,
    axisPressedMouseMove:{time:true,price:true},
    axisDoubleClickReset:{time:true,price:true}};
}
export function resetPriceScale(chart){
  if(!chart||typeof chart.priceScale!=='function')return false;
  chart.priceScale('right').applyOptions({autoScale:true});
  return true;
}
export function macdSeries(closes,chart={}){
  const fast=ema(closes,Number(chart.macdFast||12));
  const slow=ema(closes,Number(chart.macdSlow||26));
  const macd=fast.map((v,i)=>v==null||slow[i]==null?null:v-slow[i]);
  return {macd,signal:ema(macd,Number(chart.macdSignal||9))};
}
export function bollingerSeries(closes,length){
  const n=Math.max(2,Math.floor(Number(length)||20)),basis=sma(closes,n);
  const upper=[],lower=[];
  for(let i=0;i<closes.length;i++){
    const avg=basis[i];
    if(avg==null){upper.push(null);lower.push(null);continue;}
    const slice=closes.slice(i-n+1,i+1);
    const deviation=Math.sqrt(slice.reduce((sum,x)=>sum+(x-avg)**2,0)/slice.length);
    upper.push(avg+2*deviation);lower.push(avg-2*deviation);
  }
  return {basis,upper,lower};
}
export function activeIndicatorReadings(bars,chart={}){
  if(!Array.isArray(bars)||!bars.length)return [];
  const c=bars.map(b=>b.close),last=bars.at(-1),out=[];
  const push=(key,label,value,details=[])=>{
    if(chart[key])out.push({key,label,value:Number.isFinite(value)?value:null,
      details:details.map(v=>Number.isFinite(v)?v:null)});
  };
  for(const [key,periodKey] of [['ema20','ema20Len'],['ema50','ema50Len'],
    ['ema200','ema200Len'],['sma20','sma20Len']]){
    if(!chart[key])continue;
    const period=Number(chart[periodKey]);
    push(key,(key.startsWith('sma')?'SMA ':'EMA ')+period,
      (key.startsWith('sma')?sma(c,period):ema(c,period)).at(-1));
  }
  if(chart.bollinger){
    const bb=bollingerSeries(c,chart.bollPeriod);
    push('bollinger','Bollinger '+chart.bollPeriod,bb.basis.at(-1),
      [bb.upper.at(-1),bb.lower.at(-1)]);
  }
  push('volume','Volume',last.volume??null);
  if(chart.rsi)push('rsi','RSI '+chart.rsiPeriod,rsi(c,chart.rsiPeriod).at(-1));
  if(chart.macd){
    const m=macdSeries(c,chart);
    push('macd','MACD '+[chart.macdFast,chart.macdSlow,chart.macdSignal].join('/'),
      m.macd.at(-1),[m.signal.at(-1)]);
  }
  // Keep stable presentation order regardless of available data.
  return INDICATOR_ORDER.flatMap(k=>out.filter(x=>x.key===k));
}
