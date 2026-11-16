import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleData,ema,sma,rsi,indicators} from '../src/engine.js';
import {INDICATOR_SETTINGS,INDICATOR_ORDER,MACD_DEFAULTS,nextFullscreenState,
  updateChartField,updateIndicatorSetting,chartScaleOptions,resetPriceScale,
  bollingerSeries,macdSeries,activeIndicatorReadings} from '../src/chart-usability.js';

const base={ema20:true,ema50:false,ema200:true,sma20:false,bollinger:false,
  volume:true,rsi:true,macd:false,ema20Len:20,ema50Len:50,ema200Len:200,
  sma20Len:20,bollPeriod:20,rsiPeriod:14,...MACD_DEFAULTS};
const bars=sampleData()['DEMO-SPY'];

test('Round 20: fullscreen transitions are reversible and leave selected symbol/settings untouched',()=>{
  assert.equal(nextFullscreenState(false),true);
  assert.equal(nextFullscreenState(true),false);
  assert.equal(nextFullscreenState(false,true),true);
  assert.equal(nextFullscreenState(true,true),true);
  assert.equal(nextFullscreenState(true,false),false);
  const original={...base,symbol:'DEMO-SPY',tf:'D',lines:{'DEMO-SPY':[10]}};
  let fullscreen=false;
  fullscreen=nextFullscreenState(fullscreen,true);
  fullscreen=nextFullscreenState(fullscreen,false);
  assert.equal(fullscreen,false);
  assert.deepEqual(original,{...base,symbol:'DEMO-SPY',tf:'D',lines:{'DEMO-SPY':[10]}});
});

test('Round 20: eight indicators expose accessible independent gear/settings definitions',()=>{
  assert.deepEqual(INDICATOR_ORDER,
    ['ema20','ema50','ema200','sma20','bollinger','volume','rsi','macd']);
  assert.deepEqual(INDICATOR_SETTINGS.macd.periods.map(x=>x[0]),
    ['macdFast','macdSlow','macdSignal']);
  assert.equal(INDICATOR_SETTINGS.volume.periods.length,0);
  assert.equal(Object.values(INDICATOR_SETTINGS).filter(x=>x.periods.length).length,7);
  assert.deepEqual(INDICATOR_SETTINGS.rsi.periods[0],['rsiPeriod','Period',2,100]);
});

test('Round 20: inline and footer period controls update the SAME properties with bounds',()=>{
  const footer=updateChartField(base,'ema20Len',33);
  const inline=updateIndicatorSetting(base,'ema20','ema20Len',33);
  assert.deepEqual(footer,inline);
  assert.equal(inline.ema20Len,33);
  assert.equal(base.ema20Len,20,'updates never mutate original options');
  assert.equal(updateChartField(base,'rsiPeriod',500).rsiPeriod,100);
  assert.equal(updateIndicatorSetting(base,'rsi','rsiPeriod',1).rsiPeriod,2);
  assert.equal(updateIndicatorSetting(base,'sma20','sma20Len',22).sma20Len,22);
  assert.equal(updateIndicatorSetting(base,'bollinger','bollPeriod',35).bollPeriod,35);
  assert.equal(updateIndicatorSetting(base,'macd','macdSignal',13).macdSignal,13);
  assert.equal(updateChartField(base,'macdFast',14).macdFast,14);
  assert.equal(updateChartField(base,'ema20Len','NaN').ema20Len,20);
  assert.equal(updateIndicatorSetting(base,'ema200','enabled',false).ema200,false);
  assert.equal(updateChartField(base,'ema200',false).ema200,false);
  assert.equal(updateIndicatorSetting(base,'volume','enabled',false).volume,false);
  assert.throws(()=>updateIndicatorSetting(base,'volume','ema20Len',20),/Unknown volume setting/);
  assert.throws(()=>updateIndicatorSetting(base,'fictional','enabled',true),/Unknown indicator/);
  assert.throws(()=>updateChartField(base,'unknown',1),/Unknown chart/);
});

test('Round 20: on-chart latest EMA, SMA, RSI, volume and Bollinger readings match actual series',()=>{
  const cfg={...base,ema50:true,sma20:true,bollinger:true,macd:true};
  const close=bars.map(x=>x.close),rows=activeIndicatorReadings(bars,cfg);
  assert.deepEqual(rows.map(x=>x.key),INDICATOR_ORDER);
  const find=key=>rows.find(x=>x.key===key);
  assert.equal(find('ema20').value,ema(close,20).at(-1));
  assert.equal(find('ema50').value,ema(close,50).at(-1));
  assert.equal(find('ema200').value,ema(close,200).at(-1));
  assert.equal(find('sma20').value,sma(close,20).at(-1));
  assert.equal(find('rsi').value,rsi(close,14).at(-1));
  assert.equal(find('volume').value,bars.at(-1).volume);
  const bb=bollingerSeries(close,20);
  assert.equal(find('bollinger').value,bb.basis.at(-1));
  assert.equal(find('bollinger').details[0],bb.upper.at(-1));
  assert.equal(find('bollinger').details[1],bb.lower.at(-1));
  assert.equal(find('macd').value,macdSeries(close,cfg).macd.at(-1));
  assert.equal(find('macd').details[0],macdSeries(close,cfg).signal.at(-1));
  assert.equal(activeIndicatorReadings([],cfg).length,0);
  assert.deepEqual(activeIndicatorReadings(bars,{...base,ema20:false,ema200:false,
    volume:false,rsi:false}),[]);
});

test('Round 20: configurable MACD defaults exactly preserve original chart values',()=>{
  const close=bars.map(b=>b.close),actual=macdSeries(close,base),expected=indicators(bars);
  assert.deepEqual(actual.macd,expected.macd);
  assert.deepEqual(actual.signal,expected.signal);
  const changed=macdSeries(close,{...base,macdFast:8,macdSlow:21,macdSignal:5});
  assert.notEqual(changed.macd.at(-1),actual.macd.at(-1));
  assert.notEqual(changed.signal.at(-1),actual.signal.at(-1));
});

test('Round 20: price-scale drag, touch pinch and axis double-click reset explicitly enabled',()=>{
  assert.deepEqual(chartScaleOptions(),{
    mouseWheel:true,pinch:true,axisPressedMouseMove:{time:true,price:true},
    axisDoubleClickReset:{time:true,price:true}
  });
  const calls=[],chart={priceScale:id=>{
    calls.push(['scale',id]);
    return {applyOptions:options=>calls.push(['options',options])};
  }};
  assert.equal(resetPriceScale(chart),true);
  assert.deepEqual(calls,[['scale','right'],['options',{autoScale:true}]]);
  assert.equal(resetPriceScale(null),false);
  assert.equal(resetPriceScale({}),false);
});
