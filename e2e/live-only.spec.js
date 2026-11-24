import {test,expect} from '@playwright/test';
test('old demo preferences migrate to real data, without a synthetic fallback',async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('market-lens-sync-disabled','1');localStorage.setItem('market-lens-pro-settings',JSON.stringify({mode:'demo',lastSymbol:'DEMO-SPY',tab:'screener'}));});
  await page.route('**/api/stocks/scan?**',route=>route.fulfill({status:503,json:{error:'Test provider unavailable'}}));
  await page.goto('./');
  await expect(page.locator('#scan-status')).toContainText('Live data unavailable');
  await expect(page.getByRole('button',{name:'Use Demo'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Use Live'})).toHaveCount(0);
  await expect(page.locator('.screener-results tbody tr')).toHaveCount(0);
  await expect(page.locator('.source-badge').first()).toContainText('ALPACA UNAVAILABLE');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('market-lens-pro-settings')).mode)).toBe('live');
});
