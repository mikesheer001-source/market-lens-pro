import {test,expect} from './market-fixture.js';

test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});

test('mobile workspace keeps ticker details, chosen columns, watchlist and recent symbols accessible',async ({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('./');
  const row=page.locator('.screener-results tr[data-symbol="VXX"]');
  await row.getByRole('button',{name:'Toggle watchlist'}).tap();
  await page.getByRole('button',{name:'Columns',exact:true}).tap();
  await page.getByRole('checkbox',{name:'RSI W',exact:true}).uncheck();
  await page.getByRole('button',{name:'Close',exact:true}).tap();
  await expect(page.locator('.screener-results th').nth(3)).toBeHidden();
  await row.locator('.table-table-label').tap();
  const details=page.getByRole('dialog',{name:'VXX',exact:true});
  await expect(details.getByText('RSI W',{exact:true})).toBeVisible();
  await details.getByRole('button',{name:'Open chart',exact:true}).tap();
  await page.locator('.chart-ticker').tap();
  await expect(page.locator('#chart-symbol-watchlist')).toContainText('VXX');
  await expect(page.locator('#chart-symbol-recent')).toContainText('VXX');
  const picker=page.getByRole('dialog',{name:'Find symbol',exact:true});
  await picker.getByRole('searchbox').fill('SPY');
  await picker.getByRole('button',{name:'SPY',exact:true}).tap();
  await expect(page.locator('.chart-ticker')).toHaveAttribute('data-symbol','SPY');
  await page.locator('[data-action="chart-timeframe"][data-timeframe="W"]').tap();
  await expect(page.locator('[data-timeframe="W"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('.mobile-nav [data-tab="screener"]').tap();
  await expect(page.locator('.screener-results th').nth(3)).toBeHidden();
  expect(errors).toEqual([]);
});

test('mobile Chart Lab tracks a candle and its indicators and resizes the RSI pane',async ({page,browserName})=>{
  test.skip(browserName!=='chromium','Touch input uses Chromium DevTools');
  await page.goto('./');
  await page.locator('.mobile-nav [data-tab="charts"]').tap();
  await page.getByRole('button',{name:'Fullscreen',exact:true}).tap();
  const oscillator=page.locator('.chart-pane-legend [data-indicator-row="rsi"]');
  await expect(oscillator).toBeVisible();
  const pricePane=page.locator('#price-chart tr').first();
  const plot=pricePane.locator('td').nth(1).locator('canvas').first();
  const bounds=await plot.boundingBox();
  const readout=page.locator('#readout'),ema=page.locator('[data-indicator-row="ema20"] .chart-indicator-value');
  const date=await readout.locator('time').textContent(),reading=await ema.textContent();
  const cdp=await page.context().newCDPSession(page);
  const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:Math.round(x),y:Math.round(y)}]});
  try{
    const x=bounds.x+bounds.width*.42,y=bounds.y+bounds.height*.55;
    await touch('touchStart',x,y);
    await expect(readout.locator('time')).not.toHaveText(date);
    await expect(ema).not.toHaveText(reading);
    const firstDate=await readout.locator('time').textContent();
    await touch('touchMove',x+36,y);
    await expect(readout.locator('time')).not.toHaveText(firstDate);
    await touch('touchEnd',x+36,y);
    const separator=pricePane.locator('xpath=following-sibling::tr[1]');
    const divider=await separator.boundingBox();
    const sx=divider.x+divider.width/2,sy=divider.y+divider.height/2;
    await touch('touchStart',sx,sy);
    for(let delta=10;delta<=40;delta+=10)await touch('touchMove',sx,sy-delta);
    await touch('touchEnd',sx,sy-40);
    await expect.poll(async()=>Math.abs((await plot.boundingBox()).height-bounds.height)).toBeGreaterThan(15);
  }finally{await cdp.detach();}
});

test('backtest results precede settings and the trade log and windows can expand',async ({page})=>{
  await page.goto('./');
  await page.locator('.mobile-nav [data-tab="backtest"]').tap();
  await page.getByRole('button',{name:'Run backtest',exact:true}).tap();
  const curve=page.locator('#equity-chart');
  const settings=page.getByRole('heading',{name:'Strategy settings',exact:true});
  const [chartBox,settingsBox]=await Promise.all([curve.boundingBox(),settings.boundingBox()]);
  expect(chartBox.y).toBeLessThan(settingsBox.y);
  await page.getByRole('heading',{name:'Trade log',exact:true}).tap();
  await expect(page.locator('[data-backtest-section="trades"]')).toHaveAttribute('open','');
  await page.getByRole('button',{name:'Compare all strategies',exact:true}).first().tap();
  await expect(page.getByText('Leaderboard validation',{exact:true})).toBeVisible();
  await page.getByRole('heading',{name:'Validation windows',exact:true}).tap();
  await expect(page.locator('#rolling-window-dates')).toBeVisible();
});

test('timeframe slider snaps to supported intervals and chart height is resizable',async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('./');
  await page.locator('.mobile-nav [data-tab="charts"]').click();
  const scale=page.getByRole('slider',{name:'Timeframe scale'});
  await expect(scale).toBeVisible();
  await scale.focus();
  await scale.press('End');
  await expect(page.locator('[data-timeframe="M"]')).toHaveAttribute('aria-pressed','true');
  await scale.press('Home');
  await expect(page.locator('[data-timeframe="1m"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-timeframe="D"]').click();
  const chart=page.locator('#price-chart');
  const grip=page.locator('#chart-resize-handle');
  // Leave room below the grip for a genuine mobile drag inside the viewport.
  await grip.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
  const before=(await chart.boundingBox()).height;
  const box=await grip.boundingBox();
  const x=Math.round(box.x+box.width/2),y=Math.round(box.y+box.height/2);
  const cdp=await page.context().newCDPSession(page);
  try{
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let dy=10;dy<=100;dy+=10)
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+dy}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }finally{await cdp.detach();}
  await expect.poll(async()=>(await chart.boundingBox()).height).toBeGreaterThan(before+80);
  await grip.focus();
  await grip.press('ArrowUp');
  expect((await chart.boundingBox()).height).toBeLessThan(before+80);
  await grip.press('Home');
  expect(Math.abs((await chart.boundingBox()).height-before)).toBeLessThan(3);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});

test('chart gear controls visible timeframes, chart style and bottom logarithmic scale',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('./');
  await page.locator('.mobile-nav [data-tab="charts"]').click();
  const gear=page.getByRole('button',{name:'Chart settings',exact:true});
  await expect(page.locator('.chart-toolbar [data-option="style"]')).toHaveCount(0);
  for(const tf of ['1m','5m','4H','8H'])await expect(page.locator('[data-timeframe="'+tf+'"]')).toBeVisible();
  await gear.click();const dialog=page.locator('#chart-settings-dialog');
  await dialog.locator('[data-frame-choice="1m"]').uncheck();
  await dialog.getByLabel('Chart style').selectOption('line');
  await dialog.getByRole('button',{name:'Apply settings'}).click();
  await expect(page.locator('[data-timeframe="1m"]')).toHaveCount(0);
  const log=page.locator('.chart-ranges [data-action="chart-log-toggle"]');
  await log.click();await expect(log).toHaveAttribute('aria-pressed','true');
  await page.reload();await expect(log).toHaveAttribute('aria-pressed','true');
  await gear.click();await expect(dialog.getByLabel('Chart style')).toHaveValue('line');
  await expect(dialog.locator('[data-frame-choice="1m"]')).not.toBeChecked();
});
