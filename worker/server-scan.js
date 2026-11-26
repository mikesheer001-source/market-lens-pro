import { aggregate, alpacaBars, screenStats, statsFor } from '../src/engine.js';
import {
  ALPACA_BATCH_SIZE, ALPACA_SCAN_LOOKBACK_DAYS, LIVE_UNIVERSE, VOLATILITY_UNIVERSE
} from '../src/universe.js';
import { expectedNyseBarDate } from '../src/freshness.js';

const FEEDS = new Set(['iex', 'sip', 'delayed_sip', 'boats', 'overnight', 'otc']);
const METRICS = new Set(['rsi', 'emaDist', 'ret20', 'drawdown', 'atrPct', 'price', 'volume']);
const OPERATORS = new Set(['>', '>=', '<', '<=', '=']);
const TIMEFRAMES = new Set(['D', 'W', 'M']);
const DAY_MS = 86_400_000;

export const DEFAULT_SERVER_SCAN_CONFIG = Object.freeze({
  enabled: true,
  rules: Object.freeze([
    Object.freeze({ metric: 'emaDist', tf: 'D', op: '>', value: 0 }),
    Object.freeze({ metric: 'rsi', tf: 'D', op: '<', value: 60 })
  ]),
  universeFilter: 'all',
  feed: 'iex'
});

export function normalizeServerScanConfig(input = {}, fallbackFeed = 'iex') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('Server scan settings must be an object.'), { status: 400 });
  }
  const sourceRules = input.rules === undefined ? DEFAULT_SERVER_SCAN_CONFIG.rules : input.rules;
  if (!Array.isArray(sourceRules) || sourceRules.length > 20) {
    throw Object.assign(new Error('Provide no more than 20 screener rules.'), { status: 400 });
  }
  const rules = sourceRules.map((rule, index) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw Object.assign(new Error('Invalid screener rule ' + (index + 1) + '.'), { status: 400 });
    }
    const metric = String(rule.metric || '');
    const tf = String(rule.tf || 'D').toUpperCase();
    const op = String(rule.op || '');
    const value = Number(rule.value);
    if (!METRICS.has(metric) || !OPERATORS.has(op) || !Number.isFinite(value)) {
      throw Object.assign(new Error('Invalid metric, comparison, or threshold in screener rule ' + (index + 1) + '.'), { status: 400 });
    }
    if (!TIMEFRAMES.has(tf)) {
      throw Object.assign(new Error('Background scans support daily, weekly, and monthly rules only. Two-hour rules remain available in the client screener.'), { status: 400 });
    }
    if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') {
      throw Object.assign(new Error('Rule enabled flags must be boolean.'), { status: 400 });
    }
    return { metric, tf, op, value, ...(rule.enabled === false ? { enabled: false } : {}) };
  });
  const enabled = input.enabled === undefined ? true : input.enabled;
  if (typeof enabled !== 'boolean') {
    throw Object.assign(new Error('Server scan enabled flag must be boolean.'), { status: 400 });
  }
  const universeFilter = input.universeFilter === undefined ? 'all' : String(input.universeFilter);
  if (!['all', 'volatility'].includes(universeFilter)) {
    throw Object.assign(new Error('Unsupported server scan universe filter.'), { status: 400 });
  }
  const feed = String(input.feed || fallbackFeed || 'iex').toLowerCase();
  if (!FEEDS.has(feed)) {
    throw Object.assign(new Error('Unsupported Alpaca feed.'), { status: 400 });
  }
  return { enabled, rules, universeFilter, feed };
}

async function fetchBatch(symbols, range, feed, env) {
  const histories = Object.create(null);
  let pageToken = null;
  let page = 0;
  do {
    const upstream = new URL('https://data.alpaca.markets/v2/stocks/bars');
    for (const [key, value] of Object.entries({
      symbols: symbols.join(','),
      timeframe: '1Day',
      start: range.start,
      end: range.end,
      limit: '10000',
      adjustment: 'all',
      feed,
      sort: 'asc'
    })) upstream.searchParams.set(key, value);
    if (pageToken) upstream.searchParams.set('page_token', pageToken);
    const response = await fetch(upstream, {
      headers: {
        'APCA-API-KEY-ID': env.ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': env.ALPACA_API_SECRET,
        Accept: 'application/json'
      }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.message || 'Alpaca daily-bar request failed (HTTP ' + response.status + ').');
      error.status = response.status;
      error.retryAfter = response.headers.get('Retry-After');
      throw error;
    }
    for (const [symbol, bars] of Object.entries(payload?.bars || {})) {
      if (Array.isArray(bars)) (histories[symbol] ||= []).push(...bars);
    }
    pageToken = payload?.next_page_token || null;
    page++;
    if (pageToken && page >= 10) {
      throw Object.assign(new Error('Alpaca scan pagination exceeded the safety limit.'), { status: 502 });
    }
  } while (pageToken);
  return histories;
}

function latestDate(items) {
  return Array.isArray(items) && items.length ? String(items.at(-1)?.t || '').slice(0, 10) || null : null;
}

export async function scanServerUniverse(env, rawConfig, now = new Date()) {
  const config = normalizeServerScanConfig(rawConfig, env?.ALPACA_DATA_FEED || 'iex');
  const symbols = config.universeFilter === 'volatility'
    ? VOLATILITY_UNIVERSE.filter(symbol => LIVE_UNIVERSE.includes(symbol))
    : [...LIVE_UNIVERSE];
  const startedAt = Date.now();
  const expectedBarDate = expectedNyseBarDate(now);
  const activeRules = config.rules.filter(rule => rule.enabled !== false);
  if (!config.enabled || !activeRules.length) {
    return {
      source: 'alpaca',
      feed: config.feed,
      timeframe: '1Day',
      universeFilter: config.universeFilter,
      expectedBarDate,
      requested: symbols.length,
      returned: 0,
      matchCount: 0,
      matches: [],
      staleSymbols: [],
      freshness: { expected: expectedBarDate, allFresh: false, checked: 0, stale: [], latestBySymbol: {} },
      retryErrors: [],
      batchSize: ALPACA_BATCH_SIZE,
      batches: 0,
      upstreamRequests: 0,
      lookbackDays: ALPACA_SCAN_LOOKBACK_DAYS,
      scanDurationMs: Date.now() - startedAt,
      scannedAt: now.toISOString(),
      disabled: !config.enabled,
      skipReason: !config.enabled ? 'Background scan paused by the current screener rules.' : 'No active screener rules.'
    };
  }
  if (!env?.ALPACA_API_KEY || !env?.ALPACA_API_SECRET) {
    throw Object.assign(new Error('Alpaca credentials are not configured on the Worker.'), { status: 503 });
  }
  const end = now.toISOString();
  const start = new Date(now.getTime() - ALPACA_SCAN_LOOKBACK_DAYS * DAY_MS).toISOString();
  const barsBySymbol = Object.create(null);
  const batches = [];
  for (let index = 0; index < symbols.length; index += ALPACA_BATCH_SIZE) {
    batches.push(symbols.slice(index, index + ALPACA_BATCH_SIZE));
  }

  let upstreamRequests = 0;
  for (const batch of batches) {
    const histories = await fetchBatch(batch, { start, end }, config.feed, env);
    upstreamRequests++;
    for (const [symbol, bars] of Object.entries(histories)) {
      (barsBySymbol[symbol] ||= []).push(...bars);
    }
  }

  const recentStart = new Date(Date.parse(expectedBarDate + 'T00:00:00Z') - 7 * DAY_MS).toISOString();
  let staleSymbols = symbols.filter(symbol => {
    const latest = latestDate(barsBySymbol[symbol]);
    return !latest || latest < expectedBarDate;
  });
  const retryErrors = [];
  for (let index = 0; index < staleSymbols.length; index += ALPACA_BATCH_SIZE) {
    const batch = staleSymbols.slice(index, index + ALPACA_BATCH_SIZE);
    try {
      const histories = await fetchBatch(batch, { start: recentStart, end }, config.feed, env);
      upstreamRequests++;
      for (const [symbol, bars] of Object.entries(histories)) {
        const merged = new Map((barsBySymbol[symbol] || []).map(bar => [bar.t, bar]));
        for (const bar of bars) if (bar?.t) merged.set(bar.t, bar);
        barsBySymbol[symbol] = [...merged.values()].sort((a, b) => String(a.t).localeCompare(String(b.t)));
      }
    } catch (error) {
      retryErrors.push({ symbols: batch, reason: String(error.message || error) });
      if (error.status === 429) throw error;
    }
  }

  staleSymbols = symbols.filter(symbol => {
    const latest = latestDate(barsBySymbol[symbol]);
    return !latest || latest < expectedBarDate;
  });
  const staleSet = new Set(staleSymbols);
  const matches = [];
  if (activeRules.length) {
    for (const symbol of symbols) {
      if (staleSet.has(symbol)) continue;
      const bars = alpacaBars(barsBySymbol[symbol], '1Day');
      if (!bars.length) continue;
      const result = screenStats(tf => statsFor(aggregate(bars, tf)), activeRules);
      if (result.pass) {
        matches.push({
          symbol,
          latestBar: bars.at(-1).time,
          stats: result.stats,
          checks: result.checks
        });
      }
    }
  }

  const latestBySymbol = Object.fromEntries(symbols.map(symbol => [symbol, latestDate(barsBySymbol[symbol])]));
  return {
    source: 'alpaca',
    feed: config.feed,
    timeframe: '1Day',
    universeFilter: config.universeFilter,
    expectedBarDate,
    requested: symbols.length,
    returned: symbols.filter(symbol => (barsBySymbol[symbol] || []).length).length,
    matchCount: matches.length,
    matches,
    staleSymbols,
    freshness: {
      expected: expectedBarDate,
      allFresh: staleSymbols.length === 0,
      checked: symbols.length,
      stale: staleSymbols.map(symbol => ({ symbol, latest: latestBySymbol[symbol] })),
      latestBySymbol
    },
    retryErrors,
    batchSize: ALPACA_BATCH_SIZE,
    batches: batches.length,
    upstreamRequests,
    lookbackDays: ALPACA_SCAN_LOOKBACK_DAYS,
    scanDurationMs: Date.now() - startedAt,
    scannedAt: now.toISOString()
  };
}
