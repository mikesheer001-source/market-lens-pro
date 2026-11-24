import {test,expect} from './market-fixture.js';
import {chooseSymbol} from './chart-symbol.js';

test('Round 11 market-data leaderboard includes all built-in Pine examples and readable date, with indicator examples N/A',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="compare-strategies"]').first().click();
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
  await expect(page.locator('.leaderboard-table')).toContainText('Regular bullish RSI divergence');
  await expect(page.locator('.leaderboard-table')).toContainText('Hidden bullish RSI divergence');
  await expect(page.locator('.leaderboard-table td:first-child .muted').filter({hasText:'Indicator · N/A'})).toHaveCount(2);
  await expect(page.locator('.leaderboard-table td:nth-child(9) .muted').filter({hasText:'Indicator · N/A'})).toHaveCount(2);
  await expect(page.locator('#leaderboard-source')).toContainText('7 built-in examples, 0 saved Pine');
  await expect(page.locator('#leaderboard-source')).toContainText(/bar date \d{4}-\d{2}-\d{2}/);
  await expect(page.locator('#leaderboard-source')).not.toContainText(/bar date \d{10}/);
  await expect(page.locator('#leaderboard-chart canvas').first()).toBeVisible();
  await page.locator('[data-action="load-best-strategy"]').click();
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('Round 11 remembers real Backtester ticker/tab and last analysis after reload',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await chooseSymbol(page,'VXX');
  await page.locator('[data-action="run-backtest"]').click();
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('.sidebar [data-tab="backtest"]')).toHaveClass(/active/);
  await expect(page.locator('.source-badge').first()).toContainText('ALPACA LIVE');
  await expect(page.locator('[data-option="symbol"]')).toHaveValue('VXX');
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('Round 11 no real intraday data from the provider shows a visible error, never silently ignores Compare or Backtest click',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-option="tf"]').selectOption('2H');
  await page.locator('[data-action="run-backtest"]').click();
  await expect(page.getByRole('alert')).toContainText('could not obtain real intraday bars');
  await page.locator('[data-action="compare-strategies"]').first().click();
  await expect(page.getByRole('alert')).toContainText('Compare all strategies could not obtain real intraday bars');
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(0);
  expect(errors).toEqual([]);
});
