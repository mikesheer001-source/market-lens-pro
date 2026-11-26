import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/index.js';
import { ScanNotifications } from '../worker/scan-notifications.js';
import { normalizeServerScanConfig, scanServerUniverse } from '../worker/server-scan.js';
import { LIVE_UNIVERSE, ALPACA_BATCH_SIZE } from '../src/universe.js';
import { expectedNyseBarDate } from '../src/freshness.js';

const allowed = 'https://mikesheer001-source.github.io';
const base = 'https://market-lens-pro.example.workers.dev';

class SqlAdapter {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  exec(query, ...params) {
    const statement = this.db.prepare(query);
    if (/^\s*SELECT\b/i.test(query)) {
      const rows = statement.all(...params);
      return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
    }
    statement.run(...params);
    return { toArray: () => [] };
  }
}

function makeNotificationsBinding() {
  const storage = { sql: new SqlAdapter(), transactionSync: callback => callback() };
  const instance = new ScanNotifications({ storage });
  const stub = { fetch: request => instance.fetch(request) };
  return { instance, binding: { idFromName: () => 'market-lens-server-scan-v1', get: () => stub } };
}

function alpacaFixture() {
  const expected = expectedNyseBarDate(new Date());
  return async (resource, options) => {
    const url = new URL(resource);
    const symbols = (url.searchParams.get('symbols') || '').split(',').filter(Boolean);
    assert.equal(url.hostname, 'data.alpaca.markets');
    assert.equal(url.pathname, '/v2/stocks/bars');
    assert.equal(url.searchParams.get('timeframe'), '1Day');
    assert.equal(url.searchParams.get('feed'), 'iex');
    assert.equal(options.headers['APCA-API-KEY-ID'], 'scan-test-key');
    return Response.json({
      bars: Object.fromEntries(symbols.map(symbol => [symbol, [{
        t: expected + 'T00:00:00Z',
        o: 199, h: 201, l: 198, c: symbol === LIVE_UNIVERSE[0] ? 200 : 100, v: 1000
      }]])),
      next_page_token: null
    });
  };
}

test('server scan config validates the same rule vocabulary and rejects unsupported 2H rules', () => {
  const valid = normalizeServerScanConfig({
    rules: [{ metric: 'price', tf: 'D', op: '>', value: 150 }],
    universeFilter: 'all',
    feed: 'iex'
  });
  assert.equal(valid.rules[0].value, 150);
  assert.throws(() => normalizeServerScanConfig({
    rules: [{ metric: 'rsi', tf: '2H', op: '<', value: 50 }]
  }), /daily, weekly, and monthly/i);
  assert.throws(() => normalizeServerScanConfig({
    rules: [{ metric: 'not-a-metric', tf: 'D', op: '>', value: 1 }]
  }), /Invalid metric/i);
  assert.equal(normalizeServerScanConfig({enabled:false,rules:[]}).enabled,false);
});

test('a disabled or empty server profile skips Alpaca requests', async () => {
  const result=await scanServerUniverse({}, {enabled:false,rules:[],universeFilter:'all',feed:'iex'});
  assert.equal(result.disabled,true);
  assert.equal(result.upstreamRequests,0);
  assert.equal(result.matchCount,0);
});

test('server scan evaluates the 133-symbol live universe in 15-symbol Alpaca batches', async () => {
  const originalFetch = globalThis.fetch;
  const batches = [];
  globalThis.fetch = async (resource, options) => {
    const url = new URL(resource);
    batches.push((url.searchParams.get('symbols') || '').split(',').filter(Boolean));
    return alpacaFixture()(resource, options);
  };
  try {
    const result = await scanServerUniverse({
      ALPACA_API_KEY: 'scan-test-key',
      ALPACA_API_SECRET: 'scan-test-secret',
      ALPACA_DATA_FEED: 'iex'
    }, {
      rules: [{ metric: 'price', tf: 'D', op: '>', value: 150 }],
      universeFilter: 'all',
      feed: 'iex'
    });
    assert.equal(result.requested, LIVE_UNIVERSE.length);
    assert.equal(result.returned, LIVE_UNIVERSE.length);
    assert.equal(result.upstreamRequests, Math.ceil(LIVE_UNIVERSE.length / ALPACA_BATCH_SIZE));
    assert.ok(batches.every(batch => batch.length <= ALPACA_BATCH_SIZE));
    assert.deepEqual(batches.flat(), LIVE_UNIVERSE);
    assert.deepEqual(result.matches.map(match => match.symbol), [LIVE_UNIVERSE[0]]);
    assert.equal(result.freshness.allFresh, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('notification Durable Object stores new match alerts once and persists dismissals', async () => {
  const { instance } = makeNotificationsBinding();
  const request = (path, method = 'GET', body) => instance.fetch(new Request('https://scan-notifications.internal' + path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }));
  const config = { rules: [{ metric: 'price', tf: 'D', op: '>', value: 150 }], universeFilter: 'all', feed: 'iex' };
  assert.equal((await request('/config', 'PUT', config)).status, 200);
  assert.equal((await request('/run/start', 'POST', { runId: 'run-1' })).status, 200);
  const first = await request('/run/complete', 'POST', {
    runId: 'run-1', scanType: 'manual', scannedAt: '2026-11-26T23:00:00.000Z',
    expectedBarDate: '2026-11-26', requested: 2, returned: 2, matches: [{ symbol: 'AAPL' }, { symbol: 'MSFT' }]
  }).then(response => response.json());
  assert.equal(first.newMatchCount, 2);
  assert.deepEqual(first.newMatches, ['AAPL', 'MSFT']);
  assert.equal((await request('/run/start', 'POST', { runId: 'run-2' })).status, 200);
  const second = await request('/run/complete', 'POST', {
    runId: 'run-2', scanType: 'scheduled', scannedAt: '2026-11-27T23:00:00.000Z',
    expectedBarDate: '2026-11-27', requested: 2, returned: 1, staleSymbols: ['AAPL'], matches: [{ symbol: 'MSFT' }]
  }).then(response => response.json());
  assert.equal(second.newMatchCount, 0);
  assert.equal((await request('/run/start', 'POST', { runId: 'run-3' })).status, 200);
  const afterStaleRetry = await request('/run/complete', 'POST', {
    runId: 'run-3', scanType: 'scheduled', scannedAt: '2026-11-28T23:00:00.000Z',
    expectedBarDate: '2026-11-28', requested: 2, returned: 2, matches: [{ symbol: 'AAPL' }, { symbol: 'MSFT' }]
  }).then(response => response.json());
  assert.equal(afterStaleRetry.newMatchCount, 0);
  let notifications = await request('/notifications').then(response => response.json());
  assert.equal(notifications.notifications.length, 1);
  assert.equal(notifications.notifications[0].unread, true);
  await request('/notifications/ack', 'POST', { id: 'run-1' });
  notifications = await request('/notifications').then(response => response.json());
  assert.equal(notifications.notifications[0].unread, false);
  assert.ok(notifications.notifications[0].readAt);
});

test('on-demand Worker scan creates a persisted in-app notification without exposing Alpaca credentials', async () => {
  const originalFetch = globalThis.fetch;
  const { binding } = makeNotificationsBinding();
  globalThis.fetch = alpacaFixture();
  try {
    const env = {
      ALPACA_API_KEY: 'scan-test-key',
      ALPACA_API_SECRET: 'scan-test-secret',
      ALPACA_DATA_FEED: 'iex',
      ALLOWED_ORIGINS: allowed,
      SCAN_NOTIFICATIONS: binding
    };
    const request = new Request(base + '/api/server-scan/run', {
      method: 'POST',
      headers: { Origin: allowed, 'CF-Connecting-IP': '198.51.100.121', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rules: [{ metric: 'price', tf: 'D', op: '>', value: 150 }],
        universeFilter: 'all',
        feed: 'iex'
      })
    });
    const response = await worker.fetch(request, env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.requested, LIVE_UNIVERSE.length);
    assert.equal(body.matchCount, 1);
    assert.equal(body.newMatchCount, 1);
    assert.deepEqual(body.newMatches, [LIVE_UNIVERSE[0]]);
    assert.equal(JSON.stringify(body).includes('scan-test-secret'), false);

    const notifications = await worker.fetch(new Request(base + '/api/server-scan/notifications', {
      headers: { Origin: allowed, 'CF-Connecting-IP': '198.51.100.122' }
    }), env).then(result => result.json());
    assert.equal(notifications.notifications.length, 1);
    assert.equal(notifications.notifications[0].symbols[0], LIVE_UNIVERSE[0]);
    assert.equal(notifications.notifications[0].unread, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
