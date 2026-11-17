import test from 'node:test';
import assert from 'node:assert/strict';
import {alpacaBars,aggregate,sampleData} from '../src/engine.js';
import worker from '../worker/index.js';

const ticks=[
  {t:'2026-11-16T14:30:00Z',o:100,h:102,l:99,c:101,v:500},
  {t:'2026-11-16T15:00:00Z',o:101,h:104,l:100,c:103,v:700},
  {t:'2026-11-16T16:15:00Z',o:103,h:105,l:102,c:104,v:600},
  {t:'2026-11-16T16:30:00Z',o:104,h:106,l:103,c:105,v:800},
  {t:'2026-11-16T20:30:00Z',o:105,h:108,l:104,c:107,v:900}
];
test('Alpaca 15Min response becomes genuine timestamped OHLCV; NY 2H buckets retain valid opens/highs/lows/volumes',()=>{
  const bars=alpacaBars(ticks,'15Min');
  assert.equal(bars.length,5);
  assert.equal(typeof bars[0].time,'number');
  const twoHours=aggregate(bars,'2H');
  assert.equal(twoHours.length,3);
  assert.equal(twoHours[0].open,100);
  assert.equal(twoHours[0].close,104);
  assert.equal(twoHours[0].high,105);
  assert.equal(twoHours[0].low,99);
  assert.equal(twoHours[0].volume,1800);
  assert.equal(twoHours[1].open,104);
  assert.equal(twoHours[2].close,107);
  assert.equal(twoHours[2].volume,900);
  assert.equal(aggregate(bars,'15m').length,5);
});

test('No daily series is extrapolated into simulated 15Min/2H bars',()=>{
  const daily=sampleData()['DEMO-SPY'].slice(-100);
  assert.equal(aggregate(daily,'2H').length,0);
  assert.equal(aggregate(daily,'15m').length,0);
});

test('dedicated intraday endpoint fetches real Alpaca 15Min timeframe without credentials in response and caches results',async()=>{
  const originalFetch=globalThis.fetch,originalCaches=globalThis.caches;
  let upstreamCalls=0,upstreamUrl=null;
  const storage=new Map();
  globalThis.caches={default:{
    match:async r=>storage.get(r.url)?.clone()||null,
    put:async(r,p)=>{storage.set(r.url,p.clone());}
  }};
  globalThis.fetch=async(url,options)=>{
    upstreamCalls++;upstreamUrl=new URL(url);
    assert.equal(upstreamUrl.hostname,'data.alpaca.markets');
    assert.equal(upstreamUrl.searchParams.get('timeframe'),'15Min');
    assert.equal(upstreamUrl.searchParams.get('adjustment'),'all');
    assert.equal(upstreamUrl.searchParams.get('feed'),'iex');
    assert.equal(options.headers['APCA-API-KEY-ID'],'test-key');
    return new Response(JSON.stringify({bars:ticks,next_page_token:null}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try{
    const endpoint='https://market-lens-pro-api.example.workers.dev/api/stocks/intraday?symbol=VXX&feed=iex';
    const env={ALPACA_API_KEY:'test-key',ALPACA_API_SECRET:'test-secret',ALLOWED_ORIGINS:'https://mikesheer001-source.github.io'};
    const request=()=>new Request(endpoint,{headers:{Origin:'https://mikesheer001-source.github.io','CF-Connecting-IP':'198.51.100.99'}});
    const r1=await worker.fetch(request(),env),json=await r1.json();
    assert.equal(r1.status,200);
    assert.equal(json.source,'alpaca');
    assert.equal(json.timeframe,'15Min');
    assert.equal(json.symbol,'VXX');
    assert.equal(json.returned,5);
    assert.equal(json.lookback_days,120);
    assert.equal(JSON.stringify(json).includes('test-secret'),false);
    assert.equal(r1.headers.get('X-Intraday-Cache'),'MISS');
    const r2=await worker.fetch(request(),env);
    assert.equal(r2.status,200);
    assert.equal(r2.headers.get('X-Intraday-Cache'),'HIT');
    assert.equal(upstreamCalls,1);
    assert.equal((await r2.json()).bars.length,5);
    const invalid=await worker.fetch(new Request(endpoint.replace('VXX','%21INVALID'),{headers:{Origin:'https://mikesheer001-source.github.io','CF-Connecting-IP':'198.51.100.100'}}),env);
    assert.equal(invalid.status,400);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalCaches===undefined)delete globalThis.caches;else globalThis.caches=originalCaches;
  }
});
