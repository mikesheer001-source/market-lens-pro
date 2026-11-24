import {test,expect} from './market-fixture.js';
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
