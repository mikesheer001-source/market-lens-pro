import {test,expect} from './market-fixture.js';
import {sampleData} from '../src/engine.js';
import {LIVE_SCAN_CACHE_REVISION} from '../src/live-history.js';

test('search retains chart, workspace and input nodes while updating screener matches',async({page})=>{
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await page.locator('#chart-workspaces [data-workspace-section="screener"] > summary').click();
  const chart=page.locator('#price-chart'),input=page.getByLabel('Search symbols');
  await chart.evaluate(el=>el.dataset.retained='yes');
  await input.evaluate(el=>el.dataset.retained='yes');
  await input.fill('VXX');
  await expect(page.locator('.screener-results tbody tr')).toHaveCount(1);
  await expect(page.locator('.screener-results tbody tr')).toHaveAttribute('data-symbol','VXX');
  await expect(input).toHaveAttribute('data-retained','yes');
  await expect(chart).toHaveAttribute('data-retained','yes');
  await input.fill('');
  await expect(page.locator('.screener-results tbody tr')).toHaveCount(4);
  await expect(chart).toHaveAttribute('data-retained','yes');
});

test('background quick scan completing with an open embedded screener does not remount the price chart',async({page})=>{
  const rows=sampleData()['DEMO-SPY'].slice(-1250);
  const bars=rows.map(b=>({t:b.time+'T05:00:00Z',o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const payload={source:'alpaca',feed:'iex',lookback_days:1825,scan_cache_revision:LIVE_SCAN_CACHE_REVISION,requested:133,returned:1,bars:{SPY:bars}};
  await page.route('**/api/stocks/scan?**',route=>route.fulfill({json:payload}));
  await page.goto('./');
  await expect(page.locator('#scan-status')).toContainText('1/133 symbols loaded');
  let release,start;
  const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>start=resolve);
  const updated={...payload,bars:{SPY:[...bars.slice(0,-1),{...bars.at(-1),c:bars.at(-1).c+1,h:Math.max(bars.at(-1).h,bars.at(-1).c+1)}]}};
  await page.route('**/api/stocks/scan?**',async route=>{start();await gate;return route.fulfill({json:updated});});
  await page.locator('[data-action="scan-universe"]').click();await started;
  await page.locator('.sidebar [data-tab="charts"]').click();
  await page.locator('#chart-workspaces [data-workspace-section="screener"] > summary').click();
  const chart=page.locator('#price-chart');
  await chart.evaluate(el=>{window.originalPriceChart=el;});
  const response=page.waitForResponse('**/api/stocks/scan?**');release();await response;
  await page.waitForTimeout(500);
  expect(await chart.evaluate(el=>el===window.originalPriceChart)).toBe(true);
  await page.locator('.sidebar [data-tab="screener"]').click();
  await expect(page.locator('tr[data-symbol="SPY"] td').nth(1)).toHaveText((bars.at(-1).c+1).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));
});
