// Deterministic market-data responses for browser tests only. No production Demo mode.
import {test as base,expect} from '@playwright/test';
import {sampleData} from '../src/engine.js';
export {expect};
const bars=Object.fromEntries(Object.entries(sampleData()).map(([symbol,rows])=>[
  symbol.replace(/^DEMO-/,''),rows.map(b=>({t:b.time+'T21:00:00Z',o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}))
]));
const payload={source:'alpaca',feed:'iex',requested:4,returned:4,missing:[],bars,
  freshness:{expected:bars.SPY.at(-1).t.slice(0,10)}};
export async function mockMarket(context){
  await context.route('**/api/stocks/scan?**',route=>route.fulfill({json:payload}));
  await context.route('**/api/stocks/intraday?**',route=>route.fulfill({status:503,json:{error:'No intraday fixture'}}));
  await context.route('**/api/stocks/bars?**',route=>route.fulfill({json:{bars:[],feed:'iex'}}));
  await context.route('**/api/server-scan/config',route=>route.fulfill({json:{ok:true}}));
  await context.route('**/api/server-scan/notifications',route=>route.fulfill({json:{notifications:[],lastRun:null}}));
  await context.route('**/api/server-scan/run',route=>route.fulfill({json:{requested:133,returned:133,matchCount:0,newMatchCount:0,newMatches:[],matches:[]}}));
  await context.route('**/api/server-scan/notifications/ack',route=>route.fulfill({json:{ok:true}}));
  await context.addInitScript(()=>{
    const key='market-lens-pro-settings';
    if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({lastSymbol:'SPY',lastLiveSymbol:'SPY'}));
  });
}
export async function waitForMarket(page){
  await expect(page.locator('.topbar .source-badge')).toHaveText(/ALPACA LIVE|ALPACA UNAVAILABLE|ALPACA · PREVIOUS DATA|IMPORTED OHLCV/,{timeout:30000});
}
export const test=base.extend({
  page:async({page,context},use)=>{
    await mockMarket(context);
    const goto=page.goto.bind(page),reload=page.reload.bind(page);
    page.goto=async(...args)=>{const result=await goto(...args);await waitForMarket(page);return result;};
    page.reload=async(...args)=>{const result=await reload(...args);await waitForMarket(page);return result;};
    await use(page);
  }
});
