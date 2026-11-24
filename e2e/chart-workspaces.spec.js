import {test,expect} from './market-fixture.js';
import {mockMarket,waitForMarket} from './market-fixture.js';
import {gzipSync} from 'node:zlib';

const panel=(page,key)=>page.locator('#chart-workspaces > [data-workspace-section="'+key+'"]');
const summary=(page,key)=>panel(page,key).locator(':scope > summary');
const grip=(page,key)=>panel(page,key).locator(':scope > summary > [data-workspace-drag]');
const order=page=>page.locator('#chart-workspaces > details').evaluateAll(nodes=>nodes.map(node=>node.dataset.workspaceSection));
const keys=['screener','backtest','options','optimize','scripts','data','watchlists','scans','alerts'];
test('all workspace panels below the chart share existing behavior and keep state when reordered or collapsed',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await expect(page.locator('#chart-workspaces > details')).toHaveCount(9);
  expect(await order(page)).toEqual(keys);
  expect(await page.locator('#chart-workspaces').evaluate(el=>Boolean(document.querySelector('#chart-lab-panel').compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await page.locator('#price-chart').evaluate(el=>el.dataset.keep='yes');
  await summary(page,'screener').click();
  await expect(panel(page,'screener').locator('.screener-results tbody tr')).toHaveCount(4);
  await summary(page,'backtest').click();
  await summary(page,'options').click();
  await expect(panel(page,'options').locator('[data-ob="symbol"]')).toBeVisible();
  await panel(page,'options').locator('[data-ob="price"]').fill('450');
  await panel(page,'options').locator('[data-ob="price"]').press('Tab');
  await panel(page,'options').locator('[data-ob="manual"]').click();
  await expect(panel(page,'options').locator('[data-ob="legs"] tr')).toHaveCount(1);
  await panel(page,'options').locator('#options-builder').evaluate(el=>el.dataset.keep='yes');
  await panel(page,'backtest').locator('[data-bt="capital"]').fill('23456');
  await panel(page,'backtest').locator('[data-bt="capital"]').press('Tab');
  await panel(page,'screener').locator('[data-option="preset"]').selectOption('oversold');
  await expect(panel(page,'backtest').locator('[data-bt="capital"]')).toHaveValue('23456');
  await expect(panel(page,'options').locator('[data-ob="legs"] tr')).toHaveCount(1);
  await expect(panel(page,'options').locator('#options-builder')).toHaveAttribute('data-keep','yes');
  await panel(page,'backtest').getByRole('button',{name:'Run backtest',exact:true}).click();
  await expect(panel(page,'backtest').locator('#equity-chart canvas').first()).toBeVisible();
  await expect(page.locator('.sidebar [data-tab="charts"]')).toHaveClass(/active/);
  await summary(page,'backtest').click();
  await summary(page,'screener').click();
  await summary(page,'options').click();
  await expect(panel(page,'options').locator('[data-ob="symbol"]')).toBeHidden();
  // Genuine pointer drag, with all target headers compact and visible.
  await grip(page,'options').scrollIntoViewIfNeeded();
  const source=await grip(page,'options').boundingBox(),target=await summary(page,'screener').boundingBox();
  await page.mouse.move(source.x+source.width/2,source.y+source.height/2);
  await page.mouse.down();
  await page.mouse.move(target.x+target.width/2,target.y+4,{steps:12});
  await page.mouse.up();
  expect(await order(page)).toEqual(['options','screener','backtest',...keys.slice(3)]);
  await grip(page,'backtest').press('Home');
  expect((await order(page)).slice(0,3)).toEqual(['backtest','options','screener']);
  await summary(page,'backtest').click();
  await summary(page,'options').click();
  await expect(panel(page,'backtest').locator('[data-bt="capital"]')).toHaveValue('23456');
  await expect(panel(page,'backtest').locator('#equity-chart canvas').first()).toBeVisible();
  await expect(panel(page,'options').locator('[data-ob="legs"] tr')).toHaveCount(1);
  await expect(panel(page,'options').locator('#options-builder')).toHaveAttribute('data-keep','yes');
  await summary(page,'scripts').click();
  await expect(panel(page,'scripts').locator('#pine-editor')).toBeVisible();
  await summary(page,'optimize').click();
  await expect(panel(page,'optimize').locator('[data-action="run-sweep"]')).toBeVisible();
  await summary(page,'data').click();
  await expect(panel(page,'data').locator('[data-setting="apiBaseUrl"]')).toBeVisible();
  await page.reload();
  expect((await order(page)).slice(0,3)).toEqual(['backtest','options','screener']);
  for(const key of ['backtest','options','scripts','optimize','data'])await expect(panel(page,key)).toHaveAttribute('open','');
  await expect(panel(page,'screener')).not.toHaveAttribute('open','');
  await expect(panel(page,'backtest').locator('[data-bt="capital"]')).toHaveValue('23456');
  expect(errors).toEqual([]);
});

test('layout survives shared workspace startup replacement and immediate reload',async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,storageState:{cookies:[],origins:[]}});
  try{
    await mockMarket(context);
    await context.route('**/api/shared-workspace**',async route=>{
      const document=new URL(route.request().url()).searchParams.get('document');
      if(!document)return route.fulfill({json:{settings:1}});
      if(route.request().method()==='PUT')return route.fulfill({status:204,headers:{etag:'2','access-control-expose-headers':'ETag'}});
      if(document==='settings')return route.fulfill({body:gzipSync(JSON.stringify({lastSymbol:'SPY',lastLiveSymbol:'SPY',workspaceSections:{watchlists:false,scans:false,alerts:false,backtest:false}})),headers:{etag:'1','access-control-expose-headers':'ETag'}});
      return route.fulfill({status:404});
    });
    const page=await context.newPage();
    await page.goto('./');await waitForMarket(page);
    await page.locator('.sidebar [data-tab="charts"]').click();
    await summary(page,'watchlists').click();
    await summary(page,'backtest').click();
    await grip(page,'watchlists').press('Home');
    // Click then reload without waiting for the asynchronous public sync.
    await summary(page,'scans').click();
    await page.reload();await waitForMarket(page);
    expect((await order(page))[0]).toBe('watchlists');
    for(const key of ['watchlists','backtest','scans'])await expect(panel(page,key)).toHaveAttribute('open','');
    await expect(panel(page,'alerts')).not.toHaveAttribute('open','');
  }finally{await context.close();}
});
