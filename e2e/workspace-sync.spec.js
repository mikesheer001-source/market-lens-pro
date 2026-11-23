import {gzipSync} from 'node:zlib';
import {test, expect} from '@playwright/test';

test('two devices on the same URL automatically share chart changes and saved scans', async ({browser, baseURL}) => {
  const saved = new Map();
  const mock = context => context.route('**/api/shared-workspace**', async route => {
    const request = route.request();
    const document = new URL(request.url()).searchParams.get('document');
    if (!document) {
      return route.fulfill({json:Object.fromEntries([...saved].map(([name, row]) => [name, row.version]))});
    }
    const row = saved.get(document);
    const headers = {'access-control-expose-headers':'ETag'};
    if (request.method() === 'PUT') {
      if (request.headers()['if-match'] !== String(row?.version || 0)) return route.fulfill({status:409});
      const version = (row?.version || 0) + 1;
      saved.set(document, {version, body:request.postDataBuffer()});
      return route.fulfill({status:204, headers:{...headers, etag:String(version)}});
    }
    return row ? route.fulfill({body:row.body, headers:{...headers, etag:String(row.version)}}) :
      route.fulfill({status:404});
  });
  const contextOptions = {baseURL, storageState:{cookies:[],origins:[]}};
  const first = await browser.newContext(contextOptions);
  const second = await browser.newContext(contextOptions);
  try {
    await Promise.all([mock(first), mock(second)]);
    const [a,b] = await Promise.all([first.newPage(),second.newPage()]);
    await Promise.all([a.goto('./'),b.goto('./')]);
    await a.getByLabel('Scan name').fill('My saved scan');
    await a.getByRole('button',{name:'Save scan',exact:true}).click();
    await a.locator('.sidebar [data-tab="charts"]').click();
    await a.getByRole('button',{name:'Remove EMA 20',exact:true}).click();
    await expect.poll(()=>saved.get('settings')?.version ?? 0,{timeout:12000}).toBeGreaterThan(0);
    await b.bringToFront();

    await expect(b.getByRole('option',{name:'My saved scan'})).toHaveCount(1,{timeout:18000});
    await b.locator('.sidebar [data-tab="charts"]').click();
    await expect(b.getByRole('button',{name:'Remove EMA 200',exact:true})).toBeVisible();
    await expect(b.getByRole('button',{name:'Remove EMA 20',exact:true})).toHaveCount(0);
    await b.locator('#price-chart').evaluate(el=>el.dataset.retained='yes');
    const marketRequest=b.waitForResponse('**/api/shared-workspace?document=market');
    const market={id:'success',session:'2026-11-16',next:1,checked:1,requested:1,rows:[]};
    saved.set('market',{version:1,body:gzipSync(JSON.stringify(market))});
    await marketRequest;
    await expect.poll(()=>b.evaluate(async ()=>{
      const db=await new Promise(resolve=>{
        const request=indexedDB.open('market-lens-pro-datasets');
        request.onsuccess=()=>resolve(request.result);
      });
      try{
        return await new Promise(resolve=>{
          const request=db.transaction('workspace').objectStore('workspace').get('market');
          request.onsuccess=()=>resolve(request.result?.value?.id);
        });
      }finally{db.close();}
    }),{timeout:10000}).toBe('success');
    await expect(b.locator('#price-chart')).toHaveAttribute('data-retained','yes');
    await b.locator('.sidebar [data-tab="data"]').click();
    await expect(b.getByRole('heading',{name:'Shared workspace'})).toBeVisible();
    await expect(b.getByRole('button',{name:'Join a workspace'})).toHaveCount(0);
  } finally {
    await Promise.all([first.close(),second.close()]);
  }
});
