# Market Lens Pro

Independent screener, interactive TradingView Lightweight Charts interface, and long/short historical backtester. The original market-lens repository is separate and is not modified by this project.

## Data modes

- **Demo:** exactly 4 clearly labeled synthetic sample symbols plus locally imported CSV data. Demo scans exercise the same indicator and filter logic but are not real market quotes.
- **Live:** exactly 133 curated symbols fetched through a Cloudflare Worker from Alpaca: 105 liquid US equities, 18 broad-market ETFs, and 10 live volatility tickers. This is not a full S&P 500 constituent list. The Worker keeps Alpaca credentials server-side.
- **CSV:** imported OHLCV remains in the browser's IndexedDB.

Live scans request 550 calendar days of daily bars in 15-symbol batches, follow Alpaca pagination, and cache the complete result at Cloudflare's edge for 15 minutes. With this lookback, a 200-week EMA cannot be calculated; the Screener column now explicitly shows **% vs D EMA200**, a genuine 200-daily-close EMA that agrees with the volatility preset rule. Weekly EMA200 conditions remain available but correctly report insufficient history when selected. The default feed is IEX; consolidated SIP access requires an eligible Alpaca subscription. This is a REST snapshot, not a streaming WebSocket.

The VXX / Volatility preset has 11 entries: 10 live tickers (VXX, UVXY, SVXY, VIXY, VIXM, VXZ, SVIX, UVIX, SVOL and ZVOL) plus the synthetic DEMO-VXX proxy. It checks daily RSI below 60, 252-session drawdown below -5%, and price below daily EMA200. Demo mode scans 4 synthetic symbols; with the Oversold preset, the deterministic demo scan returns 1 match: DEMO-COIN. With VXX / Volatility selected, the Demo proxy DEMO-VXX is the volatility match.

The screener's **RSI 5D** column is a five-period RSI calculated from daily closes. Daily OHLC cannot be expanded into genuine two-hour bars. A 2H filter still requires timestamped intraday data.

## Round 10: source-labeled strategy signals and latest-bar freshness

**Screener strategy signals:** Select one of the original five built-in strategies or any **saved strategy() Pine script**. Each loaded symbol's current position is calculated from its own daily OHLCV using the **same backtest order engine** and configured entry, stop/target, commissions and slippage, with long-only positioning. **LONG** means a long position remains open after the latest available bar; **EXIT** means the long closed on that bar or an exit condition at that bar's close is pending execution at next open; **FLAT** means no position. The forced liquidation used only to value a backtest at its final observation **never** counts as EXIT. The column displays the selected strategy name and the date of the source bar, plus the source in its tooltip. The Signal sort and **Signals only (LONG)** filter work alongside existing Screener filters and CSV export. Unavailable/invalid Pine strategies are not silently reported as FLAT.

**Signal flip notifications:** On each manual **Scan/Refresh**, the app compares the selected strategy's per-symbol position with its prior state for the **same mode and strategy version**. LONG↔FLAT transitions produce the existing in-app alerts (EXIT is the flat/closing state), including both states, selected strategy, ticker, observation date and data source. First comparisons establish a baseline without generating false alerts. Alerts and previous states are stored in browser localStorage only—**no background server, push notifications, live orders, or email**. Switching strategies does not trigger alerts.

**Freshness:** The Screener's **Latest bar** column displays the actual most recent daily date per ticker. In Live mode, the green/amber strip compares every symbol (including missing ones) to the most recent NYSE trading session, using a New York local calendar with exchange weekends and recurring US equity holidays. Green means all 133 latest bars are dated at least as recently as that session; amber lists **each** outdated/missing symbol and its actual date. During a trading day, Alpaca's latest 1Day candle may be unfinished; this is clearly disclosed and is not represented as a finalized closing price.

**Worker retry:** Before returning a fresh full-universe scan, the Worker finds any missing or outdated symbols and makes **one extra latest-week bar request per stale ticker, batched up to 15 tickers per HTTP call** using the same configured Alpaca data feed. It merges recovered price bars without duplicate timestamps, logs which symbols were retried and which remained stale, and returns `freshness` and `retry` metadata. The 15-minute edge-cache key includes the expected NYSE date and this revision to avoid stale cache entries spanning sessions. If VXZ (or another ticker) still lacks a bar, the app shows amber **rather than inventing a quote**. The existing 133-symbol universe and the 15-symbol batch size are unchanged.

## Round 9: strategy leaderboard

In **Backtest (Single symbol)** choose **Compare all strategies**. This runs all five built-in strategy rules and **each strategy-type script saved in Script Lab** against the same currently selected symbol/timeframe, using the same initial equity, allocation, long/short choice, commission, slippage and stop/target controls. Indicator-only scripts and scripts that cannot execute are identified in a skipped-scripts message, rather than silently omitted.

- The table reports strategy name, total return, CAGR, Sharpe, maximum drawdown, win rate, trade count and profit factor. Default rank is descending finite Sharpe; missing values go last. Every heading is sortable, and the **Best Sharpe** row remains marked after sorting.
- The comparison chart overlays the **top three by Sharpe** on identical axes, plus buy-and-hold calculated from the same original price observations. The legend names every line. **Load best into Backtester** restores its exact strategy settings, Pine code/inputs when applicable, and full recorded equity curve and trades.
- A browser-only per-symbol memory remembers the latest full backtest and ranking. Returning to a symbol or reloading restores the last run. Stored comparisons retain all strategy metrics, full top-three overlay and the best strategy's complete trade list, while discarding duplicated historical curves for other ranks to conserve space. Storage is capped at the **10 most recently used symbols** and approximately **2.9 million JSON characters**; oldest entries are trimmed. If localStorage is disabled or full, the page reports that persistence failed.
- Comparison results show the **source** (Alpaca IEX daily, imported OHLCV, or clearly simulated Demo), symbol, original bar date, timeframe and run timestamp. Stored results are historical research snapshots, not refreshed quotes or verified predictions.
- This is an **in-sample ranking**, not a standalone out-of-sample validation. Inspect the 70/30 parameter sweeps separately before drawing conclusions.

## Round 8: equal-weight multi-symbol research, volatility and real intraday candles

**Portfolio Backtest:** In Backtest choose **Equal-weight portfolio**, then select **all current Screener matches** or a **named watchlist**. The selected universe is fixed at run time. All members are joined on their shared daily trading dates; symbols lacking 40 common bars cause an explicit error rather than made-up performance. Initial capital is divided equally across symbols, and the existing backtest engine executes each symbol independently with its configured slippage, commissions, protective stops, targets, long/short and Pine strategy signals. **There is no periodic rebalancing or shared-margin/capital netting.** Portfolio return, CAGR, Sharpe (252 daily sessions, risk-free rate zero), max drawdown, combined equity against equal-weight buy-and-hold, and per-symbol return/trades/win rate/drawdown are reported with each OHLCV data source. Portfolio results and sweeps save to browser localStorage. The matching screener rules are evaluated on current loaded bars, not stale saved-scan snapshots.

**Portfolio Optimize:** Preset and Pine input variants run on the same selected symbols, with the first 70% of common daily dates used as training and the final 30% used as a chronological holdout. Results are *not* valid out-of-sample evidence after using the holdout to select the winning variant.

**Volatility dashboard:** Shows exactly ten live volatility products: VXX, SVXY, UVXY, SVIX, ZVOL, VIXM, VIXY, VXZ, UVIX and SVOL (the source universe retains the same ten and one Demo proxy). Daily OHLCV drives Close, 20-session total return, realized vol 20D and 60D (annualized sample standard deviation of daily log returns × sqrt(252)), and current close relative to the highest **daily high** in the last 252 sessions. Metrics show missing when insufficient data is available.

**Contango/roll proxies:** The two *price-only* inputs are (1) VXZ 20D return minus VXX 20D return, in percentage points, and (2) the 20D percent change in the SVXY/VXX close-price ratio, aligned on common daily sessions. A "steep contango" price-proxy label requires spread ≥ +5 pp and ratio trend ≥ +10%; "backwardation" price-proxy requires ≤ −5 pp and ≤ −10%; otherwise "flat/mixed". **Neither is an observed VIX futures curve, an actual futures roll yield, or options data.** ETF share prices themselves are not compared as levels.

**Genuine 15m/2H:** In Alpaca Live mode Chart Lab fetches 120 calendar days of real **15Min** OHLCV for the selected live symbol from the Worker endpoint `/api/stocks/intraday?symbol=VXX&feed=iex`. The Worker keeps encrypted Alpaca credentials, follows pagination, applies the selected market-data feed and caches successful results for **five minutes**. The 15-minute chart uses real timestamped bars, and 2H groups these into NYSE 09:30–11:30, 11:30–13:30, 13:30–15:30 and 15:30–16:00 New York time buckets (the final bar is only 30 minutes). Daily/weekly/monthly charts continue to use daily historical data. If Alpaca returns no eligible intraday bars or rejects a feed, the UI states the error and **never constructs intraday bars from daily OHLCV**. The original 133-symbol scanner remains daily; cross-universe 2H screener rules still require timestamped intraday input rather than magically using an on-demand selected-symbol chart.

### Actual backend

- Cloudflare Worker: https://market-lens-pro-api.mikesheer001.workers.dev
- Public frontend: https://mikesheer001-source.github.io/market-lens-pro/
- Real-market (non-mocked) browser tests run from GitHub Actions *after* publishing.
- Alpaca IEX is a real exchange-specific feed, not full US consolidated SIP coverage. No site component places orders.

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
