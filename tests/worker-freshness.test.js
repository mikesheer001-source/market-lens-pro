import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {LIVE_UNIVERSE,ALPACA_BATCH_SIZE} from '../src/universe.js';
import {expectedNyseBarDate} from '../src/freshness.js';

test('Worker retries only the lagging VXZ daily bar once, merges it and logs which symbol was stale',async()=>{
  const originalFetch=globalThis.fetch,originalCaches=globalThis.caches;
  const expected=expectedNyseBarDate(new Date());
  const old=expectedNyseBarDate(new Date(Date.parse(expected+'T12:00:00Z')));
  const seen=[],cache=new Map();
  globalThis.caches={default:{
    match:async req=>cache.get(req.url)?.clone()||null,
    put:async(req,res)=>{cache.set(req.url,res.clone());}
  }};
  globalThis.fetch=async(raw,options)=>{
    const u=new URL(raw),symbols=u.searchParams.get('symbols').split(',');
    assert.equal(u.pathname,'/v2/stocks/bars');
    assert.equal(u.searchParams.get('timeframe'),'1Day');
    assert.equal(u.searchParams.get('feed'),'iex');
    assert.equal(options.headers['APCA-API-KEY-ID'],'unit-key');
    const isRetry=Date.parse(u.searchParams.get('start'))>Date.now()-30*86400000;
    seen.push({symbols,isRetry});
    if(isRetry)assert.deepEqual(symbols,['VXZ']);
    const bars=Object.fromEntries(symbols.map(sym=>[sym,
      [{t:(sym==='VXZ'&&!isRetry?old:expected)+'T21:00:00Z',
        o:100,h:104,l:99,c:103,v:1200}]]));
    return new Response(JSON.stringify({bars,next_page_token:null}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try{
    const env={ALPACA_API_KEY:'unit-key',ALPACA_API_SECRET:'unit-secret',ALLOWED_ORIGINS:'https://mikesheer001-source.github.io'};
    const request=()=>new Request('https://fake-worker.example/api/stocks/scan?feed=iex',{
      headers:{Origin:'https://mikesheer001-source.github.io','CF-Connecting-IP':'198.51.100.224'}
    });
    const response=await worker.fetch(request(),env);
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.requested,133);
    assert.equal(result.returned,133);
    assert.equal(result.freshness.expected,expected);
    assert.equal(result.freshness.allFresh,true);
    assert.equal(result.freshness.dates.VXZ,expected);
    assert.deepEqual(result.retry.attempted,['VXZ']);
    assert.deepEqual(result.retry.updated,['VXZ']);
    assert.deepEqual(result.retry.stillStale,[]);
    assert.equal(seen.filter(s=>s.isRetry).length,1);
    assert.equal(seen.length,Math.ceil(LIVE_UNIVERSE.length/ALPACA_BATCH_SIZE)+1);
    assert.equal(result.bars.VXZ.length,2,'merge historical bar and recovered latest observation');
    const cached=await worker.fetch(request(),env);
    assert.equal(cached.headers.get('X-Scan-Cache'),'HIT');
    assert.equal(seen.filter(s=>s.isRetry).length,1,'cache avoids repetitive stale retry');
  }finally{
    globalThis.fetch=originalFetch;
    if(originalCaches===undefined)delete globalThis.caches;else globalThis.caches=originalCaches;
  }
});

test('Worker labels still-stale symbols amber after unsuccessful one-time Alpaca retry rather than fabricating a fresh close',async()=>{
  const originalFetch=globalThis.fetch,originalCaches=globalThis.caches;
  const expected=expectedNyseBarDate(new Date());
  const old=expectedNyseBarDate(new Date(Date.parse(expected+'T12:00:00Z')));
  let retries=0;
  delete globalThis.caches;
  globalThis.fetch=async(raw)=>{
    const u=new URL(raw),symbols=u.searchParams.get('symbols').split(',');
    const isRetry=Date.parse(u.searchParams.get('start'))>Date.now()-30*86400000;
    if(isRetry)retries++;
    const bars=Object.fromEntries(symbols.map(sym=>[sym,[{
      t:(sym==='VXZ'?old:expected)+'T21:00:00Z',o:100,h:101,l:99,c:100,v:1000
    }]]));
    return new Response(JSON.stringify({bars,next_page_token:null}),{status:200});
  };
  try{
    const response=await worker.fetch(new Request('https://fake-worker.example/api/stocks/scan?feed=iex',{
      headers:{'CF-Connecting-IP':'198.51.100.225'}
    }),{ALPACA_API_KEY:'key',ALPACA_API_SECRET:'secret'});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(retries,1);
    assert.equal(result.freshness.allFresh,false);
    assert.deepEqual(result.freshness.stale,[{symbol:'VXZ',latest:old}]);
    assert.deepEqual(result.retry.attempted,['VXZ']);
    assert.deepEqual(result.retry.stillStale,['VXZ']);
    assert.equal(result.bars.VXZ.at(-1).t.slice(0,10),old);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalCaches===undefined)delete globalThis.caches;else globalThis.caches=originalCaches;
  }
});
