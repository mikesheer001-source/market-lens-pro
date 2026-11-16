# Market Lens Pro

Independent screener, interactive TradingView Lightweight Charts interface, and long/short historical backtester. The original market-lens repository is separate and is not modified by this project.

## Data modes

- **Demo:** exactly 4 clearly labeled synthetic sample symbols plus locally imported CSV data. Demo scans exercise the same indicator and filter logic but are not real market quotes.
- **Live:** exactly 133 curated symbols fetched through a Cloudflare Worker from Alpaca: 105 liquid US equities, 18 broad-market ETFs, and 10 live volatility tickers. This is not a full S&P 500 constituent list. The Worker keeps Alpaca credentials server-side.
- **CSV:** imported OHLCV remains in the browser's IndexedDB.

Live scans request **1,825 calendar days (approximately five years)** of real daily bars in 15-symbol batches, follow Alpaca pagination (up to 10,000 bars per page), and cache the completed scan at Cloudflare's edge for **15 minutes**. Chart Lab's daily mode uses these longer histories, and the default single-symbol daily-bars endpoint requests five years and follows pages automatically. More than 200 weekly bars should now be present for sufficiently established symbols, enabling the separate **% vs W EMA200** column and weekly EMA200 filter; newer or sparse-history symbols may still show N/A. The original **% vs D EMA200** column remains unchanged. Data Center displays **measured browser scan time** and Worker acquisition time when available because longer scans may take longer. The default feed is IEX; consolidated SIP access requires an eligible Alpaca subscription. This is a REST snapshot, not a streaming WebSocket.

The VXX / Volatility preset has 11 entries: 10 live tickers (VXX, UVXY, SVXY, VIXY, VIXM, VXZ, SVIX, UVIX, SVOL and ZVOL) plus the synthetic DEMO-VXX proxy. It checks daily RSI below 60, 252-session drawdown below -5%, and price below daily EMA200. Demo mode scans 4 synthetic symbols; with the Oversold preset, the deterministic demo scan returns 1 match: DEMO-COIN. With VXX / Volatility selected, the Demo proxy DEMO-VXX is the volatility match.

The screener's **RSI 5D** column is a five-period RSI calculated from daily closes. Daily OHLC cannot be expanded into genuine two-hour bars. A 2H filter still requires timestamped intraday data.

## Round 11: seamless Live sessions, intraday persistence and complete Pine example comparison

**Auto-fetch:** Backtest, Compare all strategies, and Optimize automatically load genuine Alpaca **15Min** bars for a selected Live 15m/2H ticker if missing or out of date. The Backtester displays **Fetching Alpaca 15-minute bars…** while waiting and a visible error if the feed fails or supplies fewer than the minimum required observations. No click silently does nothing, and daily candles are never converted to invented intraday candles. Chart Lab continues to fetch as needed.

**Persistent bars:** A separate **IndexedDB** `intraday` object store saves the actual normalized Alpaca 15m OHLCV, symbol, feed and fetch time. The original imported `symbols` store is preserved during the schema upgrade. A saved cache entry is reused when its newest bar belongs to the expected latest **New York stock-trading session** and it was fetched within five minutes; otherwise the application requests fresh market data from the existing Worker. Cache and requests are segregated by symbol and IEX/SIP feed. If the browser blocks storage, the session still works and reports the persistence limitation.

**Restore Live/Demo and ticker:** Browser settings retain the selected mode, tab, last selected ticker, separately remembered Live/Demo tickers, and the Backtester ticker. On reopening a Live session, the site **retrieves real Alpaca daily data again before reporting Live mode**; it does not label simulated Demo bars as real. The relevant per-symbol saved analysis and leaderboard are restored once that symbol is available. If Alpaca is unavailable, the page reports the failed Live restore rather than silently substituting live quotes.

**Readable dates:** Leaderboard source/date banners display **YYYY-MM-DD** for either UTC/ISO daily dates or Unix-second intraday bars, rather than raw epoch numbers. The source and calculation timestamp remain visible.

**Built-in strategy examples:** The leaderboard now includes all **seven** bundled Pine scripts, labeled **built-in example**, in addition to all five preset strategies and any user-saved Pine strategies. Five are trading strategies and receive properly backtested ranking metrics; the two indicator-only scripts (RSI and MACD) appear explicitly as **Indicator · N/A**, without invented trades or Sharpe values. The top-three equity overlay and "Load best" use only executable strategies.

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


## Round 12 — universe-wide strategy fit and stale ticker investigation

- **Fit across universe** runs any preset or active Pine `strategy()` on the original 133-symbol curated Alpaca universe (105 equities, 18 ETFs, 10 volatility instruments), with the **same** daily-bar strategy settings, starting capital, commission, slippage, and stop/target assumptions. Sort all 133 rows by Sharpe (default) or any column, inspect per-symbol source and last bar, or load the top Sharpe symbol into a full backtest. Unavailable symbols remain visible, not treated as zero-return positions. These are **in-sample rankings, not proof of future results**. History lengths may vary.
- **MMC → MRSH:** Marsh changed the NYSE symbol effective January 14, 2026 ([issuer notice](https://www.marsh.com/en/corp/about/news/marsh-mclennan-to-change-nyse-symbol-to-mrsh.html)). The legacy MMC data ending January 13 is not current trading data, so the universe entry is now MRSH. The 133-symbol count is unchanged; prior MMC daily bars are neither relabeled nor invented.
- **VXZ:** iPath Series B VXZ remains Cboe-listed. The Nov. 13, 2026 daily bar is expected before Monday Nov. 16 is finished, so the site waits until **16:30 ET** to expect a new daily candle. The Worker already retries genuinely stale daily bars; it now queries the per-symbol Alpaca asset endpoint for inactive/missing/tradable status and supplies an explicit no-new-bars reason. A read-only `GET /api/stocks/diagnostics?symbols=MMC,MRSH,VXZ` endpoint performs bounded asset and latest-bar checks (maximum five symbols). Failed asset API authorization remains **unknown**, never mislabeled as a delisting.
- The Pages workflow runs `npm test`, `npm run build`, local Playwright, and then deployed-site Playwright. The Worker workflow deploys on backend/universe/freshness changes when Cloudflare repository secrets are configured.


## Round 13 — Daily Briefing (browser-only history)

- **Briefing** tab consolidates the completed real Alpaca daily-bar scan, matching symbols (daily close and RSI 5D), current selected strategy LONG positions, flips since the preceding comparable scan, existing **price-based contango proxy** (not VIX futures contango), VXX daily close and 20-session return, active/unread alerts, and stale/missing-bar explanations. Every block labels its source and actual bar date; no synthetic or filled market prices are used.
- Choose a strategy in Briefing (shared with Screener), then **Generate / refresh briefing** to fetch current live Alpaca data. A previous scan baseline is required for verified flips, and a missing/unselected strategy explicitly says not evaluated. Opening Briefing after a completed live scan also saves a fresh snapshot from that scan. **Copy briefing as text** copies a plain-text, date-stamped summary to the browser clipboard.
- History keeps the most recent saved snapshot **per New York calendar date** for the last **7 calendar days**, locally in `market-lens-pro-briefing-history-v1` (localStorage). Compare match counts and LONG counts with prior saved entries. Historical records never masquerade as fresh quotes and remain on the same device/browser unless manually exported; no server-side storage or recurring background task.
- This tab does not change the curated universe: **133 symbols = 105 equities (including MRSH), 18 ETFs, 10 volatility tickers**. Script Lab, portfolio, intraday caching, Worker's one-time stale retry, and earlier features remain unchanged. 


## Round 14 — modal latest-bar freshness and reason visibility

- The Worker and browser now compute the **most common actual last daily-bar date** across the 133 ticker scan results as the reference session, with the **newer date breaking ties**. The NYSE clock date is a fallback **only if no bars exist**. For example 132 tickers dated 2026-11-16 and one dated 2026-11-13 results in **132/133 current**, reference 2026-11-16, rather than a false 133/133.
- The Worker retries every symbol lagging that reference once. A **confirmed empty/newer-bar-free Alpaca retry** generates `Alpaca returns no bars after Nov 13, 2026 (2026-11-13) on this feed`, where the date is derived from the symbol's actual latest returned bar. If the retry fails or diagnostic is missing, the UI explicitly indicates that uncertainty instead of claiming a successful Alpaca check. Old Worker scan cache is invalidated by the new revision.
- The **same confirmed stale reason** appears next to the symbol's bar date in the Screener row, in the new Data Center freshness section, in the Chart Lab header when opened for that symbol, and in the Volatility metrics row. Daily Briefing remains connected to the same corrected freshness/diagnostics. No ticker is hardcoded.


## Round 15 — best-fit portfolio and Backtest date ranges

- The Backtest mode picker offers **Single symbol**, **Equal-weight portfolio** (one shared strategy), and **Best-fit portfolio** (different best-Sharpe strategy per symbol).
- In Best-fit, select **current Screener matches** or a **named watchlist**. Each eligible ticker is aligned to a shared daily calendar with the other selected tickers. The existing single-symbol leaderboard evaluates five presets plus executable saved Pine and built-in Pine examples with identical fees/slippage/stops. The highest **finite** in-sample Sharpe is selected separately for each symbol. An unrankable ticker is explicitly excluded; the included set receives equal initial-dollar allocation. The combined equity, buy-and-hold benchmark, return, CAGR, Sharpe, max drawdown and each ticker's selected strategy, source, actual last bar and individual return are shown and exportable.
- **Important:** best-fit strategies are **selected and evaluated on the same historical dates**. This is research subject to selection bias and overfitting, **not a holdout or an out-of-sample portfolio**. Equity combines independent accounts, with no periodic rebalance, margin netting, or live orders.
- Shared **Start date** and **End date** inputs on Backtest are optional and inclusive. Both blank means full available history. Single-symbol trades only on selected bars; both portfolio modes use only the common dates within the window. An invalid, reversed or empty window is rejected with an on-screen error, and results explicitly label requested and actual date range, source and bar dates. The date choice survives browser reloads. Earlier strategy tools remain available with their existing separate timeframes and comparison behavior.


## Round 16 — honest training / out-of-sample validation

- Strategy leaderboard, Fit across universe, and each best-fit portfolio ticker now show **Train return**, **Train Sharpe**, **OOS return**, **OOS Sharpe** and **Validated** status, in addition to existing full-period analytics. The split is strictly chronological: first **70% of that symbol's available backtest bars are training**, remaining **30% are unseen test**. In portfolios, symbols share aligned daily dates before splitting.
- **Training Sharpe decides rankings and best-fit picks, never the test metrics**. Training and test backtests are evaluated with the same original fills, slippage, stops, and costs, with independent starting capital. Earlier bars are used to warm up test indicators, but no OOS trading outcomes are used to pick strategies. The full-period equity curve and headline performance are preserved and labeled full-period; they should not be mistaken for a holdout curve.
- The **Validated** indicator means *positive finite OOS Sharpe and at least 30 test bars*. It is an informative status only, **not statistical significance** nor proven future profitability. Short test histories display the actual held-out return, hide unassessable Sharpe and explain how many bars were available. Strategies with flat holdout equity can have undefined Sharpe.
- The leaderboard includes a concise **walk-forward summary** counting positive OOS Sharpe candidates and naming the top OOS Sharpe with data source, bar date and holdout period. This is **one chronological holdout split, not a repeated rolling walk-forward optimization**. Do not interpret the top OOS strategy as the strategy chosen in-sample.
- All calculations honor the Round 15 start/end date window. Existing local memory and results remain readable; rerun comparisons saved prior to this round to populate the new holdout columns. Fit and best-fit CSV exports now include training/holdout values, validation and source/date evidence.


## Round 17 — range-aware strategy leaderboard and walk-forward

- When a **Single symbol** leaderboard exists and the Backtest **Start date** or **End date** is edited, the leaderboard is automatically recomputed using **only the selected inclusive window**, with every preset and executable Pine example re-evaluated. No second click on Compare is necessary. The leaderboard's **header and source strip show the selected dates**. The walk-forward summary splits this same window into 70% training and 30% held-out test; source, actual bar date and holdout dates remain visible.
- With **Full range** selected, the original comparison rules, strategy returns, rankings, 70/30 split and equity curves remain unchanged. The **Full range** button restores this automatically. Saved per-symbol leaderboards retain their ranges across page reloads.
- A window shorter than the old 40-bar full-history research gate may still run a **clearly labeled comparison** when it contains at least **5 bars** (minimum 3 training / 2 test), because an October-to-November daily window can be shorter than 40 market sessions. A holdout with fewer than 30 bars is explicitly **not validated**, and its Sharpe is not presented as reliable. Fewer than five bars, reversed dates or dates without bars cause an explanatory warning.
- If prior saved results belong to another timeframe, symbol, source, date range or bar count and cannot be recomputed, **all old ranking figures, equity overlays and walk-forward numbers are hidden** rather than shown under a misleading selected date. A clear warning and Recompute action appear. Restored reports that do match do not recompute unnecessarily.
- Both local and published-site Playwright regressions cover automatic updates, exact full-period and held-out metrics, invalid dates, preservation of Full range, and browser storage reloads. Backend, curated 133-symbol universe, and all prior features are unchanged.


## Round 18 — repeated rolling walk-forward OOS validation

- The **single-symbol Backtester leaderboard** now runs **five** fixed-strategy rolling **70% training / 30% OOS** assessments in addition to (not instead of) its existing original single 70/30 split. Each sliding window spans 40% of the selected date-filtered history and moves ahead by 15% of that history, covering 0–40%, 15–55%, 30–70%, 45–85%, and 60–100% of selected bars. The five **test periods do not overlap**; training periods do overlap. Every window uses only its own past data for indicator warmup, with independent initial capital for the out-of-sample backtest. Strategies and parameters remain fixed; these are repeated validation observations, not per-window parameter optimization.
- Three added, sortable columns sit beside existing **single-split OOS Sharpe**: **Rolling mean OOS Sharpe (5)**, **Rolling median OOS Sharpe (5)**, and **Rolling positive windows (5)** (e.g. `4/5 windows positive`). The summary line names the five date ranges and held-out dates and notes that repeated positive windows are steadier evidence than a single holdout. All five windows are run on the **same selected Backtester date range**, which refreshes automatically when date controls change.
- A window is **assessable only if it has at least 30 genuine held-out bars and a finite OOS Sharpe**. The mean and median exclude unassessable windows, explicitly state their count, and return `—` if none qualify; the positive-count cell shows `0/5 assessable` rather than treating missing data as five losses. Short ranges (e.g. one month) usually cannot support five assessable rolling windows.
- Rankings **still use the original first-70%-training Sharpe only**. The original one-split **Validated** badge, original single OOS return and Sharpe, full-period equity overlay, best-fit/portfolio logic, universe Fit, symbol memory and all prior functionality remain unchanged. Positive results across several historical windows are stronger descriptive evidence, **not proof of future returns or five independent experiments**.
- The rolling pass runs **only for the single-symbol Backtester leaderboard**, not the universe Fit or best-fit portfolio comparisons. Older saved leaderboards recalculate their new columns when opened, preserving the matching date range. Full test coverage includes window construction, exact per-strategy OOS metrics, Pine re-execution, mean/median, missing-bar behavior, browser persistence and deployed-site smoke.

## Round 19 — five years of real daily OHLCV

- **133 curated live symbols**, including MRSH, still use Alpaca IEX by default. The Worker now requests 1,825 calendar days rather than 550 for a market scan, follows page tokens, and retains the 15-minute cache. The independent single-symbol daily endpoint defaults to the same lookback, a 10,000-bar page limit and automatic pagination. Explicit `limit` and `page_token` requests retain their earlier paging behavior.
- **Chart Lab** still shows a loaded daily candle count alongside the chart; use **Show all bars** to view the full range. **Screener** now displays genuine **% vs W EMA200** alongside the previous daily percentage, based on actual weekly OHLCV aggregation. It stays blank for symbols with insufficient history.
- **Data Center** includes the client-measured scan time, the cache hit/miss status and Worker acquisition duration when reported. Longer full-universe scans may be noticeably slower and involve larger transfers. Never fake candles, lower the lookback silently or invent timing measurements.
- **Intraday** stays at the existing **120-day lookback** using genuine IEX 15-minute bars, with the same 5-minute IndexedDB freshness rules. Alpaca's public documentation says historical equity coverage goes back years, but the much larger requested intraday history has not been validated to work reliably within the current Worker pagination/response budgets. This change makes no longer-intraday claim.
- All prior tests, the original one-split OOS/rolling five-window validation, and all 133-symbol universe definitions remain intact. Live integration tests verify a daily chart with more than 378 bars and a populated weekly EMA200 for established symbols.
