import {test,expect} from './market-fixture.js';
import {sampleData} from '../src/engine.js';

const demo=sampleData()['DEMO-SPY'];
const bars=demo.slice(-300).map(b=>({t:b.time+'T21:00:00Z',
 o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
const payload={source:'alpaca',feed:'iex',
 requested:133,returned:2,missing:[],
 freshness:{expected:bars.at(-1).t.slice(0,10)},
 bars:{ABBV:bars,SPY:bars}};

test('Round 23: Fit stays in-sample by default, toggle ranks only validated OOS and follows date controls',async({page})=>{
 test.setTimeout(180000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/stocks/scan?**',route=>route.fulfill({
  status:200,contentType:'application/json',body:JSON.stringify(payload)
 }));
 await page.goto('./');
 await page.locator('.sidebar [data-tab="backtest"]').click();
 await page.locator('[data-action="fit-universe"]').click();
 await expect(page.locator('#fit-source')).toContainText('2/133 symbols backtested',{timeout:120000});
 await expect(page.locator('#fit-source')).toContainText('In-sample ranking');
 await expect(page.locator('#fit-validated-count')).toContainText('of 133 symbols have a validated strategy',{timeout:120000});
 await expect(page.locator('.fit-table tbody tr')).toHaveCount(133);
 const toggle=page.locator('#fit-validated-only');
 await expect(toggle).not.toBeChecked();
 await toggle.check();
 await expect(page.locator('#fit-source')).toContainText('Validated OOS ranking');
 const count=await page.locator('.fit-validated-table tbody tr').count();
 const summary=await page.locator('#fit-validated-count').innerText();
 expect(summary).toContain(count+' of 133 symbols have a validated strategy');
 expect(count).toBeGreaterThanOrEqual(0);expect(count).toBeLessThanOrEqual(2);
 if(count) {
  await expect(page.locator('.fit-validated-table')).toContainText('Rolling mean OOS Sharpe');
  await expect(page.locator('.fit-validated-table')).toContainText('Positive windows');
 } else await expect(page.locator('#fit-validated-empty')).toHaveText(
  'No symbol has a validated strategy on this window');
 const start=demo.at(-80).time,end=demo.at(-21).time;
 await page.locator('[data-bt-range="startDate"]').fill(start);
 await page.locator('[data-bt-range="endDate"]').fill(end);
 await expect(page.locator('#fit-source')).toContainText('selected range '+start+' to '+end,
  {timeout:120000});
 await expect(page.locator('#fit-validated-count')).toContainText('0 of 133 symbols have a validated strategy',{timeout:120000});
 await expect(page.locator('#fit-validated-empty')).toHaveText('No symbol has a validated strategy on this window');
 await expect(page.locator('.fit-validated-table')).toHaveCount(0);
 await toggle.uncheck();
 await expect(page.locator('.fit-table tbody tr')).toHaveCount(133);
 await expect(page.locator('#fit-source')).toContainText('In-sample ranking');
 expect(errors).toEqual([]);
});
