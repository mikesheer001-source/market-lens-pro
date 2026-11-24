import {test,expect} from './market-fixture.js';
import {chooseSymbol} from './chart-symbol.js';
import {sampleData} from '../src/engine.js';
import {DEFAULT_ALPACA_WORKER,LIVE_SCAN_CACHE_REVISION} from '../src/live-history.js';

const localHistory=sampleData()['DEMO-SPY'];
const longBars=[];
for(let n=1825;n>=0;n--){
  const d=new Date(Date.UTC(2026,10,16)-n*86400000);
  if(d.getUTCDay()===0||d.getUTCDay()===6)continue;
  const price=100+.03*longBars.length;
  longBars.push({t:d.toISOString().slice(0,10)+'T00:00:00Z',
    o:price,h:price+1,l:price-1,c:price,v:20000});
}
const fresh={source:'alpaca',feed:'iex',lookback_days:1825,
  scan_cache_revision:LIVE_SCAN_CACHE_REVISION,
  requested:133,returned:2,missing:[],
  freshness:{expected:'2026-11-16'},bars:{ABBV:longBars,SPY:longBars}};
const stale={...fresh,lookback_days:550,scan_cache_revision:'round14',
  bars:{ABBV:longBars.slice(-378),SPY:longBars.slice(-378)}};

test('Round 21: selected 132-bar range reports ZERO assessable rolling rows, unlike single-split',async ({page})=>{
  await page.goto('./');
  await page.locator('.sidebar [data-tab="backtest"]').click();
  await page.locator('[data-action="compare-strategies"]').first().click();
  const start=100,end=start+131;
  await page.locator('[data-bt-range="startDate"]').fill(localHistory[start].time);
  await page.locator('[data-bt-range="endDate"]').fill(localHistory[end].time);
  await expect(page.locator('#leaderboard-source')).toContainText('132 bars');
  await expect(page.locator('.leaderboard-table tbody tr')).toHaveCount(12);
  await expect(page.locator('#rolling-wf-result')).toContainText('0 of 0 assessable strategies');
  await expect(page.locator('#rolling-wf-result')).toContainText('NOT the single-split holdout count');
  const cells=page.locator('.leaderboard-table tbody tr');
  expect((await cells.locator('td:nth-child(6)').allTextContents()).every(x=>x.trim()==='—')).toBe(true);
  expect((await cells.locator('td:nth-child(7)').allTextContents()).every(x=>x.trim()==='—')).toBe(true);
  await expect(page.locator('#walk-forward-summary')).toContainText('single 70/30 chronological holdout');
  await page.locator('[data-action="clear-bt-dates"]').click();
  const full=await page.locator('.leaderboard-table tbody tr').count();
  await expect(page.locator('#leaderboard-window')).toHaveText('Full range');
  const values=await page.locator('.leaderboard-table tbody tr').evaluateAll(rows=>rows.map(tr=>({
    mean:tr.children[5].textContent.trim(),median:tr.children[6].textContent.trim()
  })));
  const numeric=values.filter(v=>v.mean!=='—'&&v.median!=='—').length;
  await page.locator('[data-backtest-section="validation"] summary').click();
  const summaryText=await page.locator('#rolling-wf-result').innerText();
  expect(summaryText).toContain('of '+numeric+' assessable strategies');
  expect(full).toBe(12);
});

test('Round 21: stale imported IndexedDB ABBV history never overrides a real five-year Live Worker response',async ({page})=>{
  test.setTimeout(120000);
  await page.goto('./');
  await page.evaluate(async()=>{
    const db=await new Promise((ok,bad)=>{
      const request=indexedDB.open('market-lens-pro-datasets');
      request.onupgradeneeded=()=>{
        if(!request.result.objectStoreNames.contains('symbols'))
          request.result.createObjectStore('symbols',{keyPath:'symbol'});
        if(!request.result.objectStoreNames.contains('intraday'))
          request.result.createObjectStore('intraday',{keyPath:'key'});
      };
      request.onsuccess=()=>ok(request.result);request.onerror=()=>bad(request.error);
    });
    const tx=db.transaction('symbols','readwrite');
    tx.objectStore('symbols').put({symbol:'ABBV',bars:Array.from({length:378},(_,i)=>({
      time:'2025-06-01',open:1,high:2,low:.5,close:1,volume:i
    }))});
    await new Promise((ok,bad)=>{tx.oncomplete=ok;tx.onerror=()=>bad(tx.error)});
    db.close();
  });
  await page.route('**/api/stocks/scan?**',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify(fresh),
    headers:{'X-Scan-Cache':'MISS'}}));
  await page.reload();
  await expect(page.locator('#scan-status')).toContainText('2/133 symbols loaded');
  await expect(page.locator('tr[data-symbol="ABBV"] td').nth(8)).toHaveText(String(longBars.length));
  await expect(page.locator('[data-weekly-ema200="ABBV"]')).not.toHaveText('—');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await chooseSymbol(page,'ABBV');
  await expect(page.getByText(longBars.length+' D bars',{exact:false})).toBeVisible();
  await page.locator('.sidebar [data-tab="data"]').click();
  await expect(page.locator('#scan-duration')).toContainText('Worker reported 1825 daily lookback days');
  await expect(page.locator('#scan-duration')).toContainText('ABBV '+longBars.length+' actual bars');
  await expect(page.locator('#scan-duration')).toContainText('SPY '+longBars.length+' actual bars');
});

test('Round 21: saved outdated Worker is detected and switched to verified official Worker',async ({page})=>{
  test.setTimeout(120000);
  const oldWorker='https://old-worker.example.workers.dev';
  let legacyRequests=0,officialRequests=0;
  await page.route('**/api/stocks/scan?**',route=>{
    const url=route.request().url();
    if(url.startsWith(oldWorker)){legacyRequests++;return route.fulfill({
      status:200,contentType:'application/json',body:JSON.stringify(stale)
    });}
    if(url.startsWith(DEFAULT_ALPACA_WORKER)){officialRequests++;return route.fulfill({
      status:200,contentType:'application/json',body:JSON.stringify(fresh)
    });}
    return route.abort();
  });
  await page.addInitScript(base=>localStorage.setItem('market-lens-pro-settings',
    JSON.stringify({apiBaseUrl:base})),oldWorker);
  await page.goto('./');
  await expect(page.locator('#scan-status')).toContainText('2/133 symbols loaded');
  expect(legacyRequests).toBe(1);
  expect(officialRequests).toBe(1);
  await expect(page.locator('tr[data-symbol="ABBV"] td').nth(8)).toHaveText(String(longBars.length));
  await page.locator('.sidebar [data-tab="data"]').click();
  await expect(page.locator('[data-setting="apiBaseUrl"]')).toHaveValue(DEFAULT_ALPACA_WORKER);
  await expect(page.locator('#scan-duration')).toContainText(
    'Outdated saved Worker automatically replaced with the official Worker');
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('market-lens-pro-settings')));
  expect(stored.apiBaseUrl).toBe(DEFAULT_ALPACA_WORKER);
});
