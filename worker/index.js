import {deviceAuthorized,enrollDevice} from "./options-device.js";
import {optionsAuthorized,optionsRequest} from "./options.js";
import { workspaceRequest, publicWorkspaceRequest } from "./workspace.js";
export { Workspace } from "./workspace.js";
import { marketScan } from "./market-scan.js";
import { LIVE_UNIVERSE, ALPACA_BATCH_SIZE, ALPACA_SCAN_LOOKBACK_DAYS, ALPACA_SCAN_CACHE_SECONDS } from "../src/universe.js";
import { expectedNyseBarDate, freshnessWithUniverse } from "../src/freshness.js";
import {LIVE_SCAN_CACHE_REVISION} from "../src/live-history.js";

const DEFAULT_ORIGINS = [
  "https://mikesheer001-source.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
];

const FEEDS = new Set(["iex", "sip", "delayed_sip", "boats", "overnight", "otc"]);
const TIMEFRAMES = /^(?:[1-9]|[1-5]\d)Min$|^(?:[1-9]|1\d|2[0-3])Hour$|^(?:1Day|1Week|1Month)$/;
const rateWindows = new Map();

// Credentialed Alpaca getAsset lookup, on paper or live trading endpoints.
// An authorization failure is UNKNOWN, never interpreted as delisting.
async function alpacaAsset(symbol,env){
  const headers={"APCA-API-KEY-ID":env.ALPACA_API_KEY,"APCA-API-SECRET-KEY":env.ALPACA_API_SECRET,
    Accept:"application/json"};
  const hosts=env.ALPACA_TRADING_API_BASE?[env.ALPACA_TRADING_API_BASE]:
    ["https://paper-api.alpaca.markets","https://api.alpaca.markets"];
  let lastError="Asset endpoint unavailable";
  for(const host of hosts){
    try{
      const response=await fetch(host.replace(/\/$/,"")+"/v2/assets/"+encodeURIComponent(symbol),{headers});
      if(response.status===401||response.status===403){lastError="Asset endpoint authorization HTTP "+response.status;continue;}
      if(response.status===404)return {found:false,status:"not_found",tradable:false};
      if(!response.ok){lastError="Asset lookup HTTP "+response.status;continue;}
      const a=await response.json();
      return {found:true,status:a.status||"unknown",tradable:a.tradable===true,
        exchange:a.exchange||null,assetClass:a.class||null,symbol:a.symbol||symbol};
    }catch(err){lastError=String(err.message||err);}
  }
  return {found:null,status:"unknown",tradable:null,error:lastError};
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(","))
    .split(",").map(value => value.trim()).filter(Boolean);
  return {
    "Access-Control-Allow-Origin": origin || allowed[0] || "null",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization, If-Match, X-Options-Approval",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers": "Retry-After",
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

function overRateLimit(ip, limit = 30) {
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
  return current.count > limit;
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
    const sharedWorkspace = url.pathname === "/api/shared-workspace";
    if ((sharedWorkspace || url.pathname === "/api/workspace") && ["GET", "PUT"].includes(request.method)) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      if (overRateLimit("workspace:" + ip, 120)) {
        return json({ error: "Workspace sync rate limit reached." }, 429, origin, env, { "Retry-After": "60" });
      }
      const response = await (sharedWorkspace ? publicWorkspaceRequest : workspaceRequest)(request, env);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders(origin, env))) headers.set(key, value);
      headers.set("Cache-Control", "no-store");
      headers.set("Access-Control-Expose-Headers", "ETag");
      return new Response(response.body, { status: response.status, headers });
    }
    if (url.pathname === "/api/options/device" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      if (overRateLimit("options-enroll:"+ip,10)) return json({error:"Try the setup link again in one minute."},429,origin,env,{"Retry-After":"60"});
      const status = await enrollDevice(request,env).catch(() => 503);
      if (status === 204) return new Response(null,{status,headers:{...corsHeaders(origin,env),"Cache-Control":"no-store"}});
      return json({error:status === 503 ? "Quote access is temporarily unavailable." : "This quote link is invalid."},status,origin,env);
    }
    if (request.method !== "GET") {
      return json({ error: "Method not allowed." }, 405, origin, env, { Allow: "GET, PUT, POST, OPTIONS" });
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        provider: "alpaca",
        configured: Boolean(env.ALPACA_API_KEY && env.ALPACA_API_SECRET),
        feed: env.ALPACA_DATA_FEED || "iex",
        service: "market-lens-pro-api",
        daily_lookback_days: ALPACA_SCAN_LOOKBACK_DAYS,
        scan_cache_revision: LIVE_SCAN_CACHE_REVISION,
        scan_cache_seconds: ALPACA_SCAN_CACHE_SECONDS
      }, 200, origin, env);
    }

    if (/^\/api\/options\/(expirations|chain|snapshots)$/.test(url.pathname)) {
      if (!env.OPTIONS_OWNER_TOKEN && !env.WORKSPACES) return json({error:"Private quotes are temporarily unavailable."},503,origin,env);
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      if (overRateLimit("options:"+ip)) return json({error:"Quote rate limit reached."},429,origin,env,{"Retry-After":"60"});
      const authorization = request.headers.get("Authorization");
      const approved = await deviceAuthorized(authorization,env).catch(() => null);
      if (!approved && !await optionsAuthorized(authorization,env.OPTIONS_OWNER_TOKEN))
        return approved === null ? json({error:"Browser verification is temporarily unavailable."},503,origin,env) :
          json({error:"Open your private setup link to enable quotes in this browser."},401,origin,env);
      if (!env.ALPACA_API_KEY || !env.ALPACA_API_SECRET)
        return json({error:"Alpaca credentials are unavailable."},503,origin,env);
      try {
        return json(await optionsRequest(url,env),200,origin,env);
      } catch (error) {
        return json({error:error.status ? error.message : "Alpaca options request failed."},error.status || 502,origin,env,
          error.retry ? {"Retry-After":String(error.retry)} : {});
      }
    }

    const isMarket = url.pathname === "/api/stocks/market";
    const isScan = url.pathname === "/api/stocks/scan";
    const isBars = url.pathname === "/api/stocks/bars";
    const isIntraday = url.pathname === "/api/stocks/intraday";
    const isDiagnostics = url.pathname === "/api/stocks/diagnostics";
    if (!isMarket && !isScan && !isBars && !isIntraday && !isDiagnostics) {
      return json({ error: "Not found." }, 404, origin, env);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (overRateLimit(ip)) {
      return json({ error: "Rate limit reached. Wait one minute and retry." }, 429, origin, env, { "Retry-After": "60" });
    }

    if (!env.ALPACA_API_KEY || !env.ALPACA_API_SECRET) {
      return json({ error: "Alpaca credentials are not configured on the Worker." }, 503, origin, env);
    }
    if (isMarket) {
      try {
        return json(await marketScan(url, env), 200, origin, env);
      } catch (error) {
        const status = [400, 409, 429].includes(error.status) ? error.status : 502;
        return json({ error: error.message || "U.S. market scan unavailable." }, status, origin, env,
          status === 429 ? { "Retry-After": "60" } : {});
      }
    }
    // Explicit targeted diagnostic: asset status plus actual newest Alpaca daily bar.
    // No prices or credentials are exposed. Up to five symbols per request.
    if(isDiagnostics){
      const symbols=String(url.searchParams.get("symbols")||"").toUpperCase().split(",").filter(Boolean);
      if(!symbols.length||symbols.length>5||symbols.some(x=>!/^[A-Z][A-Z0-9.]{0,9}$/.test(x)))
        return json({error:"Provide 1 to 5 valid ticker symbols."},400,origin,env);
      const feed=String(url.searchParams.get("feed")||env.ALPACA_DATA_FEED||"iex").toLowerCase();
      if(!FEEDS.has(feed))return json({error:"Unsupported Alpaca feed."},400,origin,env);
      const start=new Date(Date.now()-ALPACA_SCAN_LOOKBACK_DAYS*86400000).toISOString(),end=new Date().toISOString();
      const details={};
      for(const symbol of symbols){
        const asset=await alpacaAsset(symbol,env);
        let latestBarDate=null,barCount=0,barError=null;
        try{
          const upstream=new URL("https://data.alpaca.markets/v2/stocks/"+encodeURIComponent(symbol)+"/bars");
          for(const [k,v] of Object.entries({timeframe:"1Day",start,end,limit:"10000",
            adjustment:"all",feed,sort:"desc"}))upstream.searchParams.set(k,v);
          const response=await fetch(upstream,{headers:{"APCA-API-KEY-ID":env.ALPACA_API_KEY,
            "APCA-API-SECRET-KEY":env.ALPACA_API_SECRET,Accept:"application/json"}});
          const payload=await response.json().catch(()=>null);
          if(!response.ok)barError="Alpaca historical bars HTTP "+response.status+
            (payload?.message?": "+payload.message:"");
          else{
            const bars=Array.isArray(payload?.bars)?payload.bars:[];
            barCount=bars.length;latestBarDate=bars.length?bars[0].t?.slice(0,10)||null:null;
          }
        }catch(err){barError=String(err.message||err);}
        details[symbol]={asset,latestBarDate,barCount,barError,
          barsSource:"Alpaca "+feed.toUpperCase()+" 1Day",checkedAt:new Date().toISOString()};
      }
      return json({source:"alpaca",feed,start,end,details},200,origin,env);
    }

    if (isIntraday) {
      const symbol=String(url.searchParams.get("symbol")||"").trim().toUpperCase();
      const feed=String(url.searchParams.get("feed")||env.ALPACA_DATA_FEED||"iex").toLowerCase();
      if(!/^[A-Z][A-Z0-9.\-]{0,19}$/.test(symbol))
        return json({error:"Provide a valid U.S. ticker."},400,origin,env);
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
      const scanStartedAt=Date.now();
      const feed = String(url.searchParams.get("feed") || env.ALPACA_DATA_FEED || "iex").toLowerCase();
      if (!FEEDS.has(feed)) return json({ error: "Unsupported Alpaca feed." }, 400, origin, env);

      const expectedTradingDay=expectedNyseBarDate(new Date());
      const cacheUrl = new URL("/api/stocks/scan", url.origin);
      cacheUrl.searchParams.set("feed", feed);
      cacheUrl.searchParams.set("universe_revision", LIVE_SCAN_CACHE_REVISION);
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

      // The modal observed latest-bar date drives retries: one lagging ticker
      // must not be masked by the pre-close wall-clock date.
      // Retry stale symbols in capped batches to respect subrequest limits.
      const firstFreshness=freshnessWithUniverse(barsBySymbol,LIVE_UNIVERSE,expectedTradingDay);
      const retryAttempted=firstFreshness.stale.map(x=>x.symbol),retryUpdated=[],retryErrors=[];
      if(retryAttempted.length){
        const recentStart=new Date(Date.parse(firstFreshness.expected+'T00:00:00Z')-7*86400000).toISOString();
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
              const previousLatest=existing.at(-1)?.t||'';
              const merged=new Map(existing.map(bar=>[bar.t,bar]));
              for(const bar of recent)if(bar?.t)merged.set(bar.t,bar);
              barsBySymbol[symbol]=[...merged.values()].sort((a,b)=>String(a.t).localeCompare(String(b.t)));
              if((barsBySymbol[symbol].at(-1)?.t||'')>previousLatest)retryUpdated.push(symbol);
            }
          }catch(err){
            retryErrors.push({symbols,reason:String(err.message||err)});
          }
        }
        console.info("[market-lens] stale-bar retry",JSON.stringify({
          reference:firstFreshness.expected,clockFallback:expectedTradingDay,
          attempted:retryAttempted,receivedNewBars:retryUpdated,
          errors:retryErrors.map(x=>({symbols:x.symbols,reason:x.reason}))
        }));
      }
      const freshness=freshnessWithUniverse(barsBySymbol,LIVE_UNIVERSE,expectedTradingDay);
      // Retry exhausted: explain each truly stale ticker with asset status.
      const diagnostics={};
      for(const [index,row] of freshness.stale.entries()){
        const retryFailed=retryErrors.some(error=>error.symbols?.includes(row.symbol));
        // The retry response itself is evidence of no newer bar, even if the
        // extra asset-status query budget has been exhausted (15 lookups).
        diagnostics[row.symbol]={asset:index<15?await alpacaAsset(row.symbol,env):null,
          barsAfterLatest:retryFailed?null:retryUpdated.includes(row.symbol),
          retryFailed,latest:row.latest,checkedAt:new Date().toISOString()};
      }
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
        freshness:{expected:freshness.expected,referenceMethod:freshness.referenceMethod,
          clockFallback:expectedTradingDay,allFresh:freshness.allFresh,stale:freshness.stale,
          checked:freshness.checked,latestBySymbol:freshness.dates,verifiedAt:new Date().toISOString()},
        retry:retryInfo,
        diagnostics,
        batch_size: ALPACA_BATCH_SIZE,
        batches: batches.length,
        lookback_days: ALPACA_SCAN_LOOKBACK_DAYS,
        scan_cache_revision: LIVE_SCAN_CACHE_REVISION,
        scan_duration_ms: Date.now()-scanStartedAt,
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
    const start = url.searchParams.get("start") || new Date(now.getTime() -
      (timeframe==="1Day"?ALPACA_SCAN_LOOKBACK_DAYS:365) * 86_400_000).toISOString();
    if (!validDate(start) || !validDate(end) || Date.parse(start) >= Date.parse(end)) {
      return json({ error: "Provide valid start and end dates; start must precede end." }, 400, origin, env);
    }
    if (Date.parse(end) - Date.parse(start) > 10 * 366 * 86_400_000) {
      return json({ error: "Date range is limited to ten years per request." }, 400, origin, env);
    }

    const limitRaw = Number(url.searchParams.get("limit") || (timeframe==="1Day"?10_000:1_000));
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

    // Preserve explicit paging when the caller supplies limit/page_token.
    // For the default 5-year daily request, fetch all pages automatically.
    const aggregateDaily=timeframe==="1Day"&&!url.searchParams.has("limit")&&!pageToken;
    const bars=[];
    let nextToken=null,pages=0;
    do{
      let upstream;
      try{
        if(nextToken)upstreamUrl.searchParams.set("page_token",nextToken);
        upstream=await fetch(upstreamUrl,{headers:{
          "APCA-API-KEY-ID":env.ALPACA_API_KEY,
          "APCA-API-SECRET-KEY":env.ALPACA_API_SECRET,
          "Accept":"application/json"
        }});
      }catch{
        return json({error:"Could not reach Alpaca market data."},502,origin,env);
      }
      const payload=await upstream.json().catch(()=>null);
      if(!upstream.ok){
        const detail=typeof payload?.message==="string"?payload.message:"Alpaca rejected the request.";
        return json({error:"Alpaca market-data request failed.",detail,
          upstream_status:upstream.status},upstream.status===429?429:502,origin,env);
      }
      if(Array.isArray(payload?.bars))bars.push(...payload.bars);
      nextToken=payload?.next_page_token||null;
      pages++;
      if(aggregateDaily&&nextToken&&pages>=20)
        return json({error:"Daily Alpaca pagination exceeded 20 pages; refusing incomplete history."},502,origin,env);
    }while(aggregateDaily&&nextToken);
    return json({
      source:"alpaca",
      symbol,
      timeframe,
      feed,
      lookback_days:timeframe==="1Day"&&!url.searchParams.has("start")?ALPACA_SCAN_LOOKBACK_DAYS:null,
      bars,
      pages,
      next_page_token:aggregateDaily?null:nextToken
    },200,origin,env);
  }
};
