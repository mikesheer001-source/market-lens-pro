# Enable Alpaca market data (secure backend)

Market Lens Pro is a static GitHub Pages site. **Never put Alpaca keys in src/, index.html, a Vite VITE_* variable, browser storage, or a committed .env file.** The browser calls a Cloudflare Worker; only the Worker holds the Alpaca credentials.

This connection is read-only: it retrieves stock bars and does not place trades.

## What you need

1. An Alpaca account with a Market Data API key ID and secret key.
2. A Cloudflare account with the Workers workers.dev hostname enabled.
3. Permission to add GitHub repository Actions secrets and run workflows.

The default feed is IEX. Alpaca Basic market data is IEX-only for real-time equities. SIP is consolidated US exchange data and requires the appropriate Alpaca subscription. Live mode scans exactly 133 curated symbols: 105 liquid US equities, 18 broad-market ETFs, and 10 live volatility tickers. This is not a full S&P 500 constituent list. The volatility filter list has 11 entries, including the synthetic DEMO-VXX proxy used only in Demo mode. Demo mode contains exactly 4 synthetic symbols. The Worker requests 550 calendar days of daily bars in batches of 15 symbols (9 batches for the current 133-symbol universe), paginates when needed, and caches the completed scan at Cloudflare's edge for 15 minutes. It uses REST; it does not open a WebSocket or stream every tick.

## 1. Create the Cloudflare deployment credentials

1. Sign in to Cloudflare and open **Manage Account → API Tokens**.
2. Create a token from the **Edit Cloudflare Workers** template. Scope it to the Cloudflare account where this Worker will live. Do not use the Global API Key.
3. Copy the API token once.
4. Find the Cloudflare **Account ID** in the account overview.
5. In **Workers & Pages**, enable the workers.dev subdomain if Cloudflare asks.

The token is used by GitHub Actions only to publish the Worker. The app never receives it.

## 2. Get the Alpaca market-data key pair

In the Alpaca dashboard, create or view an API key ID and secret key under API Keys. The Worker uses the Trading API key-pair headers:

- APCA-API-KEY-ID
- APCA-API-SECRET-KEY

You do not need to give the browser either value. Do not use Broker API client-credentials in this integration.

## 3. Add four GitHub repository secrets

Open this repository:

**Settings → Secrets and variables → Actions → New repository secret**

Create these exact secret names:

| Secret name | Value |
|---|---|
| CLOUDFLARE_API_TOKEN | The Cloudflare API token from step 1 |
| CLOUDFLARE_ACCOUNT_ID | The Cloudflare account ID from step 1 |
| ALPACA_API_KEY | Alpaca API key ID from step 2 |
| ALPACA_API_SECRET | Alpaca secret key from step 2 |

Paste values only into GitHub's secret-value fields. Do not add them to repository files, GitHub Variables, a public issue, or ChatGPT.

## 4. Deploy the Worker

1. Open the repository's **Actions** tab.
2. Select **Deploy Alpaca data worker**.
3. Choose **Run workflow** on the main branch.
4. Wait for the job to complete successfully.

The workflow checks that all four secrets exist, uploads the Alpaca pair as encrypted Cloudflare Worker secrets using Wrangler, and deploys worker/index.js.

If it reports a missing secret, add the exact missing name above and rerun it. The workflow is manual so it will not repeatedly fail before credentials are configured.

## 5. Connect the website

1. In Cloudflare **Workers & Pages**, open market-lens-pro-api.
2. Copy its workers.dev URL. It will look like https://market-lens-pro-api.<your-workers-subdomain>.workers.dev.
3. Open Market Lens Pro, then **Data Center**.
4. The production website pre-populates the public URL **https://market-lens-pro-api.mikesheer001.workers.dev**. You can replace it if you run a different Worker. The URL is not a secret.
5. Click **Test backend** to confirm the Worker and its encrypted Alpaca secrets are ready.
6. Click **Scan live universe & switch to Live**, or use the top-bar **Live** switch. The app fetches the bundled universe and displays the symbols with returned bars.
7. Use **Refresh live scan** in the Screener to refresh the universe. Repeated scans within 15 minutes are served from the Worker cache rather than sending another batch of Alpaca requests.
8. Use the **VXX / Volatility** screener preset to restrict results to 11 entries: the 10 live tickers VXX, UVXY, SVXY, VIXY, VIXM, VXZ, SVIX, UVIX, SVOL and ZVOL, plus the synthetic DEMO-VXX proxy in Demo mode. It applies daily RSI below 60, 252-session drawdown below -5%, and price below daily EMA200. Demo mode scans 4 synthetic symbols; with the Oversold preset it returns one match, DEMO-COIN.

The Worker health endpoint reports only whether credentials are configured and which feed is selected; it never returns the keys. The browser sends requests to the Worker, not directly to Alpaca.

## What is deployed

- worker/index.js: Alpaca market-data proxy with single-symbol history and /api/stocks/scan. The scan endpoint requests 15-symbol batches, follows pagination, caches results for 15 minutes, restricts browser origins, and uses a basic per-isolate request throttle. Single-symbol history requests remain capped at 10,000 bars.
- wrangler.toml: non-secret Worker name, default IEX feed, and allowed browser origins.
- .github/workflows/deploy-worker.yml: manual deployment using GitHub Secrets and Cloudflare Wrangler.
- ALPACA_API_KEY and ALPACA_API_SECRET: encrypted Worker secrets after deployment.

The production Cloudflare Worker **was redeployed successfully on November 16, 2026** at https://market-lens-pro-api.mikesheer001.workers.dev. The GitHub Actions post-deployment smoke test confirmed 133/133 real Alpaca symbols including SVOL and an actual dated VXX daily close. For a different Cloudflare account, the Worker still requires the four GitHub secrets and the manual workflow. The GitHub Pages front end can be deployed and used in Demo mode without any of those credentials. Demo scanning uses exactly four deterministic synthetic sample symbols. With the Oversold preset it currently returns one match, DEMO-COIN. The VXX preset can return a match for DEMO-VXX, but that is a simulated test case, not a real market quote.

## Options Builder owner quotes

The public calculator accepts manual premiums. Open the Options Builder quote link on any device. The same link enables quotes automatically and the browser remembers access on later visits. If site data is cleared, reopen the same link. Anyone with the link can use it. Alpaca credentials stay on the Worker.

Select **Real-time OPRA** to check the account's OPRA entitlement, or **Indicative** for the modified-quote feed. The Worker deployment's **Alpaca options entitlement** summary reports whether the configured key returned SPY quotes for each feed and omits prices and credentials. For SPX and XSP, enter the underlying index reference price separately and use listed contracts to verify settlement. The public app uses the production Worker. A local dev server can use a local Worker via Data Center.

Public quote distribution requires the relevant market data permissions.


## Server-side screener and in-app notifications

- The Worker runs a scheduled scan at **23:00 UTC Monday–Friday**, after the U.S. cash-market close. It also exposes an on-demand **Run server scan** button in the Screener.
- The background scan evaluates the current Screener rules against the bundled **133-symbol Live universe** (or the 10 live volatility symbols when the Volatility filter is selected). It uses five years of daily bars from the configured Alpaca feed, in batches of 15 symbols.
- Server scans support daily, weekly, and monthly rules. Two-hour rules continue to work in the client-side screener but are rejected by the background scan rather than silently evaluated with missing data.
- The last Screener rules, universe filter, and feed are stored as the site's shared server-scan profile. This is consistent with the existing public shared workspace: the profile and its notifications are shared by visitors, and the most recent settings update becomes the scheduled profile.
- A notification is created only when a symbol newly enters the match set; persistent matches do not generate a new alert on every run. The last 50 notifications and their read/dismiss state are stored in a Cloudflare SQLite Durable Object. The browser polls the Worker while open and displays unread notifications in the existing in-app alert area.
- Notifications are in-app only. **No email, SMS, or new external notification service is used.** The scan is read-only and never places trades.
- A scan makes nine initial Alpaca requests for the 133-symbol universe and can make up to nine additional requests to retry stale symbols. The 15-symbol batches and one stale-bar retry are bounded; Alpaca HTTP 429 responses are surfaced as rate limits. The production Alpaca subscription and Cloudflare account quotas remain account-dependent.
- The scan-notifications-v1 Durable Object migration and Cron trigger are applied by the existing Worker deployment workflow. No extra credentials are required beyond the existing Alpaca and Cloudflare deployment secrets.
