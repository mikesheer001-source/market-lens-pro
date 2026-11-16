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
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
  await expect(page.locator('.leaderboard-table')).toContainText('Train Sharpe (rank)');
  await expect(page.locator('.leaderboard-table')).toContainText('OOS Sharpe (30%)');
  await expect(page.locator('#walk-forward-summary')).toContainText('Source: SIMULATED');
  await expect(page.locator('.leaderboard-best')).toHaveCount(1);
  await expect(page.locator('.leaderboard-table')).toContainText('Hidden bullish RSI divergence');
  await expect(page.locator('.leaderboard-table')).toContainText('Indicator · N/A');
  await expect(page.locator('#leaderboard-chart canvas').first()).toBeVisible();
  await expect(page.locator('.leaderboard-legend-item')).toHaveCount(4);
  await page.locator('[data-action="load-best-strategy"]').click();
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  await page.reload();
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
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
  const longCount=statuses.length;
  await page.reload();
  await expect(page.locator('[data-option="signal-strategy"]')).toHaveValue('preset:ema-cross');
  await expect(page.locator('[data-option="signals-only"]')).toBeChecked();
  await expect(page.locator('tbody tr[data-symbol]')).toHaveCount(longCount);
  expect(errors).toEqual([]);
});


test('published Round 15 best-fit portfolio and date-range controls work on deployed Pages',async ({page})=>{
  test.setTimeout(90000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('[data-option="preset"]').selectOption('volatility');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-option="portfolio-mode"]').selectOption('best-fit');
  await expect(page.locator('[data-action="run-best-fit"]')).toBeVisible();
  await expect(page.locator('[data-bt-range="startDate"]')).toHaveValue('');
  await expect(page.locator('[data-bt-range="endDate"]')).toHaveValue('');
  await page.locator('[data-action="run-best-fit"]').click();
  await expect(page.locator('#portfolio-source')).toContainText('Saved best-fit portfolio',{timeout:80000});
  await expect(page.locator('#portfolio-source')).toContainText('Full available range');
  await expect(page.locator('#portfolio-breakdown tr[data-portfolio-symbol="DEMO-VXX"]')).toContainText('Fit Sharpe:');
  await expect(page.locator('#portfolio-breakdown')).toContainText('Train return');
  await expect(page.locator('#portfolio-breakdown')).toContainText('OOS return');
  await expect(page.locator('#portfolio-breakdown')).toContainText('OOS Sharpe');
  await expect(page.locator('#portfolio-methodology')).toContainText('selection bias');
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('published Round 17 leaderboard auto-follows selected dates and resets to Full range',async ({page})=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="compare-strategies"]').first().click();
  await expect(page.locator('#leaderboard-window')).toHaveText('Full range');
  const oldReturn=await page.locator('tr[data-leaderboard-id="preset:ema-cross"] td').nth(9).textContent();
  // Date changes alone must trigger a full comparison and a new holdout split.
  await page.locator('[data-bt-range="startDate"]').fill('2025-01-02');
  await page.locator('[data-bt-range="endDate"]').fill('2025-12-31');
  await expect(page.locator('#leaderboard-window')).toHaveText(
    'Selected range: 2025-01-02 to 2025-12-31');
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
  await expect(page.locator('#walk-forward-summary')).toContainText('holdout');
  await expect(page.locator('#walk-forward-summary')).toContainText('Selected range: 2025-01-02 to 2025-12-31');
  const updated=await page.locator('tr[data-leaderboard-id="preset:ema-cross"] td').nth(9).textContent();
  expect(updated).not.toBe(oldReturn);
  await page.locator('[data-action="clear-bt-dates"]').click();
  await expect(page.locator('#leaderboard-window')).toHaveText('Full range');
  await expect(page.locator('tr[data-leaderboard-id="preset:ema-cross"] td').nth(9)).toHaveText(oldReturn.trim());
  await expect(page.locator('#leaderboard-chart canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('published Round 18 shows five rolling test windows, median/mean and positive count on the live website',async ({page})=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="compare-strategies"]').first().click();
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
  await expect(page.locator('.leaderboard-table')).toContainText('Rolling mean OOS Sharpe (5)');
  await expect(page.locator('.leaderboard-table')).toContainText('Rolling median OOS Sharpe (5)');
  await expect(page.locator('.leaderboard-table')).toContainText('Rolling positive windows (5)');
  await expect(page.locator('#rolling-window-dates')).toContainText('W1');
  await expect(page.locator('#rolling-window-dates')).toContainText('W5');
  await expect(page.locator('#walk-forward-summary')).toContainText('steadier evidence than a single holdout');
  await expect(page.locator('tr[data-leaderboard-id="preset:ema-cross"] td').nth(7)).toContainText('/5');
  await page.locator('[data-bt-range="startDate"]').fill('2025-01-02');
  await page.locator('[data-bt-range="endDate"]').fill('2025-12-31');
  await expect(page.locator('#leaderboard-window')).toContainText('2025-01-02 to 2025-12-31');
  await expect(page.locator('#rolling-window-dates')).toContainText('2025');
  await expect(page.locator('#leaderboard-chart canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});


test('published Round 20 fullscreen Chart Lab, indicator gear, and right-axis reset work in deployed website',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await expect(page.locator('#chart-indicator-legend')).toBeVisible();
  await expect(page.getByRole('button',{name:'Settings for EMA 20'})).toBeVisible();
  await page.locator('[data-action="chart-fullscreen"]').click();
  await expect(page.locator('#chart-lab-panel')).toHaveAttribute('data-fullscreen','true');
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await page.getByRole('button',{name:'Settings for EMA 20'}).click();
  await expect(page.locator('#indicator-settings-ema20')).toBeVisible();
  await page.locator('[data-indicator-field="ema20Len"]').fill('32');
  await page.locator('[data-indicator-field="ema20Len"]').press('Tab');
  await expect(page.locator('[data-chart="ema20Len"]')).toHaveValue('32');
  await expect(page.locator('[data-indicator-row="ema20"]')).toContainText('EMA 32');
  await page.locator('[data-action="reset-price-scale"]').click();
  await expect(page.locator('#chart-axis-hint')).toContainText('Price scale reset');
  await page.locator('[data-action="chart-exit-fullscreen"]').click();
  await expect(page.locator('#chart-lab-panel')).toHaveAttribute('data-fullscreen','false');
  await expect(page.getByRole('heading',{name:'Chart Lab'})).toBeVisible();
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});
