import {test,expect} from '@playwright/test';
import {LIVE_UNIVERSE} from '../src/universe.js';
import {sampleData} from '../src/engine.js';

test('Round 12 mocks Alpaca ONLY IN TEST to verify 133-symbol fit table, sorting and loading best',async ({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const fixture=sampleData()['DEMO-SPY'].slice(-340).map(b=>({
    t:b.time+'T21:00:00Z',o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume
  }));
  const response={source:'alpaca',feed:'iex',requested:LIVE_UNIVERSE.length,
    returned:LIVE_UNIVERSE.length,missing:[],freshness:{expected:'2026-11-13'},
    bars:Object.fromEntries(LIVE_UNIVERSE.map(symbol=>[symbol,fixture]))};
  await page.route('**/api/stocks/scan?**',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify(response)
  }));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await expect(page.locator('[data-action="fit-universe"]')).toBeVisible();
  await page.locator('[data-action="fit-universe"]').click();
  await expect(page.locator('.fit-table tbody tr')).toHaveCount(133,{timeout:45000});
  await expect(page.locator('#fit-source')).toContainText('133/133 symbols backtested');
  await expect(page.locator('tr[data-fit-symbol="MRSH"]')).toContainText('ALPACA IEX 1Day');
  await expect(page.locator('tr[data-fit-symbol="MMC"]')).toHaveCount(0);
  await expect(page.locator('.fit-table thead th').nth(3)).toHaveAttribute('aria-sort','descending');
  await page.locator('[data-action="sort-fit"][data-key="maxDD"]').click();
  await expect(page.locator('.fit-table thead th').nth(4)).toHaveAttribute('aria-sort','ascending');
  await expect(page.locator('[data-action="load-fit-best"]')).toBeVisible();
  await page.locator('[data-action="load-fit-best"]').click();
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});
