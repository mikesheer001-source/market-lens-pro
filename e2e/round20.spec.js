import {test,expect} from '@playwright/test';

test('Round 20: desktop fullscreen covers viewport, keeps symbol, returns to prior layout and preserves controls',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  const symbol=await page.locator('[data-action="chart-symbol-picker"]').getAttribute('data-symbol');
  await expect(page.getByRole('heading',{name:'Chart Lab'})).toBeVisible();
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await expect(page.locator('#chart-lab-panel')).toHaveAttribute('data-fullscreen','false');
  await expect(page.getByRole('button',{name:'Fullscreen'})).toBeVisible();
  const viewport=page.viewportSize();
  await page.evaluate(()=>window.scrollTo(0,180));
  const enterFullscreen=page.getByRole('button',{name:'Fullscreen',exact:true});
  await enterFullscreen.scrollIntoViewIfNeeded();
  const previousScroll=await page.evaluate(()=>window.scrollY);
  await enterFullscreen.click();
  const panel=page.locator('#chart-lab-panel');
  await expect(panel).toHaveAttribute('data-fullscreen','true');
  await expect(page.locator('body')).toHaveClass(/chart-fullscreen-active/);
  await expect(page.getByRole('heading',{name:'Chart Lab'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Exit fullscreen'})).toBeVisible();
  await expect(page.locator('#chart-indicator-legend')).toBeVisible();
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  const box=await panel.boundingBox();
  expect(Math.abs(box.width-viewport.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.height-viewport.height)).toBeLessThanOrEqual(2);
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  await expect(page.locator('[data-action="chart-symbol-picker"]')).toHaveAttribute('data-symbol',symbol);
  await page.locator('[data-action="reset-price-scale"]').click();
  await expect(page.locator('#chart-axis-hint')).toContainText('Price scale reset');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveAttribute('data-fullscreen','false');
  await expect(page.locator('body')).not.toHaveClass(/chart-fullscreen-active/);
  await expect(page.getByRole('heading',{name:'Chart Lab'})).toBeVisible();
  await expect(page.locator('[data-action="chart-symbol-picker"]')).toHaveAttribute('data-symbol',symbol);
  await expect(page.getByRole('button',{name:'Fullscreen'})).toBeVisible();
  const returnedScroll=await page.evaluate(()=>window.scrollY);
  expect(Math.abs(returnedScroll-previousScroll)).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('Chart Lab adds and removes indicators and persists their independent settings',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  const pane=page.locator('#chart-indicator-legend');
  await expect(pane).toBeVisible();
  await expect(page.locator('[data-indicator-row="ema20"]')).toContainText('EMA 20');
  await expect(page.locator('[data-indicator-row="ema200"]')).toContainText('EMA 200');
  await expect(page.locator('[data-indicator-row="volume"]')).toContainText('Volume');
  await expect(page.locator('[data-indicator-row="rsi"]')).toContainText('RSI 14');
  await expect(page.getByRole('button',{name:'Settings for EMA 20',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Settings for EMA 20',exact:true}).click();
  await expect(page.locator('#indicator-settings-ema20')).toBeVisible();
  await expect(page.locator('.indicator-options')).toHaveCount(0);
  const period=page.locator('[data-indicator-field="ema20Len"]');
  await period.fill('34');
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.locator('[data-indicator-row="ema20"]')).toContainText('EMA 34');
  await expect(page.locator('[data-indicator-row="ema200"]')).toContainText('EMA 200');

  await page.getByRole('button',{name:'Settings for EMA 34',exact:true}).click();
  await page.getByRole('button',{name:'Remove',exact:true}).click();
  await expect(page.locator('[data-indicator-row="ema20"]')).toHaveCount(0);
  const picker=page.getByRole('button',{name:'New indicator',exact:true});
  await picker.click();
  await page.getByRole('button',{name:'EMA',exact:true}).click();
  await page.getByLabel('Length',{exact:true}).fill('34');
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.locator('[data-indicator-row^="ma-"]')).toContainText('EMA 34');

  await picker.click();
  await page.getByText('Other indicators',{exact:true}).click();
  await page.getByRole('button',{name:'MACD 12/26/9',exact:true}).click();
  await expect(page.locator('[data-indicator-row="macd"]')).toContainText('MACD 12/26/9');
  await page.getByRole('button',{name:'Settings for MACD 12/26/9'}).click();
  await page.locator('[data-indicator-field="macdFast"]').fill('8');
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.locator('[data-indicator-row="macd"]')).toContainText('MACD 8/26/9');
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await page.reload();
  await page.locator('.sidebar [data-tab="charts"]').click();
  await expect(page.locator('[data-indicator-row^="ma-"]')).toContainText('EMA 34');
  await expect(page.locator('[data-indicator-row="macd"]')).toContainText('MACD 8/26/9');
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('Round 20: right price-axis dragging and reset remain functional without chart errors',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  const box=await page.locator('#price-chart').boundingBox();
  const x=box.x+box.width-12,y=box.y+box.height*.48;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,y-95,{steps:10});
  await page.mouse.up();
  await page.locator('[data-action="reset-price-scale"]').click();
  await expect(page.locator('#chart-axis-hint')).toContainText('Price scale reset');
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await expect(page.locator('[data-action="range-all"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('mobile price-axis gestures',()=>{
  test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});

  test('mobile touch drag changes the right price-axis scale and Auto restores it',async ({page,browserName})=>{
    test.skip(browserName!=='chromium','Touch input uses Chromium DevTools');
    await page.goto('./');
    await page.locator('.mobile-nav [data-tab="charts"]').click();
    await page.getByRole('button',{name:'Fullscreen',exact:true}).click();
    const axis=page.locator('#price-chart tr:first-child > td:last-child canvas').first();
    await expect(axis).toBeVisible();
    const before=await axis.screenshot();
    const box=await axis.boundingBox();
    const x=Math.round(box.x+box.width/2),y=Math.round(box.y+box.height/2);
    const cdp=await page.context().newCDPSession(page);
    try{
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for(let offset=12;offset<=84;offset+=12){
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-offset}]});
      }
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await expect.poll(async()=>(await axis.screenshot()).equals(before)).toBe(false);
      const dragged=await axis.screenshot();
      await page.getByRole('button',{name:'Reset price scale',exact:true}).click();
      await expect(page.locator('#chart-axis-hint')).toContainText('Price scale reset');
      await expect.poll(async()=>(await axis.screenshot()).equals(dragged)).toBe(false);
    }finally{await cdp.detach();}
  });
});

test('Round 20: mobile fullscreen fills small viewport while indicator gear and exit remain usable',async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:390,height:844});
  await page.goto('./');
  await page.locator('.mobile-nav [data-tab="charts"]').click();
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  const symbol=await page.locator('[data-action="chart-symbol-picker"]').getAttribute('data-symbol');
  await page.locator('[data-action="chart-fullscreen"]').click();
  const panel=page.locator('#chart-lab-panel');
  await expect(panel).toHaveAttribute('data-fullscreen','true');
  const box=await panel.boundingBox();
  expect(Math.abs(box.width-390)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.height-844)).toBeLessThanOrEqual(2);
  const stage=await page.locator('#chart-stage').boundingBox();
  expect(stage.height).toBeGreaterThan(110);
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await page.getByRole('button',{name:'Settings for EMA 20',exact:true}).click();
  await expect(page.locator('#indicator-settings-ema20')).toBeVisible();
  await page.locator('[data-indicator-field="ema20Len"]').fill('28');
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.locator('[data-indicator-row="ema20"]')).toContainText('EMA 28');
  await expect(page.getByRole('button',{name:'Exit fullscreen'})).toBeVisible();
  await page.locator('[data-action="chart-exit-fullscreen"]').click();
  await expect(panel).toHaveAttribute('data-fullscreen','false');
  await expect(page.locator('[data-action="chart-symbol-picker"]')).toHaveAttribute('data-symbol',symbol);
  await expect(page.locator('.mobile-nav [data-tab="charts"]')).toBeVisible();
  expect(errors).toEqual([]);
});


test('EMA and SMA stay in the picker and each copy keeps its own length',async ({page})=>{
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  const add=async (type,length)=>{
    await page.getByRole('button',{name:'New indicator',exact:true}).click();
    await page.getByRole('button',{name:type,exact:true}).click();
    await page.getByLabel('Length',{exact:true}).fill(String(length));
    await page.getByRole('button',{name:'Apply',exact:true}).click();
  };
  await add('EMA',9);
  await add('EMA',25);
  await add('SMA',10);
  await add('SMA',30);
  await page.reload();
  const legend=page.locator('#chart-indicator-legend');
  for(const label of ['EMA 9','EMA 25','SMA 10','SMA 30'])
    await expect(legend.getByRole('button',{name:'Settings for '+label,exact:true})).toBeVisible();
  await legend.getByRole('button',{name:'Remove SMA 10',exact:true}).click();
  await expect(legend.getByRole('button',{name:'Settings for SMA 30',exact:true})).toBeVisible();
  await expect(legend.getByRole('button',{name:'Settings for SMA 10',exact:true})).toHaveCount(0);
});
