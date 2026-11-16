import test from 'node:test';
import assert from 'node:assert/strict';
import {rankValidatedUniverseFit,chooseValidatedUniverseStrategy,
 validatedFitSymbolRow,fitValidatedAcrossUniverse,NO_VALIDATED_FIT} from '../src/fit-validated.js';

const strategy=(id,{split=-1,testBars=50,pos=0,assessable=5,mean=null,median=mean,train=0}={})=>({
 id,name:id,kind:'preset',strategy:'ema-cross',metrics:{sharpe:train},
 validation:{enoughTestBars:testBars>=30,testBars},
 testMetrics:{sharpe:split},
 rolling:{totalWindows:5,assessableCount:assessable,positiveCount:pos,
   meanSharpe:mean,medianSharpe:median}
});

test('Round 23: validated-only fit selects the highest ROLLING OOS mean, not training Sharpe',()=>{
 const first=strategy('high training / failed',{train:20,mean:10,pos:2});
 const second=strategy('single passed',{train:2,split:.8,mean:.4,pos:2});
 const third=strategy('rolling passed',{train:-3,split:-.4,mean:1.4,median:1.1,pos:4});
 const selected=chooseValidatedUniverseStrategy([first,second,third]);
 assert.equal(selected.id,'rolling passed');
 const row=validatedFitSymbolRow('SPY',{rows:[first,second,third]});
 assert.equal(row.validatingStrategy.name,'rolling passed');
 assert.equal(row.rollingMeanSharpe,1.4);
 assert.equal(row.rollingMedianSharpe,1.1);
 assert.equal(row.positiveWindows,4);
 assert.equal(row.validatedStrategies,2);
 assert.deepEqual(row.validationReasons,['rolling 3/5']);
 assert.deepEqual(rankValidatedUniverseFit([
 {symbol:'CCC',rollingMeanSharpe:-.1},{symbol:'BBB',rollingMeanSharpe:null},
 {symbol:'AAA',rollingMeanSharpe:.5},{symbol:'DDD',rollingMeanSharpe:.5}
 ]).map(r=>r.symbol),['AAA','DDD','CCC','BBB']);
});

test('Round 23: 29 test bars or fewer than 3 rolling positives never validate',()=>{
 const rows=[strategy('short split',{split:9,testBars:29,pos:2,mean:3}),
 strategy('negative OOS',{split:-3,pos:2,mean:4}),
 strategy('invalid rolling count',{split:-1,pos:3,assessable:2,mean:9})];
 assert.equal(chooseValidatedUniverseStrategy(rows),null);
 assert.equal(validatedFitSymbolRow('SPY',{rows}),null);
 assert.equal(NO_VALIDATED_FIT,'No symbol has a validated strategy on this window');
});

test('Round 23: single-split validation with unavailable rolling mean still counts, ranks last',()=>{
 const only=strategy('split-only',{split:1.2,pos:0,assessable:0,mean:null});
 const selected=validatedFitSymbolRow('SINGLE',{rows:[only]});
 assert.ok(selected);assert.equal(selected.rollingMeanSharpe,null);
 assert.equal(selected.positiveWindows,0);
 assert.deepEqual(selected.validationReasons,['single 70/30']);
 assert.deepEqual(rankValidatedUniverseFit([
  selected,{symbol:'ROLLING',rollingMeanSharpe:0.2}
 ]).map(x=>x.symbol),['ROLLING','SINGLE']);
});

test('Round 23: runs all symbols on selected date range and excludes invalid symbols',async()=>{
 const bars=Array.from({length:150},(_,i)=>({
  time:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),
  open:100+i,high:101+i,low:99+i,close:100+i,volume:1000
 }));
 const evaluated=[],compare=ctx=>{
  evaluated.push({symbol:ctx.symbol,length:ctx.bars.length,
    start:ctx.bars[0].time,end:ctx.bars.at(-1).time});
  return {rows:ctx.symbol==='AAA'?
   [strategy('A failed',{train:8,mean:9,pos:0}),strategy('A rolling',{mean:.5,pos:4})]:
   [strategy('B failed',{train:12,mean:6,pos:1})]};
 };
 const result=await fitValidatedAcrossUniverse({
  symbols:['AAA','BBB','EMPTY'],data:new Map([['AAA',bars],['BBB',bars]]),
  options:{capital:20000,timeframe:'2H'},backtest:()=>{},
  dateRange:{startDate:bars[20].time,endDate:bars[120].time},compare
 });
 assert.deepEqual(evaluated.map(r=>r.length),[101,101]);
 assert.equal(result.validated,1);assert.equal(result.requested,3);
 assert.equal(result.completed,2);
 assert.equal(result.rows[0].symbol,'AAA');
 assert.equal(result.rows[0].rollingMeanSharpe,.5);
 assert.equal(result.settings.timeframe,'D');
 assert.deepEqual(result.dateRange,{startDate:bars[20].time,endDate:bars[120].time});
});

test('Round 23: selected window with zero passing strategies returns explicit empty result',async()=>{
 const bars=Array.from({length:70},(_,i)=>({
  time:new Date(Date.UTC(2026,1,i+1)).toISOString().slice(0,10),
  open:100,high:101,low:99,close:100,volume:1
 }));
 const result=await fitValidatedAcrossUniverse({
  symbols:['SPY','AAPL'],data:new Map([['SPY',bars],['AAPL',bars]]),
  options:{},backtest:()=>{},compare:()=>({rows:[
    strategy('failed',{split:-.3,pos:1,mean:.1}),
    strategy('too short',{split:9,testBars:29,pos:2})
  ]})
 });
 assert.equal(result.validated,0);
 assert.deepEqual(result.rows,[]);
 assert.equal(result.requested,2);
});
