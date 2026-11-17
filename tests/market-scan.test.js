import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

test('market directory includes active exchange listings and caches complete paginated summaries', async t => {
  const originalCache = globalThis.caches;
  const cache = new Map();
  globalThis.caches = {default: {
    match: async key => cache.get(key.url)?.clone(),
    put: async (key, response) => {cache.set(key.url, response);}
  }};
  t.after(() => {
    if (originalCache) globalThis.caches = originalCache;
    else delete globalThis.caches;
  });
  const bar = day => ({t: day + 'T05:00:00Z', o: 10, h: 12, l: 9, c: 11, v: 50});
  const upstream = t.mock.method(globalThis, 'fetch', async resource => {
    const url = new URL(resource);
    if (url.pathname.endsWith('/assets')) return Response.json([
      {symbol:'SAMPLE', status:'active', exchange:'NYSE', tradable:false},
      {symbol:'FUND', status:'active', exchange:'ARCA'},
      {symbol:'OLD', status:'inactive', exchange:'NYSE'},
      {symbol:'PINK', status:'active', exchange:'OTC'}
    ]);
    assert.equal(url.searchParams.get('symbols'), 'FUND,SAMPLE');
    assert.equal(url.searchParams.get('timeframe'), '1Day');
    return url.searchParams.has('page_token') ?
      Response.json({bars:{FUND:[bar('2026-11-12')]}}) :
      Response.json({bars:{FUND:[bar('2026-11-11')]}, next_page_token:'second'});
  });
  const base = 'https://test.workers.dev/api/stocks/market';
  const env = {ALPACA_API_KEY:'key', ALPACA_API_SECRET:'secret'};
  const request = params => worker.fetch(new Request(base + params), env);
  const catalog = await request('').then(r => r.json());
  assert.equal(catalog.requested, 2);
  const query = '?' + new URLSearchParams({session: catalog.session, id: catalog.id, batch: 0});
  const summary = await request(query).then(r => r.json());
  assert.equal(summary.checked, 2);
  assert.deepEqual(summary.rows.map(row => row.symbol), ['FUND']);
  assert.equal(summary.rows[0].frames.D.bars, 2);
  assert.equal(summary.rows[0].frames.W.bars, 1);
  assert.equal(summary.rows[0].latestBar, '2026-11-12');
  assert.deepEqual(await request(query).then(r => r.json()), summary);
  assert.equal(upstream.mock.callCount(), 3);
});
