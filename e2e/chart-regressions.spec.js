import {test,expect} from './market-fixture.js';
import {sampleData} from '../src/engine.js';

const row=(page,key)=>page.locator('#chart-lab-panel [data-chart-workspace-row="'+key+'"]');
const panel=(page,key)=>page.locator('#chart-workspaces > [data-workspace-section="'+key+'"]');

async function configureBacktest(page){
  await page.locator('.chart-tools summary').click();
  await page.getByRole('button',{name:'Workspace tools & overlays',exact:true}).click();
  const dialog=page.locator('#chart-workspace-dialog');
  await dialog.locator('[data-chart-workspace-choice="backtest"]').check();
  await dialog.getByRole('button',{name:'Apply visibility'}).click();
  await expect(dialog).not.toBeVisible();
}
async function chooseSymbol(page,symbol){
  await page.locator('[data-action="chart-symbol-picker"]').click();
  const dialog=page.locator('#chart-symbol-dialog');
  await dialog.getByLabel('Search chart symbols').fill(symbol);
  await dialog.locator('[data-action="chart-choose-symbol"][data-symbol="'+symbol+'"]').click();
}
function makeIntradayBars(count){
  const sessions=[];
  for(let cursor=new Date('2026-11-25T12:00:00Z');sessions.length<95;cursor.setUTCDate(cursor.getUTCDate()-1)){
    if(cursor.getUTCDay()!==0&&cursor.getUTCDay()!==6)sessions.push(cursor.toISOString().slice(0,10));
  }
  sessions.reverse();
  const bars=[];
  for(const session of sessions){
    const [year,month,date]=session.split('-').map(Number);
    const utcOffset=session<'2026-11-01'?4:5;
    const limit=Math.min(26,count-bars.length);
    for(let i=0;i<limit;i++){
      const timestamp=Date.UTC(year,month-1,date,9+utcOffset,30+i*15);
      const close=40+bars.length/1000;
      bars.push({t:new Date(timestamp).toISOString(),o:close,h:close+.2,l:close-.2,c:close+.05,v:1000});
    }
    if(bars.length===count)break;
  }
  return bars;
}

test('Backtest workspace content is present when expanded after a collapsed chart rerender',async({page})=>{
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await configureBacktest(page);
  await row(page,'backtest').getByRole('button',{name:'Settings',exact:true}).click();
  const backtest=panel(page,'backtest');
  await expect(backtest).toHaveAttribute('open','');
  await expect(backtest.locator('.workspace-content')).toContainText('Strategy settings');
  await expect(backtest.locator('.workspace-content')).toContainText('Performance');

  await backtest.locator(':scope > summary').click();
  await expect(backtest).not.toHaveAttribute('open','');
  await chooseSymbol(page,'VXX');
  await expect(backtest).not.toHaveAttribute('open','');
  await backtest.locator(':scope > summary').click();
  await expect(backtest).toHaveAttribute('open','');
  await expect(backtest.locator('.workspace-content')).toContainText('Strategy settings');
  await expect(backtest.locator('.workspace-content')).toContainText('Equity curve vs. buy-and-hold');
});

test('daily crosshair readout follows the hovered BusinessDay instead of sticking to the last bar',async({page})=>{
  const lastDate=sampleData()['DEMO-SPY'].at(-1).time;
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await page.getByRole('button',{name:'All',exact:true}).click();
  const chart=page.locator('#price-chart');
  const bounds=await chart.boundingBox();
  await page.mouse.move(bounds.x+bounds.width*.25,bounds.y+bounds.height*.3);
  await expect.poll(async()=>page.locator('#readout time').textContent()).not.toBe(lastDate);
});

test('VXX 15-minute bar count remains stable after switching to another ticker and back',async({page})=>{
  const vxxBars=makeIntradayBars(2464);
  const spyBars=Array.from({length:10},(_,i)=>{
    const timestamp=Date.UTC(2026,10,25,14,30+i*15),close=500+i;
    return {t:new Date(timestamp).toISOString(),o:close,h:close+1,l:close-1,c:close+.25,v:2000};
  });
  let vxxRequests=0;
  await page.route('**/api/stocks/intraday?**',route=>{
    const symbol=new URL(route.request().url()).searchParams.get('symbol');
    if(symbol==='VXX'){
      vxxRequests++;
      return route.fulfill({json:{symbol,feed:'iex',timeframe:'15Min',bars:vxxBars}});
    }
    return route.fulfill({json:{symbol,feed:'iex',timeframe:'15Min',bars:spyBars}});
  });
  await page.goto('./');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await chooseSymbol(page,'VXX');
  await page.locator('[data-timeframe="15m"]').click();
  await expect(page.locator('.chart-data')).toContainText('2464 15m bars');
  await chooseSymbol(page,'SPY');
  await expect(page.locator('.chart-data')).toContainText('10 15m bars');
  await chooseSymbol(page,'VXX');
  await expect(page.locator('.chart-data')).toContainText('2464 15m bars');
  expect(vxxRequests).toBe(1);
});
