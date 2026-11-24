import {test,expect} from './market-fixture.js';

test('equal-weight portfolio accepts named watchlist, combines equity, sweeps and persists',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  for(const symbol of ['SPY','VXX'])
    await page.locator('tr[data-symbol="'+symbol+'"] button.star').click();
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-option="portfolio-mode"]').selectOption('portfolio');
  await page.locator('[data-option="portfolio-scope"]').selectOption('watchlist');
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.locator('[data-action="run-portfolio"]').click();
  await expect(page.locator('#portfolio-source')).toContainText('ALPACA');
  await expect(page.locator('#portfolio-source')).toContainText('2 symbols');
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  await expect(page.locator('.data-table tbody tr')).toHaveCount(2);
  await expect(page.getByText('Equal-weight buy & hold',{exact:true})).toBeVisible();
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

test('no daily OHLCV is faked into 2H or 15m candles',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await page.locator('[data-timeframe="2H"]').click();
  await expect(page.locator('#price-chart canvas')).toHaveCount(0);
  await expect(page.getByText(/Live intraday unavailable/)).toBeVisible();
  await expect(page.locator('.info-strip.warning')).toContainText('Alpaca');
  await page.locator('[data-timeframe="15m"]').click();
  await expect(page.locator('#price-chart canvas')).toHaveCount(0);
  await expect(page.getByText(/Live intraday unavailable/)).toBeVisible();
  expect(errors).toEqual([]);
});
