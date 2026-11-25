const CACHE_REVISION = 'us-equity-directory-v1';
const CACHE_TTL_SECONDS = 86_400;
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.\-]{0,19}$/;

async function alpacaJson(url, env) {
  const response = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': env.ALPACA_API_KEY,
      'APCA-API-SECRET-KEY': env.ALPACA_API_SECRET,
      Accept: 'application/json'
    }
  });
  if (!response.ok) {
    const error = new Error('Alpaca asset directory returned HTTP ' + response.status + '.');
    error.status = response.status;
    error.retryAfter = response.headers.get('Retry-After');
    throw error;
  }
  const assets = await response.json();
  if (!Array.isArray(assets)) throw new Error('Alpaca asset directory response was not an array.');
  return assets;
}

async function fetchAssets(env) {
  const hosts = env.ALPACA_TRADING_API_BASE
    ? [env.ALPACA_TRADING_API_BASE]
    : ['https://paper-api.alpaca.markets', 'https://api.alpaca.markets'];
  let assets;
  for (const [index, host] of hosts.entries()) {
    try {
      const endpoint = new URL('/v2/assets', host);
      endpoint.searchParams.set('status', 'active');
      endpoint.searchParams.set('asset_class', 'us_equity');
      assets = await alpacaJson(endpoint, env);
      break;
    } catch (error) {
      if (index === hosts.length - 1 || ![401, 403].includes(error.status)) throw error;
    }
  }
  return assets;
}

async function digest(symbols) {
  const value = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(symbols.join(',')));
  return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function loadDirectory(env) {
  const assets = await fetchAssets(env);
  const eligible = assets.filter(asset =>
    asset?.class === 'us_equity' &&
    asset?.status === 'active' &&
    asset?.tradable === true &&
    typeof asset.symbol === 'string' &&
    SYMBOL_PATTERN.test(asset.symbol)
  );
  const symbols = [...new Set(eligible.map(asset => asset.symbol))].sort();
  if (!symbols.length) throw new Error('Alpaca returned no active, tradable U.S. equity assets.');
  const exchanges = [...new Set(eligible.map(asset => asset.exchange).filter(
    exchange => typeof exchange === 'string' && exchange.length
  ))].sort();
  const missingExchange = eligible.filter(asset => !asset.exchange).length;
  return {
    source: 'alpaca-v2-assets',
    assetClass: 'us_equity',
    status: 'active',
    tradable: true,
    id: await digest(symbols),
    count: symbols.length,
    requested: symbols.length,
    symbols,
    exchanges,
    missingExchange,
    refreshedAt: new Date().toISOString()
  };
}

export async function assetDirectory(url, env) {
  const refresh = url.searchParams.get('refresh') === '1';
  const cacheKey = new URL('/internal/' + CACHE_REVISION, url.origin).toString();
  const cache = globalThis.caches?.default;
  if (!refresh && cache) {
    try {
      const hit = await cache.match(new Request(cacheKey));
      if (hit) return { ...await hit.json(), cacheHit: true };
    } catch {
      // Cache loss or an unavailable edge cache must not prevent a live lookup.
    }
  }

  const value = { ...await loadDirectory(env), cacheHit: false };
  if (cache) {
    try {
      await cache.put(new Request(cacheKey), Response.json(value, {
        headers: { 'Cache-Control': 'public, max-age=' + CACHE_TTL_SECONDS }
      }));
    } catch {
      // The live directory is still returned if edge storage is temporarily unavailable.
    }
  }
  return value;
}
