import test from 'node:test';
import assert from 'node:assert/strict';
import {backtest,sampleData} from '../src/engine.js';
import {compilePine,executePine} from '../src/pine.js';
import {PINE_EXAMPLES} from '../src/pine-examples.js';
import {availableStrategySignals,computeOneStrategySignal,evaluateStrategySignals,scanSignalFlips,signalPosition,PRESET_SIGNAL_OPTIONS} from '../src/signals.js';

const sample=new Map(Object.entries(sampleData()));
const opts={strategy:'breakout',period:5,capital:10000,side:'long',feeBps:1,slipBps:2,stopPct:0,targetPct:0};
const barsOf=closes=>closes.map((close,i)=>({
  time:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),
  open:close,high:close+.2,low:close-.2,close,volume:1000
}));
test('five preset signals plus every saved Pine strategy are available without indicator-only scripts being executed',()=>{
  const library=[
    {id:'saved-one',name:'My Pine EMA',code:PINE_EXAMPLES.find(x=>x.id==='ema-cross').code,settings:{fastLength:5,slowLength:20}},
    {id:'saved-indicator',name:'RSI plot',code:PINE_EXAMPLES.find(x=>x.id==='rsi-indicator').code,settings:{length:14}}
  ];
  const all=availableStrategySignals(library);
  assert.equal(PRESET_SIGNAL_OPTIONS.length,5);
  assert.equal(all.length,7);
  const preset=all.find(x=>x.id==='preset:breakout');
  assert.equal(preset.strategy,'breakout');
  const chosen=all.find(x=>x.id==='pine:saved-one');
  const signal=computeOneStrategySignal({bars:sample.get('DEMO-SPY'),source:'SIMULATED',
    selection:chosen,options:opts,backtest,compilePine,executePine});
  assert.ok(['LONG','FLAT','EXIT'].includes(signal.status));
  assert.equal(signal.source,'SIMULATED');
  const indicator=computeOneStrategySignal({bars:sample.get('DEMO-SPY'),source:'SIMULATED',
    selection:all.find(x=>x.id==='pine:saved-indicator'),options:opts,backtest,compilePine,executePine});
  assert.equal(indicator.status,'UNAVAILABLE');
  assert.match(indicator.reason,/indicator/);
});

test('signal status tracks actual position and avoids treating forced end-of-data close as EXIT',()=>{
  const rising=Array.from({length:90},(_,i)=>i<45?100:100+(i-45));
  const bars=barsOf(rising);
  const selection=PRESET_SIGNAL_OPTIONS.find(x=>x.id==='preset:breakout');
  const long=computeOneStrategySignal({bars,selection,options:opts,source:'TEST',
    backtest,compilePine,executePine});
  assert.equal(long.status,'LONG');
  assert.equal(long.positionOpen,true);
  const base=backtest(bars,{...opts,strategy:'breakout',timeframe:'D'});
  assert.equal(base.signalState.status,'LONG');
  assert.equal(base.trades.at(-1).reason,'End of data'); // artificial backtest liquidation is not a signal
  const collapse=barsOf([...rising,75]);
  const pending=computeOneStrategySignal({bars:collapse,selection,options:opts,
    source:'TEST',backtest,compilePine,executePine});
  assert.equal(pending.status,'EXIT');
  assert.equal(pending.exitReason,'Next bar signal');
  const exited=computeOneStrategySignal({bars:barsOf([...rising,75,74]),selection,
    options:opts,source:'TEST',backtest,compilePine,executePine});
  assert.equal(exited.status,'EXIT');
  assert.equal(exited.positionOpen,false);
  assert.equal(exited.exitReason,'Signal');
  const flat=computeOneStrategySignal({bars:barsOf([...rising,75,74,73]),selection,
    options:opts,source:'TEST',backtest,compilePine,executePine});
  assert.equal(flat.status,'FLAT');
});

test('real strategy statuses use the same completed daily bars, stop and fee inputs as the main backtest engine',()=>{
  const symbols=new Map([['DEMO-SPY',sample.get('DEMO-SPY')],['DEMO-VXX',sample.get('DEMO-VXX')]]);
  const chosen=PRESET_SIGNAL_OPTIONS[0];
  const result=evaluateStrategySignals({data:symbols,selection:chosen,options:{...opts,fast:15,slow:50},
    backtest,compilePine,executePine,sourceFor:()=> 'SIMULATED DAILY'});
  assert.deepEqual(Object.keys(result.signals),['DEMO-SPY','DEMO-VXX']);
  assert.equal(result.errors.length,0);
  for(const [symbol,bars] of symbols){
    const same=backtest(bars,{...opts,fast:15,slow:50,strategy:'ema-cross',timeframe:'D',side:'long'}).signalState;
    assert.equal(result.signals[symbol].status,same.status);
    assert.equal(result.signals[symbol].barDate,bars.at(-1).time);
    assert.equal(result.signals[symbol].source,'SIMULATED DAILY');
  }
});

test('flip detection emits only long-to-flat or flat-to-long transitions once and preserves strategy/name/date/source',()=>{
  const first=scanSignalFlips({},{
    VXX:{status:'FLAT',barDate:'2026-11-13',source:'ALPACA IEX 1Day'},
    SVXY:{status:'LONG',barDate:'2026-11-13',source:'ALPACA IEX 1Day'}
  },{strategyId:'preset:ema-cross',strategyName:'EMA crossover'});
  assert.equal(first.flips.length,0);
  const updated=scanSignalFlips(first.states,{
    VXX:{status:'LONG',barDate:'2026-11-16',source:'ALPACA IEX 1Day'},
    SVXY:{status:'EXIT',barDate:'2026-11-16',source:'ALPACA IEX 1Day'}
  },{strategyId:'preset:ema-cross',strategyName:'EMA crossover',checkedAt:'2026-11-17T00:00:00Z'});
  assert.equal(updated.flips.length,2);
  assert.deepEqual(updated.flips.map(x=>x.symbol),['VXX','SVXY']);
  assert.deepEqual(updated.flips.map(x=>x.from+'-'+x.to),['FLAT-LONG','LONG-FLAT']);
  assert.equal(updated.flips[1].observedTo,'EXIT');
  assert.equal(updated.flips[0].barDate,'2026-11-16');
  assert.equal(updated.flips[0].strategyName,'EMA crossover');
  assert.equal(updated.flips[0].source,'ALPACA IEX 1Day');
  const repeat=scanSignalFlips(updated.states,{
    VXX:{status:'LONG',barDate:'2026-11-16',source:'ALPACA IEX 1Day'},
    SVXY:{status:'FLAT',barDate:'2026-11-16',source:'ALPACA IEX 1Day'}
  },{strategyId:'preset:ema-cross'});
  assert.equal(repeat.flips.length,0);
  assert.equal(signalPosition('EXIT'),'FLAT');
});

test('no bars, inadequate history, invalid Pine code yield visible UNAVAILABLE rather than false FLAT',()=>{
  const chosen=PRESET_SIGNAL_OPTIONS[0];
  const absent=computeOneStrategySignal({bars:[],source:'ALPACA',selection:chosen,options:opts,backtest});
  assert.equal(absent.status,'UNAVAILABLE');
  const invalid={id:'pine:invalid',kind:'pine',name:'Bad',strategy:'pine-custom',code:'strategy("Bad")\nx = ta.rsi(close)',settings:{}};
  const res=evaluateStrategySignals({data:new Map([['A',sample.get('DEMO-SPY')]]),
    selection:invalid,options:opts,backtest,compilePine,executePine});
  assert.equal(res.errors.length,1);
  assert.match(res.errors[0].reason,/line 2: ta.rsi needs a series and a length/);
});
