import { LIVE_UNIVERSE, ALPACA_BATCH_SIZE, ALPACA_SCAN_LOOKBACK_DAYS, ALPACA_SCAN_CACHE_SECONDS } from "../src/universe.js";
import { expectedNyseBarDate, freshnessWithUniverse } from "../src/freshness.js";

const DEFAULT_ORIGINS = [
  "https://mikesheer001-source.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
];

const FEEDS = new Set(["iex", "sip", "delayed_sip", "boats", "overnight", "otc"]);
const TIMEFRAMES = /^(?:[1-9]|[1-5]\d)Min$|^(?:[1-9]|1\d|2[0-3])Hour$|^(?:1Day|1Week|1Month)$/;
const rateWindows = new Map();

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(","))
    .split(",").map(value => value.trim()).filter(Boolean);
  return {
    "Access-Control-Allow-Origin": origin || allowed[0] || "null",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(body, status, origin, env, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin, env),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extra
    }
  });
}

function validDate(value) {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

function overRateLimit(ip) {
  const now = Date.now();
  const current = rateWindows.get(ip);
  if (!current || now - current.startedAt >= 60_000) {
    rateWindows.set(ip, { startedAt: now, count: 1 });
    if (rateWindows.size > 2_000) {
      for (const [key, value] of rateWindows) {
        if (now - value.startedAt >= 60_000) rateWindows.delete(key);
      }
    }
    return false;
  }
  current.count += 1;
  return current.count > 30;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(","))
      .split(",").map(value => value.trim()).filter(Boolean);

    if (origin && !allowed.includes(origin)) {
      return json({ error: "Origin not allowed." }, 403, null, env);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }
    if (request.method !== "GET") {
      return json({ error: "Method not allowed." }, 405, origin, env, { Allow: "GET, OPTIONS" });
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        provider: "alpaca",
        configured: Boolean(env.ALPACA_API_KEY && env.ALPACA_API_SECRET),
        feed: env.ALPACA_DATA_FEED || "iex",
        service: "market-lens-pro-api"
      }, 200, origin, env);
    }

    const isScan = url.pathname === "/api/stocks/scan";
    const isBars = url.pathname === "/api/stocks/bars";
    const isIntraday = url.pathname === "/api/stocks/intraday";
    if (!isScan && !isBars && !isIntraday) {
      return json({ error: "Not found." }, 404, origin, env);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (overRateLimit(ip)) {
      return json({ error: "Rate limit reached. Wait one minute and retry." }, 429, origin, env, { "Retry-After": "60" });
    }

    if (!env.ALPACA_API_KEY || !env.ALPACA_API_SECRET) {
      return json({ error: "Alpaca credentials are not configured on the Worker." }, 503, origin, env);
    }

    if (isIntraday) {
      const symbol=String(url.searchParams.get("symbol")||"").trim().toUpperCase();
      const feed=String(url.searchParams.get("feed")||env.ALPACA_DATA_FEED||"iex").toLowerCase();
      if(!LIVE_UNIVERSE.includes(symbol))
        return json({error:"Choose a symbol from the 133-symbol live universe."},400,origin,env);
      if(!FEEDS.has(feed))return json({error:"Unsupported Alpaca feed."},400,origin,env);
      const cacheUrl=new URL("/api/stocks/intraday",url.origin);
      cacheUrl.searchParams.set("symbol",symbol);
      cacheUrl.searchParams.set("feed",feed);
      cacheUrl.searchParams.set("origin",origin||"none");
      cacheUrl.searchParams.set("revision","2026-11-17-intraday-v1");
      const key=new Request(cacheUrl.toString(),{method:"GET"});
      const edge=globalThis.caches?.default;
      if(edge)try{
        const hit=await edge.match(key);
        if(hit){const headers=new Headers(hit.headers);headers.set("X-Intraday-Cache","HIT");
          return new Response(hit.body,{status:hit.status,headers});}
      }catch{}
      const lookbackDays=120,start=new Date(Date.now()-lookbackDays*86400000).toISOString();
      const end=new Date().toISOString();
      const bars=[];let token=null,pages=0;
      try {
        do {
          const upstreamUrl=new URL("https://data.alpaca.markets/v2/stocks/"+encodeURIComponent(symbol)+"/bars");
          for(const [k,v] of Object.entries({timeframe:"15Min",start,end,limit:"10000",adjustment:"all",feed,sort:"asc"}))
            upstreamUrl.searchParams.set(k,v);
          if(token)upstreamUrl.searchParams.set("page_token",token);
          const upstream=await fetch(upstreamUrl,{headers:{
            "APCA-API-KEY-ID":env.ALPACA_API_KEY,
            "APCA-API-SECRET-KEY":env.ALPACA_API_SECRET,
            Accept:"application/json"
          }});
          const payload=await upstream.json().catch(()=>null);
          if(!upstream.ok){
            const err=new Error(typeof payload?.message==="string"?payload.message:"Alpaca rejected the 15-minute bar request.");
            err.status=upstream.status;throw err;
          }
          if(Array.isArray(payload?.bars))bars.push(...payload.bars);
          token=payload?.next_page_token||null;
          pages++;
          if(token&&pages>=10)throw Error("Intraday pagination exceeded the safety limit.");
        }while(token);
      }catch(error){
        return json({error:"Real Alpaca intraday bars unavailable.",detail:error.message||"Upstream error"},
          error.status===429?429:502,origin,env,error.status===429?{"Retry-After":"60"}:{});
      }
      const response=json({source:"alpaca",symbol,feed,timeframe:"15Min",start,end,
        lookback_days:lookbackDays,returned:bars.length,bars},
        200,origin,env,{"Cache-Control":"public, max-age=300",
          "CDN-Cache-Control":"public, max-age=300","X-Intraday-Cache":"MISS"});
      if(edge)try{await edge.put(key,response.clone());}catch{}
      return response;
    }

    if (isScan) {
      const feed = String(url.searchParams.get("feed") || env.ALPACA_DATA_FEED || "iex").toLowerCase();
      if (!FEEDS.has(feed)) return json({ error: "Unsupported Alpaca feed." }, 400, origin, env);

      const expectedTradingDay=expectedNyseBarDate(new Date());
      const cacheUrl = new URL("/api/stocks/scan", url.origin);
      cacheUrl.searchParams.set("feed", feed);
      cacheUrl.searchParams.set("universe_revision", "2026-11-17-scan-freshness-retry");
      cacheUrl.searchParams.set("expected_trading_day",expectedTradingDay);
      cacheUrl.searchParams.set("origin", origin || "none");
      const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
      const edgeCache = globalThis.caches?.default;
      if (edgeCache) {
        try {
          const cached = await edgeCache.match(cacheKey);
          if (cached) {
            const headers = new Headers(cached.headers);
            headers.set("X-Scan-Cache", "HIT");
            return new Response(cached.body, { status: cached.status, headers });
          }
        } catch {}
      }

      const end = new Date().toISOString();
      const start = new Date(Date.now() - ALPACA_SCAN_LOOKBACK_DAYS * 86_400_000).toISOString();
      const barsBySymbol = Object.create(null);
      const batches = [];
      for (let i = 0; i < LIVE_UNIVERSE.length; i += ALPACA_BATCH_SIZE) {
        batches.push(LIVE_UNIVERSE.slice(i, i + ALPACA_BATCH_SIZE));
      }

      try {
        for (const symbols of batches) {
          let pageToken = null;
          let page = 0;
          do {
            const upstreamUrl = new URL("https://data.alpaca.markets/v2/stocks/bars");
            upstreamUrl.searchParams.set("symbols", symbols.join(","));
            upstreamUrl.searchParams.set("timeframe", "1Day");
            upstreamUrl.searchParams.set("start", start);
            upstreamUrl.searchParams.set("end", end);
            upstreamUrl.searchParams.set("limit", "10000");
            upstreamUrl.searchParams.set("adjustment", "all");
            upstreamUrl.searchParams.set("feed", feed);
            upstreamUrl.searchParams.set("sort", "asc");
            if (pageToken) upstreamUrl.searchParams.set("page_token", pageToken);

            const upstream = await fetch(upstreamUrl, {
              headers: {
                "APCA-API-KEY-ID": env.ALPACA_API_KEY,
                "APCA-API-SECRET-KEY": env.ALPACA_API_SECRET,
                "Accept": "application/json"
              }
            });
            const payload = await upstream.json().catch(() => null);
            if (!upstream.ok) {
              const error = new Error(typeof payload?.message === "string" ? payload.message : "Alpaca rejected a market scan batch.");
              error.status = upstream.status;
              throw error;
            }
            const rows = payload?.bars && typeof payload.bars === "object" ? payload.bars : {};
            for (const [symbol, items] of Object.entries(rows)) {
              if (Array.isArray(items)) (barsBySymbol[symbol] ||= []).push(...items);
            }
            pageToken = payload?.next_page_token || null;
            page += 1;
            if (pageToken && page >= 10) throw new Error("Alpaca scan pagination exceeded the safety limit.");
          } while (pageToken);
        }
      } catch (error) {
        const status = error.status === 429 ? 429 : 502;
        return json({
          error: "Alpaca market-wide scan failed.",
          detail: error.message || "The Alpaca request could not be completed."
        }, status, origin, env, status === 429 ? { "Retry-After": "60" } : {});
      }

      // One fresh-data retry per stale symbol, grouped in the same 15-symbol batches
      // as the original scan to stay within Cloudflare's subrequest budget.
      const firstFreshness=freshnessWithUniverse(barsBySymbol,LIVE_UNIVERSE,expectedTradingDay);
      const retryAttempted=firstFreshness.stale.map(x=>x.symbol),retryUpdated=[],retryErrors=[];
      if(retryAttempted.length){
        const recentStart=new Date(Date.parse(expectedTradingDay+'T00:00:00Z')-7*86400000).toISOString();
        for(let i=0;i<retryAttempted.length;i+=ALPACA_BATCH_SIZE){
          const symbols=retryAttempted.slice(i,i+ALPACA_BATCH_SIZE);
          try{
            const retryUrl=new URL("https://data.alpaca.markets/v2/stocks/bars");
            for(const [key,value] of Object.entries({
              symbols:symbols.join(","),timeframe:"1Day",start:recentStart,end,
              limit:"10000",adjustment:"all",feed,sort:"asc"
            }))retryUrl.searchParams.set(key,value);
            const response=await fetch(retryUrl,{
              headers:{"APCA-API-KEY-ID":env.ALPACA_API_KEY,"APCA-API-SECRET-KEY":env.ALPACA_API_SECRET,
                "Accept":"application/json"}
            });
            const payload=await response.json().catch(()=>null);
            if(!response.ok)throw Error(payload?.message||"Alpaca stale-bar retry failed (HTTP "+response.status+").");
            const returned=payload?.bars||{};
            for(const symbol of symbols){
              const recent=Array.isArray(returned[symbol])?returned[symbol]:[];
              if(!recent.length)continue;
              const existing=barsBySymbol[symbol]||[];
              const merged=new Map(existing.map(bar=>[bar.t,bar]));
              for(const bar of recent)if(bar?.t)merged.set(bar.t,bar);
              barsBySymbol[symbol]=[...merged.values()].sort((a,b)=>String(a.t).localeCompare(String(b.t)));
              retryUpdated.push(symbol);
            }
          }catch(err){
            retryErrors.push({symbols,reason:String(err.message||err)});
          }
        }
        console.info("[market-lens] stale-bar retry",JSON.stringify({
          expected:expectedTradingDay,attempted:retryAttempted,receivedNewBars:retryUpdated,
          errors:retryErrors.map(x=>({symbols:x.symbols,reason:x.reason}))
        }));
      }
      const freshness=freshnessWithUniverse(barsBySymbol,LIVE_UNIVERSE,expectedTradingDay);
      const retryInfo={attempted:retryAttempted,updated:retryUpdated,
        stillStale:freshness.stale.map(x=>x.symbol),errors:retryErrors};
      const returnedSymbols = Object.keys(barsBySymbol).filter(symbol => barsBySymbol[symbol]?.length);
      const missing = LIVE_UNIVERSE.filter(symbol => !barsBySymbol[symbol]?.length);
      const response = json({
        source: "alpaca",
        timeframe: "1Day",
        feed,
        requested: LIVE_UNIVERSE.length,
        returned: returnedSymbols.length,
        missing,
        freshness:{expected:freshness.expected,allFresh:freshness.allFresh,stale:freshness.stale,
          checked:freshness.checked,latestBySymbol:freshness.dates,verifiedAt:new Date().toISOString()},
        retry:retryInfo,
        batch_size: ALPACA_BATCH_SIZE,
        batches: batches.length,
        lookback_days: ALPACA_SCAN_LOOKBACK_DAYS,
        start,
        end,
        bars: barsBySymbol
      }, 200, origin, env, {
        "Cache-Control": "public, max-age=" + ALPACA_SCAN_CACHE_SECONDS,
        "CDN-Cache-Control": "public, max-age=" + ALPACA_SCAN_CACHE_SECONDS,
        "X-Scan-Cache": "MISS"
      });
      if (edgeCache) {
        try { await edgeCache.put(cacheKey, response.clone()); } catch {}
      }
      return response;
    }

    const symbol = String(url.searchParams.get("symbol") || "").trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.^_-]{0,19}$/.test(symbol)) {
      return json({ error: "Provide one valid ticker symbol, such as SPY." }, 400, origin, env);
    }

    const timeframe = url.searchParams.get("timeframe") || "1Day";
    if (!TIMEFRAMES.test(timeframe)) {
      return json({ error: "Unsupported timeframe." }, 400, origin, env);
    }

    const feed = String(url.searchParams.get("feed") || env.ALPACA_DATA_FEED || "iex").toLowerCase();
    if (!FEEDS.has(feed)) {
      return json({ error: "Unsupported Alpaca feed." }, 400, origin, env);
    }

    const now = new Date();
    const end = url.searchParams.get("end") || now.toISOString();
    const start = url.searchParams.get("start") || new Date(now.getTime() - 365 * 86_400_000).toISOString();
    if (!validDate(start) || !validDate(end) || Date.parse(start) >= Date.parse(end)) {
      return json({ error: "Provide valid start and end dates; start must precede end." }, 400, origin, env);
    }
    if (Date.parse(end) - Date.parse(start) > 10 * 366 * 86_400_000) {
      return json({ error: "Date range is limited to ten years per request." }, 400, origin, env);
    }

    const limitRaw = Number(url.searchParams.get("limit") || 1_000);
    if (!Number.isInteger(limitRaw) || limitRaw < 1) {
      return json({ error: "Limit must be a positive integer." }, 400, origin, env);
    }
    const limit = Math.min(limitRaw, 10_000);
    const adjustment = url.searchParams.get("adjustment") || "all";
    if (!["raw", "split", "dividend", "all"].includes(adjustment)) {
      return json({ error: "Unsupported adjustment value." }, 400, origin, env);
    }

    const upstreamUrl = new URL(
      "https://data.alpaca.markets/v2/stocks/" + encodeURIComponent(symbol) + "/bars"
    );
    upstreamUrl.searchParams.set("timeframe", timeframe);
    upstreamUrl.searchParams.set("start", start);
    upstreamUrl.searchParams.set("end", end);
    upstreamUrl.searchParams.set("limit", String(limit));
    upstreamUrl.searchParams.set("adjustment", adjustment);
    upstreamUrl.searchParams.set("feed", feed);
    const pageToken = url.searchParams.get("page_token");
    if (pageToken) {
      if (pageToken.length > 2_000) return json({ error: "Invalid page token." }, 400, origin, env);
      upstreamUrl.searchParams.set("page_token", pageToken);
    }

    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        headers: {
          "APCA-API-KEY-ID": env.ALPACA_API_KEY,
          "APCA-API-SECRET-KEY": env.ALPACA_API_SECRET,
          "Accept": "application/json"
        }
      });
    } catch {
      return json({ error: "Could not reach Alpaca market data." }, 502, origin, env);
    }

    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      const detail = typeof payload?.message === "string" ? payload.message : "Alpaca rejected the request.";
      return json({
        error: "Alpaca market-data request failed.",
        detail,
        upstream_status: upstream.status
      }, upstream.status === 429 ? 429 : 502, origin, env);
    }

    const bars = Array.isArray(payload?.bars) ? payload.bars : [];
    return json({
      source: "alpaca",
      symbol,
      timeframe,
      feed,
      bars,
      next_page_token: payload?.next_page_token || null
    }, 200, origin, env);
  }
};
