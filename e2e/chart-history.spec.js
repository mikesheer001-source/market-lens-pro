import {test,expect} from './market-fixture.js';
import {LIVE_SCAN_CACHE_REVISION} from '../src/live-history.js';
import {sampleData} from '../src/engine.js';
import {expectedNyseBarDate} from '../src/freshness.js';

const fixture=(t,c=100)=>({t,o:c,h:c+1,l:c-1,c,v:50000});
const daily=sampleData()['DEMO-SPY'].slice(500,1750).map(bar=>fixture(bar.time+'T05:00:00Z',bar.close));
async function openLiveChart(page){
  await page.route('**/api/stocks/scan?**',route=>route.fulfill({json:{
    source:'alpaca',feed:'iex',lookback_days:1825,scan_cache_revision:LIVE_SCAN_CACHE_REVISION,
    requested:133,returned:1,missing:[],bars:{SPY:daily}
  }}));
  await page.goto('./');
  await expect(page.locator('#scan-status')).toContainText('1/133 symbols loaded');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await expect(page.locator('.chart-data')).toContainText(daily.length+' D bars');
}

test('zooming out at the left edge prepends daily candles without affecting the Screener',async ({page})=>{
  let requests=0;
  await page.route('**/api/stocks/bars?**',route=>{
    requests++;
    const params=new URL(route.request().url()).searchParams;
    expect(params.get('symbol')).toBe('SPY');
    expect(params.get('timeframe')).toBe('1Day');
    expect(Date.parse(params.get('end'))).toBeLessThan(Date.parse(daily[0].t));
    return route.fulfill({json:{bars:[fixture('2021-01-04T05:00:00Z'),...daily.slice(0,1)]}});
  });
  await openLiveChart(page);
  await page.getByRole('button',{name:'All',exact:true}).click();
  expect(requests).toBe(0);
  const area=page.locator('#price-chart');
  await area.scrollIntoViewIfNeeded();
  const bounds=await area.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  await page.mouse.wheel(0,420);
  await expect(page.locator('.chart-data')).toContainText((daily.length+1)+' D bars');
  expect(requests).toBe(1);
  await page.locator('.sidebar [data-tab="screener"]').click();
  await expect(page.locator('tr[data-symbol="SPY"] td').nth(8)).toHaveText(String(daily.length));
});

test('older intraday requests follow page tokens and deduplicate bars',async ({page})=>{
  const initial=[fixture('2025-06-02T13:30:00Z'),fixture('2025-06-02T13:45:00Z')];
  const tokens=[];
  await page.route('**/api/stocks/intraday?**',route=>route.fulfill({json:{bars:initial,feed:'iex'}}));
  await page.route('**/api/stocks/bars?**',route=>{
    const params=new URL(route.request().url()).searchParams;
    expect(params.get('timeframe')).toBe('15Min');
    expect(Date.parse(params.get('end'))).toBeLessThan(Date.parse(initial[0].t));
    const token=params.get('page_token');
    tokens.push(token);
    return route.fulfill({json:token?
      {bars:[fixture('2025-05-30T13:30:00Z'),fixture('2025-05-30T13:45:00Z')]}:
      {bars:[fixture('2025-05-30T13:30:00Z')],next_page_token:'older-page-2'}});
  });
  await openLiveChart(page);
  await page.locator('[data-timeframe="15m"]').click();
  await expect(page.locator('.chart-data')).toContainText('2 15m bars');
  await page.getByRole('button',{name:'Older bars',exact:true}).click();
  await expect(page.locator('.chart-data')).toContainText('4 15m bars');
  expect(tokens).toEqual([null,'older-page-2']);
});

test('a quick scan finishing in Chart Lab leaves the chart mounted and caches the results',async ({page})=>{
  await openLiveChart(page);
  await page.locator('.sidebar [data-tab="screener"]').click();
  let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  let started;
  const fetchStarted=new Promise(resolve=>{started=resolve;});
  await page.route('**/api/stocks/scan?**',async route=>{
    started();
    await pending;
    return route.fulfill({json:{
      source:'alpaca',feed:'iex',lookback_days:1825,scan_cache_revision:LIVE_SCAN_CACHE_REVISION,
      requested:133,returned:1,bars:{SPY:daily}
    }});
  });
  await page.locator('[data-action="scan-universe"]').click();
  await fetchStarted;
  await page.locator('.sidebar [data-tab="charts"]').click();
  const chart=page.locator('#price-chart');
  await chart.evaluate(el=>el.dataset.retained='yes');
  const response=page.waitForResponse('**/api/stocks/scan?**');
  finish();
  await response;
  await expect(chart).toHaveAttribute('data-retained','yes');
  await page.locator('.sidebar [data-tab="screener"]').click();
  await expect(page.locator('#scan-status')).toContainText('1/133 symbols loaded');
  await expect(page.getByRole('button',{name:'View SPY',exact:true})).toBeVisible();
});

test('a stale in-memory intraday series refreshes when Chart Lab is rendered again',async({page})=>{
  await openLiveChart(page);
  await page.clock.install({time:new Date()});
  const expected=expectedNyseBarDate();
  const staleDate=new Date(Date.parse(expected+'T12:00:00Z')-2*86400000).toISOString().slice(0,10);
  const stale=[fixture(staleDate+'T14:30:00Z'),fixture(staleDate+'T14:45:00Z')];
  const fresh=[fixture(expected+'T14:30:00Z',110),fixture(expected+'T14:45:00Z',111)];
  let requests=0;
  await page.route('**/api/stocks/intraday?**',route=>{
    requests++;
    return route.fulfill({json:{source:'alpaca',symbol:'SPY',feed:'iex',timeframe:'15Min',
      bars:requests===1?stale:fresh}});
  });
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('[data-timeframe="15m"]').click();
  await expect(page.locator('.chart-data')).toContainText('2 15m bars');
  expect(requests).toBe(1);
  await expect(page.locator('#readout time')).toHaveText(stale[1].t.slice(0,16).replace('T',' '));
  // Simulate an app that stayed open beyond the five-minute freshness window.
  await page.clock.fastForward(300_001);
  await page.locator('.sidebar [data-tab="screener"]').click();
  await page.locator('.sidebar [data-tab="charts"]').click();
  await expect.poll(()=>requests).toBe(2);
  await expect(page.locator('.chart-data')).toContainText('2 15m bars');
  await expect(page.locator('#readout time')).toHaveText(fresh[1].t.slice(0,16).replace('T',' '));
  expect(errors).toEqual([]);
});
