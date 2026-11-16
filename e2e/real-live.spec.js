import {test,expect} from '@playwright/test';
import {LIVE_UNIVERSE} from '../src/universe.js';

const WORKER='https://market-lens-pro-api.mikesheer001.workers.dev';

// This is an honest live integration test: no request interception, no fake OHLCV.
// It is intentionally disabled for the local simulator and enabled after production deploy.
test('real Alpaca Worker scans entire 133-symbol universe and publishes VXX daily close',async ({page,request})=>{
  test.skip(process.env.REAL_ALPACA_TEST!=='1','Requires REAL_ALPACA_TEST=1, run after publishing GitHub Pages');
  test.setTimeout(180_000);
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
  await expect(status).toContainText('Live scan complete',{timeout:150_000});
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
