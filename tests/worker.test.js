import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { LIVE_UNIVERSE, ALPACA_BATCH_SIZE } from '../src/universe.js';

const allowed = 'https://mikesheer001-source.github.io';
const base = 'https://market-lens-pro-api.example.workers.dev';

test('health endpoint reports configuration without revealing credentials', async () => {
  const response = await worker.fetch(new Request(base + '/api/health', {headers:{Origin:allowed}}), {
    ALPACA_API_KEY:'test-key-not-for-production',
    ALPACA_API_SECRET:'test-secret-not-for-production',
    ALPACA_DATA_FEED:'iex',
    ALLOWED_ORIGINS:allowed
  });
  const body = await response.json();
  assert.equal(response.status,200);
  assert.equal(body.configured,true);
  assert.equal(body.feed,'iex');
  assert.equal(JSON.stringify(body).includes('test-secret'),false);
});

test('bars endpoint refuses to run without server-side credentials', async () => {
  const response = await worker.fetch(new Request(base + '/api/stocks/bars?symbol=SPY'), {
    ALLOWED_ORIGINS:allowed
  });
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/not configured/i);
});

test('bars endpoint validates symbols and timeframes before contacting Alpaca', async () => {
  const env={ALPACA_API_KEY:'key',ALPACA_API_SECRET:'secret',ALLOWED_ORIGINS:allowed};
  const invalidSymbol=await worker.fetch(new Request(base+'/api/stocks/bars?symbol=SPY%2FQQQ'),env);
  assert.equal(invalidSymbol.status,400);
  const invalidTimeframe=await worker.fetch(new Request(base+'/api/stocks/bars?symbol=SPY&timeframe=2Day'),env);
  assert.equal(invalidTimeframe.status,400);
});

test('bars endpoint proxies with server-only Alpaca headers and returns OHLCV bars', async () => {
  const originalFetch=globalThis.fetch;
  let requestedUrl,requestedHeaders;
  globalThis.fetch=async (url,options)=>{
    requestedUrl=new URL(url);
    requestedHeaders=options.headers;
    return new Response(JSON.stringify({
      bars:[{t:'2026-11-13T14:30:00Z',o:100,h:105,l:99,c:104,v:123456}],
      next_page_token:null
    }),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    const response=await worker.fetch(new Request(base+'/api/stocks/bars?symbol=SPY&timeframe=1Day&start=2026-11-01T00%3A00%3A00Z&end=2026-11-16T00%3A00%3A00Z&limit=250',{headers:{Origin:allowed,'CF-Connecting-IP':'198.51.100.40'}}),{
      ALPACA_API_KEY:'server-key',
      ALPACA_API_SECRET:'server-secret',
      ALPACA_DATA_FEED:'iex',
      ALLOWED_ORIGINS:allowed
    });
    const body=await response.json();
    assert.equal(response.status,200);
    assert.equal(requestedUrl.hostname,'data.alpaca.markets');
    assert.equal(requestedUrl.pathname,'/v2/stocks/SPY/bars');
    assert.equal(requestedUrl.searchParams.get('feed'),'iex');
    assert.equal(requestedUrl.searchParams.get('limit'),'250');
    assert.equal(requestedHeaders['APCA-API-KEY-ID'],'server-key');
    assert.equal(requestedHeaders['APCA-API-SECRET-KEY'],'server-secret');
    assert.equal(body.source,'alpaca');
    assert.equal(body.bars[0].c,104);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'),allowed);
  } finally {
    globalThis.fetch=originalFetch;
  }
});

test('bars endpoint rejects browser origins outside the configured allowlist', async () => {
  const response=await worker.fetch(new Request(base+'/api/stocks/bars?symbol=SPY',{headers:{Origin:'https://attacker.example'}}),{
    ALPACA_API_KEY:'key',ALPACA_API_SECRET:'secret',ALLOWED_ORIGINS:allowed
  });
  assert.equal(response.status,403);
});

test('market scan batches the bundled universe and caches the Alpaca response', async () => {
  const originalFetch=globalThis.fetch,originalCaches=globalThis.caches;
  const cached=new Map(),batches=[];
  let upstreamCalls=0;
  globalThis.caches={default:{
    match:async request=>cached.get(request.url)?.clone()||null,
    put:async (request,response)=>{cached.set(request.url,response.clone());}
  }};
  globalThis.fetch=async (url,options)=>{
    const parsed=new URL(url),symbols=(parsed.searchParams.get('symbols')||'').split(',').filter(Boolean);
    upstreamCalls+=1;batches.push(symbols);
    assert.equal(parsed.hostname,'data.alpaca.markets');
    assert.equal(parsed.pathname,'/v2/stocks/bars');
    assert.equal(parsed.searchParams.get('timeframe'),'1Day');
    assert.equal(parsed.searchParams.get('feed'),'iex');
    assert.equal(options.headers['APCA-API-KEY-ID'],'scan-key');
    return new Response(JSON.stringify({
      bars:Object.fromEntries(symbols.map(symbol=>[symbol,[{t:'2026-11-13T00:00:00Z',o:100,h:101,l:99,c:100,v:1000}]])),
      next_page_token:null
    }),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    const request=()=>new Request(base+'/api/stocks/scan?feed=iex',{headers:{Origin:allowed,'CF-Connecting-IP':'198.51.100.88'}});
    const env={ALPACA_API_KEY:'scan-key',ALPACA_API_SECRET:'scan-secret',ALPACA_DATA_FEED:'iex',ALLOWED_ORIGINS:allowed};
    const expectedBatches=Math.ceil(LIVE_UNIVERSE.length/ALPACA_BATCH_SIZE);
    const first=await worker.fetch(request(),env),body=await first.json();
    assert.equal(first.status,200);
    assert.equal(first.headers.get('X-Scan-Cache'),'MISS');
    assert.equal(body.requested,LIVE_UNIVERSE.length);
    assert.equal(body.returned,LIVE_UNIVERSE.length);
    assert.ok(body.bars.VXX?.length);
    assert.equal(upstreamCalls,expectedBatches);
    assert.ok(batches.every(batch=>batch.length<=ALPACA_BATCH_SIZE));
    assert.deepEqual(batches.flat(),LIVE_UNIVERSE);
    const second=await worker.fetch(request(),env);
    assert.equal(second.status,200);
    assert.equal(second.headers.get('X-Scan-Cache'),'HIT');
    assert.equal(upstreamCalls,expectedBatches,'a cached scan must not make more Alpaca requests');
  } finally {
    globalThis.fetch=originalFetch;
    if(originalCaches===undefined)delete globalThis.caches;else globalThis.caches=originalCaches;
  }
});

test('market scan refuses to run without server-side Alpaca credentials', async () => {
  const response=await worker.fetch(new Request(base+'/api/stocks/scan',{headers:{Origin:allowed,'CF-Connecting-IP':'198.51.100.89'}}),{
    ALLOWED_ORIGINS:allowed
  });
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/not configured/i);
});
