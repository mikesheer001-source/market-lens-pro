import {expect,test} from '@playwright/test';

test('manual options builder computes a vertical spread and keeps it while switching tabs', async ({page}) => {
  await page.goto('./');
  const nav=page.getByRole('navigation',{name:'Primary navigation'});
  await nav.getByRole('button',{name:'Options Builder'}).click();
  const builder=page.locator('#options-builder');
  await builder.getByLabel('Underlying reference price').fill('100');
  await builder.getByLabel('Strategy preset').selectOption('Bull call debit spread');
  await builder.getByRole('button',{name:'Apply preset'}).click();
  await builder.getByLabel('Leg 1 entry').fill('2.5');
  await builder.getByLabel('Leg 2 entry').fill('1');
  await expect(builder.getByText('$150.00 debit')).toBeVisible();
  await expect(builder.getByText('$101.50',{exact:true})).toBeVisible();
  await expect(builder.getByRole('img',{name:'Profit and loss versus underlying price'})).toBeVisible();
  await nav.getByRole('button',{name:'Screener'}).click();
  await nav.getByRole('button',{name:'Options Builder'}).click();
  await expect(builder.getByLabel('Leg 1 entry')).toHaveValue('2.5');
  await expect(builder.getByText('$150.00 debit')).toBeVisible();
});

test('explicit Alpaca feed and quote refresh keep the entry premium locked', async ({page}) => {
  const expiry=new Date(Date.now()+21*86_400_000).toISOString().slice(0,10);
  const symbol='SPY'+expiry.slice(2).replaceAll('-','')+'C00500000';
  const time=new Date().toISOString();
  const initial={bid:1,ask:2,time,iv:.19};
  await page.route('**/api/options/**', route=>{
    const url=new URL(route.request().url());
    expect(url.searchParams.get('feed')).toBe('opra');
    expect(route.request().headers().authorization).toBe('Bearer '+ 'a'.repeat(32));
    if (url.pathname.endsWith('/expirations')) return route.fulfill({json:{
      feed:'opra',expirations:[expiry],underlying:{value:500,time,feed:'IEX'}}});
    if (url.pathname.endsWith('/chain')) return route.fulfill({json:{feed:'opra',contracts:[
      {symbol,root:'SPY',type:'call',expiry,strike:500,multiplier:100,quote:initial}]}});
    return route.fulfill({json:{feed:'opra',quotes:{[symbol]:{...initial,bid:2,ask:3}}}});
  });
  await page.goto('./');
  await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('button',{name:'Options Builder'}).click();
  const builder=page.locator('#options-builder');
  await builder.getByText('Connect Alpaca owner quotes').click();
  await builder.getByLabel('Owner access code').fill('a'.repeat(32));
  await builder.getByRole('button',{name:'Connect',exact:true}).click();
  await expect(builder.locator('[data-ob=status]')).toContainText('Real-time OPRA');
  await builder.getByRole('button',{name:'Buy',exact:true}).click();
  await expect(builder.getByLabel('Leg 1 entry')).toHaveValue('1.5');
  await builder.getByRole('button',{name:'Refresh prices'}).click();
  await expect(builder.getByText('$250.00 debit')).toBeVisible();
  await expect(builder.getByLabel('Leg 1 entry')).toHaveValue('1.5');
  await builder.getByRole('button',{name:'Disconnect'}).click();
  await expect(builder.getByText('$250.00 debit')).toHaveCount(0);
  await expect(builder.getByLabel('Leg 1 entry')).toHaveValue('1.5');
});
