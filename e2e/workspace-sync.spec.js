import {test, expect} from '@playwright/test';

test('pairing restores chart changes and a saved scan in a fresh browser context', async ({browser, baseURL}) => {
  const saved = new Map();
  const mock = context => context.route('**/api/workspace**', async route => {
    const request = route.request();
    const document = new URL(request.url()).searchParams.get('document');
    if (!document) {
      return route.fulfill({json:Object.fromEntries([...saved].map(([name, row]) => [name, row.version]))});
    }
    const row = saved.get(document);
    const headers = {'access-control-expose-headers':'ETag'};
    if (request.method() === 'PUT') {
      const version = (row?.version || 0) + 1;
      saved.set(document, {version, body:request.postDataBuffer()});
      return route.fulfill({status:204, headers:{...headers, etag:String(version)}});
    }
    return row ? route.fulfill({body:row.body, headers:{...headers, etag:String(row.version)}}) :
      route.fulfill({status:404});
  });
  const first = await browser.newContext({baseURL});
  const second = await browser.newContext({baseURL});
  try {
    await Promise.all([mock(first), mock(second)]);
    const a = await first.newPage();
    await a.goto('./');
    await a.getByLabel('Scan name').fill('My saved scan');
    await a.getByRole('button',{name:'Save scan',exact:true}).click();
    await a.locator('.sidebar [data-tab="charts"]').click();
    await a.getByRole('button',{name:'Remove EMA 20',exact:true}).click();
    await a.locator('.sidebar [data-tab="data"]').click();
    await a.getByRole('button',{name:'Create synced workspace'}).click();
    const code = a.getByLabel('Private pairing code');
    await expect(code).toHaveValue(/^ML1-/);
    const joinCode = await code.inputValue();

    const b = await second.newPage();
    await b.goto('./');
    await b.locator('.sidebar [data-tab="data"]').click();
    await b.getByRole('button',{name:'Join a workspace'}).click();
    await b.getByLabel('Private pairing code').fill(joinCode);
    await b.getByRole('button',{name:'Join workspace',exact:true}).click();
    await expect(b.getByRole('button',{name:'Show pairing code'})).toBeVisible();
    await b.locator('.sidebar [data-tab="charts"]').click();
    await expect(b.getByRole('button',{name:'Remove EMA 200',exact:true})).toBeVisible();
    await expect(b.getByRole('button',{name:'Remove EMA 20',exact:true})).toHaveCount(0);
    await b.locator('.sidebar [data-tab="screener"]').click();
    await expect(b.getByRole('option',{name:'My saved scan'})).toHaveCount(1);
  } finally {
    await Promise.all([first.close(),second.close()]);
  }
});
