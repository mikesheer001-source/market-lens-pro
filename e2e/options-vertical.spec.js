import {test,expect} from './market-fixture.js';
async function configurePnl(page){
 await page.locator('.chart-tools summary').click();
 await page.getByRole('button',{name:'Workspace tools & overlays',exact:true}).click();
 const dialog=page.locator('#chart-workspace-dialog');
 await dialog.locator('[data-chart-workspace-choice="options"]').setChecked(true);
 await dialog.locator('[data-chart-workspace-choice="optionsPnl"]').setChecked(true);
 await dialog.getByRole('button',{name:'Apply visibility'}).click();
}
test('builds call debit and put credit verticals from live contracts and updates Chart Lab expiration P&L',async({page})=>{
 test.setTimeout(90_000);
 const expiry=new Date(Date.now()+21*86_400_000).toISOString().slice(0,10),quoteTime=new Date().toISOString();
 const strikes=[95,100,105,110],calls={95:[4,5],100:[2,3],105:[1,2],110:[.4,.6]},
   puts={95:[.4,.6],100:[2,3],105:[4,5],110:[6,7]};
 await page.route('**/api/options/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/device'))return route.fulfill({status:204});
  if(url.pathname.endsWith('/expirations'))return route.fulfill({json:{feed:'indicative',expirations:[expiry],
    underlying:{value:100,time:quoteTime,feed:'IEX'}}});
  if(url.pathname.endsWith('/chain'))return route.fulfill({json:{feed:'indicative',contracts:strikes.flatMap(strike=>[
    {symbol:'SPY'+expiry+'C'+strike,root:'SPY',type:'call',expiry,strike,multiplier:100,quote:{bid:calls[strike][0],ask:calls[strike][1],time:quoteTime}},
    {symbol:'SPY'+expiry+'P'+strike,root:'SPY',type:'put',expiry,strike,multiplier:100,quote:{bid:puts[strike][0],ask:puts[strike][1],time:quoteTime}}
  ])}});
  if(url.pathname.endsWith('/snapshots'))return route.fulfill({json:{feed:'indicative',quotes:Object.fromEntries(strikes.flatMap(strike=>[
    ['C',calls[strike]],['P',puts[strike]]
  ].map(([type,[bid,ask]])=>['SPY'+expiry+type+strike,{bid,ask,time:quoteTime}])))}});
  return route.fulfill({status:404,json:{error:'Unexpected options request'}});
 });
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('./#options-setup='+'b'.repeat(64));
 const builder=page.locator('#options-builder');
 await expect(builder.locator('[data-ob=status]')).toContainText('8 contracts');
 await expect(builder.getByLabel('Vertical expiration')).toHaveValue(expiry);
 await expect(builder.getByLabel('First vertical contract strike')).toHaveValue('100');
 await expect(builder.getByLabel('Second vertical contract strike')).toHaveValue('105');
 await expect(builder.getByLabel('First vertical contract entry premium')).toHaveValue('2.5');
 await expect(builder.getByLabel('Second vertical contract entry premium')).toHaveValue('1.5');
 await expect(builder.getByLabel('First vertical contract action')).toHaveValue('buy');
 await expect(builder.getByLabel('Second vertical contract action')).toHaveValue('sell');
 await expect(builder.locator('[data-ob=vertical-summary]')).toContainText('$100.00 debit');
 await expect(builder.locator('[data-ob=vertical-summary]')).toContainText('$400.00');
 await expect(builder.locator('[data-ob=vertical-summary]')).toContainText('$100.00');
 await expect(builder.locator('[data-ob=vertical-summary]')).toContainText('0.25 : 1');
 await builder.getByLabel('Contracts per leg').fill('2');
 await expect(builder.locator('[data-ob=vertical-summary]')).toContainText('$200.00 debit');
 await expect(builder.locator('[data-ob=vertical-summary]')).toContainText('$800.00');
 await builder.getByRole('button',{name:'Replace positions with this spread'}).click();
 await expect(builder.getByLabel('Leg 1 quantity')).toHaveValue('2');
 await expect(builder.getByLabel('Leg 2 quantity')).toHaveValue('2');
 await expect(builder.getByLabel('Leg 1 strike',{exact:true})).toHaveValue('100');
 await expect(builder.getByLabel('Leg 2 strike',{exact:true})).toHaveValue('105');
 await builder.getByLabel('Vertical option type').selectOption('put');
 await builder.getByLabel('Vertical spread structure').selectOption('credit');
 await expect(builder.getByLabel('First vertical contract strike')).toHaveValue('100');
 await expect(builder.getByLabel('Second vertical contract strike')).toHaveValue('95');
 await expect(builder.getByLabel('First vertical contract action')).toHaveValue('sell');
 await expect(builder.getByLabel('Second vertical contract action')).toHaveValue('buy');
 await builder.getByLabel('Contracts per leg').fill('1');
 await expect(builder.locator('[data-ob=vertical-summary]')).toContainText('$200.00 credit');
 await expect(builder.locator('[data-ob=vertical-summary]')).toContainText('$300.00');
 await builder.getByRole('button',{name:'Replace positions with this spread'}).click();
 await expect(builder.getByLabel('Leg 1 side')).toHaveValue('sell');
 await expect(builder.getByLabel('Leg 2 side')).toHaveValue('buy');
 await page.locator('.sidebar [data-tab="charts"]').click();
 await configurePnl(page);
 await expect(page.locator('#price-chart')).toHaveAttribute('data-options-pnl-status','ready');
 await expect(page.locator('#price-chart')).toHaveAttribute('data-options-pnl-breakevens','[98]');
 expect(errors).toEqual([]);
});
