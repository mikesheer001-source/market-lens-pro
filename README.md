# Market Lens Pro

Independent screener, interactive TradingView Lightweight Charts interface, and long/short historical backtester. The original market-lens repository is separate and is not modified by this project.

## Data modes

- **Demo:** exactly 4 clearly labeled synthetic sample symbols plus locally imported CSV data. Demo scans exercise the same indicator and filter logic but are not real market quotes.
- **Live:** exactly 133 curated symbols fetched through a Cloudflare Worker from Alpaca: 105 liquid US equities, 18 broad-market ETFs, and 10 live volatility tickers. This is not a full S&P 500 constituent list. The Worker keeps Alpaca credentials server-side.
- **CSV:** imported OHLCV remains in the browser's IndexedDB.

Live scans request 550 calendar days of daily bars in 15-symbol batches, follow Alpaca pagination, and cache the complete result at Cloudflare's edge for 15 minutes. With this lookback, a 200-week EMA cannot be calculated; the Screener column now explicitly shows **% vs D EMA200**, a genuine 200-daily-close EMA that agrees with the volatility preset rule. Weekly EMA200 conditions remain available but correctly report insufficient history when selected. The default feed is IEX; consolidated SIP access requires an eligible Alpaca subscription. This is a REST snapshot, not a streaming WebSocket.

The VXX / Volatility preset has 11 entries: 10 live tickers (VXX, UVXY, SVXY, VIXY, VIXM, VXZ, SVIX, UVIX, SVOL and ZVOL) plus the synthetic DEMO-VXX proxy. It checks daily RSI below 60, 252-session drawdown below -5%, and price below daily EMA200. Demo mode scans 4 synthetic symbols; with the Oversold preset, the deterministic demo scan returns 1 match: DEMO-COIN. With VXX / Volatility selected, the Demo proxy DEMO-VXX is the volatility match.

The screener's **RSI 5D** column is a five-period RSI calculated from daily closes. Daily OHLC cannot be expanded into genuine two-hour bars. A 2H filter still requires timestamped intraday data.

## Script Lab: browser-only Pine Script v5 subset

Open **Script Lab** to edit, check, and run custom Pine scripts. Scripts and inputs can be saved, loaded, renamed and deleted in your browser's `localStorage`. No source code is transmitted to a server. The editor runs through `src/pine.js`, a bounded parser/interpreter without JavaScript `eval` or dynamic code execution.

**Supported syntax:** `//@version=5`, `indicator()`, `strategy()`, variables, `var`, `:=`, numeric/boolean/series arithmetic, history indexing such as `close[5]`, `if` / `else` with spaces, `plot()`, `plotshape()`, `input.int()`, `input.float()`, `input.bool()`, `ta.ema`, `ta.sma`, `ta.rsi`, `ta.macd`, `ta.stoch`, `ta.atr`, `ta.bb`, `ta.cross`, `ta.crossover`, `ta.crossunder`, `ta.highest`, `ta.lowest`, `ta.change`, and `strategy.entry/exit/close` with `when=` and optional exit `stop=`/`limit=`. MACD and Bollinger Bands support tuple assignments. Indicator plots use the existing chart library, with a separate pane for `overlay=false`. Up to four custom indicators can be applied at once.

**Deliberate limitations:** This is **not a full TradingView Pine Script runtime**. Arbitrary Pine user-defined functions, libraries, arrays, loops, `request.security`, trading alerts, intrabar strategy recalculation, and every TradingView order/pyramiding mode are not implemented. Unsupported syntax raises a line-numbered error. The engine is single-position and follows its existing next-open fills, slippage/fee/borrow-cost, stop-first execution and backtest controls. Script `strategy.exit` stop/limit levels execute on the next bar through that same engine; a `strategy.exit` without a stop/limit is treated as a market exit in this subset.

**Examples:** EMA crossover, RSI mean reversion, price-lower-low/RSI-higher-low **regular bullish divergence**, price-higher-low/RSI-lower-low **true hidden bullish divergence with daily EMA200 trend filter**, Bollinger mean reversion, RSI oscillator and MACD. The requested lower-price-low/higher-RSI-low condition is *regular bullish divergence* in standard technical-analysis terminology, despite the original “hidden RSI divergence” label. The pivot example confirms the lowest price using only already-observed candles and enters on the following bar.

**Parameter sweeps:** The first two `input.int()` or `input.float()` values produce up to nine parameter variants. The existing 70% training / 30% chronological holdout split and backtest-cost assumptions are reused; rankings based on holdout data can still overfit.

**Live VXX quote:** In Live mode, the Screener highlights the actual VXX daily close and date returned by the connected Alpaca Worker (or explicitly says VXX was unavailable). It is a daily closing bar, **not a streaming last-trade quote**. Demo mode clearly labels its synthetic price.

## Local research workspace

- **Named watchlists:** create, rename and delete lists. The Screener star adds or removes a symbol from the selected list; lists survive reloads in localStorage.
- **Saved scans:** enter a name and save the current filter rules plus the currently displayed rows. Loading one restores its rules and a clearly dated **historical snapshot**, never a fake live quote.
- **Screener CSV:** exports only the currently filtered rows, including daily EMA200 percentage, RSI values and match flags.
- **In-app alerts:** configure a symbol's daily close or daily RSI(14) above/below a threshold. Alerts check when you scan or refresh and remain in browser localStorage until dismissed. No push, email or background monitoring.
- **Backtest persistence:** last results and sweep values survive tab changes and page reloads. The result is labeled by original symbol and timeframe; historical market-data sources are not automatically restored.
- **Full symbol access:** Chart Lab, Backtest and Script Lab symbol selectors include all loaded symbols for the current Demo/Live mode, with a symbol search. Screener volatility filtering does not restrict their selectors.

The inactive historical **ZIVB** ticker was replaced with the independently traded **SVOL** ETF; **ZVOL** already represents the corresponding mid-term inverse VIX product. Counts remain exactly 105 equities, 18 ETFs and 10 volatility tickers (133 total). The true live test checks for 133/133 and SVOL.

## Live Alpaca setup

Production Worker: https://market-lens-pro-api.mikesheer001.workers.dev. This public URL is the website's default API endpoint; the Alpaca key pair remains encrypted on Cloudflare, never in browser code. Follow docs/ALPACA_SETUP.md to maintain or redeploy the Worker.

## Development

    npm install
    npm test
    npm run build
    npm run test:e2e

The Worker can be tested locally with Wrangler (npx wrangler dev). For local secrets, create a .dev.vars file in the repository root with ALPACA_API_KEY and ALPACA_API_SECRET; .dev.vars is git-ignored. Never commit that file.

## Deployment

- GitHub Pages frontend: https://mikesheer001-source.github.io/market-lens-pro/
- Pages builds run unit tests, the local Playwright suite, published-site browser tests, and an explicitly **non-mocked** real Alpaca Worker 133-symbol/VXX smoke test after deployment.
- Pages deploys from .github/workflows/pages.yml.
- Cloudflare Worker deploy is a separate manual workflow: .github/workflows/deploy-worker.yml.

Nothing here submits live orders.
