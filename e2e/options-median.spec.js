import {test,expect} from '@playwright/test';
import {LIVE_SCAN_CACHE_REVISION} from '../src/live-history.js';
import {sampleData} from '../src/engine.js';
import {OPTIONS_DEVICE_KEY} from '../src/options-api.js';

test('Chart Lab loads six-month and one-year options medians and can hide them',async ({page})=>{
  const now=Date.now();
  const expirations=[180,365].map(days=>new Date(now+days*86_400_000).toISOString().slice(0,10));
  const daily=sampleData()['DEMO-SPY'].slice(500,1750).map(bar=>({
    t:bar.time+'T05:00:00Z',o:bar.close,h:bar.close+1,l:bar.close-1,c:bar.close,v:50000
  }));
  const token='a'.repeat(64);
  await page.addInitScript(({key,token})=>localStorage.setItem(key,token),{key:OPTIONS_DEVICE_KEY,token});
  await page.route('**/api/stocks/scan?**',route=>route.fulfill({json:{
    source:'alpaca',feed:'iex',lookback_days:1825,scan_cache_revision:LIVE_SCAN_CACHE_REVISION,
    requested:133,returned:1,missing:[],bars:{SPY:daily}
  }}));
  const requested=[];
  await page.route('**/api/options/**',route=>{
    const url=new URL(route.request().url());
    expect(route.request().headers().authorization).toBe('Bearer '+token);
    expect(url.searchParams.get('symbol')).toBe('SPY');
    expect(url.searchParams.get('feed')).toBe('indicative');
    if(url.pathname.endsWith('/expirations'))return route.fulfill({json:{feed:'indicative',expirations,underlying:{value:100}}});
    const expiry=url.searchParams.get('expiry');
    requested.push(expiry);
    const median=expiry===expirations[0]?103:108;
    const years=(Date.parse(expiry+'T20:00:00Z')-now)/(365*86_400_000);
    const contracts=Array.from({length:17},(_,i)=>86+i*2).map(strike=>{
      const mid=Math.exp(-.04*years)*(median+24-strike)**2/96;
      return {root:'SPY',strike,type:'call',quote:{bid:mid-.01,ask:mid+.01,time:new Date(now).toISOString()}};
    });
    return route.fulfill({json:{feed:'indicative',contracts}});
  });
  await page.goto('./');
  await page.locator('.mode-switch [data-action="mode-live"]').click();
  await expect(page.locator('#scan-status')).toContainText('1/133 symbols loaded');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await page.getByRole('button',{name:'New indicator'}).click();
  await page.getByRole('button',{name:'Options 50/50 levels'}).click();
  const result=page.locator('#chart-options-median-result');
  await expect(result.locator('.chart-options-median-level').first()).toHaveAttribute('title',new RegExp(expirations[0]));
  await expect(result).toContainText('$103.00');
  await expect(result.locator('.chart-options-median-level').last()).toHaveAttribute('title',new RegExp(expirations[1]));
  await expect(result).toContainText('$108.00');
  expect(requested.sort()).toEqual(expirations);
  await expect(page.locator('#chart-indicator-legend').locator(result)).toBeVisible();
  await expect(page.getByLabel('Rate assumption (%)')).toHaveCount(0);
  await page.getByRole('button',{name:'New indicator'}).click();
  const picker=page.getByRole('dialog');
  await expect(picker.getByText('Other indicators',{exact:true})).toHaveCount(0);
  const enabled=picker.getByRole('button',{name:'Options 50/50 levels',exact:true});
  await expect(enabled).toContainText('On chart');
  await enabled.click();
  await expect(page.getByLabel('Rate assumption (%)')).toHaveValue('4');
  await page.getByLabel('Rate assumption (%)').fill('5');
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await page.getByRole('button',{name:'Settings for Options 50/50'}).click();
  await expect(page.getByLabel('Rate assumption (%)')).toHaveValue('5');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('.chart-tools summary').click();
  await page.getByRole('button',{name:'Hide options 50/50'}).click();
  await expect(result).toHaveCount(0);
});
