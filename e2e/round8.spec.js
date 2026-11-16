import {test,expect} from '@playwright/test';

test('equal-weight portfolio accepts named watchlist, combines equity, sweeps and persists',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  for(const symbol of ['DEMO-SPY','DEMO-VXX'])
    await page.locator('tr[data-symbol="'+symbol+'"] button.star').click();
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-option="portfolio-mode"]').selectOption('portfolio');
  await page.locator('[data-option="portfolio-scope"]').selectOption('watchlist');
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.locator('[data-action="run-portfolio"]').click();
  await expect(page.locator('#portfolio-source')).toContainText('SIMULATED');
  await expect(page.locator('#portfolio-source')).toContainText('2 symbols');
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  await expect(page.locator('.data-table tbody tr')).toHaveCount(2);
  await expect(page.getByText('Equal-weight buy & hold')).toBeVisible();
  await page.locator('.sidebar [data-tab="optimize"]').click();
  await page.locator('[data-action="run-sweep"]').click();
  await expect(page.locator('.data-table tbody tr')).toHaveCount(9);
  await page.reload();
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await expect(page.locator('[data-option="portfolio-mode"]')).toHaveValue('portfolio');
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  await expect(page.locator('.data-table tbody tr')).toHaveCount(2);
  await page.locator('.sidebar [data-tab="optimize"]').click();
  await expect(page.locator('.data-table tbody tr')).toHaveCount(9);
  expect(errors).toEqual([]);
});

test('volatility dashboard shows ten sourced ticker slots and discloses price-only proxy uncertainty',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="volatility"]').click();
  await expect(page.getByRole('heading',{name:'Volatility'})).toBeVisible();
  await expect(page.locator('tr[data-vol-symbol]')).toHaveCount(10);
  await expect(page.locator('tr[data-vol-symbol="VXX"]')).toBeVisible();
  await expect(page.locator('tr[data-vol-symbol="SVOL"]')).toBeVisible();
  await expect(page.locator('#contango-regime')).toContainText('Unavailable');
  await expect(page.getByText('NOT VIX FUTURES CONTANGO')).toBeVisible();
  await expect(page.locator('#volatility-source')).toContainText('Demo mode');
  await expect(page.locator('tr[data-vol-symbol="VXX"]')).toContainText('NOT LOADED');
  expect(errors).toEqual([]);
});

test('no daily Demo OHLCV is faked into 2H or 15m candles',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await page.locator('[data-option="tf"]').selectOption('2H');
  await expect(page.locator('#price-chart canvas')).toHaveCount(0);
  await expect(page.getByText(/No genuine 2H bars available/)).toBeVisible();
  await expect(page.locator('.info-strip')).toContainText('never expanded');
  await page.locator('[data-option="tf"]').selectOption('15m');
  await expect(page.locator('#price-chart canvas')).toHaveCount(0);
  await expect(page.getByText(/No genuine 15m bars available/)).toBeVisible();
  expect(errors).toEqual([]);
});
