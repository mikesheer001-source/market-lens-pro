# Alpaca U.S. equity directory

The Worker exposes a discovery-only endpoint:

- GET /api/stocks/universe returns the complete symbol directory from Alpaca Trading API /v2/assets?status=active&asset_class=us_equity.
- Assets are retained only when class is us_equity, status is active, and tradable is true.
- Symbols are validated, de-duplicated, and sorted. There is no exchange allowlist; every exchange returned by Alpaca is eligible.
- The response includes count/requested, symbols, exchanges, a SHA-256 directory id, refreshedAt, and whether the result was an edge-cache hit.
- The Cloudflare Cache API stores the directory for 24 hours. It refreshes automatically after expiry; GET /api/stocks/universe?refresh=1 forces a live refresh and replaces the cached directory.
- The Worker tries the configured ALPACA_TRADING_API_BASE when present; otherwise it tries paper trading and falls back to live trading only after an authorization failure.
- Alpaca's us_equity asset class is the combined stock/ETF directory; the asset endpoint does not provide a dependable separate stock-versus-ETF type field. The reported count is therefore the combined active, tradable U.S. equity count.

This endpoint performs directory discovery only. It does not request historical bars or alter the existing screener, backtester, leaderboard, Fit, signals, 50/50 median data, or probability forecast layers. Edge cache storage is best-effort: if Cloudflare evicts an entry, the next request retrieves a fresh directory from Alpaca.
