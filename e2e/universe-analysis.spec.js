import {test,expect} from './market-fixture.js';

function makeBars(count=300,offset=0){
 return Array.from({length:count},(_,index)=>{
  const close=100+offset+index*.04+Math.sin(index/8)*3;
  return {t:new Date(Date.UTC(2025,0,1+index)).toISOString().replace('.000',''),
   o:close-.2,h:close+1,l:close-1,c:close,v:10000+index};
 });
}

test('backtester and single-symbol strategy leaderboard can select and download any directory ticker',async({page})=>{
 const errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/stocks/universe*',route=>route.fulfill({json:{
  source:'alpaca-v2-assets',id:'directory-test',count:4,symbols:['SPY','VXX','QQQ','AAPL']
 }}));
 await page.route('**/api/stocks/bars?**',async route=>{
  const url=new URL(route.request().url());
  const symbol=url.searchParams.get('symbol');
  requests.push({symbol});
  return route.fulfill({json:{source:'alpaca',feed:'iex',timeframe:'1Day',bars:makeBars(300,5)}});
 });
 await page.goto('./');
 await page.locator('.sidebar [data-tab="backtest"]').click();
 await expect(page.locator('.symbol-search')).toHaveAttribute('placeholder',/4 Alpaca/);
 await page.locator('.symbol-search').fill('AAPL');
 const response=page.waitForResponse(response=>response.url().includes('/api/stocks/bars')&&
  new URL(response.url()).searchParams.get('symbol')==='AAPL');
 await page.locator('[data-option="symbol"]').selectOption('AAPL');
 await response;
 await expect(page.locator('[data-option="symbol"]')).toHaveValue('AAPL');
 expect(requests).toHaveLength(1);
 expect(requests[0].symbol).toBe('AAPL');
 await page.locator('[data-action="run-backtest"]').click();
 await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
 await page.locator('[data-action="compare-strategies"]').first().click();
 await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
 await expect(page.locator('#leaderboard-source')).toContainText('AAPL');
 expect(errors).toEqual([]);
});

test('full-universe analysis streams more than the quick universe into backtests, Fit, leaderboard and signals',async({page})=>{
 const errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));
 const symbols=Array.from({length:134},(_,index)=>'U'+String(index).padStart(4,'0'));
 const rows=makeBars(80);
 await page.route('**/api/stocks/universe*',route=>route.fulfill({json:{
  source:'alpaca-v2-assets',id:'large-test-directory',count:symbols.length,symbols
 }}));
 await page.route('**/api/stocks/bars?**',async route=>{
  const url=new URL(route.request().url());
  const batch=url.searchParams.get('symbols').split(',');
  requests.push({symbols:batch,limit:url.searchParams.get('limit'),sort:url.searchParams.get('sort'),
   timeframe:url.searchParams.get('timeframe'),feed:url.searchParams.get('feed')});
  return route.fulfill({json:{source:'alpaca',feed:'iex',timeframe:'1Day',
   bars:Object.fromEntries(batch.map((symbol,index)=>[symbol,rows.map(bar=>({
    ...bar,c:bar.c+index*.01,o:bar.o+index*.01,h:bar.h+index*.01,l:bar.l+index*.01
   }))])),next_page_token:null}});
 });
 await page.goto('./');
 await page.locator('.sidebar [data-tab="backtest"]').click();
 await expect(page.locator('.symbol-search')).toHaveAttribute('placeholder',/134 Alpaca/);
 await page.locator('.sidebar [data-tab="screener"]').click();
 await page.locator('[data-option="signal-strategy"]').selectOption('preset:ema-cross');
 await page.locator('[data-action="run-universe-analysis"]').click();
 await expect(page.locator('#fit-source')).toContainText('134/134 symbols backtested',{timeout:180000});
 await expect(page.locator('#universe-fit .fit-table tbody tr')).toHaveCount(134);
 await expect(page.locator('#universe-leaderboard-table tbody tr').first()).toBeVisible();
 await expect.poll(()=>requests.length,{timeout:30000}).toBe(2);
 expect(requests.map(request=>request.symbols.length)).toEqual([100,34]);
 expect(requests.every(request=>request.limit==='10000'&&request.sort==='asc'&&
  request.timeframe==='1Day'&&request.feed==='iex')).toBe(true);
 await page.locator('.sidebar [data-tab="screener"]').click();
 await expect(page.locator('#universe-signal-status')).toContainText('134 evaluated');
 await expect(page.locator('#universe-signal-results')).toBeVisible();
 expect(errors).toEqual([]);
});
