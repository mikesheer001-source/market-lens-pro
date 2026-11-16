import {test,expect} from '@playwright/test';
import {LIVE_UNIVERSE,ALPACA_SCAN_LOOKBACK_DAYS} from '../src/universe.js';
import {aggregate,statsFor} from '../src/engine.js';

const history=[];
const date=Date.UTC(2026,10,16);
for(let offset=ALPACA_SCAN_LOOKBACK_DAYS;offset>=0;offset--){
  const day=new Date(date-offset*86400000);
  if(day.getUTCDay()===0||day.getUTCDay()===6)continue;
  const base=100+history.length*.1;
  history.push({t:day.toISOString().slice(0,10)+'T00:00:00Z',
    o:base,h:base+1,l:base-1,c:base+.25,v:50000});
}
const payload={source:'alpaca',feed:'iex',requested:133,returned:133,
  lookback_days:1825,scan_duration_ms:12000,missing:[],
  bars:Object.fromEntries(LIVE_UNIVERSE.map(s=>[s,history])),
  freshness:{expected:'2026-11-16',checked:133},diagnostics:{}};
const responseBody=JSON.stringify(payload);

test('Round 19: a real-five-year-length mocked scan fills W EMA200 and shows >1200 daily candles',async ({page})=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/stocks/scan?**',route=>route.fulfill({
    status:200,contentType:'application/json',body:responseBody,
    headers:{'X-Scan-Cache':'MISS'}}));
  await page.goto('./');
  await page.locator('.mode-switch [data-action="mode-live"]').click();
  await expect(page.locator('#scan-status')).toContainText('133/133 symbols loaded',{timeout:150000});
  await expect(page.locator('tr[data-symbol]')).toHaveCount(133);
  await expect(page.locator('thead th')).toContainText(['% vs W EMA200']);
  const weekly=page.locator('tr[data-symbol="SPY"] [data-weekly-ema200="SPY"]');
  await expect(weekly).toBeVisible();
  await expect(weekly).not.toHaveText('—');
  const n=await page.locator('tr[data-symbol="SPY"] td').nth(8).textContent();
  expect(Number(n)).toBeGreaterThan(1200);
  const wk=statsFor(aggregate(history.map(x=>({
    time:x.t.slice(0,10),open:x.o,high:x.h,low:x.l,close:x.c,volume:x.v
  })),'W'));
  const pct=100*(wk.price/wk.ema200-1);
  expect(wk.bars).toBeGreaterThan(250);
  const display=(pct>0?'+':'')+pct.toLocaleString('en-US',{
    minimumFractionDigits:2,maximumFractionDigits:2})+'%';
  await expect(weekly).toHaveText(display);
  await page.locator('.sidebar [data-tab="charts"]').click();
  await page.locator('[data-option="symbol"]').selectOption('SPY');
  await expect(page.getByText(new RegExp(history.length+' D bars'))).toBeVisible();
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await page.locator('.sidebar [data-tab="data"]').click();
  await expect(page.locator('#scan-duration')).toContainText('Last live scan:');
  await expect(page.locator('#scan-duration')).toContainText('Worker acquisition 12.00 seconds');
  await expect(page.locator('#scan-duration')).toContainText('1825-day daily lookback');
  expect(errors).toEqual([]);
});
