import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {aggregate,ema,statsFor,screenSymbol} from '../src/engine.js';
import {ALPACA_SCAN_LOOKBACK_DAYS,ALPACA_SCAN_CACHE_SECONDS,
  ALPACA_BATCH_SIZE,LIVE_UNIVERSE} from '../src/universe.js';
const ROOT='https://market-lens-pro-api.test.workers.dev';
const env={ALPACA_API_KEY:'example-key',ALPACA_API_SECRET:'example-secret',
  ALPACA_DATA_FEED:'iex',ALLOWED_ORIGINS:'https://mikesheer001-source.github.io'};
const req=(endpoint,ip)=>new Request(ROOT+endpoint,{headers:{
  'CF-Connecting-IP':ip,'Origin':'https://mikesheer001-source.github.io'}});

function dailyHistory(days){
  const dates=[],now=Date.UTC(2026,10,17);
  for(let i=days;i>=0;i--){
    const date=new Date(now-i*86400000),weekday=date.getUTCDay();
    if(weekday===0||weekday===6)continue;
    const time=date.toISOString().slice(0,10),price=100+dates.length*.03;
    dates.push({time,open:price,high:price+1,low:price-1,close:price,volume:10000});
  }
  return dates;
}
test('Round 19: five-year daily lookback yields over 1200 candles and over 200 weekly bars',()=>{
  assert.equal(ALPACA_SCAN_LOOKBACK_DAYS,1825);
  assert.equal(ALPACA_SCAN_CACHE_SECONDS,900);
  assert.equal(LIVE_UNIVERSE.length,133);
  assert.equal(LIVE_UNIVERSE.includes('MRSH'),true);
  assert.equal(LIVE_UNIVERSE.includes('MMC'),false);
  const extended=dailyHistory(ALPACA_SCAN_LOOKBACK_DAYS);
  const old=dailyHistory(550);
  const weekly=aggregate(extended,'W');
  assert.ok(extended.length>1200,'expect more than 1200 real-session-like daily candles');
  assert.ok(weekly.length>=250&&weekly.length<=265,'expect about 260 weekly candles');
  assert.equal(statsFor(weekly).bars,weekly.length);
  assert.ok(Number.isFinite(statsFor(weekly).ema200));
  assert.equal(ema(weekly.map(b=>b.close),200).at(-1),statsFor(weekly).ema200);
  assert.equal(statsFor(aggregate(old,'W')).ema200,null,
    '550 calendar days cannot warm up a weekly EMA200');
  assert.ok(Number.isFinite(100*(statsFor(weekly).price/statsFor(weekly).ema200-1)));
  const rule=[{metric:'emaDist',tf:'W',op:'>',value:-100}];
  assert.equal(screenSymbol(extended,rule).pass,true);
  assert.equal(screenSymbol(old,rule).pass,false);
});

test('Round 19: five-year universe scan paginates by 10k with 15-minute cache intact',async ()=>{
  const original=globalThis.fetch,cache=globalThis.caches;
  const calls=[],stored=new Map();
  globalThis.caches={default:{match:async k=>stored.get(k.url)?.clone()||null,
    put:async(k,v)=>{stored.set(k.url,v.clone());}}};
  globalThis.fetch=async url=>{
    const u=new URL(url),syms=u.searchParams.get('symbols').split(',');
    const page=u.searchParams.get('page_token');
    assert.equal(u.searchParams.get('limit'),'10000');
    assert.equal(u.searchParams.get('timeframe'),'1Day');
    const gap=(Date.now()-Date.parse(u.searchParams.get('start')))/86400000;
    assert.ok(Math.abs(gap-ALPACA_SCAN_LOOKBACK_DAYS)<.1,'scan start is five years ago');
    calls.push({count:syms.length,page});
    const t=page?'2026-11-17':'2026-11-16';
    return new Response(JSON.stringify({
      bars:Object.fromEntries(syms.map(x=>[x,[{t:t+'T00:00:00Z',o:10,h:11,l:9,c:10,v:100}]])),
      next_page_token:page?null:'continue'}),{status:200});
  };
  try{
    const first=await worker.fetch(req('/api/stocks/scan?feed=iex','192.0.2.129'),env);
    assert.equal(first.status,200);
    const body=await first.json();
    assert.equal(body.lookback_days,1825);
    assert.equal(body.returned,133);
    assert.equal(body.batches,Math.ceil(133/ALPACA_BATCH_SIZE));
    assert.ok(Number.isFinite(body.scan_duration_ms));
    assert.equal(body.bars.SPY.length,2);
    assert.equal(body.bars.MRSH.length,2);
    assert.equal(first.headers.get('X-Scan-Cache'),'MISS');
    assert.match(first.headers.get('Cache-Control'),/max-age=900/);
    assert.equal(calls.length,Math.ceil(133/ALPACA_BATCH_SIZE)*2);
    const second=await worker.fetch(req('/api/stocks/scan?feed=iex','192.0.2.129'),env);
    assert.equal(second.headers.get('X-Scan-Cache'),'HIT');
    assert.equal(calls.length,Math.ceil(133/ALPACA_BATCH_SIZE)*2);
  }finally{
    globalThis.fetch=original;
    if(cache===undefined)delete globalThis.caches;else globalThis.caches=cache;
  }
});

test('Round 19: single-symbol default daily endpoint loads five years and follows page token',async ()=>{
  const original=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async url=>{
    const u=new URL(url),token=u.searchParams.get('page_token');
    assert.equal(u.pathname,'/v2/stocks/SPY/bars');
    assert.equal(u.searchParams.get('timeframe'),'1Day');
    assert.equal(u.searchParams.get('limit'),'10000');
    assert.ok(Math.abs((Date.now()-Date.parse(u.searchParams.get('start')))/86400000-1825)<.1);
    calls.push(token||'first');
    return new Response(JSON.stringify({bars:[{t:(token?'2026-11-17':'2026-11-16')+'T00:00:00Z',
      o:5,h:6,l:4,c:5,v:100}],next_page_token:token?null:'second'}),{status:200});
  };
  try{
    const response=await worker.fetch(req('/api/stocks/bars?symbol=SPY&timeframe=1Day','192.0.2.130'),env);
    assert.equal(response.status,200);
    const data=await response.json();
    assert.deepEqual(calls,['first','second']);
    assert.equal(data.lookback_days,1825);
    assert.equal(data.bars.length,2);
    assert.equal(data.pages,2);
    assert.equal(data.next_page_token,null);
  }finally{globalThis.fetch=original;}
});

test('Round 19: explicit per-page limit still returns pagination token (backward compatible)',async ()=>{
  const original=globalThis.fetch;
  let call=0;
  globalThis.fetch=async url=>{
    call++;
    const u=new URL(url);
    assert.equal(u.searchParams.get('limit'),'250');
    return new Response(JSON.stringify({bars:[{t:'2026-11-16T00:00:00Z',o:5,h:6,l:4,c:5,v:100}],
      next_page_token:'page-two'}),{status:200});
  };
  try{
    const response=await worker.fetch(req('/api/stocks/bars?symbol=SPY&limit=250','192.0.2.131'),env);
    const data=await response.json();
    assert.equal(response.status,200);
    assert.equal(call,1);
    assert.equal(data.bars.length,1);
    assert.equal(data.next_page_token,'page-two');
  }finally{globalThis.fetch=original;}
});
