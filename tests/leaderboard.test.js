import test from 'node:test';
import assert from 'node:assert/strict';
import {backtest,sampleData,aggregate} from '../src/engine.js';
import {compilePine,executePine} from '../src/pine.js';
import {PINE_EXAMPLES} from '../src/pine-examples.js';
import {compareStrategies,sortLeaderboard,leaderboardBest,buildEquityOverlay,
  updateSymbolMemory,pruneSymbolMemory,symbolMemoryItem,compactLeaderboard,
  PRESET_STRATEGIES,LEADERBOARD_METRICS,SYMBOL_MEMORY_LIMIT} from '../src/leaderboard.js';

const history=sampleData()['DEMO-SPY'];
const options={strategy:'ema-cross',timeframe:'D',capital:10000,allocation:100,feeBps:1,slipBps:2,
  stopPct:3,targetPct:8,side:'long',rsiPeriod:14,buyLevel:30,sellLevel:65};
const pineId=id=>PINE_EXAMPLES.find(x=>x.id===id);
const run=(custom=[])=>compareStrategies({symbol:'DEMO-SPY',bars:history,options,source:'SIMULATED',
  savedScripts:custom,backtest,compilePine,executePine});

test('all five preset strategies and every saved Pine strategy are independently backtested with identical cost settings',()=>{
  const saved=[{id:'pine-1',name:'My EMA strategy',code:pineId('ema-cross').code,
    settings:{fastLength:20,slowLength:50}},
    {id:'pine-2',name:'My hidden RSI',code:pineId('hidden-rsi-divergence').code,
      settings:{pivotBars:5}},
    {id:'indicator',name:'RSI lines only',code:pineId('rsi-indicator').code,settings:{length:14}}];
  const report=run(saved);
  assert.equal(PRESET_STRATEGIES.length,5);
  assert.equal(report.compared,7);
  assert.equal(report.savedPineStrategies,2);
  assert.equal(report.skipped.length,1);
  assert.match(report.skipped[0].reason,/Indicator only/);
  assert.equal(report.source,'SIMULATED');
  assert.equal(report.symbol,'DEMO-SPY');
  assert.equal(report.timeframe,'D');
  assert.equal(report.rows.filter(r=>r.kind==='preset').length,5);
  assert.equal(report.rows.filter(r=>r.kind==='pine').length,2);
  assert.equal(report.rows.find(r=>r.id==='pine:pine-1').script.id,'pine-1');
  assert.ok(report.rows.every(r=>r.metrics?.returnPct!==undefined&&r.curve.length===history.length-1));
  const control=backtest(history,{...options,strategy:'ema-cross'});
  assert.equal(report.rows.find(r=>r.id==='preset:ema-cross').metrics.endEquity,control.metrics.endEquity);
  assert.deepEqual(report.rows.find(r=>r.id==='preset:ema-cross').trades,control.trades);
});

test('leaderboard ranks highest finite Sharpe first, sorts every numeric column and keeps nulls last',()=>{
  const rows=[
    {id:'A',name:'Beta',metrics:{sharpe:1.1,returnPct:20,maxDD:15,profitFactor:null,trades:10}},
    {id:'B',name:'Alpha',metrics:{sharpe:2.3,returnPct:-4,maxDD:2,profitFactor:3,trades:9}},
    {id:'C',name:'Zero',metrics:{sharpe:null,returnPct:30,maxDD:30,profitFactor:null,trades:0}}
  ];
  assert.equal(leaderboardBest(rows).id,'B');
  assert.deepEqual(sortLeaderboard(rows).map(r=>r.id),['B','A','C']);
  assert.deepEqual(sortLeaderboard(rows,'sharpe',false).map(r=>r.id),['A','B','C']);
  assert.deepEqual(sortLeaderboard(rows,'returnPct',true).map(r=>r.id),['C','A','B']);
  assert.deepEqual(sortLeaderboard(rows,'maxDD',false).map(r=>r.id),['B','A','C']);
  assert.deepEqual(sortLeaderboard(rows,'name',false).map(r=>r.name),['Alpha','Beta','Zero']);
  assert.deepEqual(sortLeaderboard(rows,'profitFactor',true).map(r=>r.id),['B','A','C']);
  for(const key of LEADERBOARD_METRICS)assert.equal(sortLeaderboard(rows,key).length,3);
  assert.throws(()=>sortLeaderboard(rows,'madeUp'),/Unknown leaderboard/);
});

test('overlay uses exactly top three Sharpe-ranked curves plus date-aligned buy-and-hold, with original capital',()=>{
  const report=run([{id:'saved',name:'EMA in Pine',code:pineId('ema-cross').code,settings:{fastLength:9,slowLength:45}}]);
  const overlay=report.overlay;
  assert.equal(overlay.series.length,3);
  assert.equal(overlay.labels.length,4);
  assert.equal(overlay.labels.at(-1),'Buy & hold');
  assert.deepEqual(overlay.series.map(x=>x.id),sortLeaderboard(report.rows).slice(0,3).map(x=>x.id));
  assert.equal(overlay.series[0].points.length,report.rows[0].curve.length);
  assert.equal(overlay.benchmark.length,overlay.series[0].points.length);
  const first=history[1],last=history.at(-1);
  assert.equal(overlay.benchmark[0].time,first.time);
  assert.ok(Math.abs(overlay.benchmark[0].value-report.capital*first.close/first.open)<1e-6);
  assert.ok(Math.abs(overlay.benchmark.at(-1).value-report.capital*last.close/first.open)<1e-6);
  const rebuilt=buildEquityOverlay(report,history);
  assert.deepEqual(rebuilt,overlay);
  assert.throws(()=>buildEquityOverlay(report,history.slice(0,40)),/benchmark without|missing a bar/);
});

test('stored ranking retains all metrics, the entire overlay, best trades and script source without overfilling browser storage',()=>{
  const report=run([{id:'saved',name:'Pine EMA',code:pineId('ema-cross').code,settings:{fastLength:8,slowLength:31}}]);
  const compact=compactLeaderboard(report);
  assert.deepEqual(compact.rows.map(r=>r.name),report.rows.map(r=>r.name));
  assert.deepEqual(compact.overlay,report.overlay);
  const best=compact.rows.find(x=>x.id===report.bestId);
  assert.ok(best.curve.length>0);
  assert.deepEqual(best.trades,report.rows.find(x=>x.id===report.bestId).trades);
  assert.ok(compact.rows.filter(r=>r.id!==report.bestId).every(r=>r.curve.length===0&&r.trades.length===0));
  assert.ok(JSON.stringify(compact).length<JSON.stringify(report).length);
});

test('per-symbol strategy memory merges last backtest and leaderboard independently and survives browser JSON',()=>{
  const report=run();
  const base=updateSymbolMemory({},'DEMO-SPY',{leaderboard:compactLeaderboard(report)},1000);
  const row=report.rows.find(r=>r.id===report.bestId);
  const next=updateSymbolMemory(base,'DEMO-SPY',{backtest:{options:{strategy:row.strategy,feeBps:1},
    result:{metrics:row.metrics,curve:row.curve,trades:row.trades},timeframe:'D',source:'SIMULATED'}},2000);
  const other=updateSymbolMemory(next,'DEMO-VXX',{backtest:{options:{strategy:'breakout'},result:{metrics:{returnPct:12}}}},3000);
  const restored=JSON.parse(JSON.stringify(other));
  assert.equal(symbolMemoryItem(restored,'DEMO-SPY').backtest.options.strategy,row.strategy);
  assert.equal(symbolMemoryItem(restored,'DEMO-SPY').leaderboard.bestId,report.bestId);
  assert.equal(symbolMemoryItem(restored,'DEMO-VXX').backtest.options.strategy,'breakout');
  assert.equal(symbolMemoryItem(restored,'DEMO-SPY').backtest.timeframe,'D');
  assert.equal(symbolMemoryItem(restored,'not-present'),null);
});

test('symbol memory is capped by entry count and size with newest valid symbols retained',()=>{
  let memory={};
  for(let i=0;i<23;i++)memory=updateSymbolMemory(memory,'S'+i,{backtest:{result:{metrics:{returnPct:i}}}},i);
  assert.equal(Object.keys(memory).length,SYMBOL_MEMORY_LIMIT);
  assert.equal(symbolMemoryItem(memory,'S22').backtest.result.metrics.returnPct,22);
  assert.equal(symbolMemoryItem(memory,'S0'),null);
  const pruned=pruneSymbolMemory({
    A:{lastUpdated:10,backtest:{data:'x'.repeat(1000)}},
    B:{lastUpdated:9,backtest:{data:'small'}}
  },5,300);
  assert.equal(Object.keys(pruned).length,1);
  assert.ok(pruned.B);
});
