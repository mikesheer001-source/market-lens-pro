import {test,expect} from './market-fixture.js';

test('one and five minute chart intervals use separate genuine provider resolutions and do not share cached candles',async({page})=>{
  const requests=[];
  await page.route('**/api/stocks/bars?**',route=>{
    const params=new URL(route.request().url()).searchParams;
    const timeframe=params.get('timeframe');
    requests.push(timeframe);
    const minutes=timeframe==='1Min'?1:5;
    const bars=Array.from({length:12},(_,i)=>({t:new Date(Date.UTC(2026,10,23,14,30+i*minutes)).toISOString(),o:100+i,h:102+i,l:99+i,c:101+i,v:1000}));
    return route.fulfill({json:{source:'alpaca',feed:'iex',timeframe,bars,next_page_token:null}});
  });
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await page.locator('[data-timeframe="1m"]').click();
  await expect(page.locator('.chart-data')).toContainText('12 1m bars');
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await page.locator('[data-timeframe="5m"]').click();
  await expect(page.locator('.chart-data')).toContainText('12 5m bars');
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  expect(requests).toEqual(['1Min','5Min']);
  await page.locator('[data-timeframe="1m"]').click();
  await expect(page.locator('.chart-data')).toContainText('12 1m bars');
  expect(requests).toEqual(['1Min','5Min']);
});
