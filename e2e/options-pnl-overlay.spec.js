import {test,expect} from './market-fixture.js';

async function configure(page,choices){
  await page.locator('.chart-tools summary').click();
  await page.getByRole('button',{name:'Workspace tools & overlays',exact:true}).click();
  const dialog=page.locator('#chart-workspace-dialog');
  for(const [key,enabled] of Object.entries(choices))
    await dialog.locator('[data-chart-workspace-choice="'+key+'"]').setChecked(enabled);
  await dialog.getByRole('button',{name:'Apply visibility'}).click();
}
const optionRow=page=>page.locator('#chart-workspaces [data-chart-workspace-row="options"]');
const optionsPanel=page=>page.locator('#chart-workspaces > [data-workspace-section="options"]');

test('draws quote-verified green/red expiration P&L and breakevens, then recalculates premium and quantity edits',async({page})=>{
  test.setTimeout(90_000);
  const expiry=new Date(Date.now()+21*86_400_000).toISOString().slice(0,10);
  const quoteTime=new Date().toISOString();
  const symbols=['SPY'+expiry+'C100','SPY'+expiry+'C105'];
  const bars=[99,102,110].map((close,index)=>({
    t:new Date(Date.UTC(2026,10,24+index,21)).toISOString(),
    o:close-.5,h:close+1,l:close-1,c:close,v:10000+index
  }));
  await page.route('**/api/stocks/scan?**',route=>route.fulfill({json:{
    source:'alpaca',feed:'iex',requested:1,returned:1,missing:[],bars:{SPY:bars},
    freshness:{expected:bars.at(-1).t.slice(0,10)}
  }}));
  await page.route('**/api/options/**',route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/device'))return route.fulfill({status:204});
    if(url.pathname.endsWith('/expirations'))return route.fulfill({json:{
      feed:'indicative',expirations:[expiry],underlying:{value:100,time:quoteTime,feed:'IEX'}
    }});
    if(url.pathname.endsWith('/chain'))return route.fulfill({json:{feed:'indicative',contracts:[
      {symbol:symbols[0],root:'SPY',type:'call',expiry,strike:100,multiplier:100,quote:{bid:2,ask:3,time:quoteTime}},
      {symbol:symbols[1],root:'SPY',type:'call',expiry,strike:105,multiplier:100,quote:{bid:1,ask:2,time:quoteTime}}
    ]}});
    if(url.pathname.endsWith('/snapshots'))return route.fulfill({json:{feed:'indicative',quotes:{
      [symbols[0]]:{bid:2,ask:3,time:quoteTime},[symbols[1]]:{bid:1,ask:2,time:quoteTime}
    }}});
    return route.fulfill({status:404,json:{error:'Unexpected options request'}});
  });

  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('./#options-setup='+'b'.repeat(64));
  const builder=page.locator('#options-builder');
  await expect(builder.locator('[data-ob=status]')).toContainText('2 contracts');
  await builder.getByLabel('Underlying reference price').fill('100');
  await builder.getByLabel('Strategy preset').selectOption('Bull call debit spread');
  await builder.getByRole('button',{name:'Apply preset'}).click();
  await expect(builder.getByLabel('Leg 1 entry')).toHaveValue('2.5');
  await expect(builder.getByLabel('Leg 2 entry')).toHaveValue('1.5');

  await page.locator('.sidebar [data-tab="charts"]').click();
  await expect(page.locator('#price-chart')).toHaveAttribute('data-options-pnl-status','off');
  await configure(page,{options:true,optionsPnl:true});
  await expect(page.locator('#price-chart')).toHaveAttribute('data-options-pnl-status','ready');
  await expect(page.locator('#price-chart')).toHaveAttribute('data-workspace-option-pnl-breakevens','1');
  await expect(page.locator('#price-chart')).toHaveAttribute('data-options-pnl-breakevens','[101]');
  await expect(page.locator('#price-chart')).toHaveAttribute('data-options-pnl-profit-points','2');
  await expect(page.locator('#price-chart')).toHaveAttribute('data-options-pnl-loss-points','1');
  await expect(page.locator('#options-pnl-readout')).toContainText('Expiry +$400.00');
  await expect(page.locator('#options-pnl-readout')).toContainText('Live −$100.00');

  await optionRow(page).getByRole('button',{name:'Open builder'}).click();
  const workspaceBuilder=optionsPanel(page).locator('#options-builder');
  await workspaceBuilder.getByLabel('Leg 1 entry').fill('3.5');
  await expect(page.locator('#price-chart')).toHaveAttribute('data-options-pnl-breakevens','[102]');
  await workspaceBuilder.getByLabel('Leg 1 quantity').fill('2');
  await expect(page.locator('#price-chart')).toHaveAttribute('data-options-pnl-breakevens','[102.75]');
  await expect(page.locator('#price-chart')).toHaveAttribute('data-options-pnl-profit-points','1');
  await expect(page.locator('#price-chart')).toHaveAttribute('data-options-pnl-loss-points','2');

  await workspaceBuilder.getByLabel('Leg 2 expiry').fill('2026-12-19');
  await expect(page.locator('#price-chart')).toHaveAttribute('data-options-pnl-status','missing-live-quotes');
  await expect(page.locator('#options-pnl-readout')).toContainText('Fresh live bid/ask quotes');
  await configure(page,{optionsPnl:false});
  await expect(page.locator('#price-chart')).toHaveAttribute('data-options-pnl-status','off');
  await expect(page.locator('#options-pnl-readout')).toBeHidden();
  expect(errors).toEqual([]);
});
