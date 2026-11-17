import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {sampleData} from '../src/engine.js';

const demo=sampleData()['DEMO-SPY'];
const dataBars=demo.slice(-300).map(b=>({t:b.time+'T21:00:00Z',
 o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
const payload={source:'alpaca',feed:'iex',requested:133,returned:2,missing:[],
 freshness:{expected:dataBars.at(-1).t.slice(0,10)},
 bars:{ABBV:dataBars,SPY:dataBars}};
const csvLines=x=>x.trimEnd().split(/\r?\n/);
async function downloadCsv(page,selector){
 const wait=page.waitForEvent('download');
 await page.locator(selector).click();
 const d=await wait;return {filename:d.suggestedFilename(),
   contents:await readFile(await d.path(),'utf8')};
}
test('Round 25 leaderboard CSV matches filtered and sorted visible rows and selected dates',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('./');
 await page.locator('.sidebar [data-tab="backtest"]').click();
 await page.locator('[data-action="compare-strategies"]').first().click();
 await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
 await page.locator('[data-action="sort-leaderboard"][data-key="name"]').click();
 const initial=await downloadCsv(page,'[data-action="export-leaderboard"]');
 const rows=await page.locator('.leaderboard-table tbody tr').evaluateAll(items=>items.map(tr=>
   [...tr.querySelector('td').childNodes].filter(n=>n.nodeType===3)
     .map(n=>n.textContent.trim()).join('').trim()));
 const values=csvLines(initial.contents);
 expect(values.length).toBe(rows.length+1);
 expect(values[0]).toContain('Rolling median OOS Sharpe');
 expect(values.slice(1).map(x=>x.split(',')[0])).toEqual(rows);
 await page.locator('#leaderboard-validated-only').check();
 const selectedStart=demo[850].time,selectedEnd=demo[1150].time;
 await page.locator('[data-bt-range="startDate"]').fill(selectedStart);
 await page.locator('[data-bt-range="endDate"]').fill(selectedEnd);
 await expect(page.locator('#leaderboard-window')).toContainText(selectedStart+' to '+selectedEnd);
 const filtered=await page.locator('.leaderboard-table tbody tr').count();
 const second=await downloadCsv(page,'[data-action="export-leaderboard"]');
 expect(second.filename).toBe('leaderboard-validated-only-'+selectedStart+'-to-'+selectedEnd+'.csv');
 expect(csvLines(second.contents).length).toBe(filtered+1);
 if(filtered)expect(csvLines(second.contents).slice(1).every(row=>
   row.split(',')[8].startsWith('Validated ('))).toBe(true);
 expect(errors).toEqual([]);
});
test('Round 25 Fit CSV uses in-sample sort and validated-only ranking, never unshown symbols',async({page})=>{
 test.setTimeout(180000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/stocks/scan?**',route=>route.fulfill({
   status:200,contentType:'application/json',body:JSON.stringify(payload)
 }));
 await page.goto('./');
 await page.locator('.sidebar [data-tab="backtest"]').click();
 await page.locator('[data-action="fit-universe"]').click();
 await expect(page.locator('.fit-table tbody tr')).toHaveCount(133,{timeout:150000});
 await page.locator('[data-action="sort-fit"][data-key="symbol"]').click();
 const symbols=await page.locator('.fit-table tbody tr').evaluateAll(rows=>
   rows.map(tr=>tr.getAttribute('data-fit-symbol')));
 const original=await downloadCsv(page,'[data-action="export-fit"]');
 expect(csvLines(original.contents).slice(1).map(x=>x.split(',')[0])).toEqual(symbols);
 expect(original.filename).toMatch(/^fit-across-universe-in-sample-/);
 await page.locator('#fit-validated-only').check();
 const activeSymbols=await page.locator('.fit-validated-table tbody tr').evaluateAll(rows=>
   rows.map(tr=>tr.getAttribute('data-fit-symbol')));
 const validated=await downloadCsv(page,'[data-action="export-fit"]');
 expect(csvLines(validated.contents).slice(1).map(x=>x.split(',')[0])).toEqual(activeSymbols);
 expect(validated.contents).toContain('Rolling mean OOS Sharpe');
 expect(validated.filename).toMatch(/^fit-across-universe-validated-only-/);
 const start=demo.at(-80).time,end=demo.at(-21).time;
 await page.locator('[data-bt-range="startDate"]').fill(start);
 await page.locator('[data-bt-range="endDate"]').fill(end);
 await expect(page.locator('#fit-validated-count')).toContainText('0 of 133 symbols have a validated strategy',{timeout:150000});
 const empty=await downloadCsv(page,'[data-action="export-fit"]');
 expect(empty.filename).toBe('fit-across-universe-validated-only-'+start+'-to-'+end+'.csv');
 expect(csvLines(empty.contents).length).toBe(1);
 expect(errors).toEqual([]);
});
test('Round 25 best-fit CSV contains only displayed holdings, numeric weights and portfolio headlines',async({page})=>{
 test.setTimeout(180000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('./');
 await page.locator('[data-option="preset"]').selectOption('all');
 await page.locator('.sidebar [data-tab="backtest"]').click();
 await page.locator('[data-option="portfolio-mode"]').selectOption('best-fit');
 await page.locator('[data-action="run-best-fit"]').click();
 await expect(page.locator('#portfolio-breakdown tbody tr')).toHaveCount(4,{timeout:100000});
 const symbols=await page.locator('#portfolio-breakdown tbody tr').evaluateAll(rows=>
   rows.map(tr=>tr.getAttribute('data-portfolio-symbol')));
 const original=await downloadCsv(page,'[data-action="export-portfolio"]');
 const lines=csvLines(original.contents);
 expect(lines.slice(0,4).map(l=>l.split(',')[0])).toEqual([
   'Portfolio total return (%)','Portfolio CAGR (%)','Portfolio Sharpe','Portfolio max drawdown (%)']);
 expect(lines[4]).toBe('');
 expect(lines.slice(6).map(x=>x.split(',')[0])).toEqual(symbols);
 expect(original.filename).toMatch(/^best-fit-portfolio-in-sample-/);
 await page.locator('#best-fit-validated-only').check();
 await expect(page.locator('#portfolio-source')).toBeVisible({timeout:120000});
 const count=await page.locator('#portfolio-breakdown tbody tr').count();
 const validated=await downloadCsv(page,'[data-action="export-portfolio"]');
 expect(csvLines(validated.contents).length).toBe(count+6);
 expect(validated.filename).toMatch(/^best-fit-portfolio-validated-only-/);
 const start=demo[300].time,end=demo[359].time;
 await page.locator('[data-bt-range="startDate"]').fill(start);
 await page.locator('[data-bt-range="endDate"]').fill(end);
 await expect(page.locator('#best-fit-validated-empty')).toBeVisible({timeout:120000});
 const empty=await downloadCsv(page,'[data-action="export-portfolio"]');
 expect(csvLines(empty.contents).length).toBe(6);
 expect(empty.filename).toBe('best-fit-portfolio-validated-only-'+start+'-to-'+end+'.csv');
 expect(errors).toEqual([]);
});
