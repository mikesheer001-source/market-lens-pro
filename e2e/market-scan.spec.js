import {test, expect} from './market-fixture.js';

test('U.S. scan uses technical summaries and loads an uncurated ticker on demand', async ({page}) => {
  const stats = {price: 102, ema200: 95, rsi: 54, rsi5: 52, ret20: 2, drawdown: -2, atrPct: 1, volume: 500, bars: 250};
  let chartRequests = 0;
  await page.route('**/api/stocks/market**', route => route.fulfill({json:
    new URL(route.request().url()).searchParams.has('batch') ?
      {index: 0, checked: 2, rows: [{symbol: 'TESTETF', latestBar: '2026-11-16', frames: {D: stats, W: stats, M: stats}}]} :
      {id: 'catalog-1', session: '2026-11-16', requested: 2, batches: 1}
  }));
  await page.route('**/api/stocks/bars?symbol=TESTETF', route => {
    chartRequests++;
    return route.fulfill({json: {bars: [
      {t:'2026-11-13T05:00:00Z', o:100, h:102, l:99, c:101, v:600},
      {t:'2026-11-16T05:00:00Z', o:101, h:103, l:100, c:102, v:500}
    ]}});
  });
  await page.goto('./');
  await page.getByRole('button', {name: 'Scan all U.S. listings'}).click();
  await expect(page.locator('#market-scan-status')).toContainText('2 / 2 listings checked · complete');
  await expect(page.getByRole('button', {name: 'View TESTETF'})).toContainText('MATCH');
  expect(chartRequests).toBe(0);
  await page.getByRole('button', {name: 'View TESTETF'}).click();
  await expect(page.getByRole('heading', {name: 'Chart Lab', exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name: /Change symbol, TESTETF/})).toBeVisible();
  expect(chartRequests).toBe(1);
  await page.locator('.match-review').getByRole('button', {name:'Screener'}).click();
  await expect(page.getByRole('button', {name:'View TESTETF'})).toBeVisible();
});

test('Chart Lab indicator × removes the overlay and allows adding it back', async ({page}) => {
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await page.getByRole('button', {name:'Remove EMA 20', exact:true}).click();
  await expect(page.getByRole('button', {name:'Settings for EMA 20', exact:true})).toHaveCount(0);
  await page.getByRole('button', {name:'New indicator'}).click();
  await page.getByRole('button', {name:'EMA', exact:true}).click();
  await page.getByRole('button', {name:'Apply', exact:true}).click();
  await expect(page.getByRole('button', {name:'Remove EMA 20', exact:true})).toBeVisible();
});

test('a full market scan updates results without replacing the search box', async ({page}) => {
  const stats={price:102,ema200:95,rsi:54,bars:250};
  let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  let started;
  const batch=new Promise(resolve=>{started=resolve;});
  await page.route('**/api/stocks/market**',async route=>{
    if(!new URL(route.request().url()).searchParams.has('batch'))
      return route.fulfill({json:{id:'quiet-market',session:'2026-11-16',requested:1,batches:1}});
    started();
    await pending;
    return route.fulfill({json:{checked:1,rows:[{symbol:'TESTETF',latestBar:'2026-11-16',frames:{D:stats,W:stats,M:stats}}]}});
  });
  await page.goto('./');
  await page.getByRole('button',{name:'Scan all U.S. listings'}).click();
  await batch;
  const search=page.getByRole('textbox',{name:'Search symbols'});
  await search.fill('TEST');
  await search.evaluate(el=>el.dataset.retained='yes');
  finish();
  await expect(page.getByRole('button',{name:'View TESTETF'})).toBeVisible();
  await expect(search).toHaveAttribute('data-retained','yes');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('TEST');
});
