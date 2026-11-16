import {test,expect} from '@playwright/test';

test('desktop screener, chart, backtest, optimization and CSV import',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await expect(page.getByRole('heading',{name:'Screener'})).toBeVisible();
  await expect(page.locator('tr[data-symbol]')).toHaveCount(4);
  await expect(page.locator('thead th').nth(4)).toHaveText('RSI 5D');
  const shortRsi = await page.locator('tbody tr td:nth-child(5)').allTextContents();
  expect(shortRsi).toHaveLength(4);
  expect(shortRsi.every(value => value.trim() !== '—')).toBeTruthy();
  await page.locator('.sidebar [data-tab="data"]').click();
  await expect(page.getByRole('heading',{name:'Data Center'})).toBeVisible();
  await expect(page.locator('[data-setting="apiBaseUrl"]')).toBeVisible();
  await page.locator('.sidebar [data-tab="screener"]').click();
  await expect(page.getByRole('heading',{name:'Screener'})).toBeVisible();
  await page.locator('.sidebar [data-tab="charts"]').click();
  await expect(page.getByRole('heading',{name:'Chart Lab'})).toBeVisible();
  await expect(page.locator('[data-option="style"]')).toHaveValue('candles');
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await page.locator('[data-option="tf"]').selectOption('W');
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await page.locator('.sidebar [data-tab="screener"]').click();
  await page.locator('[data-option="preset"]').selectOption('volatility');
  await expect(page.locator('tr[data-symbol]')).toHaveCount(1);
  await expect(page.locator('tr[data-symbol="DEMO-VXX"] .pill')).toHaveText('MATCH');
  await page.locator('[data-action="scan-universe"]').click();
  await expect(page.locator('#scan-status')).toContainText('Demo scan complete');
  await expect(page.locator('#scan-status')).toContainText('1 matches');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="run-backtest"]').click();
  await expect(page.getByText('Completed trades')).toBeVisible();
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  await page.locator('.sidebar [data-tab="optimize"]').click();
  await page.locator('[data-action="run-sweep"]').click();
  await expect(page.locator('.data-table tbody tr')).toHaveCount(9);
  await page.locator('.sidebar [data-tab="data"]').click();
  await page.locator('#csv-file').setInputFiles({
    name:'TEST.csv',mimeType:'text/csv',
    buffer:Buffer.from('Date,Open,High,Low,Close,Volume\n2024-01-01,100,102,99,101,1000\n2024-01-02,101,103,100,102,1100\n')
  });
  await expect(page.getByText('TEST',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile navigation and candlestick canvas',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:390,height:844});
  await page.goto('./');
  await expect(page.locator('.mobile-nav')).toBeVisible();
  await page.locator('.mobile-nav [data-tab="charts"]').click();
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('failed Live scan restores Demo mode and keeps the sample universe visible',async ({page})=>{
  await page.goto('./');
  await page.evaluate(()=>{
    localStorage.setItem('market-lens-pro-settings',JSON.stringify({apiBaseUrl:'https://unreachable.market-lens.invalid'}));
  });
  await page.reload();
  await page.route('https://unreachable.market-lens.invalid/**',route=>route.abort());
  await page.locator('.mode-switch [data-action="mode-live"]').click();
  await expect(page.locator('#scan-status')).toContainText('Live scan failed; Demo mode restored');
  await expect(page.locator('tr[data-symbol]')).toHaveCount(4);
  await expect(page.locator('.mode-switch [data-action="mode-demo"]')).toHaveClass(/selected/);
});
