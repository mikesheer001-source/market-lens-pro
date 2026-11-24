import test from 'node:test';
import assert from 'node:assert/strict';
import {readableBarDate,nyIntradaySession,normalizeStartupPreferences,intradayCacheFresh,intradayFetchDecision} from '../src/intraday-session.js';
import {PINE_EXAMPLES} from '../src/pine-examples.js';
import {compareStrategies,sortLeaderboard} from '../src/leaderboard.js';
import {backtest,sampleData} from '../src/engine.js';
import {compilePine,executePine} from '../src/pine.js';

const ts=s=>Math.floor(Date.parse(s)/1000);
const now=Date.parse('2026-11-16T21:10:00Z');
const entry=(end='2026-11-16T20:45:00Z',fetchedAt=now-4000)=>({
  symbol:'VXX',feed:'iex',source:'ALPACA',fetchedAt,
  bars:[{time:ts('2026-11-13T20:45:00Z'),open:12,high:13,low:11,close:12,volume:100},
    {time:ts(end),open:12,high:13,low:11,close:12.5,volume:120}]
});

test('intraday Backtest/Compare auto-fetch decision respects real 2H and 15m source and bar availability',()=>{
  const input={mode:'live',source:'ALPACA',symbol:'VXX',feed:'iex',
    expected:'2026-11-16',now};
  assert.equal(intradayFetchDecision({...input,timeframe:'2H'}),'fetch');
  assert.equal(intradayFetchDecision({...input,timeframe:'15m'}),'fetch');
  assert.equal(intradayFetchDecision({...input,timeframe:'D'}),'daily');
  assert.equal(intradayFetchDecision({...input,timeframe:'W'}),'daily');
  assert.equal(intradayFetchDecision({...input,timeframe:'2H',mode:'demo'}),'unavailable');
  assert.equal(intradayFetchDecision({...input,timeframe:'15m',source:'SIMULATED'}),'unavailable');
  assert.equal(intradayFetchDecision({...input,timeframe:'2H',entry:entry()}),'cached');
});

test('persisted 15m bars stay current only for the expected NYSE session, correct Alpaca feed, within five-minute age',()=>{
  const inputs={symbol:'VXX',feed:'iex',expected:'2026-11-16',now};
  assert.equal(nyIntradaySession({time:ts('2026-11-16T20:45:00Z')}),'2026-11-16');
  assert.equal(nyIntradaySession({time:ts('2026-11-13T20:45:00Z')}),'2026-11-13');
  assert.equal(intradayCacheFresh(entry(),inputs),true);
  assert.equal(intradayCacheFresh(entry('2026-11-13T20:45:00Z'),inputs),false);
  assert.equal(intradayCacheFresh(entry('2026-11-16T20:45:00Z',now-301000),inputs),false);
  assert.equal(intradayCacheFresh({...entry(),feed:'sip'},inputs),false);
  assert.equal(intradayCacheFresh({...entry(),source:'SIMULATED'},inputs),false);
  assert.equal(intradayCacheFresh({...entry(),symbol:'UVXY'},inputs),false);
  assert.equal(intradayFetchDecision({...inputs,timeframe:'2H',mode:'live',source:'ALPACA',entry:entry('2026-11-13T20:45:00Z')}),'fetch');
  assert.equal(intradayCacheFresh(JSON.parse(JSON.stringify(entry())),inputs),true);
});

test('Live-only mode migrates old Demo preferences and preserves the real Backtester symbol and tab',()=>{
  const saved=JSON.parse(JSON.stringify({mode:'live',tab:'backtest',lastBacktestSymbol:'VXX',
    lastLiveSymbol:'SVIX',lastDemoSymbol:'DEMO-VXX',lastSymbol:'VXZ'}));
  const value=normalizeStartupPreferences(saved);
  assert.equal(value.mode,'live');
  assert.equal(value.tab,'backtest');
  assert.equal(value.selectedSymbol,'VXX');
  assert.equal(value.lastLiveSymbol,'SVIX');
  const mixed=normalizeStartupPreferences({...saved,lastBacktestSymbol:'DEMO-SPY'});
  assert.equal(mixed.selectedSymbol,'VXZ','do not restore a Demo symbol while Live');
  const demo=normalizeStartupPreferences({...saved,mode:'demo'});
  assert.equal(demo.mode,'live');
  assert.equal(demo.selectedSymbol,'VXX');
  assert.equal(normalizeStartupPreferences({mode:'demo',lastSymbol:'DEMO-SPY'}).selectedSymbol,'VXX');
  assert.equal(normalizeStartupPreferences({}).mode,'live');
  assert.equal(normalizeStartupPreferences({tab:'javascript:bad'}).tab,'screener');
});

test('every banner bar date from seconds/ms/ISO/structured bars is human-readable YYYY-MM-DD',()=>{
  assert.equal(readableBarDate(1794853800),new Date(1794853800*1000).toISOString().slice(0,10));
  assert.equal(readableBarDate(Date.parse('2026-11-16T20:45:00Z')),'2026-11-16');
  assert.equal(readableBarDate('2026-11-16'),'2026-11-16');
  assert.equal(readableBarDate('2026-11-16T21:00:00Z'),'2026-11-16');
  assert.equal(readableBarDate({time:ts('2026-11-16T20:45:00Z')}),'2026-11-16');
  assert.equal(readableBarDate({t:'2026-11-13T21:00:00Z'}),'2026-11-13');
  assert.equal(readableBarDate('bad'),'—');
});

test('default strategy leaderboard includes all seven built-in Pine examples but never fabricates trades for 2 indicators',()=>{
  const bars=sampleData()['DEMO-SPY'];
  const result=compareStrategies({
    symbol:'DEMO-SPY',bars,options:{timeframe:'D',capital:10000,feeBps:1,slipBps:2},
    source:'SIMULATED DEMO',
    backtest,compilePine,executePine,builtInExamples:PINE_EXAMPLES,savedScripts:[]
  });
  assert.equal(PINE_EXAMPLES.length,7);
  assert.equal(result.rows.length,12);
  assert.equal(result.builtInExamples,7);
  assert.equal(result.executableExamples,5);
  assert.equal(result.savedPineStrategies,0);
  for(const sample of PINE_EXAMPLES)assert.ok(result.rows.some(r=>r.id==='example:'+sample.id));
  const hidden=result.rows.find(r=>r.id==='example:hidden-rsi-divergence');
  assert.equal(hidden.kind,'example');
  assert.ok(hidden.curve.length);
  const indicator=result.rows.filter(x=>x.kind==='example-indicator');
  assert.equal(indicator.length,2);
  assert.ok(indicator.every(x=>x.curve.length===0&&x.trades.length===0&&x.metrics.sharpe===null));
  assert.ok(sortLeaderboard(result.rows).slice(-2).every(x=>x.kind==='example-indicator'));
  assert.equal(result.overlay.series.length,3);
  assert.ok(result.overlay.benchmark.length>0);
});
