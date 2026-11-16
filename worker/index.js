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

    if (url.pathname !== "/api/stocks/bars") {
      return json({ error: "Not found." }, 404, origin, env);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (overRateLimit(ip)) {
      return json({ error: "Rate limit reached. Wait one minute and retry." }, 429, origin, env, { "Retry-After": "60" });
    }

    if (!env.ALPACA_API_KEY || !env.ALPACA_API_SECRET) {
      return json({ error: "Alpaca credentials are not configured on the Worker." }, 503, origin, env);
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
