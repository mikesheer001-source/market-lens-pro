import {test,expect} from '@playwright/test';
import {LIVE_UNIVERSE} from '../src/universe.js';
import {sampleData} from '../src/engine.js';

test('Round 13 live Daily Briefing compiles real-source fields, copies text and retains one dated history record',async ({page})=>{
  test.setTimeout(90000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const bars=sampleData()['DEMO-SPY'].slice(-320).map(b=>({
    t:b.time+'T21:00:00Z',o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume
  }));
  const finalDate=bars.at(-1).t.slice(0,10);
  const staleDate=bars.at(-4).t.slice(0,10);
  const fixture={
    source:'alpaca',feed:'iex',requested:133,returned:133,missing:[],
    freshness:{expected:finalDate,checked:133},
    diagnostics:{VXZ:{asset:{found:true,status:'active',tradable:true},barsAfterLatest:false}},
    bars:Object.fromEntries(LIVE_UNIVERSE.map(sym=>[sym,sym==='VXZ'?bars.slice(0,-3):bars]))
  };
  await page.route('**/api/stocks/scan?**',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify(fixture)
  }));
  await page.goto('./');
  await page.locator('[data-option="preset"]').selectOption('all');
  await page.locator('.sidebar [data-tab="briefing"]').click();
  await expect(page.getByRole('heading',{name:'Briefing'})).toBeVisible();
  await expect(page.locator('#briefing-history')).toContainText('No saved daily briefings');
  await page.locator('[data-option="briefing-strategy"]').selectOption('preset:ema-cross');
  await page.locator('[data-action="generate-briefing"]').click();
  await expect(page.locator('#briefing-metadata')).toContainText('ALPACA IEX 1Day',{timeout:60000});
  await expect(page.locator('#briefing-scan')).toContainText('133');
  await expect(page.locator('tr[data-briefing-match]')).toHaveCount(133);
  await expect(page.locator('tr[data-briefing-match="MRSH"]')).toContainText('ALPACA IEX 1Day');
  await expect(page.locator('tr[data-briefing-match="MMC"]')).toHaveCount(0);
  await expect(page.locator('#briefing-signals')).toContainText('EMA crossover');
  await expect(page.locator('#briefing-signals')).toContainText('No preceding comparable scan');
  await expect(page.locator('#briefing-regime')).toContainText('NOT VIX FUTURES CONTANGO');
  await expect(page.locator('#briefing-vxx')).toContainText('VXX 20D return');
  await expect(page.locator('#briefing-alerts')).toContainText('Source: LOCAL browser alerts');
  await expect(page.locator('#briefing-stale')).toContainText('VXZ');
  await expect(page.locator('#briefing-stale')).toContainText('Alpaca returns no bars after '+staleDate);
  await expect(page.locator('#briefing-history .briefing-history-row')).toHaveCount(1);

  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.locator('[data-action="copy-briefing"]').click();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  expect(copied).toContain('MARKET LENS PRO — DAILY BRIEFING');
  expect(copied).toContain('LONG (');
  expect(copied).toContain('RSI 5D');
  expect(copied).toContain('NOT VIX FUTURES CONTANGO');
  expect(copied).toContain('VXX: $');
  expect(copied).toContain('Stale/missing bars (1): VXZ');

  await page.locator('[data-action="generate-briefing"]').click();
  await expect(page.locator('#briefing-signals')).toContainText('No position flips since the preceding comparable scan',{timeout:60000});
  await expect(page.locator('#briefing-history .briefing-history-row')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.sidebar [data-tab="briefing"]')).toHaveClass(/active/);
  await expect(page.locator('#briefing-history .briefing-history-row')).toHaveCount(1,{timeout:60000});
  await expect(page.locator('#briefing-scan')).toContainText('133',{timeout:60000});
  expect(errors).toEqual([]);
});

test('Round 13 Briefing never treats Demo prices as live source or historical snapshot as a current scan',async ({page})=>{
  await page.goto('./');
  await page.locator('.sidebar [data-tab="briefing"]').click();
  await expect(page.locator('#briefing-metadata')).toHaveCount(0);
  await expect(page.getByText('No live briefing generated in this session',{exact:false})).toBeVisible();
  await expect(page.locator('#briefing-history')).toBeVisible();
});
