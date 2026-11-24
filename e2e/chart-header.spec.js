import {test,expect} from './market-fixture.js';

async function assertHeader(page){
  const header=page.locator('#chart-lab-panel .chart-toolbar');
  const ticker=header.locator('.chart-ticker');
  const name=ticker.locator('.chart-ticker-name');
  const controls=header.locator('.chart-toolbar-controls');
  const actions=controls.locator('.chart-toolbar-actions');
  const frames=controls.locator('.chart-frame-scale');
  await expect(ticker).toBeVisible();
  await expect(name).toHaveText(await ticker.getAttribute('data-symbol'));
  await expect(frames.getByRole('slider',{name:'Timeframe scale'})).toBeVisible();
  for(const label of ['New indicator','Reset price scale','Chart settings'])
    await expect(actions.getByRole('button',{name:label,exact:true})).toBeVisible();
  await expect(actions.locator('.chart-tools summary')).toBeVisible();
  const [t,c,a,f,h]=await Promise.all([ticker,controls,actions,frames,header].map(el=>el.boundingBox()));
  expect(c.y).toBeGreaterThanOrEqual(t.y+t.height-1);
  expect(a.y).toBeGreaterThanOrEqual(t.y+t.height-1);
  expect(f.y).toBeGreaterThanOrEqual(t.y+t.height-1);
  expect(a.x).toBeGreaterThan(t.x);
  expect(Math.abs(a.x+a.width-(c.x+c.width))).toBeLessThanOrEqual(2);
  expect(c.x+c.width).toBeLessThanOrEqual(h.x+h.width+1);
  const sizes=await header.evaluate(el=>({
    ticker:parseFloat(getComputedStyle(el.querySelector('.chart-ticker-name')).fontSize),
    control:Math.max(...[...el.querySelectorAll('.chart-toolbar-actions>button,.chart-timeframes button')].map(b=>parseFloat(getComputedStyle(b).fontSize)))
  }));
  expect(sizes.ticker).toBeGreaterThanOrEqual(30);
  expect(sizes.ticker).toBeGreaterThanOrEqual(sizes.control*2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width+1);
}
for(const width of [1440,768,390,320]){
  test('prominent ticker and lower right controls at '+width+'px, including fullscreen',async({page})=>{
    await page.setViewportSize({width,height:844});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('./');
    await page.locator((width<=800?'.mobile-nav':'.sidebar')+' [data-tab="charts"]').click();
    await assertHeader(page);
    const ticker=page.locator('.chart-ticker');
    await ticker.click();
    const picker=page.locator('#chart-symbol-dialog');
    await picker.getByLabel('Search chart symbols').fill('VXX');
    await picker.locator('[data-action="chart-choose-symbol"][data-symbol="VXX"]').click();
    await expect(ticker).toHaveAccessibleName('Change symbol, VXX');
    await expect(ticker.locator('.chart-ticker-name')).toHaveText('VXX');
    await assertHeader(page);
    await page.locator('.chart-tools summary').click();
    for(const label of ['Horizontal line','Show options 50/50','View 50/50 dots','Workspace tools & overlays','Clear price levels','Export PNG'])
      await expect(page.locator('.chart-tools-menu').getByRole('button',{name:label,exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Workspace tools & overlays',exact:true}).click();
    const dialog=page.locator('#chart-workspace-dialog');
    await dialog.locator('[data-chart-workspace-choice="watchlist"]').check();
    await dialog.getByRole('button',{name:'Apply visibility'}).click();
    await expect(page.locator('[data-chart-workspace-row="watchlist"]')).toBeVisible();
    await expect(page.locator('#chart-workspaces > details')).toHaveCount(9);
    await page.getByRole('button',{name:'Fullscreen',exact:true}).click();
    await assertHeader(page);
    await expect(page.locator('#price-chart canvas').first()).toBeVisible();
    expect((await page.locator('#chart-stage').boundingBox()).height).toBeGreaterThan(110);
    await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();
    await expect(page.locator('#chart-workspaces > details')).toHaveCount(9);
    await page.reload();
    await expect(ticker.locator('.chart-ticker-name')).toHaveText('VXX');
    await expect(page.locator('[data-chart-workspace-row="watchlist"]')).toBeVisible();
    await assertHeader(page);
    expect(errors).toEqual([]);
  });
}
