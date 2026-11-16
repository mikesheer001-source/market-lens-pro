# Market Lens Pro

Independent screener, interactive TradingView Lightweight Charts interface, and long/short historical backtester. The original market-lens repository is separate and is not modified by this project.

## Data modes

- **Demo:** four clearly labeled synthetic sample symbols plus locally imported CSV data. Demo scans exercise the same indicator and filter logic but are not real market quotes.
- **Live:** a bundled universe of 100+ liquid US stocks, market ETFs, and volatility products fetched through a Cloudflare Worker from Alpaca. The Worker keeps Alpaca credentials server-side.
- **CSV:** imported OHLCV remains in the browser's IndexedDB.

Live scans request 550 calendar days of daily bars in 15-symbol batches, follow Alpaca pagination, and cache the complete result at Cloudflare's edge for 15 minutes. The default feed is IEX; consolidated SIP access requires an eligible Alpaca subscription. This is a REST snapshot, not a streaming WebSocket.

The VXX / Volatility preset restricts the screener to VXX, UVXY, SVXY, VIXY, VIXM, VXZ, SVIX, UVIX, ZIVB and ZVOL. It checks daily RSI below 60, 252-session drawdown below -5%, and price below daily EMA200. Demo mode uses synthetic DEMO-VXX so the rules can be tested without credentials.

The screener's **RSI 5D** column is a five-period RSI calculated from daily closes. Daily OHLC cannot be expanded into genuine two-hour bars. A 2H filter still requires timestamped intraday data.

## Live Alpaca setup

Follow docs/ALPACA_SETUP.md. It lists the four GitHub Secrets, Cloudflare token permissions, the manual Worker deployment workflow, and the steps to connect the resulting workers.dev URL in Data Center.

## Development

    npm install
    npm test
    npm run build
    npm run test:e2e

The Worker can be tested locally with Wrangler (npx wrangler dev). For local secrets, create a .dev.vars file in the repository root with ALPACA_API_KEY and ALPACA_API_SECRET; .dev.vars is git-ignored. Never commit that file.

## Deployment

- GitHub Pages frontend: https://mikesheer001-source.github.io/market-lens-pro/
- Pages builds run unit tests, the local Playwright suite, and a second Playwright smoke test against the published URL after deployment.
- Pages deploys from .github/workflows/pages.yml.
- Cloudflare Worker deploy is a separate manual workflow: .github/workflows/deploy-worker.yml.

Nothing here submits live orders.
