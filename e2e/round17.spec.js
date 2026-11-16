import {test,expect} from '@playwright/test';
import {sampleData,backtest} from '../src/engine.js';

const history=sampleData()['DEMO-SPY'];
const parameters={strategy:'ema-cross',timeframe:'D',capital:10000,
  allocation:100,feeBps:1,slipBps:2,stopPct:0,targetPct:0,side:'long',
  fast:20,slow:100};
const pct=n=>(n>0?'+':'')+n.toLocaleString('en-US',
  {minimumFractionDigits:2,maximumFractionDigits:2})+'%';

test('Round 17: changing the date pickers automatically rebuilds all leaderboard rows, OOS and equity',async ({page})=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const start=1200,end=1400,n=end-start+1,cut=Math.floor(n*.7);
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="compare-strategies"]').first().click();
  await expect(page.locator('#leaderboard-window')).toContainText('Full range');
  const initial=await page.locator('tr[data-leaderboard-id="preset:ema-cross"] td').nth(6).textContent();
  const priorSummary=await page.locator('#walk-forward-summary').textContent();
  await page.locator('[data-bt-range="startDate"]').fill(history[start].time);
  await page.locator('[data-bt-range="endDate"]').fill(history[end].time);
  // No second click on Compare all strategies or Run backtest: selection auto-syncs.
  await expect(page.locator('#leaderboard-window')).toHaveText(
    'Selected range: '+history[start].time+' to '+history[end].time);
  await expect(page.locator('#leaderboard-source')).toContainText(n+' bars');
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
  await expect(page.locator('#leaderboard-range-mismatch')).toHaveCount(0);
  const row=page.locator('tr[data-leaderboard-id="preset:ema-cross"]');
  const expectedFull=backtest(history.slice(start,end+1),parameters);
  const expectedOos=backtest(history.slice(start,end+1),{...parameters,startIndex:cut});
  await expect(row.locator('td').nth(6)).toHaveText(pct(expectedFull.metrics.returnPct));
  await expect(row.locator('td').nth(3)).toHaveText(pct(expectedOos.metrics.returnPct));
  await expect(page.locator('#walk-forward-summary')).toContainText(
    'holdout '+history[start+cut].time+' to '+history[end].time);
  await expect(page.locator('#walk-forward-summary')).toContainText('Source: SIMULATED');
  expect(await page.locator('#walk-forward-summary').textContent()).not.toBe(priorSummary);
  await expect(page.locator('#leaderboard-chart canvas').first()).toBeVisible();
  await page.reload();
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await expect(page.locator('#leaderboard-window')).toContainText(history[start].time);
  await expect(page.locator('tr[data-leaderboard-id="preset:ema-cross"] td').nth(6))
    .toHaveText(pct(expectedFull.metrics.returnPct));
  await page.locator('[data-action="clear-bt-dates"]').click();
  await expect(page.locator('#leaderboard-window')).toHaveText('Full range');
  await expect(page.locator('tr[data-leaderboard-id="preset:ema-cross"] td').nth(6)).toHaveText(initial.trim());
  await expect(page.locator('#leaderboard-range-mismatch')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Round 17: reversed date edits never show mismatched leaderboard rows or walk-forward figures',async ({page})=>{
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="compare-strategies"]').first().click();
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
  await page.locator('[data-bt-range="startDate"]').fill(history[1400].time);
  await page.locator('[data-bt-range="endDate"]').fill(history[1200].time);
  await expect(page.locator('#leaderboard-range-mismatch')).toContainText('start date must be on or before');
  await expect(page.locator('.leaderboard-table')).toHaveCount(0);
  await expect(page.locator('#walk-forward-summary')).toHaveCount(0);
  await expect(page.locator('#leaderboard-chart')).toHaveCount(0);
  await page.locator('[data-bt-range="endDate"]').fill(history[1600].time);
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
  await expect(page.locator('#leaderboard-window')).toContainText(history[1600].time);
  await expect(page.locator('#walk-forward-summary')).toContainText('holdout');
});

test('Round 17: short selected window still displays honest comparison with too-few OOS bars',async ({page})=>{
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="compare-strategies"]').first().click();
  await page.locator('[data-bt-range="startDate"]').fill(history[1500].time);
  await page.locator('[data-bt-range="endDate"]').fill(history[1532].time);
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
  await expect(page.locator('#leaderboard-source')).toContainText('33 bars');
  await expect(page.locator('.leaderboard-table')).toContainText('need at least 30');
  await expect(page.locator('#walk-forward-summary')).toContainText('0 of 0 assessable');
  await expect(page.locator('.oos-validated')).toHaveCount(0);
  await expect(page.locator('#leaderboard-range-mismatch')).toHaveCount(0);
});
