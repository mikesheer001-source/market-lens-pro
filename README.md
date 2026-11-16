# Market Lens Pro

Independent screener, interactive TradingView Lightweight Charts interface, and long/short historical backtester. The original market-lens repository is separate and is not modified by this project.

## Data modes

- **Demo:** clearly labeled simulated sample data and locally imported CSV data.
- **Live:** daily Alpaca stock bars fetched on demand through a Cloudflare Worker. The Worker keeps Alpaca credentials server-side. The browser only stores the public Worker URL and selected ticker.
- **CSV:** imported OHLCV remains in the browser's IndexedDB.

The screener's **RSI 5D** column is a five-period RSI calculated from daily closes. Daily OHLC cannot be expanded into genuine two-hour bars. A 2H filter still requires timestamped intraday data.

## Live Alpaca setup

Follow docs/ALPACA_SETUP.md. It lists the four GitHub Secrets, Cloudflare token permissions, the manual Worker deployment workflow, and the steps to connect the resulting workers.dev URL in Data Center.

The default Alpaca feed is IEX. SIP access requires an eligible Alpaca subscription. The current Live toggle fetches daily bars over REST on demand; it is not a real-time WebSocket stream.

## Development

    npm install
    npm test
    npm run build
    npm run test:e2e

The Worker can be tested locally with Wrangler (npx wrangler dev). For local secrets, create a .dev.vars file in the repository root with ALPACA_API_KEY and ALPACA_API_SECRET; .dev.vars is git-ignored. Never commit that file.

## Deployment

- GitHub Pages frontend: https://mikesheer001-source.github.io/market-lens-pro/
- Pages deploys from .github/workflows/pages.yml.
- Cloudflare Worker deploy is a separate manual workflow: .github/workflows/deploy-worker.yml.

Nothing here submits live orders.
