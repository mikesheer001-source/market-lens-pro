import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {expectedNyseBarDate} from '../src/freshness.js';
import {ALPACA_SCAN_LOOKBACK_DAYS,LIVE_UNIVERSE,ALPACA_BATCH_SIZE} from '../src/universe.js';
import {DEFAULT_ALPACA_WORKER,LIVE_SCAN_CACHE_REVISION,inspectLiveHistory,
  shouldTryDefaultWorker,liveScanUrl,MIN_ESTABLISHED_DAILY_BARS} from '../src/live-history.js';
import {compareStrategiesInRange} from '../src/leaderboard-range.js';
import {rollingLeaderboardSummary} from '../src/rolling-validation.js';
import {holdoutSummary} from '../src/validation.js';
import {sampleData,backtest} from '../src/engine.js';
import {compilePine,executePine} from '../src/pine.js';
import {PINE_EXAMPLES} from '../src/pine-examples.js';

const historical=sampleData()['DEMO-SPY'];
const options={strategy:'ema-cross',capital:10000,allocation:100,feeBps:1,
  slipBps:2,stopPct:0,targetPct:0,side:'long',fast:20,slow:100,timeframe:'D'};
const common={symbol:'DEMO-SPY',source:'SIMULATED Demo OHLCV',options,backtest,
  compilePine,executePine,builtInExamples:PINE_EXAMPLES};
const display=value=>value==null||!Number.isFinite(value)?'—':value.toFixed(2);

test('Round 21: missing or 550-day live Worker is detected, without confusing reported lookback with actual bars',()=>{
  assert.equal(ALPACA_SCAN_LOOKBACK_DAYS,1825);
  const stale={lookback_days:550,bars:{ABBV:Array(378).fill({}),SPY:Array(378).fill({})}};
  const a=inspectLiveHistory(stale);
  assert.equal(a.ok,false);assert.equal(a.reportedDays,550);
  assert.deepEqual(a.counts,{ABBV:378,SPY:378});
  assert.match(a.reason,/only 550/);
  assert.equal(shouldTryDefaultWorker('https://legacy.example.workers.dev',a),true);
  assert.equal(shouldTryDefaultWorker(DEFAULT_ALPACA_WORKER,a),false);
  const contradictory={...stale,lookback_days:1825};
  const b=inspectLiveHistory(contradictory);
  assert.equal(b.ok,false);
  assert.deepEqual(b.short,['ABBV','SPY']);
  assert.match(b.reason,/too few actual bars/);
  const good=inspectLiveHistory({lookback_days:1825,
    bars:{ABBV:Array(1250).fill({}),SPY:Array(1253).fill({})}});
  assert.equal(good.ok,true);
  assert.deepEqual(good.counts,{ABBV:1250,SPY:1253});
  assert.equal(MIN_ESTABLISHED_DAILY_BARS,900);
  assert.equal(inspectLiveHistory({bars:{ABBV:[{}]}}).hasLookback,false,
    'old mocks with no metadata remain backward-compatible');
});

test('Round 21: revisioned scan requests use stable URLs so the 15-minute cache remains reusable',()=>{
  const first=liveScanUrl(DEFAULT_ALPACA_WORKER,'iex'),second=liveScanUrl(DEFAULT_ALPACA_WORKER,'iex');
  const u=new URL(first);
  assert.equal(first,second);
  assert.equal(u.origin,DEFAULT_ALPACA_WORKER);
  assert.equal(u.searchParams.get('history_revision'),LIVE_SCAN_CACHE_REVISION);
  assert.notEqual(LIVE_SCAN_CACHE_REVISION,'2026-11-17-round19-five-year-history');
  assert.equal(u.searchParams.get('feed'),'iex');
});

test('Round 21: Worker health and scan expose same cache revision, and old Round 19 edge-cache key is invalidated',async ()=>{
  const origin='https://mikesheer001-source.github.io',base='https://market-lens-pro-api.example.workers.dev';
  const env={ALPACA_API_KEY:'fake-key',ALPACA_API_SECRET:'fake-secret',
    ALPACA_DATA_FEED:'iex',ALLOWED_ORIGINS:origin};
  const health=await worker.fetch(new Request(base+'/api/health'),env);
  const metadata=await health.json();
  assert.equal(metadata.daily_lookback_days,1825);
  assert.equal(metadata.scan_cache_revision,LIVE_SCAN_CACHE_REVISION);
  assert.equal(metadata.scan_cache_seconds,900);
  const date=expectedNyseBarDate(new Date());
  const cache=new Map(),calls=[];
  const oldKey=new URL('/api/stocks/scan',base);
  oldKey.searchParams.set('feed','iex');
  oldKey.searchParams.set('universe_revision','2026-11-17-round19-five-year-history');
  oldKey.searchParams.set('expected_trading_day',date);
  oldKey.searchParams.set('origin',origin);
  cache.set(oldKey.toString(),new Response(JSON.stringify({lookback_days:550,
    bars:{ABBV:Array(378).fill({}),SPY:Array(378).fill({})}})));
  const savedCache=globalThis.caches,savedFetch=globalThis.fetch;
  globalThis.caches={default:{
    match:async key=>cache.get(key.url)?.clone()||null,
    put:async(key,response)=>{cache.set(key.url,response.clone());}
  }};
  globalThis.fetch=async url=>{
    const u=new URL(url);
    const syms=u.searchParams.get('symbols').split(',');
    calls.push(syms);
    return new Response(JSON.stringify({
      bars:Object.fromEntries(syms.map(symbol=>[symbol,
        [{t:date+'T00:00:00Z',o:100,h:101,l:99,c:100,v:1000}]])),
      next_page_token:null}),{status:200});
  };
  try{
    const req=()=>new Request(base+'/api/stocks/scan?feed=iex',{
      headers:{Origin:origin,'CF-Connecting-IP':'192.0.2.247'}});
    const first=await worker.fetch(req(),env),fresh=await first.json();
    assert.equal(first.status,200);
    assert.equal(first.headers.get('X-Scan-Cache'),'MISS');
    assert.equal(fresh.lookback_days,1825);
    assert.equal(fresh.scan_cache_revision,LIVE_SCAN_CACHE_REVISION);
    assert.equal(fresh.requested,LIVE_UNIVERSE.length);
    assert.equal(fresh.returned,LIVE_UNIVERSE.length);
    assert.equal(calls.length,Math.ceil(133/ALPACA_BATCH_SIZE));
    const key=[...cache.keys()].find(key=>key.includes(LIVE_SCAN_CACHE_REVISION));
    assert.ok(key,'new cache key contains new revision');
    assert.notEqual(key,oldKey.toString());
    const second=await worker.fetch(req(),env);
    assert.equal(second.headers.get('X-Scan-Cache'),'HIT');
    assert.equal(calls.length,Math.ceil(133/ALPACA_BATCH_SIZE));
    assert.equal((await second.json()).lookback_days,1825);
  }finally{
    globalThis.fetch=savedFetch;
    if(savedCache===undefined)delete globalThis.caches;else globalThis.caches=savedCache;
  }
});

test('Round 21: on 132 bars, rolling summary equals rendered numeric table cells, not single-split holdout',()=>{
  const report=compareStrategiesInRange({...common,bars:historical.slice(0,132)});
  assert.equal(report.rows.filter(r=>r?.strategy).length,8,
    '5 built-in presets plus 3 Pine strategies');
  const summary=rollingLeaderboardSummary(report.rows);
  const assessable=report.rows.filter(r=>r?.strategy&&display(r.rolling?.meanSharpe)!=='—'&&
    display(r.rolling?.medianSharpe)!=='—');
  const positive=assessable.filter(r=>r.rolling.meanSharpe>0);
  assert.equal(summary.assessable,assessable.length);
  assert.equal(summary.positive,positive.length);
  assert.equal(summary.assessable,0);
  assert.equal(summary.positive,0);
  assert.ok(report.rows.filter(r=>r.strategy).every(r=>r.rolling?.assessableCount===0));
  const single=holdoutSummary(report.rows);
  assert.ok(single.assessable>0,'single 30% holdout can be valid while five rolling holdouts are not');
  assert.notEqual(summary.assessable,single.assessable);
});

test('Round 21: on full history, rolling summary matches all displayed numeric means and medians',()=>{
  const report=compareStrategiesInRange({...common,bars:historical});
  const summary=rollingLeaderboardSummary(report.rows);
  const visible=report.rows.filter(r=>r?.strategy&&
    display(r.rolling?.meanSharpe)!=='—'&&display(r.rolling?.medianSharpe)!=='—');
  assert.equal(summary.assessable,visible.length);
  assert.equal(summary.positive,visible.filter(r=>r.rolling.meanSharpe>0).length);
  assert.ok(summary.assessable>0);
  assert.equal(summary.total,report.rows.filter(r=>r?.strategy).length);
  assert.equal(summary.unassessable,summary.total-summary.assessable);
  assert.equal(summary.best?.rolling?.meanSharpe,
    Math.max(...visible.map(r=>r.rolling.meanSharpe)));
});
