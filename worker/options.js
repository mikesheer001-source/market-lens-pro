const dataHost = 'https://data.alpaca.markets';
const tradingHosts = ['https://paper-api.alpaca.markets','https://api.alpaca.markets'];
const symbolPattern = /^[A-Z][A-Z0-9.-]{0,9}$/;
const contractPattern = /^[A-Z0-9.]{1,10}\d{6}[CP]\d{8}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const indexRoots = new Set(['SPX','SPXW','XSP']);
const ET = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',dateStyle:'short'});

function fail(status, message, retry) {
  throw Object.assign(new Error(message), {status,retry});
}

export async function optionsAuthorized(header, secret) {
  const token = header?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1];
  if (!secret || !token) return false;
  const encode = new TextEncoder();
  const [provided,expected] = await Promise.all([token,secret].map(value =>
    crypto.subtle.digest('SHA-256',encode.encode(value)).then(value => new Uint8Array(value))));
  return provided.reduce((difference, byte, index) => difference | (byte ^ expected[index]), 0) === 0;
}

const number = value => value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const fixedUrl = (base, path, params) => {
  const url = new URL(path,base);
  for (const [key,value] of Object.entries(params)) if (value != null) url.searchParams.set(key,value);
  return url;
};

export function normalizeSnapshot(snapshot) {
  const q = snapshot?.latestQuote;
  const t = snapshot?.latestTrade;
  return {bid:number(q?.bp),ask:number(q?.ap),bidSize:number(q?.bs),askSize:number(q?.as),
    time:q?.t ?? null,last:number(t?.p),tradeTime:t?.t ?? null,iv:number(snapshot?.impliedVolatility),
    greeks:Object.fromEntries(['delta','gamma','theta','vega','rho'].map(key => [key,number(snapshot?.greeks?.[key])]))};
}

export function standardContract(row, underlying) {
  if (!contractPattern.test(row.symbol) || !datePattern.test(row.expiration_date) ||
    !['call','put'].includes(row.type) || number(row.size) !== 100 || !(number(row.strike_price) > 0)) return null;
  const index = indexRoots.has(underlying);
  const validRoot = index ? (underlying === 'SPX' ? ['SPX','SPXW'].includes(row.root_symbol) :
    row.root_symbol === underlying) : row.root_symbol === underlying.replaceAll('.','').replaceAll('-','');
  if (!validRoot || row.style !== (index ? 'european' : 'american')) return null;
  const deliverables = row.deliverables ?? [];
  if (!index && deliverables.length && (deliverables.length !== 1 ||
    !['equity','stock','shares','share'].includes(deliverables[0].type?.toLowerCase()) ||
    number(deliverables[0].amount) !== 100 ||
    (deliverables[0].symbol && deliverables[0].symbol !== underlying))) return null;
  return {symbol:row.symbol,root:row.root_symbol,expiry:row.expiration_date,type:row.type,
    strike:Number(row.strike_price),multiplier:100,openInterest:number(row.open_interest),
    openInterestDate:row.open_interest_date ?? null};
}

async function alpaca(url, env, fetcher) {
  const response = await fetcher(url,{headers:{'APCA-API-KEY-ID':env.ALPACA_API_KEY,
    'APCA-API-SECRET-KEY':env.ALPACA_API_SECRET,Accept:'application/json'},signal:AbortSignal.timeout(10_000)});
  if (response.status === 429) {
    const reset = Number(response.headers.get('X-RateLimit-Reset'));
    const retry = Number(response.headers.get('Retry-After')) || (reset ? Math.ceil(reset - Date.now()/1000) : 60);
    fail(429,'Alpaca quote limit reached.',Math.max(1,retry));
  }
  return response;
}

async function contractPage(env, params, fetcher) {
  const bases = env.ALPACA_TRADING_API_BASE ? [env.ALPACA_TRADING_API_BASE] : tradingHosts;
  for (const base of bases) {
    const res = await alpaca(fixedUrl(base,'/v2/options/contracts',{...params,limit:10000}),env,fetcher);
    if (res.ok) return res.json();
    if (![401,403].includes(res.status)) break;
  }
  fail(502,'Alpaca contract metadata is unavailable for this ticker.');
}

async function contracts(env, params, fetcher) {
  const rows = [];
  let token;
  for (let page = 0; page < 5; page++) {
    const body = await contractPage(env,{...params,page_token:token},fetcher);
    rows.push(...(body.option_contracts ?? []));
    token = body.next_page_token;
    if (!token) return rows;
  }
  fail(502,'Alpaca returned too many contracts. Narrow the expiration or strike range.');
}

async function optionData(env, path, params, fetcher) {
  const res = await alpaca(fixedUrl(dataHost,path,params),env,fetcher);
  if (res.status === 403 && params.feed === 'opra')
    fail(403,'OPRA is unavailable for this Alpaca connection. Check the subscription and OPRA agreement, or select Indicative.');
  if (!res.ok) fail(502,'Alpaca options snapshots are unavailable.');
  return res.json();
}

export async function optionsRequest(url, env, fetcher = fetch) {
  const action = url.pathname.split('/').at(-1);
  const get = key => url.searchParams.get(key);
  const feed = get('feed');
  const symbol = get('symbol');
  if (!['opra','indicative'].includes(feed)) fail(400,'Choose OPRA or Indicative.');
  const snapshotsPath = '/v1beta1/options/snapshots';
  if (action === 'snapshots') {
    const symbols = [...new Set((get('symbols') || '').split(','))];
    if (symbols.length > 8 || symbols.some(name => !contractPattern.test(name)))
      fail(400,'Provide up to eight valid options contract symbols.');
    const body = await optionData(env,snapshotsPath,{feed,symbols:symbols.join(','),limit:symbols.length},fetcher);
    return {feed,quotes:Object.fromEntries(Object.entries(body.snapshots ?? {}).map(([name,snapshot]) =>
      [name,normalizeSnapshot(snapshot)]))};
  }
  if (!symbolPattern.test(symbol ?? '')) fail(400,'Enter a valid underlying ticker.');
  const today = ET.format(new Date());
  const until = new Date(Date.parse(today + 'T00:00:00Z') + 730 * 86_400_000).toISOString().slice(0,10);
  const baseParams = {underlying_symbols:symbol};
  if (action === 'expirations') {
    const discovery = contracts(env,{...baseParams,expiration_date_gte:today,expiration_date_lte:until},fetcher);
    const stockFeed = env.ALPACA_DATA_FEED === 'sip' ? 'sip' : 'iex';
    const spot = indexRoots.has(symbol) ? Promise.resolve(null) : (async () => {
      try {
        const res = await alpaca(fixedUrl(dataHost,'/v2/stocks/'+symbol+'/snapshot',{feed:stockFeed}),env,fetcher);
        const {latestTrade} = res.ok ? await res.json() : {};
        return latestTrade?.p > 0 ? {value:latestTrade.p,time:latestTrade.t,feed:stockFeed.toUpperCase()} : null;
      } catch { return null; }
    })();
    const [rows,underlying] = await Promise.all([discovery,spot]);
    const expirations = [...new Set(rows.filter(row => standardContract(row,symbol)).map(row => row.expiration_date))].sort();
    return {feed,symbol,expirations,underlying};
  }
  const expiry = get('expiry');
  const center = number(get('center'));
  const width = number(get('width'));
  if (!datePattern.test(expiry ?? '') || expiry < today || expiry > until ||
    !(center > 0 && center <= 1e6 && width >= 0.01 && width <= 1)) fail(400,'Choose an expiration and a valid strike range.');
  const strike = {strike_price_gte:center*(1-width),strike_price_lte:center*(1+width)};
  const params = {...strike,expiration_date:expiry};
  const chain = await contracts(env,{...baseParams,...params,show_deliverables:true},fetcher);
  const bySymbol = new Map(chain.map(row => standardContract(row,symbol)).filter(Boolean).map(row => [row.symbol,row]));
  const result = [];
  let token;
  if (bySymbol.size) {
    for (let page = 0; page < 8; page++) {
      const body = await optionData(env,snapshotsPath+'/'+symbol,{...params,feed,limit:1000,page_token:token},fetcher);
      for (const [name,snapshot] of Object.entries(body.snapshots ?? {})) {
        const row = bySymbol.get(name);
        if (row) {
          result.push({...row,quote:normalizeSnapshot(snapshot)});
          bySymbol.delete(name);
        }
      }
      token = body.next_page_token;
      if (!token || !bySymbol.size) break;
    }
    if (token && bySymbol.size) fail(502,'Alpaca returned too many quotes. Narrow the strike range.');
  }
  result.push(...bySymbol.values());
  result.sort((a,b) => a.strike-b.strike || a.root.localeCompare(b.root) || a.type.localeCompare(b.type));
  return {feed,symbol,expiry,contracts:result};
}
