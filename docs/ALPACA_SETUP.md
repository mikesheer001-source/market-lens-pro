# Enable Alpaca market data (secure backend)

Market Lens Pro is a static GitHub Pages site. **Never put Alpaca keys in src/, index.html, a Vite VITE_* variable, browser storage, or a committed .env file.** The browser calls a Cloudflare Worker; only the Worker holds the Alpaca credentials.

This connection is read-only: it retrieves stock bars and does not place trades.

## What you need

1. An Alpaca account with a Market Data API key ID and secret key.
2. A Cloudflare account with the Workers workers.dev hostname enabled.
3. Permission to add GitHub repository Actions secrets and run workflows.

The default feed is IEX. Alpaca Basic market data is IEX-only for real-time equities. SIP is consolidated US exchange data and requires the appropriate Alpaca subscription. This app currently requests daily bars over REST when you select Live; it does not open a WebSocket or stream every tick.

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
4. Paste that public Worker URL into **Cloudflare Worker API URL**. This URL is not a secret.
5. Enter a ticker such as SPY, click **Test backend**, then **Fetch live bars & switch to Live**.
6. The top-bar **Demo / Live** switch changes the data source. Selecting Live again refreshes the selected ticker's daily bars.

The Worker health endpoint reports only whether credentials are configured and which feed is selected; it never returns the keys. The browser sends requests to the Worker, not directly to Alpaca.

## What is deployed

- worker/index.js: fixed Alpaca market-data proxy. It validates ticker/timeframe/date inputs, limits each request to one symbol and at most 10,000 bars, restricts browser origins, and uses a basic per-isolate request throttle.
- wrangler.toml: non-secret Worker name, default IEX feed, and allowed browser origins.
- .github/workflows/deploy-worker.yml: manual deployment using GitHub Secrets and Cloudflare Wrangler.
- ALPACA_API_KEY and ALPACA_API_SECRET: encrypted Worker secrets after deployment.

The Cloudflare Worker is **not deployed until the four GitHub secrets are added and the workflow is run**. The GitHub Pages front end can be deployed and used in Demo mode without any of those credentials.
