import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleData,statsFor,aggregate,screenSymbol,backtest,parameterSweep} from '../src/engine.js';
import {restoreWatchlists,watchlistChange,validateAlert,checkAlerts,makeScanSnapshot,analysisSnapshot,restoreAnalysis} from '../src/workspace.js';

test('named watchlists migrate legacy starred symbols and toggle only selected list',()=>{
  const restored=restoreWatchlists({watch:['DEMO-VXX','DEMO-SPY']});
  assert.equal(restored.watchlists.length,1);
  assert.deepEqual([...restored.watch].sort(),['DEMO-SPY','DEMO-VXX']);
  const extras=[...restored.watchlists,{id:'momentum',name:'Momentum',symbols:['DEMO-COIN']}];
  const changed=watchlistChange(extras,'momentum','DEMO-NVDA');
  assert.deepEqual(changed[0].symbols,restored.watchlists[0].symbols);
  assert.deepEqual(changed[1].symbols,['DEMO-COIN','DEMO-NVDA']);
  const removed=watchlistChange(changed,'momentum','DEMO-COIN');
  assert.deepEqual(removed[1].symbols,['DEMO-NVDA']);
});

test('local RSI and price alerts trigger once, rearm, preserve date and stay local',()=>{
  const data=new Map(Object.entries(sampleData())),bars=data.get('DEMO-VXX'),daily=statsFor(aggregate(bars,'D'));
  const config=validateAlert({symbol:'DEMO-VXX',metric:'price',op:'>',threshold:daily.price-1});
  let alerts=[{...config,id:'a',active:false,unread:false}];
  const first=checkAlerts(alerts,data,statsFor,aggregate,'2026-11-17T12:00:00Z');
  assert.equal(first.hits.length,1);
  assert.equal(first.hits[0].symbol,'DEMO-VXX');
  assert.equal(first.hits[0].barDate,bars.at(-1).time);
  const repeat=checkAlerts(first.alerts,data,statsFor,aggregate,'2026-11-17T12:01:00Z');
  assert.equal(repeat.hits.length,0);
  const inactive={...repeat.alerts[0],threshold:daily.price+1};
  const reset=checkAlerts([inactive],data,statsFor,aggregate,'2026-11-17T12:02:00Z');
  assert.equal(reset.alerts[0].active,false);
  const rearmed=checkAlerts([{...reset.alerts[0],threshold:daily.price-1}],data,statsFor,aggregate,'2026-11-17T12:03:00Z');
  assert.equal(rearmed.hits.length,1);
  assert.throws(()=>validateAlert({symbol:'DEMO-VXX',metric:'rsi',op:'>',threshold:110}),/RSI level/);
});

test('a saved scan captures exact filtered rows, rules and timestamp without external data',()=>{
  const data=sampleData(),rules=[{metric:'rsi',tf:'D',op:'<',value:35}];
  const rows=Object.entries(data).filter(([,bars])=>screenSymbol(bars,rules).pass).map(([symbol,bars])=>({
    symbol,d:statsFor(aggregate(bars,'D')),w:statsFor(aggregate(bars,'W')),
    evalResult:screenSymbol(bars,rules),source:'SIMULATED'
  }));
  const saved=makeScanSnapshot(rows,{id:'scan-1',name:'Oversold',source:'DEMO',rules,
    savedAt:'2026-11-17T00:00:00Z',universeFilter:'all',query:'',sort:'symbol'});
  assert.equal(saved.rows.length,1);
  assert.equal(saved.rows[0].symbol,'DEMO-COIN');
  assert.equal(saved.rules[0].value,35);
  rules[0].value=60;
  assert.equal(saved.rules[0].value,35);
  assert.equal(saved.savedAt,'2026-11-17T00:00:00Z');
});

test('backtest and sweep snapshots survive JSON/localStorage serialization',()=>{
  const bars=sampleData()['DEMO-SPY'];
  const result=backtest(bars,{strategy:'ema-cross'}),sweep=parameterSweep(bars,{strategy:'ema-cross'});
  const snap=analysisSnapshot({result,sweep,symbol:'DEMO-SPY',tf:'D',strategy:'ema-cross',source:'SIMULATED',
    savedAt:'2026-11-17T00:00:00Z'});
  const restored=restoreAnalysis(JSON.parse(JSON.stringify(snap)));
  assert.equal(restored.symbol,'DEMO-SPY');
  assert.equal(restored.result.metrics.trades,result.metrics.trades);
  assert.equal(restored.result.curve.length,result.curve.length);
  assert.equal(restored.sweep.length,9);
  assert.equal(restoreAnalysis({version:0}),null);
});
