import {test,expect} from './market-fixture.js';
import {readFile} from 'node:fs/promises';
import {sampleData} from '../src/engine.js';

const prices=sampleData()['DEMO-SPY'];
const bars=prices.slice(-300).map(b=>({t:b.time+'T21:00:00Z',
 o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
const payload={source:'alpaca',feed:'iex',requested:133,returned:2,missing:[],
 freshness:{expected:bars.at(-1).t.slice(0,10)},bars:{SPY:bars,ABBV:bars}};
async function download(page,action){
 const pending=page.waitForEvent('download');
 await page.locator('[data-action="'+action+'"]').click();
 const artifact=await pending;
 return (await readFile(await artifact.path(),'utf8')).trimEnd().split(/\r?\n/);
}

test('Round 26: leaderboard Validated-only count, all per-row reason badges and CSV agree',async({page})=>{
 const errors=[];page.on('pageerror',err=>errors.push(err.message));
 await page.goto('./');
 await page.locator('.sidebar [data-tab="backtest"]').click();
 await page.locator('[data-action="compare-strategies"]').first().click();
 await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
 await page.locator('#leaderboard-validated-only').check();
 const rows=page.locator('.leaderboard-table tbody tr');
 const count=await rows.count();
 await expect(page.locator('#leaderboard-validation-count')).toContainText(
   'Showing '+count+' of 12 total leaderboard rows');
 const labels=await rows.locator('td:nth-child(9)').allTextContents();
 expect(labels.every(x=>x.includes('Validated (')&&!x.includes('Not validated'))).toBe(true);
 const csv=await download(page,'export-leaderboard');
 expect(csv.length).toBe(count+1);
 expect(csv.slice(1).map(x=>x.split(',')[8])).toEqual(labels.map(x=>x.trim()));
 expect(errors).toEqual([]);
});

test('Round 26: validated best-fit headline equals badge count and all CSV validation labels',async({page})=>{
 test.setTimeout(180000);
 const errors=[];page.on('pageerror',err=>errors.push(err.message));
 await page.goto('./');
 await page.locator('[data-option="preset"]').selectOption('all');
 await page.locator('.sidebar [data-tab="backtest"]').click();
 await page.locator('[data-option="portfolio-mode"]').selectOption('best-fit');
 await page.locator('#best-fit-validated-only').check();
 await page.locator('[data-action="run-best-fit"]').click();
 await expect(page.locator('#portfolio-source')).toBeVisible({timeout:150000});
 const rows=page.locator('#portfolio-breakdown tbody tr');
 const count=await rows.count();
 await expect(page.locator('#best-fit-validation-count')).toContainText(
   count+' of 4 selected symbols qualify');
 const labels=await rows.locator('td:nth-child(12)').allTextContents();
 expect(labels.length).toBe(count);
 expect(labels.every(x=>x.includes('Validated (')&&!x.includes('Not validated'))).toBe(true);
 if(count){
   const csv=await download(page,'export-portfolio');
   expect(csv.slice(6).map(x=>x.split(',').at(-1))).toEqual(labels.map(x=>x.trim()));
 }else await expect(page.locator('#best-fit-validated-empty')).toBeVisible();
 await page.locator('[data-bt-range="startDate"]').fill(prices[300].time);
 await page.locator('[data-bt-range="endDate"]').fill(prices[359].time);
 await expect(page.locator('#best-fit-validation-count')).toContainText(
  '0 of 4 selected symbols qualify',{timeout:150000});
 await expect(page.locator('#best-fit-validated-empty')).toBeVisible();
 const empty=await download(page,'export-portfolio');
 expect(empty.length).toBe(6);
 expect(errors).toEqual([]);
});

test('Round 26: validated universe Fit qualification labels match count and exported reasons',async({page})=>{
 test.setTimeout(180000);
 const errors=[];page.on('pageerror',err=>errors.push(err.message));
 await page.route('**/api/stocks/scan?**',route=>route.fulfill({
  status:200,contentType:'application/json',body:JSON.stringify(payload)
 }));
 await page.goto('./');
 await page.locator('.sidebar [data-tab="backtest"]').click();
 await page.locator('[data-action="fit-universe"]').click();
 await expect(page.locator('.fit-table tbody tr')).toHaveCount(133,{timeout:150000});
 await page.locator('#fit-validated-only').check();
 await expect(page.locator('#fit-source')).toContainText('Validated OOS ranking');
 const rows=page.locator('.fit-validated-table tbody tr');
 const count=await rows.count();
 await expect(page.locator('#fit-validated-count')).toContainText(
   count+' of 133 symbols have a validated strategy');
 const labels=await rows.locator('td:nth-child(6)').allTextContents();
 expect(labels.every(x=>x.includes('Validated (')&&!x.includes('Not validated'))).toBe(true);
 const csv=await download(page,'export-fit');
 expect(csv.length).toBe(count+1);
 expect(csv.slice(1).map(x=>x.split(',')[5])).toEqual(labels.map(x=>x.trim()));
 expect(errors).toEqual([]);
});
