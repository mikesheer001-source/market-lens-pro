import {test,expect} from './market-fixture.js';
import {LIVE_SCAN_CACHE_REVISION} from '../src/live-history.js';
import {sampleData} from '../src/engine.js';
import {OPTIONS_DEVICE_KEY} from '../src/options-api.js';

test('Chart Lab loads six-month and one-year options medians and can hide them',async ({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  // Observe actual Canvas drawing calls without replacing the chart renderer.
  await page.addInitScript(()=>{
    const probe=window.medianCanvasProbe={texts:[],dots:[],lines:[]};
    const proto=CanvasRenderingContext2D.prototype;
    const fillText=proto.fillText,arc=proto.arc,fill=proto.fill,fillRect=proto.fillRect,stroke=proto.stroke;
    const colors=['#7bdac6','#f0bd77'];
    proto.fillText=function(text,x,y,...args){
      if(String(text).startsWith('50/50 · ')||/^\d{4}-\d{2}-\d{2}(?: 20:00 UTC)? · \$/u.test(String(text)))
        probe.texts.push({text:String(text),x,y});
      return fillText.call(this,text,x,y,...args);
    };
    const arcs=new WeakMap();
    proto.arc=function(x,y,r,...args){arcs.set(this,{x,y,r});return arc.call(this,x,y,r,...args);};
    proto.fill=function(...args){
      const dot=arcs.get(this);
      if(dot&&dot.r===4.5&&colors.includes(this.fillStyle))probe.dots.push({...dot,color:this.fillStyle});
      arcs.delete(this);return fill.apply(this,args);
    };
    proto.fillRect=function(x,y,w,h){
      if(colors.includes(this.fillStyle)&&Math.abs(w)>80&&Math.abs(h)<=4)probe.lines.push({x,y,w,h});
      return fillRect.call(this,x,y,w,h);
    };
    proto.stroke=function(...args){
      if(colors.includes(this.strokeStyle))probe.lines.push({stroke:true});
      return stroke.apply(this,args);
    };
  });
  const now=Date.now();
  const expirations=[180,365].map(days=>new Date(now+days*86_400_000).toISOString().slice(0,10));
  const daily=sampleData()['DEMO-SPY'].slice(500,1750).map(bar=>({
    t:bar.time+'T05:00:00Z',o:bar.close,h:bar.close+1,l:bar.close-1,c:bar.close,v:50000
  }));
  const token='a'.repeat(64);
  await page.addInitScript(({key,token})=>localStorage.setItem(key,token),{key:OPTIONS_DEVICE_KEY,token});
  await page.route('**/api/stocks/scan?**',route=>route.fulfill({json:{
    source:'alpaca',feed:'iex',lookback_days:1825,scan_cache_revision:LIVE_SCAN_CACHE_REVISION,
    requested:133,returned:1,missing:[],bars:{SPY:daily}
  }}));
  const requested=[];
  await page.route('**/api/options/**',route=>{
    const url=new URL(route.request().url());
    expect(route.request().headers().authorization).toBe('Bearer '+token);
    expect(url.searchParams.get('symbol')).toBe('SPY');
    expect(url.searchParams.get('feed')).toBe('indicative');
    if(url.pathname.endsWith('/expirations'))return route.fulfill({json:{feed:'indicative',expirations,underlying:{value:100}}});
    const expiry=url.searchParams.get('expiry');
    requested.push(expiry);
    const median=expiry===expirations[0]?103:108;
    const years=(Date.parse(expiry+'T20:00:00Z')-now)/(365*86_400_000);
    const contracts=Array.from({length:17},(_,i)=>86+i*2).map(strike=>{
      const mid=Math.exp(-.04*years)*(median+24-strike)**2/96;
      return {root:'SPY',strike,type:'call',quote:{bid:mid-.01,ask:mid+.01,time:new Date(now).toISOString()}};
    });
    return route.fulfill({json:{feed:'indicative',contracts}});
  });
  await page.goto('./');
  await expect(page.locator('#scan-status')).toContainText('1/133 symbols loaded');
  await page.locator('.sidebar [data-tab="charts"]').click();
  await page.getByRole('button',{name:'New indicator'}).click();
  await page.getByRole('button',{name:'Options 50/50 levels'}).click();
  const result=page.locator('#chart-options-median-result');
  await expect(result.locator('.chart-options-median-level').first()).toHaveAttribute('title',new RegExp(expirations[0]));
  await expect(result).toContainText('$103.00');
  await expect(result.locator('.chart-options-median-level').last()).toHaveAttribute('title',new RegExp(expirations[1]));
  await expect(result).toContainText('$108.00');
  await expect(result.locator('.chart-options-median-level').first()).toContainText('50/50 · '+expirations[0]);
  await expect(result.locator('.chart-options-median-level').last()).toContainText('50/50 · '+expirations[1]);
  await expect.poll(()=>page.evaluate(()=>window.medianCanvasProbe.texts.map(x=>x.text))).toEqual(expect.arrayContaining([
    '50/50 · 6M','50/50 · 1Y',expirations[0]+' · $103.00',expirations[1]+' · $108.00']));
  const painted=await page.evaluate(()=>window.medianCanvasProbe);
  const a=painted.dots.filter(x=>x.color==='#7bdac6').at(-1),b=painted.dots.filter(x=>x.color==='#f0bd77').at(-1);
  expect(a).toBeTruthy();expect(b).toBeTruthy();
  expect(a.x).toBeLessThan(b.x);expect(a.y).toBeGreaterThan(b.y);
  expect(painted.lines).toEqual([]);
  expect(requested.sort()).toEqual(expirations);
  await expect(page.locator('#chart-indicator-legend').locator(result)).toBeVisible();
  await expect(page.getByLabel('Rate assumption (%)')).toHaveCount(0);
  await page.getByRole('button',{name:'New indicator'}).click();
  const picker=page.getByRole('dialog');
  await expect(picker.getByText('Other indicators',{exact:true})).toHaveCount(0);
  const enabled=picker.getByRole('button',{name:'Options 50/50 levels',exact:true});
  await expect(enabled).toContainText('Add another');
  await enabled.click();
  await expect(page.getByLabel('Rate assumption (%)')).toHaveValue('4');
  await page.getByLabel('Rate assumption (%)').fill('5');
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  const copy=page.locator('[data-indicator-row^="ind-"]');
  await expect(copy.locator('.chart-options-median-level')).toHaveCount(2);
  await copy.getByRole('button',{name:'Settings for Options 50/50'}).click();
  await expect(page.getByLabel('Rate assumption (%)')).toHaveValue('5');
  await page.getByRole('button',{name:'Remove',exact:true}).click();
  await expect(copy).toHaveCount(0);
  await page.locator('[data-indicator-row="optionsMedian"]').getByRole('button',{name:'Settings for Options 50/50'}).click();
  await expect(page.getByLabel('Rate assumption (%)')).toHaveValue('4');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('.chart-tools summary').click();
  await page.getByRole('button',{name:'Hide options 50/50'}).click();
  await expect(result).toHaveCount(0);
  await expect(page.locator('[data-median-show]')).toHaveCount(0);
  await page.evaluate(()=>{window.medianCanvasProbe.texts.length=0;window.medianCanvasProbe.dots.length=0;window.medianCanvasProbe.lines.length=0;});
  await page.setViewportSize({width:1100,height:800});
  await expect(page.locator('#price-chart canvas').first()).toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await page.evaluate(()=>window.medianCanvasProbe)).toEqual({texts:[],dots:[],lines:[]});
  await page.locator('.chart-tools summary').click();
  await page.locator('.chart-tools-menu').getByRole('button',{name:'Options 50/50 levels'}).click();
  await expect(result).toContainText('$103.00');
  await expect.poll(()=>page.evaluate(()=>window.medianCanvasProbe.dots.length)).toBeGreaterThan(0);
  await expect(result.getByRole('button',{name:'View dots'})).toBeVisible();
  expect(errors).toEqual([]);
});
