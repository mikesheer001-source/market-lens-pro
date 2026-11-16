import {test,expect} from '@playwright/test';
import {sampleData} from '../src/engine.js';

const bars=sampleData()['DEMO-SPY'];
const enterComparison=async page=>{
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="compare-strategies"]').first().click();
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
};
test('Round 22: validated-only toggle filters exact active rows, keeps selected range and persists',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await enterComparison(page);
  const allIds=await page.locator('.leaderboard-table tbody tr').evaluateAll(rows=>rows.map(r=>r.dataset.leaderboardId));
  const candidates=await page.locator('.leaderboard-table tbody tr').evaluateAll(rows=>rows
    .filter(r=>r.querySelector('td:nth-child(9) .oos-validated')).map(r=>r.dataset.leaderboardId));
  const toggle=page.locator('#leaderboard-validated-only');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  const shown=await page.locator('.leaderboard-table tbody tr').evaluateAll(rows=>rows.map(r=>r.dataset.leaderboardId));
  expect(shown).toEqual(allIds.filter(id=>candidates.includes(id)));
  await expect(page.locator('#leaderboard-validation-count')).toContainText(
    'Showing '+candidates.length+' of 12 total leaderboard rows');
  await expect(page.locator('#leaderboard-validation-count')).toContainText('OR positive Sharpe in at least 3 of 5 rolling');
  await page.reload();
  await expect(page.locator('#leaderboard-validated-only')).toBeChecked();
  await expect(page.locator('#leaderboard-validation-count')).toContainText(
    'Showing '+candidates.length+' of 12');
  await page.locator('#leaderboard-validated-only').uncheck();
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
  expect(errors).toEqual([]);
});

test('Round 22: on a 60-bar selected range none qualify, shows clear message, toggles back to 12 rows',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await enterComparison(page);
  const begin=87,end=146;
  await page.locator('[data-bt-range="startDate"]').fill(bars[begin].time);
  await page.locator('[data-bt-range="endDate"]').fill(bars[end].time);
  await expect(page.locator('#leaderboard-source')).toContainText('60 bars');
  await page.locator('#leaderboard-validated-only').check();
  await expect(page.locator('#leaderboard-validation-empty')).toHaveText(
    'No strategy validated on this window');
  await expect(page.locator('#leaderboard-validation-count')).toContainText(
    'Showing 0 of 12 total leaderboard rows');
  await expect(page.locator('#leaderboard-window')).toContainText('Selected range:');
  await expect(page.locator('.leaderboard-table')).toHaveCount(0);
  await expect(page.locator('#leaderboard-chart canvas').first()).toBeVisible();
  await page.locator('#leaderboard-validated-only').uncheck();
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
  await expect(page.locator('#leaderboard-validation-empty')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Round 22: live-data Briefing keeps selected signal and explicitly shows validated rolling and full-period lines',async ({page})=>{
  test.setTimeout(160000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const data=bars.map(b=>({t:b.time+'T00:00:00Z',o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  await page.route('**/api/stocks/scan?**',route=>route.fulfill({
    status:200,contentType:'application/json',
    body:JSON.stringify({
      source:'alpaca',feed:'iex',lookback_days:1825,
      requested:133,returned:2,missing:[],freshness:{expected:'2026-11-16'},
      bars:{ABBV:data,SPY:data}
    })
  }));
  await page.goto('./');
  await page.locator('.mode-switch [data-action="mode-live"]').click();
  await expect(page.locator('#scan-status')).toContainText('2/133 symbols loaded');
  await page.locator('.sidebar [data-tab="briefing"]').click();
  const strategy=page.locator('[data-option="briefing-strategy"]');
  await strategy.selectOption('preset:ema-cross');
  await expect(page.locator('#briefing-metadata')).toContainText('ALPACA IEX 1Day');
  await expect(page.locator('#briefing-signals')).toContainText('EMA crossover');
  await expect(page.locator('#briefing-top-validated')).toContainText('Top validated strategy (rolling OOS):');
  await expect(page.locator('#briefing-top-full-period')).toContainText('Full-period best (full-period Sharpe):');
  await expect(page.locator('#briefing-strategy-leaders')).toContainText('ABBV');
  await expect(page.locator('#briefing-top-validated')).toContainText(/rolling mean OOS Sharpe|No validated strategy with a numeric rolling mean/);
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.locator('[data-action="copy-briefing"]').click();
  const text=await page.evaluate(()=>navigator.clipboard.readText());
  expect(text).toContain('Top validated strategy (rolling OOS):');
  expect(text).toContain('Full-period best (full-period Sharpe):');
  expect(text.indexOf('Top validated strategy')).toBeLessThan(text.indexOf('Full-period best'));
  await expect(page.locator('#briefing-history .briefing-history-row')).toHaveCount(1);
  expect(errors).toEqual([]);
});
