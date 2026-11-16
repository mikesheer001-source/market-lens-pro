import {test,expect} from '@playwright/test';
import {sampleData} from '../src/engine.js';
import {LIVE_UNIVERSE} from '../src/universe.js';

// Fixture mimics the real Alpaca-confirmed Nov 16 case, including the old
// Worker clock cutoff that incorrectly claimed all 133 symbols were current.
test('Round 14: 132 fresh Nov 16 bars and VXZ Nov 13 appear on all four screens',async ({page})=>{
  test.setTimeout(90000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const weekdays=[];
  for(const d=new Date('2026-11-16T00:00:00Z');weekdays.length<280;d.setUTCDate(d.getUTCDate()-1))
    if(d.getUTCDay()!==0&&d.getUTCDay()!==6)weekdays.push(d.toISOString().slice(0,10));
  weekdays.reverse();
  const samples=sampleData()['DEMO-SPY'].slice(-280);
  const bars=samples.map((b,i)=>({t:weekdays[i]+'T21:00:00Z',o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const body={source:'alpaca',timeframe:'1Day',feed:'iex',requested:133,returned:133,missing:[],
    freshness:{expected:'2026-11-13',allFresh:true,checked:133,stale:[]},
    diagnostics:{VXZ:{asset:{found:true,status:'active',tradable:true},
      barsAfterLatest:false,retryFailed:false,latest:'2026-11-13'}},
    bars:Object.fromEntries(LIVE_UNIVERSE.map(sym=>[sym,sym==='VXZ'?bars.slice(0,-1):bars]))};
  await page.route('**/api/stocks/scan?**',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify(body)
  }));
  await page.goto('./');
  await page.locator('[data-action="mode-live"]').first().click();
  await expect(page.locator('#scan-status')).toContainText('133/133 symbols loaded',{timeout:60000});
  await expect(page.locator('#scan-freshness')).toContainText('Stale daily bars · reference latest-bar session 2026-11-16 · 132/133 current');
  await expect(page.locator('#scan-freshness')).not.toContainText('133/133 current');
  const reason='Alpaca returns no bars after Nov 13, 2026 (2026-11-13) on this feed';
  await expect(page.locator('tr[data-symbol="VXZ"] td.fresh-date')).toContainText(reason);
  await expect(page.locator('tr[data-symbol="VXX"] td.fresh-date')).not.toContainText('Alpaca returns no bars after');
  await page.locator('.sidebar [data-tab="data"]').click();
  await expect(page.locator('#data-freshness')).toContainText('132/133 current');
  await expect(page.locator('#data-freshness [data-data-stale-symbol="VXZ"]')).toContainText(reason);
  await page.locator('.sidebar [data-tab="charts"]').click();
  await page.locator('[data-option="symbol"]').selectOption('VXZ');
  await expect(page.locator('#chart-stale-warning')).toContainText(reason);
  await expect(page.locator('#chart-stale-warning')).toContainText('2026-11-16');
  await page.locator('.sidebar [data-tab="volatility"]').click();
  await expect(page.locator('tr[data-vol-symbol="VXZ"]')).toContainText(reason);
  await expect(page.locator('tr[data-vol-symbol="VXX"]')).not.toContainText('Alpaca returns no bars after');
  expect(errors).toEqual([]);
});
