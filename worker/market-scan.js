import { aggregate, statsFor } from '../src/engine.js';
import { expectedNyseBarDate } from '../src/freshness.js';
import { ALPACA_SCAN_LOOKBACK_DAYS } from '../src/universe.js';

const batchSize = 64;
const exchanges = new Set(['AMEX', 'ARCA', 'BATS', 'NYSE', 'NASDAQ', 'NYSEARCA', 'TXSE', 'IEX']);
const revision = 'market-v1';
const dayMs = 86_400_000;

async function cached(url, ttl, load) {
  const edge = globalThis.caches?.default;
  const key = new Request(url);
  const hit = await edge?.match(key).catch(() => null);
  if (hit) return hit.json();
  const value = await load();
  const response = Response.json(value, { headers: { 'Cache-Control': 'public, max-age=' + ttl } });
  await edge?.put(key, response).catch(() => {});
  return value;
}

async function alpacaJson(url, env) {
  const response = await fetch(url, { headers: {
    'APCA-API-KEY-ID': env.ALPACA_API_KEY,
    'APCA-API-SECRET-KEY': env.ALPACA_API_SECRET,
    Accept: 'application/json'
  } });
  if (!response.ok) {
    const error = new Error('Alpaca returned HTTP ' + response.status + '.');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function catalog(origin, env, session) {
  return cached(origin + '/internal/' + revision + '/catalog/' + session, 86_400, async () => {
    const hosts = env.ALPACA_TRADING_API_BASE ? [env.ALPACA_TRADING_API_BASE] :
      ['https://paper-api.alpaca.markets', 'https://api.alpaca.markets'];
    let assets;
    for (const [index, host] of hosts.entries()) {
      try {
        assets = await alpacaJson(new URL('/v2/assets?status=active&asset_class=us_equity', host), env);
        break;
      } catch (error) {
        if (index === hosts.length - 1 || ![401, 403].includes(error.status)) throw error;
      }
    }
    const symbols = [...new Set(assets.filter(asset =>
      asset.status === 'active' && exchanges.has(asset.exchange) &&
      /^[A-Z][A-Z0-9.\-]{0,19}$/.test(asset.symbol)
    ).map(asset => asset.symbol))].sort();
    if (!symbols.length) throw new Error('Alpaca returned an empty U.S. listings directory.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(symbols.join(',')));
    const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return { id, symbols };
  });
}

// Daily bars arrive sorted by ticker, then by timestamp. Keep only the values
// used by the screener and use the same weekly and monthly candles as Chart Lab.
function summarize(items) {
  const bars = items.map(bar => ({
    time: bar.t.slice(0, 10), open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v
  })).filter(bar => bar.close > 0);
  if (!bars.length) return null;
  return { latestBar: bars.at(-1).time, frames: {
    D: statsFor(bars), W: statsFor(aggregate(bars, 'W')), M: statsFor(aggregate(bars, 'M'))
  } };
}

export async function marketScan(url, env) {
  const session = expectedNyseBarDate(new Date());
  const listings = await catalog(url.origin, env, session);
  const batches = Math.ceil(listings.symbols.length / batchSize);
  if (!url.searchParams.has('batch')) return { session, id: listings.id, requested: listings.symbols.length, batches };

  const index = Number(url.searchParams.get('batch'));
  if (url.searchParams.get('id') !== listings.id || url.searchParams.get('session') !== session) {
    throw Object.assign(new Error('The market session or ticker directory changed. Restart the scan.'), { status: 409 });
  }
  if (!Number.isInteger(index) || index < 0 || index >= batches) {
    throw Object.assign(new Error('Invalid market scan batch.'), { status: 400 });
  }
  const feed = env.ALPACA_DATA_FEED || 'iex';
  const cacheUrl = url.origin + '/internal/' + revision + '/' + feed + '/' + session + '/' + listings.id + '/' + index;
  return cached(cacheUrl, 86_400, async () => {
    const symbols = listings.symbols.slice(index * batchSize, (index + 1) * batchSize);
    const stop = Date.parse(session + 'T00:00:00Z') + dayMs;
    const upstream = new URL('https://data.alpaca.markets/v2/stocks/bars');
    for (const [key, value] of Object.entries({
      symbols: symbols.join(','), timeframe: '1Day', feed, adjustment: 'all', sort: 'asc',
      start: new Date(stop - ALPACA_SCAN_LOOKBACK_DAYS * dayMs).toISOString(),
      end: new Date(stop - 1).toISOString(), limit: '10000'
    })) upstream.searchParams.set(key, value);

    const histories = new Map();
    for (let page = 0; ; page++) {
      const payload = await alpacaJson(upstream, env);
      for (const [symbol, bars] of Object.entries(payload.bars || {})) {
        if (!histories.has(symbol)) histories.set(symbol, []);
        histories.get(symbol).push(...bars);
      }
      if (!payload.next_page_token) break;
      if (page >= 11) throw new Error('Alpaca returned too many pages for one batch.');
      upstream.searchParams.set('page_token', payload.next_page_token);
    }
    const rows = symbols.flatMap(symbol => {
      const summary = summarize(histories.get(symbol) || []);
      return summary ? [{ symbol, ...summary }] : [];
    });
    return { index, checked: symbols.length, rows };
  });
}
