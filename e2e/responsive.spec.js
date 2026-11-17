import {test,expect} from '@playwright/test';

for(const width of [1440,1024,768,390]){
 test('trading workspace respects viewport grid at '+width+'px',async ({page})=>{
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.setViewportSize({width,height:900});
   await page.goto('./');
   await expect(page.getByRole('heading',{name:'Screener'})).toBeVisible();
   await expect(page.locator('.market-fact')).toContainText('DEMO-VXX');
   await expect(page.locator('.market-fact')).toContainText('SIMULATED');
   const check=async ()=>{
     const measurements=await page.evaluate(()=>{
       const main=document.querySelector('.main'),box=main.getBoundingClientRect();
       return {vw:innerWidth,doc:document.documentElement.scrollWidth,body:document.body.scrollWidth,left:box.left,right:innerWidth-box.right};
     });
     expect(measurements.doc,'document overflows at '+width+'px').toBeLessThanOrEqual(width+1);
     expect(measurements.body,'body overflows at '+width+'px').toBeLessThanOrEqual(width+1);
     if(width<=800)expect(Math.abs(measurements.left-measurements.right),'unbalanced content edges').toBeLessThanOrEqual(2);
   };
   await check();
   const nav=width<=800?'.mobile-nav':'.sidebar';
   await page.locator(nav+' [data-tab="charts"]').click();
   await expect(page.locator('#price-chart canvas').first()).toBeVisible();
   await check();
   await page.locator(nav+' [data-tab="backtest"]').click();
   await page.locator('[data-action="run-backtest"]').click();
   await expect(page.locator('#equity-chart canvas').first()).toBeVisible();
   await check();
   if(width<=800)await page.getByText('More',{exact:true}).click();
   await page.locator(nav+' [data-tab="data"]').click();
   await expect(page.locator('[data-setting="apiBaseUrl"]')).toBeVisible();
   await check();
   if(width<=800)await page.getByText('More',{exact:true}).click();
   await page.locator(nav+' [data-tab="scripts"]').click();
   await expect(page.getByRole('heading',{name:'Script Lab'})).toBeVisible();
   await expect(page.locator('#pine-editor')).toBeVisible();
   await check();
   await page.locator(nav+' [data-tab="screener"]').click();
   await page.locator('[data-option="preset"]').selectOption('volatility');
   await page.locator('[data-action="scan-universe"]').click();
   await expect(page.locator('#scan-status')).toContainText('1 match');
   await check();
   const sizes=await page.locator('.mode-switch button').evaluateAll(els=>els.map(el=>({h:el.getBoundingClientRect().height,w:el.getBoundingClientRect().width})));
   expect(sizes.every(x=>x.h>=44&&x.w>=44)).toBeTruthy();
   expect(errors).toEqual([]);
 });
}
