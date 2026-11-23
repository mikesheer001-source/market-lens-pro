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

test('the private setup link approves this browser and reloads quotes automatically', async ({page}) => {
  const expiry=new Date(Date.now()+21*86_400_000).toISOString().slice(0,10);
  const symbol='SPY'+expiry.slice(2).replaceAll('-','')+'C00500000';
  const time=new Date().toISOString();
  const initial={bid:1,ask:2,time,iv:.19};
  let enrollmentCount=0, authorization;
  await page.route('**/api/options/**', route=>{
    const request=route.request();
    const url=new URL(request.url());
    if (url.pathname.endsWith('/device')) {
      enrollmentCount++;
      expect(request.method()).toBe('POST');
      expect(request.headers()['x-options-approval']).toBe('b'.repeat(64));
      authorization=request.headers().authorization;
      expect(authorization).toMatch(/^Bearer [a-f0-9]{64}$/);
      return route.fulfill({status:204});
    }
    expect(url.searchParams.get('feed')).toBe('indicative');
    expect(request.headers().authorization).toBe(authorization);
    if (url.pathname.endsWith('/expirations')) return route.fulfill({json:{
      feed:'indicative',expirations:[expiry],underlying:{value:500,time,feed:'IEX'}}});
    if (url.pathname.endsWith('/chain')) return route.fulfill({json:{feed:'indicative',contracts:[
      {symbol,root:'SPY',type:'call',expiry,strike:500,multiplier:100,quote:initial}]}});
    return route.fulfill({json:{feed:'indicative',quotes:{[symbol]:{...initial,bid:2,ask:3}}}});
  });
  await page.goto('./#options-setup='+'b'.repeat(64));
  const builder=page.locator('#options-builder');
  const status=builder.locator('[data-ob=status]');
  await expect(status).toContainText('Indicative');
  await expect(page).not.toHaveURL(/options-setup/);
  await builder.getByRole('button',{name:'Buy',exact:true}).click();
  await expect(builder.getByLabel('Leg 1 entry')).toHaveValue('1.5');
  await builder.getByRole('button',{name:'Refresh prices'}).click();
  await expect(builder.getByText('$250.00 debit')).toBeVisible();
  await expect(builder.getByLabel('Leg 1 entry')).toHaveValue('1.5');
  await page.reload();
  await expect(builder.getByRole('button',{name:'Buy',exact:true})).toBeVisible();
  expect(enrollmentCount).toBe(1);
});
