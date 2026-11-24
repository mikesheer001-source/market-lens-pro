import {test,expect} from './market-fixture.js';
import {sampleData} from '../src/engine.js';
import {LIVE_UNIVERSE} from '../src/universe.js';

test('Round 16 demo leaderboard shows train and OOS results, walk-forward summary, source/date and ranking',async ({page})=>{
  test.setTimeout(90000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="compare-strategies"]').first().click();
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
  await expect(page.locator('.leaderboard-table')).toContainText('Train return (70%)');
  await expect(page.locator('.leaderboard-table')).toContainText('Train Sharpe (rank)');
  await expect(page.locator('.leaderboard-table')).toContainText('OOS return (30%)');
  await expect(page.locator('.leaderboard-table')).toContainText('OOS Sharpe (30%)');
  await expect(page.locator('#walk-forward-summary')).toContainText('Walk-forward summary');
  await expect(page.locator('#walk-forward-summary')).toContainText('Source: Alpaca');
  await expect(page.locator('#walk-forward-summary')).toContainText('bar date:');
  await expect(page.locator('.leaderboard-table .leaderboard-best')).toHaveCount(1);
  await expect(page.locator('.leaderboard-table tbody tr').first()).toContainText('Best Sharpe');
  await expect(page.locator('tr[data-leaderboard-id="example:rsi-indicator"]')).toContainText('Indicator · N/A');
  await expect(page.locator('#leaderboard-chart canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});
test('Round 16 best-fit per-symbol table shows independent OOS metrics and source/date',async ({page})=>{
  test.setTimeout(90000);
  const prices=sampleData()['DEMO-SPY'],start=prices[200].time,end=prices[750].time;
  await page.goto('./');
  await page.locator('[data-option="preset"]').selectOption('volatility');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-option="portfolio-mode"]').selectOption('best-fit');
  await page.locator('[data-bt-range="startDate"]').fill(start);
  await page.locator('[data-bt-range="endDate"]').fill(end);
  await page.locator('[data-action="run-best-fit"]').click();
  await expect(page.locator('#portfolio-source')).toContainText('Saved best-fit portfolio',{timeout:60000});
  await expect(page.locator('#portfolio-breakdown')).toContainText('Train return');
  await expect(page.locator('#portfolio-breakdown')).toContainText('OOS return');
  await expect(page.locator('#portfolio-breakdown')).toContainText('OOS Sharpe');
  await expect(page.locator('tr[data-portfolio-symbol="VXX"]')).toContainText('Fit Sharpe:');
  await expect(page.locator('tr[data-portfolio-symbol="VXX"]')).toContainText('ALPACA');
  await expect(page.locator('tr[data-portfolio-symbol="VXX"]')).toContainText(end);
  await expect(page.locator('#portfolio-methodology')).toContainText('first 70% training bars');
  await expect(page.locator('#portfolio-methodology')).toContainText('selection bias');
  await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
});
test('Round 16 Fit across 133 mock Alpaca symbols displays source, date, train and held-out metrics',async ({page})=>{
  test.setTimeout(180000);
  const src=sampleData()['DEMO-SPY'].slice(-280);
  const bars=src.map(b=>({t:b.time+'T21:00:00Z',o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const stamp=bars.at(-1).t.slice(0,10);
  const payload={source:'alpaca',feed:'iex',requested:133,returned:133,missing:[],
    bars:Object.fromEntries(LIVE_UNIVERSE.map(s=>[s,bars])),
    freshness:{expected:stamp,checked:133},diagnostics:{}};
  await page.route('**/api/stocks/scan?**',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify(payload)
  }));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="fit-universe"]').click();
  await expect(page.locator('#fit-source')).toContainText('133/133 symbols backtested',{timeout:140000});
  await expect(page.locator('.fit-table tbody tr')).toHaveCount(133);
  await expect(page.locator('.fit-table')).toContainText('Train return (70%)');
  await expect(page.locator('.fit-table')).toContainText('OOS return (30%)');
  await expect(page.locator('.fit-table')).toContainText('OOS Sharpe (30%)');
  await expect(page.locator('tr[data-fit-symbol="MRSH"]')).toContainText('ALPACA IEX');
  await expect(page.locator('tr[data-fit-symbol="MRSH"]')).toContainText(stamp);
  await expect(page.locator('tr[data-fit-symbol="MMC"]')).toHaveCount(0);
});
