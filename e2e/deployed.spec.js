import {test,expect} from '@playwright/test';

test('published Pages site renders screener, daily RSI, chart and backtest',async ({page})=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('./');
  await expect(page.getByRole('heading',{name:'Screener'})).toBeVisible();
  await expect(page.locator('tr[data-symbol]')).toHaveCount(4);
  await expect(page.locator('thead th').nth(4)).toHaveText('RSI 5D');
  const rsiValues=await page.locator('tbody tr td:nth-child(5)').allTextContents();
  expect(rsiValues).toHaveLength(4);
  expect(rsiValues.every(value=>value.trim()!=='—')).toBeTruthy();

  await page.locator('.sidebar [data-tab="charts"]').click();
  await expect(page.getByRole('heading',{name:'Chart Lab'})).toBeVisible();
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await expect(page.locator('[data-option="style"]')).toHaveValue('candles');

  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="run-backtest"]').click();
  await expect(page.getByText('Completed trades')).toBeVisible();
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  await expect(page.locator('.equity-legend')).toBeVisible();
  await expect(page.locator('.equity-legend')).toContainText('Strategy');
  await expect(page.locator('.equity-legend')).toContainText('Buy & hold');

  await page.locator('.sidebar [data-tab="screener"]').click();
  await page.locator('[data-option="preset"]').selectOption('oversold');
  await page.locator('[data-action="scan-universe"]').click();
  await expect(page.locator('#scan-status')).toContainText('1 match');
  await expect(page.locator('#scan-status')).not.toContainText('1 matches');
  await expect(page.locator('tr[data-symbol="DEMO-COIN"] .pill')).toHaveText('MATCH');
  await expect(page.locator('tr[data-symbol="DEMO-SPY"] .pill')).toHaveText('NO MATCH');

  await page.locator('[data-option="preset"]').selectOption('volatility');
  await expect(page.locator('tr[data-symbol]')).toHaveCount(1);
  await expect(page.locator('tr[data-symbol="DEMO-VXX"] .pill')).toHaveText('MATCH');
  await page.locator('[data-action="scan-universe"]').click();
  await expect(page.locator('#scan-status')).toContainText('1 match');
  expect(errors).toEqual([]);
});

test('published Script Lab runs a Pine oscillator and a custom strategy through backtesting',async ({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="scripts"]').click();
  await expect(page.getByRole('heading',{name:'Script Lab'})).toBeVisible();
  await page.locator('[data-action="pine-example"][data-example="rsi-indicator"]').click();
  await page.locator('[data-action="pine-run"]').click();
  await expect(page.getByRole('heading',{name:'Chart Lab'})).toBeVisible();
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await page.locator('.sidebar [data-tab="scripts"]').click();
  await page.locator('[data-action="pine-example"][data-example="ema-cross"]').click();
  await page.locator('[data-action="pine-run"]').click();
  await expect(page.getByRole('heading',{name:'Backtest'})).toBeVisible();
  await expect(page.locator('[data-bt="strategy"]')).toHaveValue('pine-custom');
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});


test('published strategy leaderboard compares presets, renders top three, and reloads the best strategy',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="compare-strategies"]').first().click();
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(5);
  await expect(page.locator('.leaderboard-best')).toHaveCount(1);
  await expect(page.locator('#leaderboard-chart canvas').first()).toBeVisible();
  await expect(page.locator('.leaderboard-legend-item')).toHaveCount(4);
  await page.locator('[data-action="load-best-strategy"]').click();
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  await page.reload();
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(5);
  await expect(page.locator('#leaderboard-chart canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});


test('published Screener strategy signal picker sorts LONG states with real dates and reloads locally',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('[data-option="signal-strategy"]').selectOption('preset:ema-cross');
  await expect(page.locator('thead th').last()).toContainText('EMA crossover');
  await expect(page.locator('tbody .signal-status')).toHaveCount(4);
  await expect(page.locator('tbody .signal-date').first()).toContainText(/^\d{4}-\d{2}-\d{2}$/);
  await page.locator('[data-option="sort"]').selectOption('signal');
  await page.locator('[data-option="signals-only"]').check();
  const statuses=await page.locator('tbody .signal-status').allTextContents();
  expect(statuses.every(x=>x.trim()==='LONG')).toBe(true);
  await page.reload();
  await expect(page.locator('[data-option="signal-strategy"]')).toHaveValue('preset:ema-cross');
  await expect(page.locator('tbody tr[data-symbol]')).toHaveCount(4);
  expect(errors).toEqual([]);
});
