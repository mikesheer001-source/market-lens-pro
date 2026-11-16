import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('screener exports currently filtered daily EMA200 results as a CSV',async ({page})=>{
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.goto('./');
  await expect(page.locator('thead th').nth(5)).toHaveText('% vs D EMA200');
  await expect(page.locator('tr[data-symbol="DEMO-VXX"] td').nth(5)).not.toHaveText('—');
  await page.locator('[data-option="preset"]').selectOption('oversold');
  await page.locator('[data-option="matches"]').check();
  await expect(page.locator('tbody tr[data-symbol]')).toHaveCount(1);
  const [download]=await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-action="export-screener"]').click()
  ]);
  const csv=await readFile(await download.path(),'utf8');
  expect(csv).toContain('Pct_vs_D_EMA200');
  expect(csv).toContain('DEMO-COIN');
  expect(csv).not.toContain('DEMO-SPY');
  expect(errors).toEqual([]);
});

test('backtest and parameter sweep survive navigation and page reload',async ({page})=>{
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="run-backtest"]').click();
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  const tradeCount=await page.getByText('Completed trades').locator('..').locator('strong').textContent();
  await page.locator('.sidebar [data-tab="charts"]').click();
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  await expect(page.getByText('Completed trades').locator('..').locator('strong')).toHaveText(tradeCount);
  await page.locator('.sidebar [data-tab="optimize"]').click();
  await page.locator('[data-action="run-sweep"]').click();
  await expect(page.locator('.data-table tbody tr')).toHaveCount(9);
  await page.reload();
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  await expect(page.getByText('Completed trades').locator('..').locator('strong')).toHaveText(tradeCount);
  await page.locator('.sidebar [data-tab="optimize"]').click();
  await expect(page.locator('.data-table tbody tr')).toHaveCount(9);
});

test('named watchlists and symbols can be created, renamed, selected and deleted',async ({page})=>{
  await page.goto('./');
  await page.locator('[data-input="watchlist-name"]').fill('Volatility candidates');
  await page.locator('[data-action="watchlist-create"]').click();
  await expect(page.locator('[data-option="watchlist-select"] option')).toHaveCount(2);
  await page.locator('tr[data-symbol="DEMO-VXX"] button.star').click();
  await expect(page.locator('tr[data-symbol="DEMO-VXX"] button.star')).toHaveClass(/on/);
  await page.locator('[data-option="watchlist-select"]').selectOption('default');
  await expect(page.locator('tr[data-symbol="DEMO-VXX"] button.star')).not.toHaveClass(/on/);
  const created=await page.locator('[data-option="watchlist-select"] option').last().getAttribute('value');
  await page.locator('[data-option="watchlist-select"]').selectOption(created);
  await expect(page.locator('tr[data-symbol="DEMO-VXX"] button.star')).toHaveClass(/on/);
  await page.locator('[data-input="watchlist-name"]').fill('My volatility');
  await page.locator('[data-action="watchlist-rename"]').click();
  await expect(page.locator('[data-option="watchlist-select"] option').last()).toContainText('My volatility');
  await page.reload();
  await expect(page.locator('[data-option="watchlist-select"] option')).toHaveCount(2);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[data-action="watchlist-delete"]').click();
  await expect(page.locator('[data-option="watchlist-select"] option')).toHaveCount(1);
});

test('saved scan restores exact rule set and archived filtered rows after reload',async ({page})=>{
  await page.goto('./');
  await page.locator('[data-option="preset"]').selectOption('oversold');
  await page.locator('[data-option="matches"]').check();
  await expect(page.locator('tbody tr[data-symbol]')).toHaveCount(1);
  await page.locator('[data-input="scan-name"]').fill('RSI oversold');
  await page.locator('[data-action="save-scan"]').click();
  await expect(page.locator('[data-option="saved-scan-select"] option')).toHaveCount(2);
  await page.locator('[data-option="preset"]').selectOption('all');
  await expect(page.locator('tbody tr[data-symbol]')).toHaveCount(4); // no rules: every symbol is a match
  await page.locator('[data-option="matches"]').uncheck();
  await expect(page.locator('tbody tr[data-symbol]')).toHaveCount(4);
  const id=await page.locator('[data-option="saved-scan-select"] option').last().getAttribute('value');
  await page.locator('[data-option="saved-scan-select"]').selectOption(id);
  await expect(page.locator('tbody tr[data-symbol]')).toHaveCount(1);
  await expect(page.locator('tbody tr[data-symbol="DEMO-COIN"]')).toBeVisible();
  await expect(page.getByText(/Showing saved scan snapshot:/)).toContainText('archived values');
  await page.reload();
  await page.locator('[data-option="saved-scan-select"]').selectOption(id);
  await expect(page.locator('tbody tr[data-symbol="DEMO-COIN"]')).toBeVisible();
});

test('local price and RSI alerts are evaluated on each scan and persist until dismissed',async ({page})=>{
  await page.goto('./');
  await page.locator('[data-alert-field="symbol"]').selectOption('DEMO-VXX');
  await page.locator('[data-alert-field="metric"]').selectOption('price');
  await page.locator('[data-alert-field="op"]').selectOption('>');
  await page.locator('[data-alert-field="threshold"]').fill('0');
  await page.locator('[data-action="alert-create"]').click();
  await page.locator('[data-action="scan-universe"]').click();
  await expect(page.locator('.alert-banner')).toContainText('DEMO-VXX');
  await expect(page.locator('.alert-banner')).toContainText('1 in-app alert triggered');
  await page.reload();
  await expect(page.locator('.alert-banner')).toBeVisible();
  await page.locator('[data-action="alert-ack"]').click();
  await expect(page.locator('.alert-banner')).toHaveCount(0);
});
