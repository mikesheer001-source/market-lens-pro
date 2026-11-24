import {expect,test} from './market-fixture.js';

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

test('drags quoted legs between listed strikes and rolls to a tapped expiration', async ({page}) => {
  const expiration = days => new Date(Date.now()+days*86_400_000).toISOString().slice(0,10);
  const expirations = [expiration(21),expiration(42)];
  const time = new Date().toISOString();
  await page.route('**/api/options/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/device')) return route.fulfill({status:204});
    if (url.pathname.endsWith('/expirations')) return route.fulfill({json:{
      feed:'indicative', expirations, underlying:{value:100,time,feed:'IEX'}
    }});
    const expiry = url.searchParams.get('expiry');
    const contracts = [95,100,105,110].map(strike => ({symbol:'SPY'+expiry+strike,root:'SPY',
      type:'call', expiry, strike, multiplier:100, quote:{bid:strike===105 ? 2 : 3,ask:strike===105 ? 3 : 4,time}}));
    return route.fulfill({json:{feed:'indicative',contracts}});
  });
  await page.goto('./#options-setup='+'b'.repeat(64));
  const builder = page.locator('#options-builder');
  await expect(builder.locator('[data-ob=status]')).toContainText('4 contracts');
  await builder.getByRole('button',{name:'+ Buy Call',exact:true}).click();
  const ruler = builder.locator('[data-ob=ruler]');
  const marker = ruler.getByRole('button',{name:'Move leg 1 strike, 100C'});
  const bounds = await marker.boundingBox();
  const rulerBox = await ruler.boundingBox();
  expect(bounds).toBeTruthy();
  const x = bounds.x+bounds.width/2, y = bounds.y+bounds.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x+rulerBox.width*.86*(5/16),y,{steps:7});
  await expect(builder.locator('[data-ob=metrics]')).toContainText('$250.00 debit');
  await page.mouse.up();
  await expect(builder.getByLabel('Leg 1 strike',{exact:true})).toHaveValue('105');
  await expect(builder.getByLabel('Leg 1 entry')).toHaveValue('2.5');
  await builder.locator('[data-expiry-day="'+expirations[1]+'"]').click();
  await expect(builder.getByLabel('Leg 1 expiry')).toHaveValue(expirations[1]);
  const rolled = ruler.getByRole('button',{name:'Move leg 1 strike, 105C'});
  await rolled.press('ArrowLeft');
  await expect(builder.getByLabel('Leg 1 strike',{exact:true})).toHaveValue('100');
  await builder.getByRole('button',{name:'Table',exact:true}).click();
  await expect(builder.getByRole('table',{name:'Scenario P&L in dollars'})).toBeVisible();
  await builder.getByRole('button',{name:'Graph',exact:true}).click();
  await expect(builder.getByRole('img',{name:'Profit and loss versus underlying price'})).toBeVisible();
});

async function gotoBuilderWithGreeks(page) {
  const expiration = new Date(Date.now()+21*86_400_000).toISOString().slice(0,10);
  const time = new Date().toISOString();
  const greeks = {delta:0.5,gamma:0.02,theta:-0.1,vega:0.4,rho:0.05};
  await page.route('**/api/options/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/device')) return route.fulfill({status:204});
    if (url.pathname.endsWith('/expirations')) return route.fulfill({json:{
      feed:'indicative',expirations:[expiration],underlying:{value:100,time,feed:'IEX'}}});
    const contracts = [95,100,105,110].flatMap(strike => ['call','put'].map(type => ({
      symbol:'SPY'+expiration+strike+type[0].toUpperCase(),root:'SPY',type,expiry:expiration,
      strike,multiplier:100,quote:{bid:3,ask:4,time,iv:0.25,greeks}})));
    return route.fulfill({json:{feed:'indicative',contracts}});
  });
  await page.goto('./#options-setup='+'b'.repeat(64));
  const builder = page.locator('#options-builder');
  await expect(builder.locator('[data-ob=status]')).toContainText('contracts');
  return builder;
}

test('sell legs are created from the quick buttons and flip the net entry to a credit', async ({page}) => {
  const builder = await gotoBuilderWithGreeks(page);
  await builder.getByRole('button',{name:'+ Sell Call',exact:true}).click();
  await expect(builder.getByLabel('Leg 1 side')).toHaveValue('sell');
  await expect(builder.locator('[data-ob=metrics]')).toContainText('$350.00 credit');
  await builder.getByRole('button',{name:'+ Sell Put',exact:true}).click();
  await expect(builder.getByLabel('Leg 2 side')).toHaveValue('sell');
  await expect(builder.locator('[data-ob=metrics]')).toContainText('$700.00 credit');
});

test('buy and sell controls and legs sit on opposite sides of the strike axis on mobile', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  const builder = await gotoBuilderWithGreeks(page);
  const buy = builder.getByRole('button',{name:'+ Buy Call',exact:true});
  const sell = builder.getByRole('button',{name:'+ Sell Put',exact:true});
  const axis = builder.locator('.options-strike-axis');
  await buy.click();
  await sell.click();
  const buyMarker = builder.locator('[data-strike-leg="0"]');
  const sellMarker = builder.locator('[data-strike-leg="1"]');
  const a = await axis.boundingBox(), b = await buyMarker.boundingBox(), s = await sellMarker.boundingBox();
  expect(b.y+b.height).toBeLessThanOrEqual(a.y);
  expect(s.y).toBeGreaterThanOrEqual(a.y+a.height);
  expect((await buy.boundingBox()).y).toBeLessThan(b.y);
  expect((await sell.boundingBox()).y).toBeGreaterThan(s.y);
  await builder.locator('[data-flip="0"]').click();
  await expect(builder.locator('.options-strike-lanes.sell [data-strike-leg="0"]')).toBeVisible();
  await expect(builder.locator('.options-strike-lanes.buy [data-strike-leg]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});

test('strike chips delete only when swiped away from the axis', async ({page}) => {
  const builder = await gotoBuilderWithGreeks(page);
  await builder.getByRole('button',{name:'+ Buy Call',exact:true}).click();
  await builder.getByRole('button',{name:'+ Sell Call',exact:true}).click();
  const ruler = builder.locator('[data-ob=ruler]');
  await expect(ruler.getByRole('button',{name:/Remove leg/})).toHaveCount(0);
  const count = builder.locator('[data-ob=position-count]');
  const swipe = async (side,dy,returnToStart=false) => {
    const marker = ruler.locator('.options-strike-chip.'+side);
    await marker.scrollIntoViewIfNeeded();
    const box = await marker.boundingBox();
    const x = box.x+box.width/2, y = box.y+box.height/2;
    await page.mouse.move(x,y);
    await page.mouse.down();
    await page.mouse.move(x,y+dy,{steps:6});
    if (returnToStart) await page.mouse.move(x,y,{steps:6});
    await page.mouse.up();
  };
  await swipe('buy',60);
  await expect(count).toHaveText('2');
  await swipe('sell',-60);
  await expect(count).toHaveText('2');
  await swipe('buy',-60,true);
  await expect(count).toHaveText('2');
  await swipe('buy',-60);
  await expect(count).toHaveText('1');
  await expect(ruler.locator('.options-strike-chip.sell')).toHaveCount(1);
  await swipe('sell',60);
  await expect(count).toHaveText('0');
});

test('swiping a chip up removes it and dragging it sideways moves the strike', async ({page}) => {
  const builder = await gotoBuilderWithGreeks(page);
  await builder.getByRole('button',{name:'+ Buy Call',exact:true}).click();
  const ruler = builder.locator('[data-ob=ruler]');
  let marker = ruler.getByRole('button',{name:'Move leg 1 strike, 100C'});
  let bounds = await marker.boundingBox();
  let x = bounds.x+bounds.width/2, y = bounds.y+bounds.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,y-60,{steps:5});
  await page.mouse.up();
  await expect(builder.locator('[data-ob=position-count]')).toHaveText('0');
  await expect(builder.getByText('Add legs to see your strategy payoff.')).toBeVisible();
  await builder.getByRole('button',{name:'+ Buy Call',exact:true}).click();
  marker = ruler.getByRole('button',{name:'Move leg 1 strike, 100C'});
  bounds = await marker.boundingBox();
  const rulerBox = await ruler.boundingBox();
  x = bounds.x+bounds.width/2; y = bounds.y+bounds.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x+rulerBox.width*.86*(5/16),y,{steps:7});
  await page.mouse.up();
  await expect(builder.getByLabel('Leg 1 strike',{exact:true})).toHaveValue('105');
  await expect(builder.locator('[data-ob=position-count]')).toHaveText('1');
});

test('tapping B/S on a chip flips buy to sell and flips debit to credit', async ({page}) => {
  const builder = await gotoBuilderWithGreeks(page);
  await builder.getByRole('button',{name:'+ Buy Call',exact:true}).click();
  await expect(builder.locator('[data-ob=metrics]')).toContainText('$350.00 debit');
  await builder.locator('[data-flip="0"]').click();
  await expect(builder.getByLabel('Leg 1 side')).toHaveValue('sell');
  await expect(builder.locator('[data-ob=metrics]')).toContainText('$350.00 credit');
});

test('payoff shows Net Greeks from live quotes', async ({page}) => {
  const builder = await gotoBuilderWithGreeks(page);
  await builder.getByRole('button',{name:'+ Buy Call',exact:true}).click();
  await expect(builder.locator('[data-ob=payoff-greeks]')).toContainText('Live Greeks');
  await expect(builder.locator('[data-ob=payoff-greeks]')).toContainText('Delta 50.00');
  await expect(builder.locator('[data-ob=greeks]')).toContainText('Delta 50.00');
});

test('moves a strike with touch on a narrow screen', async ({browser,baseURL}) => {
  const page = await browser.newPage({baseURL,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await page.addInitScript(() => localStorage.setItem('market-lens-sync-disabled','1'));
  try {
    await page.goto('./');
    await page.locator('.mobile-more summary').tap();
    await page.locator('.mobile-more').getByRole('button',{name:'Options Builder'}).tap();
    const builder = page.locator('#options-builder');
    await builder.getByLabel('Underlying reference price').fill('100');
    await builder.getByRole('button',{name:'+ Buy Call',exact:true}).tap();
    const ruler = builder.locator('[data-ob=ruler]');
    const marker = ruler.getByRole('button',{name:'Move leg 1 strike, 100C'});
    await marker.scrollIntoViewIfNeeded();
    const bounds = await marker.boundingBox();
    const x = Math.round(bounds.x+bounds.width/2), y = Math.round(bounds.y+bounds.height/2);
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+37,y}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(async () => Number(await builder.getByLabel('Leg 1 strike',{exact:true}).inputValue())).toBeGreaterThan(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  } finally {
    await page.close();
  }
});

test('dragging the group price handle shifts all manual legs together without changing actual spot',async({page})=>{
  await page.goto('./');
  await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('button',{name:'Options Builder'}).click();
  const b=page.locator('#options-builder');
  await b.getByLabel('Underlying reference price').fill('100');
  await b.getByLabel('Strategy preset').selectOption('Bull call debit spread');
  await b.getByRole('button',{name:'Apply preset'}).click();
  const a=b.getByLabel('Leg 1 strike',{exact:true}),c=b.getByLabel('Leg 2 strike',{exact:true});
  const before=[Number(await a.inputValue()),Number(await c.inputValue())];
  const handle=b.getByRole('button',{name:'Move all option strikes'});
  await handle.scrollIntoViewIfNeeded();
  const box=await handle.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+50,y,{steps:8});await page.mouse.up();
  await expect.poll(async()=>Number(await a.inputValue())).toBeGreaterThan(before[0]);
  expect(Number(await c.inputValue())-Number(await a.inputValue())).toBeCloseTo(before[1]-before[0],6);
  await expect(b.getByLabel('Underlying reference price')).toHaveValue('100');
  const shifted=Number(await a.inputValue());await handle.focus();await handle.press('ArrowLeft');
  await expect.poll(async()=>Number(await a.inputValue())).toBeLessThan(shifted);
});
