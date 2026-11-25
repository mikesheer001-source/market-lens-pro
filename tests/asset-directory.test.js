import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

function cacheMock() {
  const entries = new Map();
  return {
    entries,
    default: {
      match: async key => entries.get(key.url)?.clone(),
      put: async (key, response) => { entries.set((typeof key === 'string' ? key : key.url), response.clone()); }
    }
  };
}

const base = 'https://test.workers.dev/api/stocks/universe';
const env = { ALPACA_API_KEY: 'test-key', ALPACA_API_SECRET: 'test-secret' };

test('universe directory retrieves all active, tradable us_equity assets without an exchange allowlist', async t => {
  const originalCache = globalThis.caches;
  const originalFetch = globalThis.fetch;
  globalThis.caches = cacheMock();
  let upstreamCalls = 0;
  globalThis.fetch = async resource => {
    const url = new URL(resource);
    upstreamCalls++;
    assert.equal(url.hostname, 'paper-api.alpaca.markets');
    assert.equal(url.pathname, '/v2/assets');
    assert.equal(url.searchParams.get('status'), 'active');
    assert.equal(url.searchParams.get('asset_class'), 'us_equity');
    return Response.json([
      {symbol:'AAA', class:'us_equity', status:'active', tradable:true, exchange:'NYSE'},
      {symbol:'BBB', class:'us_equity', status:'active', tradable:true, exchange:'NASDAQ'},
      {symbol:'NEWVENUE', class:'us_equity', status:'active', tradable:true, exchange:'NEW_EXCHANGE'},
      {symbol:'AAA', class:'us_equity', status:'active', tradable:true, exchange:'NYSE'},
      {symbol:'INACTIVE', class:'us_equity', status:'inactive', tradable:true, exchange:'NYSE'},
      {symbol:'NOTRADE', class:'us_equity', status:'active', tradable:false, exchange:'NYSE'},
      {symbol:'CRYPTO', class:'crypto', status:'active', tradable:true, exchange:'',},
      {symbol:'BAD SYMBOL', class:'us_equity', status:'active', tradable:true, exchange:'NYSE'}
    ]);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalCache === undefined) delete globalThis.caches;
    else globalThis.caches = originalCache;
  });

  const response = await worker.fetch(new Request(base, {
    headers: {'CF-Connecting-IP':'198.51.100.81'}
  }), env);
  assert.equal(response.status, 200);
  const directory = await response.json();
  assert.equal(directory.source, 'alpaca-v2-assets');
  assert.equal(directory.assetClass, 'us_equity');
  assert.equal(directory.status, 'active');
  assert.equal(directory.tradable, true);
  assert.equal(directory.count, 3);
  assert.equal(directory.requested, 3);
  assert.deepEqual(directory.symbols, ['AAA', 'BBB', 'NEWVENUE']);
  assert.deepEqual(directory.exchanges, ['NASDAQ', 'NEW_EXCHANGE', 'NYSE']);
  assert.equal(directory.cacheHit, false);
  assert.equal(typeof directory.refreshedAt, 'string');
  assert.equal(directory.id.length, 64);
  assert.equal(upstreamCalls, 1);
});

test('universe directory is cached for normal reads and refresh=1 replaces the stored directory', async t => {
  const originalCache = globalThis.caches;
  const originalFetch = globalThis.fetch;
  globalThis.caches = cacheMock();
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls++;
    const symbol = upstreamCalls === 1 ? 'AAA' : 'BBB';
    return Response.json([{symbol, class:'us_equity', status:'active', tradable:true, exchange:'NYSE'}]);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalCache === undefined) delete globalThis.caches;
    else globalThis.caches = originalCache;
  });

  const request = (query='', ip='198.51.100.82') => worker.fetch(new Request(base + query, {
    headers: {'CF-Connecting-IP':ip}
  }), env);
  const first = await request().then(response => response.json());
  const cached = await request().then(response => response.json());
  const refreshed = await request('?refresh=1').then(response => response.json());
  const cachedRefresh = await request().then(response => response.json());

  assert.deepEqual(first.symbols, ['AAA']);
  assert.equal(first.cacheHit, false);
  assert.deepEqual(cached.symbols, ['AAA']);
  assert.equal(cached.cacheHit, true);
  assert.deepEqual(refreshed.symbols, ['BBB']);
  assert.equal(refreshed.cacheHit, false);
  assert.deepEqual(cachedRefresh.symbols, ['BBB']);
  assert.equal(cachedRefresh.cacheHit, true);
  assert.equal(upstreamCalls, 2);
  const stored = [...globalThis.caches.entries.values()][0];
  assert.equal(stored.headers.get('Cache-Control'), 'public, max-age=86400');
});

test('universe directory falls back from paper to live only for authorization failures', async t => {
  const originalCache = globalThis.caches;
  const originalFetch = globalThis.fetch;
  delete globalThis.caches;
  const hosts = [];
  globalThis.fetch = async resource => {
    const url = new URL(resource);
    hosts.push(url.hostname);
    if (url.hostname === 'paper-api.alpaca.markets') return new Response('unauthorized', {status:401});
    return Response.json([{symbol:'LIVE', class:'us_equity', status:'active', tradable:true, exchange:'NASDAQ'}]);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalCache === undefined) delete globalThis.caches;
    else globalThis.caches = originalCache;
  });

  const response = await worker.fetch(new Request(base, {
    headers: {'CF-Connecting-IP':'198.51.100.83'}
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).symbols, ['LIVE']);
  assert.deepEqual(hosts, ['paper-api.alpaca.markets', 'api.alpaca.markets']);
});
