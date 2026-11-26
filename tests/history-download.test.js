import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadHistoricalBars,downloadUniverseHistory,HISTORY_DOWNLOAD_BATCH_SIZE,HISTORY_DOWNLOAD_PAGE_LIMIT} from '../src/history-download.js';

const response=(body,status=200,headers={})=>new Response(JSON.stringify(body),{
  status,headers:{'Content-Type':'application/json',...headers}
});
const bar=(date,close)=>({t:date+'T05:00:00Z',o:close,h:close+1,l:close-1,c:close,v:100});

test('history downloader batches symbols and follows every multi-symbol page token',async()=>{
  const calls=[];
  const fetchImpl=async input=>{
    const url=new URL(input),symbols=url.searchParams.get('symbols').split(','),token=url.searchParams.get('page_token');
    calls.push({symbols,token,limit:url.searchParams.get('limit')});
    const date=token?'2024-01-02':'2024-01-03';
    return response({
      bars:Object.fromEntries(symbols.map((symbol,index)=>[symbol,[bar(date,10+index)]])),
      next_page_token:token?null:'cursor-'+symbols[0]
    });
  };
  const result=await downloadHistoricalBars({
    symbols:['aaa','bbb','ccc'],start:'2024-01-01',end:'2024-01-10',
    batchSize:2,limit:10,requestIntervalMs:0,fetchImpl
  });
  assert.equal(result.requested,3);
  assert.equal(result.returned,3);
  assert.equal(result.batches,2);
  assert.equal(result.pages,4);
  assert.equal(result.retries,0);
  assert.deepEqual(calls.map(call=>call.symbols),[
    ['AAA','BBB'],['AAA','BBB'],['CCC'],['CCC']
  ]);
  assert.deepEqual(calls.map(call=>call.token),[null,'cursor-AAA',null,'cursor-CCC']);
  assert.ok(calls.every(call=>call.limit==='10'));
  assert.deepEqual(result.bars.AAA.map(item=>item.t),[
    '2024-01-02T05:00:00Z','2024-01-03T05:00:00Z'
  ]);
  assert.deepEqual(result.bars.BBB.map(item=>item.t),[
    '2024-01-02T05:00:00Z','2024-01-03T05:00:00Z'
  ]);
  assert.deepEqual(result.missing,[]);
});

test('history downloader retries 429 using Retry-After and returns the complete batch',async()=>{
  let calls=0;
  const result=await downloadHistoricalBars({
    symbols:['AAA'],start:'2024-01-01',end:'2024-01-10',
    requestIntervalMs:0,maxRetries:1,retryBaseDelayMs:0,
    fetchImpl:async()=>{
      calls++;
      if(calls===1)return response({error:'rate limited'},429,{'Retry-After':'0'});
      return response({bars:{AAA:[bar('2024-01-02',10)]},next_page_token:null});
    }
  });
  assert.equal(calls,2);
  assert.equal(result.retries,1);
  assert.equal(result.totalBars,1);
  assert.equal(result.bars.AAA.length,1);
});

test('universe downloader uses all 13,532 symbols and splits them into bounded batches',async()=>{
  const symbols=Array.from({length:13532},(_,index)=>'S'+String(index).padStart(5,'0'));
  const batches=[];
  let directoryCalls=0;
  const fetchImpl=async input=>{
    const url=new URL(input);
    if(url.pathname.endsWith('/api/stocks/universe')){
      directoryCalls++;
      return response({source:'alpaca-v2-assets',id:'directory-id',count:symbols.length,symbols});
    }
    const batch=url.searchParams.get('symbols').split(',');
    batches.push(batch);
    return response({bars:{},next_page_token:null});
  };
  const result=await downloadUniverseHistory({
    start:'2020-01-01',end:'2025-01-01',requestIntervalMs:0,fetchImpl
  });
  assert.equal(directoryCalls,1);
  assert.equal(result.directory.id,'directory-id');
  assert.equal(result.directory.count,13532);
  assert.equal(result.requested,13532);
  assert.equal(result.batches,Math.ceil(13532/HISTORY_DOWNLOAD_BATCH_SIZE));
  assert.equal(batches.length,136);
  assert.equal(Math.max(...batches.map(batch=>batch.length)),HISTORY_DOWNLOAD_BATCH_SIZE);
  assert.equal(batches.reduce((sum,batch)=>sum+batch.length,0),13532);
  assert.equal(result.missing.length,13532);
  assert.equal(HISTORY_DOWNLOAD_PAGE_LIMIT,10000);
});

test('history downloader rejects invalid dates, symbols, batch sizes and page limits',async()=>{
  const fetchImpl=async()=>response({bars:{},next_page_token:null});
  const base={start:'2024-01-01',end:'2024-02-01',requestIntervalMs:0,fetchImpl};
  await assert.rejects(()=>downloadHistoricalBars({...base,symbols:[]}),/At least one ticker/);
  await assert.rejects(()=>downloadHistoricalBars({...base,symbols:['BAD SYMBOL']}),/Invalid ticker/);
  await assert.rejects(()=>downloadHistoricalBars({...base,symbols:['AAA'],batchSize:101}),/Batch size/);
  await assert.rejects(()=>downloadHistoricalBars({...base,symbols:['AAA'],limit:10001}),/Page limit/);
  await assert.rejects(()=>downloadHistoricalBars({...base,symbols:['AAA'],start:'2024-02-01'}),/valid start and end/);
});


test('streaming universe download releases each completed batch and does not retain the full history',async()=>{
  const symbols=Array.from({length:205},(_,index)=>'S'+String(index).padStart(4,'0'));
  const batches=[];
  const fetchImpl=async input=>{
    const url=new URL(input);
    if(url.pathname.endsWith('/api/stocks/universe'))
      return response({source:'alpaca-v2-assets',count:symbols.length,symbols});
    const batch=url.searchParams.get('symbols').split(',');
    return response({bars:Object.fromEntries(batch.map(symbol=>[symbol,[bar('2024-01-02',10)]])),next_page_token:null});
  };
  const result=await downloadUniverseHistory({
    start:'2024-01-01',end:'2024-02-01',batchSize:100,requestIntervalMs:0,
    retainBars:false,fetchImpl,
    onBatch:async batch=>batches.push({symbols:batch.symbols.length,bars:Object.keys(batch.bars).length,totalBars:batch.totalBars})
  });
  assert.equal(result.requested,205);
  assert.equal(result.returned,205);
  assert.equal(result.totalBars,205);
  assert.equal(result.batches,3);
  assert.equal(Object.hasOwn(result,'bars'),false);
  assert.deepEqual(batches.map(x=>x.symbols),[100,100,5]);
  assert.deepEqual(batches.map(x=>x.bars),[100,100,5]);
  assert.equal(batches.at(-1).totalBars,205);
});
