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
  expect(errors).toEqual([]);
});
