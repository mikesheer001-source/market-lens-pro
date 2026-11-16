import {test,expect} from '@playwright/test';
import {sampleData,backtest} from '../src/engine.js';
import {rollingWindows,summarizeRollingSharpe,rollingPositiveText} from '../src/rolling-validation.js';

const bars=sampleData()['DEMO-SPY'];
const options={strategy:'ema-cross',capital:10000,allocation:100,feeBps:1,
  slipBps:2,stopPct:0,targetPct:0,side:'long',fast:20,slow:100,timeframe:'D'};
const format=n=>n==null||!Number.isFinite(n)?'—':Number(n).toLocaleString('en-US',
  {minimumFractionDigits:2,maximumFractionDigits:2});

test('Round 18: five rolling Sharpe columns, dates and positive-window count match independently calculated OOS results',async ({page})=>{
  test.setTimeout(120000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="compare-strategies"]').first().click();
  const table=page.locator('.leaderboard-table');
  await expect(table).toContainText('OOS Sharpe (30%)');
  await expect(table).toContainText('Rolling mean OOS Sharpe (5)');
  await expect(table).toContainText('Rolling median OOS Sharpe (5)');
  await expect(table).toContainText('Rolling positive windows (5)');
  await expect(table.locator('tbody tr')).toHaveCount(12);
  await expect(page.locator('.leaderboard-best')).toHaveCount(1);
  const row=page.locator('tr[data-leaderboard-id="preset:ema-cross"]');
  const manual=rollingWindows(bars).map(w=>{
    const result=backtest(bars.slice(w.startIndex,w.endIndex+1),{
      ...options,startIndex:w.testStartIndex});
    return {...w,sharpe:result.metrics.sharpe};
  });
  const expected=summarizeRollingSharpe(manual);
  await expect(row.locator('td').nth(5)).toHaveText(format(expected.meanSharpe));
  await expect(row.locator('td').nth(6)).toHaveText(format(expected.medianSharpe));
  await expect(row.locator('td').nth(7)).toContainText(rollingPositiveText(expected));
  await expect(page.locator('#rolling-window-dates')).toContainText('W1');
  await expect(page.locator('#rolling-window-dates')).toContainText('W5');
  await expect(page.locator('#rolling-window-dates')).toContainText(manual[0].testStart);
  await expect(page.locator('#rolling-window-dates')).toContainText(manual[4].testEnd);
  await expect(page.locator('#walk-forward-summary')).toContainText(
    'A strategy positive in most windows is steadier evidence than a single holdout');
  await expect(page.locator('#leaderboard-window')).toHaveText('Full range');
  await expect(page.locator('#leaderboard-chart canvas').first()).toBeVisible();
  await page.locator('[data-action="sort-leaderboard"][data-key="rollingMean"]').click();
  await expect(table.locator('th[aria-sort="descending"]')).toContainText('Rolling mean');
  await page.reload();
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await expect(page.locator('#rolling-window-dates')).toContainText('W5');
  await expect(page.locator('tr[data-leaderboard-id="preset:ema-cross"] td').nth(7))
    .toContainText(rollingPositiveText(expected));
  expect(errors).toEqual([]);
});

test('Round 18: changing selected dates rebuilds rolling windows, while original single OOS remains',async ({page})=>{
  test.setTimeout(120000);
  const start=1080,end=1679;
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="compare-strategies"]').first().click();
  await page.locator('[data-bt-range="startDate"]').fill(bars[start].time);
  await page.locator('[data-bt-range="endDate"]').fill(bars[end].time);
  await expect(page.locator('#leaderboard-window')).toHaveText(
    'Selected range: '+bars[start].time+' to '+bars[end].time);
  await expect(page.locator('#leaderboard-source')).toContainText('600 bars');
  const segment=bars.slice(start,end+1),manual=rollingWindows(segment);
  await expect(page.locator('#rolling-window-dates')).toContainText(manual[0].windowStart);
  await expect(page.locator('#rolling-window-dates')).toContainText(manual[4].testEnd);
  const row=page.locator('tr[data-leaderboard-id="preset:ema-cross"]');
  const direct=backtest(segment,{...options,startIndex:Math.floor(segment.length*.7)});
  const sharpe=direct.metrics.sharpe;
  await expect(row.locator('td').nth(4)).toHaveText(format(sharpe));
  await expect(page.locator('#walk-forward-summary')).toContainText('holdout '+bars[start+420].time);
  await expect(page.locator('#rolling-window-dates')).toContainText('W5');
  await page.locator('[data-action="clear-bt-dates"]').click();
  await expect(page.locator('#leaderboard-window')).toHaveText('Full range');
  await expect(page.locator('#rolling-window-dates')).toContainText(bars.at(-1).time);
});

test('Round 18: too-short OOS rolling windows show N/A, not zero or Validated',async ({page})=>{
  test.setTimeout(120000);
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="compare-strategies"]').first().click();
  await page.locator('[data-bt-range="startDate"]').fill(bars[1200].time);
  await page.locator('[data-bt-range="endDate"]').fill(bars[1399].time);
  await expect(page.locator('#leaderboard-source')).toContainText('200 bars');
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
  const row=page.locator('tr[data-leaderboard-id="preset:ema-cross"]');
  await expect(row.locator('td').nth(5)).toHaveText('—');
  await expect(row.locator('td').nth(6)).toHaveText('—');
  await expect(row.locator('td').nth(7)).toContainText('0/5 assessable');
  await expect(row.locator('td').nth(7)).toContainText('fewer than 30 test bars');
  await expect(page.locator('#walk-forward-summary')).toContainText('W5');
  await expect(page.locator('#leaderboard-range-mismatch')).toHaveCount(0);
});
