import {test,expect} from './market-fixture.js';

test('universe history download batches symbols, follows page tokens and retries rate limits',async({page})=>{
  const requests=[];
  let rateLimitSent=false;
  await page.route('**/history-worker/api/stocks/universe*',route=>route.fulfill({json:{
    source:'alpaca-v2-assets',id:'test-directory',count:5,
    symbols:['AAA','BBB','CCC','DDD','EEE']
  }}));
  await page.route('**/history-worker/api/stocks/bars?**',async route=>{
    const url=new URL(route.request().url());
    const symbols=url.searchParams.get('symbols').split(',');
    const token=url.searchParams.get('page_token');
    requests.push({symbols,token,limit:url.searchParams.get('limit'),timeframe:url.searchParams.get('timeframe'),sort:url.searchParams.get('sort')});
    if(!rateLimitSent&&symbols[0]==='AAA'&&!token){
      rateLimitSent=true;
      return route.fulfill({status:429,headers:{'Retry-After':'0'},json:{error:'rate limited'}});
    }
    const date=token?'2024-01-03T05:00:00Z':'2024-01-02T05:00:00Z';
    return route.fulfill({json:{
      bars:Object.fromEntries(symbols.map((symbol,index)=>[symbol,[{
        t:date,o:10+index,h:11+index,l:9+index,c:10.5+index,v:100
      }]])),
      next_page_token:token?null:'next-'+symbols[0]
    }});
  });
  await page.goto('./');
  const result=await page.evaluate(async()=>{
    const {downloadUniverseHistory}=await import('/market-lens-pro/src/history-download.js');
    const progress=[];
    const value=await downloadUniverseHistory({
      workerUrl:location.origin+'/history-worker',
      start:'2024-01-01',end:'2024-01-10',batchSize:2,limit:2,
      requestIntervalMs:0,maxRetries:2,retryBaseDelayMs:0,
      onProgress:event=>progress.push(event)
    });
    return {...value,progress};
  });
  expect(result.requested).toBe(5);
  expect(result.returned).toBe(5);
  expect(result.batches).toBe(3);
  expect(result.pages).toBe(6);
  expect(result.retries).toBe(1);
  expect(result.directory.id).toBe('test-directory');
  expect(result.missing).toEqual([]);
  for(const symbol of ['AAA','BBB','CCC','DDD','EEE']){
    expect(result.bars[symbol]).toHaveLength(2);
    expect(result.bars[symbol][0].t).toBe('2024-01-02T05:00:00Z');
    expect(result.bars[symbol][1].t).toBe('2024-01-03T05:00:00Z');
  }
  expect(requests).toHaveLength(7);
  expect(requests.filter(request=>request.token===null)).toHaveLength(4);
  expect(requests.filter(request=>request.token!==null)).toHaveLength(3);
  expect(requests.every(request=>request.limit==='2'&&request.timeframe==='1Day'&&request.sort==='asc')).toBe(true);
  expect(requests.filter(request=>request.token===null).map(request=>request.symbols)).toEqual([
    ['AAA','BBB'],['AAA','BBB'],['CCC','DDD'],['EEE']
  ]);
  expect(result.progress.filter(event=>event.type==='page')).toHaveLength(6);
});
