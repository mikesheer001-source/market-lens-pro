import test from 'node:test';
import assert from 'node:assert/strict';
import {compilePine,executePine,sweepPine,PineError} from '../src/pine.js';
import {PINE_EXAMPLES} from '../src/pine-examples.js';
import {sampleData,backtest} from '../src/engine.js';

const bars=sampleData()['DEMO-SPY'];
const example=id=>PINE_EXAMPLES.find(x=>x.id===id).code;
const lineInput=(code,n)=>code.split('\n')[n-1];

test('Pine v5 example scripts compile with correct declaration and editable inputs',()=>{
  for(const item of PINE_EXAMPLES){
    const p=compilePine(item.code);
    assert.equal(p.mode,item.id.endsWith('indicator')?'indicator':'strategy');
    assert.ok(p.inputs.length>=1,item.id);
    assert.ok(p.title);
  }
});

test('EMA crossover script generates signals and trades through existing backtest with costs',()=>{
  const compiled=compilePine(example('ema-cross'));
  const execution=executePine(compiled,bars);
  assert.equal(execution.barCount,bars.length);
  assert.equal(execution.plots.length,2);
  assert.ok(execution.plots[0].values.some(Number.isFinite));
  assert.ok(execution.signals.buy.some(Boolean),'EMA crossover must signal entries');
  const clean=backtest(bars,{strategy:'pine-custom',customSignals:execution.signals,feeBps:0,slipBps:0});
  const expensive=backtest(bars,{strategy:'pine-custom',customSignals:execution.signals,feeBps:10,slipBps:10});
  assert.ok(clean.metrics.trades>0,'must actually backtest');
  assert.ok(expensive.metrics.endEquity<clean.metrics.endEquity);
  assert.ok(clean.curve.length>0);
});

test('RSI oscillator draws values in its own pane',()=>{
  const p=compilePine(example('rsi-indicator'));assert.equal(p.mode,'indicator');assert.equal(p.overlay,false);
  const result=executePine(p,bars);
  assert.equal(result.plots.length,1);
  assert.equal(result.shapes.length,1);
  assert.ok(result.plots[0].values.slice(20).every(Number.isFinite));
});

test('MACD, BB, stochastic, ATR, highest, lowest and change execute as numeric series',()=>{
  const src=[
    '//@version=5','indicator("Function coverage", overlay=false)',
    'length = input.int(14, "Period")',
    '[macd, signal, hist] = ta.macd(close, 12, 26, 9)',
    '[middle, upper, lower] = ta.bb(close, 20, 2)',
    'stoch = ta.stoch(close, high, low, length)',
    'movement = ta.change(close, 1)',
    'avgRange = ta.atr(length)',
    'maxClose = ta.highest(close, length)',
    'minClose = ta.lowest(close, length)',
    'swing = ta.cross(close, ta.sma(close, length))',
    'plot(macd, "MACD")',
    'plot(signal, "Signal")',
    'plot(hist, "Histogram")',
    'plot(upper, "Upper")',
    'plot(lower, "Lower")',
    'plot(stoch, "Stochastic")',
    'plot(avgRange, "ATR")',
    'plot(maxClose, "High")',
    'plot(minClose, "Low")',
    'plot(movement, "Change")',
    'plotshape(swing, "Cross")'
  ].join('\n');
  const result=executePine(src,bars);
  assert.equal(result.plots.length,10);
  assert.equal(result.shapes.length,1);
  assert.ok(result.plots.every(plot=>plot.values.some(Number.isFinite)),'each indicator must produce values');
});

test('input controls override indicators and alter their computed values',()=>{
  const p=compilePine(example('rsi-indicator'));
  const r14=executePine(p,bars,{length:14}),r5=executePine(p,bars,{length:5});
  assert.notEqual(r14.plots[0].values.at(-1),r5.plots[0].values.at(-1));
});

test('the requested confirmed price lower low / RSI higher low divergence triggers only after confirmation',()=>{
  const closes=Array.from({length:140},(_,i)=>{
    if(i<=29)return 110+i*.3;
    if(i<=35)return 118.7-(i-29)*38.7/6;
    if(i<=55)return 80+(i-35)*2.25;
    if(i<=80)return 125-(i-55)*2;
    if(i<=105)return 75+(i-80)*1.4;
    return 110+(i-105)*.15;
  });
  const fixture=closes.map((close,i)=>({
    time:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),
    open:close,high:close+.1,low:close,close,volume:1000
  }));
  const p=compilePine(example('rsi-divergence'));
  const result=executePine(p,fixture,{rightBars:5});
  assert.equal(result.signals.buy[80],false,'no future-bar lookahead at pivot itself');
  assert.equal(result.signals.buy[85],true,'the later confirmed pivot has a lower price low and higher RSI low');
  assert.ok(result.shapes[0].values[85]);
  const bt=backtest(fixture,{strategy:'pine-custom',customSignals:result.signals,feeBps:1,slipBps:2});
  assert.ok(bt.trades.length>=1,'divergence enters the shared backtest engine');
  assert.equal(bt.trades[0].entry,fixture[86].time,'entry is next bar open after confirmed signal');
});

test('the Bollinger strategy works with tuple assignment and a custom input',()=>{
  const p=compilePine(example('bollinger-revert'));
  const result=executePine(p,bars,{deviations:1.5});
  assert.equal(result.plots.length,3);
  assert.ok(result.signals.buy.some(Boolean));
});

test('strategy.close signals exit without re-entering on the same bar',()=>{
  const src=[
    '//@version=5','strategy("Close only")',
    'strategy.entry("Long", strategy.long, when=bar_index == 30)',
    'strategy.close("Long", when=bar_index == 35)'
  ].join('\n');
  const output=executePine(src,bars);
  assert.equal(output.signals.buy[35],false);
  assert.equal(output.signals.closeLong[35],true);
  const bt=backtest(bars,{strategy:'pine-custom',customSignals:output.signals,feeBps:0,slipBps:0});
  assert.equal(bt.trades.length,1);
  assert.equal(bt.trades[0].entry,bars[31].time);
  assert.equal(bt.trades[0].exit,bars[36].time);
});

test('strategy.exit with stop and limit uses the existing stop-first policy',()=>{
  const src=[
    '//@version=5','strategy("Bracket")',
    'strategy.entry("Long", strategy.long, when=bar_index == 28)',
    'strategy.exit("Bracket", from_entry="Long", stop=close * 0.90, limit=close * 1.10, when=bar_index >= 28)'
  ].join('\n');
  const output=executePine(src,bars);
  assert.ok(output.signals.stop[28]>0);
  assert.ok(output.signals.limit[28]>0);
  const bt=backtest(bars,{strategy:'pine-custom',customSignals:output.signals});
  assert.ok(Number.isFinite(bt.metrics.returnPct));
});

test('Pine input sweeps return train and holdout metrics for input variations',()=>{
  const p=compilePine(example('ema-cross'));
  const rows=sweepPine(p,bars,backtest,{strategy:'pine-custom',capital:10000,feeBps:2},{fastLength:20,slowLength:50});
  assert.equal(rows.length,9);
  assert.ok(rows.every(x=>Number.isFinite(x.train.returnPct)&&Number.isFinite(x.test.returnPct)));
  assert.ok(rows.some(x=>x.params.fastLength!==20));
});

test('parser errors have line numbers and teach missing parameters',()=>{
  assert.throws(()=>compilePine('//@version=5\nindicator("Bad")\nr = ta.rsi(close)'),error=>{
    assert.ok(error instanceof PineError);assert.match(error.message,/line 3: ta\.rsi needs a series and a length/);return true;
  });
  assert.throws(()=>compilePine('indicator("Bad")\nx = security("foo")'),/line 2: Unsupported function/);
  assert.throws(()=>compilePine('indicator("Bad")\nif close > open\nplot(close)'),/line 2: An if statement needs an indented body/);
});

test('unsafe Pine constructs cannot execute arbitrary JavaScript',()=>{
  assert.throws(()=>compilePine('indicator("No JS")\nfoo = eval("alert(1)")'),/Unsupported function/);
  assert.throws(()=>compilePine('indicator("No JS")\nwhile true'),/Unexpected token|Expected/);
});

test('input.bool controls custom indicator visibility without changing the original OHLCV bars',()=>{
  const source=[
    '//@version=5',
    'indicator("Boolean input")',
    'visible = input.bool(true, "Show line")',
    'plot(visible ? close : na, "Selected close")'
  ].join('\n');
  const show=executePine(source,bars,{visible:true}),hide=executePine(source,bars,{visible:false});
  assert.ok(show.plots[0].values.some(Number.isFinite));
  assert.ok(hide.plots[0].values.every(x=>x===null));
  assert.equal(bars.length,1800);
});

test('history references and series arithmetic use only past bar values',()=>{
  const source=[
    'indicator("History arithmetic", overlay=false)',
    'difference = close - close[1]',
    'plot(difference, "Daily change")'
  ].join('\n');
  const computed=executePine(source,bars);
  assert.equal(computed.plots[0].values[0],null);
  assert.equal(computed.plots[0].values[1],bars[1].close-bars[0].close);
});

test('TRUE hidden bullish divergence triggers only after price higher low and RSI lower low',()=>{
  const close=[];
  for(let i=0;i<220;i++)close.push(100+i*.2);
  const up=1.2,downs=13,downStep=-(8+7*up)/downs;
  for(let j=0;j<20;j++)close.push(close.at(-1)+(j%3===0?up:downStep));
  for(let j=0;j<25;j++)close.push(close.at(-1)+35/25);
  for(let j=0;j<7;j++)close.push(close.at(-1)-31/7);
  for(let j=0;j<12;j++)close.push(close.at(-1)+10/12);
  const bars=close.map((value,i)=>({
    time:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),
    open:value,high:value+.1,low:value-.05,close:value,volume:1000
  }));
  assert.ok(bars[271].low>bars[239].low,'higher price low is present');
  const program=compilePine(example('hidden-rsi-divergence'));
  assert.equal(program.mode,'strategy');
  const result=executePine(program,bars,{pivotBars:5,trendLength:200});
  assert.equal(result.signals.buy[271],false,'cannot know pivot until future five candles finish');
  assert.equal(result.signals.buy[276],true,'hidden bullish divergence enters on confirmation bar');
  assert.ok(result.shapes.some(shape=>shape.values[276]),'must draw entry marker');
  assert.ok(result.signals.sell.every(v=>!v),'this is a long-only script');
  const backtested=backtest(bars,{strategy:'pine-custom',customSignals:result.signals,feeBps:1,slipBps:2});
  assert.ok(backtested.trades.length>0,'hidden divergence genuinely places trades');
  assert.equal(backtested.trades[0].entry,bars[277].time,'entry fills at next bar open');
});
