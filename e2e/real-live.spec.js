import {test,expect} from '@playwright/test';
import {LIVE_UNIVERSE} from '../src/universe.js';
import {nyIntradaySession} from '../src/intraday-session.js';
import {expectedNyseBarDate} from '../src/freshness.js';

const WORKER='https://market-lens-pro-api.mikesheer001.workers.dev';

// This is an honest live integration test: no request interception, no fake OHLCV.
// It is intentionally disabled for the local simulator and enabled after production deploy.
test('real Alpaca Worker scans entire 133-symbol universe and publishes VXX daily close',async ({page,request})=>{
  test.skip(process.env.REAL_ALPACA_TEST!=='1','Requires REAL_ALPACA_TEST=1, run after publishing GitHub Pages');
  test.setTimeout(300_000);
  const health=await request.get(WORKER+'/api/health',{timeout:30_000});
  expect(health.status(),'Actual Cloudflare health endpoint').toBe(200);
  const healthData=await health.json();
  expect(healthData.ok).toBe(true);
  expect(healthData.configured).toBe(true);
  expect(healthData.provider).toBe('alpaca');
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.goto('./');
  await page.evaluate(url=>localStorage.setItem('market-lens-pro-settings',JSON.stringify({apiBaseUrl:url})),WORKER);
  await page.reload();
  await page.locator('.mode-switch [data-action="mode-live"]').click();
  const status=page.locator('#scan-status');
  await expect(status).toContainText('Live scan complete',{timeout:240_000});
  await expect(status).toContainText('133/133 symbols loaded');
  await expect(page.locator('tr[data-symbol]')).toHaveCount(133);
  await expect(page.locator('tr[data-symbol="SVOL"]')).toHaveCount(1);
  await expect(page.locator('tr[data-symbol="VXX"]')).toHaveCount(1);
  const fact=page.locator('.market-fact');
  await expect(fact).toContainText('ALPACA VXX DAILY CLOSE');
  await expect(fact).toContainText(/Bar date: \d{4}-\d{2}-\d{2}/);
  const actualClose=(await page.locator('tr[data-symbol="VXX"] td').nth(1).innerText()).trim();
  expect(actualClose).toMatch(/\d/);
  await expect(fact).toContainText('$'+actualClose);
  await expect(page.locator('tr[data-symbol="VXX"] td').nth(5)).not.toHaveText('—');
  await expect(page.locator('thead th').nth(5)).toContainText('% vs D EMA200');
  await expect(page.getByRole('columnheader',{name:/% vs W EMA200/})).toBeVisible();
  const spyBars=Number((await page.locator('tr[data-symbol="SPY"] td').nth(8).innerText()).trim());
  expect(spyBars,'Real SPY scan should supply more than the old ~378 daily candles').toBeGreaterThan(378);
  await expect(page.locator('[data-weekly-ema200="SPY"]')).not.toHaveText('—');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await page.locator('[data-option="symbol"]').selectOption('SPY');
  await expect(page.getByText(spyBars+' D bars',{exact:false})).toBeVisible();
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await page.locator('.sidebar [data-tab="data"]').click();
  await expect(page.locator('#scan-duration')).toContainText('Last live scan:');
  await expect(page.locator('#scan-duration')).toContainText('1825-day daily lookback');
  await expect(page.locator('#scan-duration')).toContainText(/measured in this browser/);
  console.info('Round 19 REAL Alpaca SPY daily bars='+spyBars+
    ', W EMA200='+await page.locator('.sidebar [data-tab="screener"]').count()+
    ' (weekly column confirmed), scan duration '+(await page.locator('#scan-duration').innerText()));
  await page.locator('.sidebar [data-tab="charts"]').click();
  await expect(page.locator('[data-option="symbol"] option')).toHaveCount(LIVE_UNIVERSE.length);
  await page.locator('[data-option="symbol"]').selectOption('AAPL');
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await expect(page.locator('[data-option="symbol"] option')).toHaveCount(LIVE_UNIVERSE.length);
  await page.locator('[data-option="symbol"]').selectOption('SVOL');
  await page.locator('[data-action="run-backtest"]').click();
  await expect(page.getByText('Completed trades')).toBeVisible();
  expect(errors).toEqual([]);
});


test('actual Alpaca IEX 15m bars produce real 2H candles, volatility analytics and portfolio results',async ({page,request})=>{
  test.skip(process.env.REAL_ALPACA_TEST!=='1','Runs only after Pages and Worker deployment; never intercept market OHLCV');
  test.setTimeout(180_000);
  const response=await request.get(WORKER+'/api/stocks/intraday?symbol=VXX&feed=iex',{timeout:60_000});
  expect(response.status(),'Real intraday Worker endpoint must be reachable').toBe(200);
  const payload=await response.json();
  expect(payload.source).toBe('alpaca');
  expect(payload.timeframe).toBe('15Min');
  expect(payload.symbol).toBe('VXX');
  expect(payload.returned,'IEX must return genuine intraday trade bars, no daily simulation').toBeGreaterThan(20);
  expect(payload.bars.every(b=>typeof b.t==='string'&&typeof b.o==='number'&&typeof b.c==='number')).toBeTruthy();
  const pageErrors=[];page.on('pageerror',err=>pageErrors.push(err.message));
  await page.goto('./');
  await page.evaluate(url=>localStorage.setItem('market-lens-pro-settings',JSON.stringify({apiBaseUrl:url})),WORKER);
  await page.reload();
  await page.locator('.mode-switch [data-action="mode-live"]').click();
  await expect(page.locator('#scan-status')).toContainText('133/133 symbols loaded',{timeout:150000});
  await page.locator('.sidebar [data-tab="charts"]').click();
  await page.locator('[data-option="symbol"]').selectOption('VXX');
  await page.locator('[data-option="tf"]').selectOption('15m');
  await expect(page.locator('#price-chart canvas').first()).toBeVisible({timeout:60000});
  await expect(page.locator('.info-strip').first()).toContainText('Alpaca 15-minute trade-bar OHLCV');
  await page.locator('[data-option="tf"]').selectOption('2H');
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await expect(page.locator('.info-strip').first()).toContainText('NYSE 09:30–16:00 ET session buckets');
  await page.locator('.sidebar [data-tab="volatility"]').click();
  await expect(page.locator('tr[data-vol-symbol]')).toHaveCount(10);
  await expect(page.locator('tr[data-vol-symbol="VXX"]')).toContainText('ALPACA IEX 1Day');
  await expect(page.locator('tr[data-vol-symbol="VXX"] td').nth(5)).not.toHaveText('—');
  await expect(page.locator('tr[data-vol-symbol="SVOL"]')).not.toContainText('NOT LOADED');
  await expect(page.locator('#contango-regime')).not.toHaveText('Unavailable');
  await page.locator('.sidebar [data-tab="screener"]').click();
  for(const ticker of ['VXX','SVOL'])await page.locator('tr[data-symbol="'+ticker+'"] button.star').click();
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-option="portfolio-mode"]').selectOption('portfolio');
  await page.locator('[data-option="portfolio-scope"]').selectOption('watchlist');
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.locator('[data-action="run-portfolio"]').click();
  await expect(page.locator('#portfolio-source')).toContainText('ALPACA IEX 1Day');
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  await expect(page.locator('.data-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.data-table tbody tr').first()).toContainText('ALPACA');
  expect(pageErrors).toEqual([]);
});


test('real Alpaca IEX OHLCV runs the entire preset strategy leaderboard on VXX without mock quotes',async ({page})=>{
  test.skip(process.env.REAL_ALPACA_TEST!=='1','Run after deployment against the actual configured Worker');
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.goto('./');
  await page.evaluate(url=>localStorage.setItem('market-lens-pro-settings',JSON.stringify({apiBaseUrl:url})),WORKER);
  await page.reload();
  await page.locator('.mode-switch [data-action="mode-live"]').click();
  await expect(page.locator('#scan-status')).toContainText('133/133 symbols loaded',{timeout:150000});
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-option="symbol"]').selectOption('VXX');
  await page.locator('[data-action="compare-strategies"]').first().click();
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
  await expect(page.locator('#leaderboard-source')).toContainText('Alpaca IEX OHLCV');
  await expect(page.locator('#leaderboard-source')).toContainText('VXX');
  await expect(page.locator('#leaderboard-source')).toContainText('7 built-in examples');
  await expect(page.locator('#leaderboard-source')).not.toContainText(/bar date \d{10}/);
  await expect(page.locator('#leaderboard-chart canvas').first()).toBeVisible();
  await page.locator('[data-action="load-best-strategy"]').click();
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});


test('real Alpaca scan exposes latest-bar freshness and dated computed strategy positions without mocked data',async ({page,request})=>{
  test.skip(process.env.REAL_ALPACA_TEST!=='1','Run after deployment against real Alpaca IEX Worker');
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const response=await request.get(WORKER+'/api/stocks/scan?feed=iex',{timeout:120000});
  expect(response.status()).toBe(200);
  const payload=await response.json();
  expect(payload.source).toBe('alpaca');
  expect(payload.requested).toBe(133);
  expect(payload.returned).toBe(133);
  expect(payload.freshness.expected).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(payload.freshness.checked).toBe(133);
  expect(Array.isArray(payload.freshness.stale)).toBe(true);
  expect(Array.isArray(payload.retry.attempted)).toBe(true);
  const rawVxx=payload.bars.VXX.at(-1).t.slice(0,10);
  await page.goto('./');
  await page.evaluate(url=>localStorage.setItem('market-lens-pro-settings',JSON.stringify({apiBaseUrl:url})),WORKER);
  await page.reload();
  await page.locator('.mode-switch [data-action="mode-live"]').click();
  await expect(page.locator('#scan-status')).toContainText('133/133 symbols loaded',{timeout:150000});
  const barDates=Object.values(payload.bars).map(bars=>bars?.at(-1)?.t?.slice(0,10)).filter(Boolean);
  const counts=new Map();
  for(const day of barDates)counts.set(day,(counts.get(day)||0)+1);
  const observedReference=[...counts].sort((a,b)=>b[1]-a[1]||b[0].localeCompare(a[0]))[0][0];
  expect(payload.freshness.expected).toBe(observedReference);
  await expect(page.locator('#scan-freshness')).toContainText('reference latest-bar session '+observedReference);
  await expect(page.locator('#scan-freshness')).toContainText(
    String(payload.freshness.checked-payload.freshness.stale.length)+'/133 current'
  );
  // If the real Worker still observes a VXZ gap, verify the actual asset/bar
  // diagnosis on every page. This conditional avoids failing when Alpaca
  // eventually publishes VXZ's delayed bar.
  const vxzLag=payload.freshness.stale.find(x=>x.symbol==='VXZ');
  if(vxzLag&&payload.diagnostics?.VXZ?.barsAfterLatest===false){
    const human=new Intl.DateTimeFormat('en-US',{
      timeZone:'UTC',month:'short',day:'numeric',year:'numeric'
    }).format(new Date(vxzLag.latest+'T00:00:00Z'));
    const warning='Alpaca returns no bars after '+human+' ('+vxzLag.latest+') on this feed';
    await expect(page.locator('tr[data-symbol="VXZ"] .fresh-date')).toContainText(warning);
    await page.locator('.sidebar [data-tab="data"]').click();
    await expect(page.locator('#data-freshness [data-data-stale-symbol="VXZ"]')).toContainText(warning);
    await page.locator('.sidebar [data-tab="charts"]').click();
    await page.locator('[data-option="symbol"]').selectOption('VXZ');
    await expect(page.locator('#chart-stale-warning')).toContainText(warning);
    await page.locator('.sidebar [data-tab="volatility"]').click();
    await expect(page.locator('tr[data-vol-symbol="VXZ"]')).toContainText(warning);
    await page.locator('.sidebar [data-tab="screener"]').click();
  }
  await expect(page.locator('tr[data-symbol="VXX"] .fresh-date')).toHaveText(rawVxx);
  await expect(page.locator('tbody tr[data-symbol]')).toHaveCount(133);
  await page.locator('[data-option="signal-strategy"]').selectOption('preset:ema-cross');
  await expect(page.locator('thead th').last()).toContainText('EMA crossover');
  await expect(page.locator('tbody .signal-status')).toHaveCount(133,{timeout:120000});
  const statuses=await page.locator('tbody .signal-status').allTextContents();
  expect(statuses.every(x=>['LONG','FLAT','EXIT'].includes(x.trim()))).toBe(true);
  await expect(page.locator('tr[data-symbol="VXX"] .signal-date')).toHaveText(rawVxx);
  await page.locator('[data-option="sort"]').selectOption('signal');
  await page.locator('[data-option="signals-only"]').check();
  const longs=await page.locator('tbody .signal-status').allTextContents();
  expect(longs.every(x=>x.trim()==='LONG')).toBe(true);
  expect(errors).toEqual([]);
});


test('Round 11 live 2H comparison auto-fetches real Alpaca 15Min bars, caches in IndexedDB, restores Live and VXX on reload',async ({page})=>{
  test.skip(process.env.REAL_ALPACA_TEST!=='1','Only after publish, using real configured Alpaca Worker');
  test.setTimeout(180000);
  const errors=[],intradayRequests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/api/stocks/intraday?'))intradayRequests.push(r.url());});
  await page.goto('./');
  await page.evaluate(url=>localStorage.setItem('market-lens-pro-settings',JSON.stringify({apiBaseUrl:url})),WORKER);
  await page.reload();
  await page.locator('.mode-switch [data-action="mode-live"]').click();
  await expect(page.locator('#scan-status')).toContainText('133/133 symbols loaded',{timeout:150000});
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-option="symbol"]').selectOption('VXX');
  await page.locator('[data-option="tf"]').selectOption('2H');
  // No Chart Lab navigation, no manual Refresh button; the analysis fetch is automatic.
  await page.locator('[data-action="compare-strategies"]').first().click();
  await expect(page.locator('#leaderboard-source')).toContainText('VXX',{timeout:90000});
  await expect(page.locator('#leaderboard-source')).toContainText('2H');
  await expect(page.locator('#leaderboard-source')).toContainText('7 built-in examples');
  await expect(page.locator('#leaderboard-source')).not.toContainText(/bar date \d{10}/);
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
  await expect(page.locator('#leaderboard-chart canvas').first()).toBeVisible();
  expect(intradayRequests.length).toBeGreaterThan(0);
  const record=await page.evaluate(()=>new Promise((resolve,reject)=>{
    const open=indexedDB.open('market-lens-pro-datasets',2);
    open.onerror=()=>reject(open.error?.message);
    open.onsuccess=()=>{
      const db=open.result,tx=db.transaction('intraday','readonly'),req=tx.objectStore('intraday').get('VXX|iex');
      req.onsuccess=()=>{db.close();resolve(req.result||null);};
      req.onerror=()=>reject(req.error?.message);
    };
  }));
  expect(record?.bars.length).toBeGreaterThan(40);
  expect(record.source).toBe('ALPACA');
  expect(record.feed).toBe('iex');
  await page.locator('[data-action="run-backtest"]').click();
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  const requestCount=intradayRequests.length;
  await page.reload();
  await expect(page.locator('.mode-switch [data-action="mode-live"]')).toHaveAttribute('aria-pressed','true',{timeout:150000});
  await expect(page.locator('.sidebar [data-tab="backtest"]')).toHaveClass(/active/);
  await expect(page.locator('[data-option="symbol"]')).toHaveValue('VXX');
  await expect(page.locator('[data-option="tf"]')).toHaveValue('2H');
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
  await expect(page.locator('.leaderboard-table')).toContainText('Hidden bullish RSI divergence');
  await expect(page.locator('#leaderboard-source')).not.toContainText(/bar date \d{10}/);
  await expect(page.locator('#leaderboard-chart canvas').first()).toBeVisible();
  const lastSession=nyIntradaySession(record.bars.at(-1));
  if(lastSession>=expectedNyseBarDate())
    expect(intradayRequests.length).toBe(requestCount,'fresh 15m IndexedDB bars should be reused without refetching');
  else
    expect(intradayRequests.length).toBeGreaterThan(requestCount,'stale Alpaca data must be refetched on reload');
  expect(errors).toEqual([]);
});


test('Round 12: direct Alpaca asset status and most recent bars for legacy MMC, MRSH and VXZ',async ({request})=>{
  test.skip(process.env.REAL_ALPACA_TEST!=='1','Read-only real Alpaca diagnostic runs after Pages deployment');
  test.setTimeout(120000);
  const response=await request.get(WORKER+'/api/stocks/diagnostics?symbols=MMC,MRSH,VXZ&feed=iex',
    {timeout:90000});
  expect(response.status(),'Round 12 credentialed live Worker diagnostics').toBe(200);
  const payload=await response.json();
  expect(payload.source).toBe('alpaca');
  for(const symbol of ['MMC','MRSH','VXZ']){
    const detail=payload.details[symbol];
    expect(detail,'Alpaca diagnostic response for '+symbol).toBeTruthy();
    expect(detail.asset).toBeTruthy();
    expect(detail.barsSource).toBe('Alpaca IEX 1Day');
    console.log('ROUND12_ALPACA_DIAGNOSTIC '+JSON.stringify({
      symbol,asset:detail.asset,latestBarDate:detail.latestBarDate,
      barCount:detail.barCount,barError:detail.barError,checkedAt:detail.checkedAt
    }));
  }
});


test('Round 13 published Briefing uses real Alpaca daily data, saves history and copies date-stamped text',async ({page})=>{
  test.skip(process.env.REAL_ALPACA_TEST!=='1','Real published-site Daily Briefing smoke after GitHub Pages deployment');
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="briefing"]').click();
  await page.locator('[data-option="briefing-strategy"]').selectOption('preset:ema-cross');
  await page.locator('[data-action="generate-briefing"]').click();
  await expect(page.locator('#briefing-metadata')).toContainText('ALPACA IEX 1Day',{timeout:150000});
  await expect(page.locator('#briefing-scan')).toContainText('Source: ALPACA IEX 1Day');
  await expect(page.locator('#briefing-signals')).toContainText('EMA crossover');
  await expect(page.locator('#briefing-regime')).toContainText('NOT VIX FUTURES CONTANGO');
  await expect(page.locator('#briefing-vxx')).toContainText('VXX 20D return');
  await expect(page.locator('#briefing-history .briefing-history-row')).toHaveCount(1);
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.locator('[data-action="copy-briefing"]').click();
  const text=await page.evaluate(()=>navigator.clipboard.readText());
  expect(text).toContain('MARKET LENS PRO — DAILY BRIEFING');
  expect(text).toContain('VXX: $');
  expect(text).toContain('NOT VIX FUTURES CONTANGO');
  await page.reload();
  await expect(page.locator('.sidebar [data-tab="briefing"]')).toHaveClass(/active/);
  await expect(page.locator('#briefing-history .briefing-history-row')).toHaveCount(1,{timeout:150000});
  expect(errors).toEqual([]);
});
