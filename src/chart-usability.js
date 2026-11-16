// Chart Lab settings, indicator math and price-axis behavior.
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

export function indicatorInputs(key){
  return key==='volume'?[['volumeHeight','Height (% of price pane)',8,40]]:INDICATOR_SETTINGS[key].periods;
}

export function indicatorLabel(key,chart){
  if(key.startsWith('ema'))return 'EMA '+chart[key+'Len'];
  if(key==='sma20')return 'SMA '+chart.sma20Len;
  if(key==='bollinger')return 'Bollinger '+chart.bollPeriod;
  if(key==='rsi')return 'RSI '+chart.rsiPeriod;
  if(key==='macd')return 'MACD '+[chart.macdFast,chart.macdSlow,chart.macdSignal].join('/');
  return INDICATOR_SETTINGS[key].label;
}

export function nextFullscreenState(current,mode){
  return typeof mode==='boolean'?mode:!Boolean(current);
}
export function updateChartField(chart,field,value){
  const current={...chart},indicator=INDICATOR_SETTINGS[field];
  if(indicator) return {...current,[field]:Boolean(value)};
  for(const key of INDICATOR_ORDER){
    const setting=indicatorInputs(key).find(([name])=>name===field);
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
  if(!indicatorInputs(indicator).some(([name])=>name===field))
    throw Error('Unknown '+indicator+' setting: '+field);
  return updateChartField(chart,field,value);
}
export function chartScaleOptions(){
  return {mouseWheel:true,pinch:true,
    axisPressedMouseMove:{time:true,price:true},
    axisDoubleClickReset:{time:true,price:true}};
}
export function mountPriceAxisTouch(container,chart){
  // Lightweight Charts uses the plot's vertical-scroll option for its axis
  // too. Enable the native drag only for touches that start on a right axis.
  let axisTouch=null;
  container.addEventListener('touchstart',event=>{
    if(axisTouch!==null||event.touches.length!==1)return;
    const cell=event.target.closest('td');
    if(!cell||!chart.panes().some(pane=>pane.getHTMLElement()?.lastElementChild===cell))return;
    axisTouch=event.changedTouches[0].identifier;
    chart.applyOptions({handleScroll:{vertTouchDrag:true}});
  },{capture:true,passive:true});
  const end=event=>{
    if(axisTouch===null||!Array.from(event.changedTouches).some(touch=>touch.identifier===axisTouch))return;
    axisTouch=null;
    chart.applyOptions({handleScroll:{vertTouchDrag:false}});
  };
  container.addEventListener('touchend',end,{passive:true});
  container.addEventListener('touchcancel',end,{passive:true});
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
  const push=(key,value,details=[])=>{
    if(chart[key])out.push({key,label:indicatorLabel(key,chart),value:Number.isFinite(value)?value:null,
      details:details.map(v=>Number.isFinite(v)?v:null)});
  };
  for(const [key,periodKey] of [['ema20','ema20Len'],['ema50','ema50Len'],
    ['ema200','ema200Len'],['sma20','sma20Len']]){
    if(!chart[key])continue;
    const period=Number(chart[periodKey]);
    push(key,(key==='sma20'?sma(c,period):ema(c,period)).at(-1));
  }
  if(chart.bollinger){
    const bb=bollingerSeries(c,chart.bollPeriod);
    push('bollinger',bb.basis.at(-1),
      [bb.upper.at(-1),bb.lower.at(-1)]);
  }
  push('volume',last.volume??null);
  if(chart.rsi)push('rsi',rsi(c,chart.rsiPeriod).at(-1));
  if(chart.macd){
    const m=macdSeries(c,chart);
    push('macd',m.macd.at(-1),[m.signal.at(-1)]);
  }
  // Keep stable presentation order regardless of available data.
  return INDICATOR_ORDER.flatMap(k=>out.filter(x=>x.key===k));
}
