import {test, expect} from './market-fixture.js';

test('server scan produces a persistent in-app alert that can be dismissed', async ({page}) => {
  let notifications = [];
  await page.route('**/api/server-scan/config', route => route.fulfill({json:{ok:true}}));
  await page.route('**/api/server-scan/notifications', route => route.fulfill({json:{notifications,lastRun:null}}));
  await page.route('**/api/server-scan/run', route => {
    notifications = [{
      id: 'run-e2e-1',
      createdAt: '2026-11-26T23:00:00.000Z',
      scanType: 'manual',
      matchCount: 1,
      symbols: ['AAPL'],
      barDate: '2026-11-26',
      readAt: null,
      unread: true
    }];
    return route.fulfill({json:{
      runId:'run-e2e-1',requested:133,returned:133,matchCount:1,
      newMatchCount:1,newMatches:['AAPL'],expectedBarDate:'2026-11-26'
    }});
  });
  await page.route('**/api/server-scan/notifications/ack', async route => {
    notifications = notifications.map(item => ({...item,readAt:'2026-11-27T00:00:00.000Z',unread:false}));
    return route.fulfill({json:{ok:true}});
  });

  await page.goto('./');
  const runButton = page.getByRole('button', {name:'Run server scan'});
  await expect(runButton).toBeVisible();
  await runButton.click();
  await expect(page.locator('.alert-banner')).toContainText('AAPL');
  await expect(page.locator('#server-scan-status')).toContainText('1 match');
  await page.locator('#screener-facts').getByRole('button', {name:'Dismiss server alert'}).click();
  await expect(page.locator('.alert-banner')).not.toContainText('AAPL');
});
