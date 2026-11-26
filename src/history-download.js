import {DEFAULT_ALPACA_WORKER,canonicalWorkerBase} from './live-history.js';

export const HISTORY_DOWNLOAD_BATCH_SIZE=100;
export const HISTORY_DOWNLOAD_PAGE_LIMIT=10_000;
export const HISTORY_DOWNLOAD_REQUEST_INTERVAL_MS=2_500;

const SYMBOL_PATTERN=/^[A-Z0-9][A-Z0-9.^_-]{0,19}$/;
const FEEDS=new Set(['iex','sip','delayed_sip','boats','overnight','otc']);
const TIMEFRAMES=/^(?:[1-9]|[1-5]\d)Min$|^(?:[1-9]|1\d|2[0-3])Hour$|^(?:1Day|1Week|1Month)$/;
const ADJUSTMENTS=new Set(['raw','split','dividend','all']);

function normalizeSymbols(values){
  if(!Array.isArray(values))throw new TypeError('Symbols must be an array.');
  const symbols=[],seen=new Set();
  for(const value of values){
    const symbol=String(value??'').trim().toUpperCase();
    if(!SYMBOL_PATTERN.test(symbol))throw new Error('Invalid ticker symbol: '+symbol);
    if(!seen.has(symbol)){seen.add(symbol);symbols.push(symbol);}
  }
  if(!symbols.length)throw new Error('At least one ticker symbol is required.');
  return symbols;
}
function delay(milliseconds,signal){
  if(signal?.aborted)return Promise.reject(signal.reason||new Error('History download cancelled.'));
  const ms=Math.max(0,Math.ceil(milliseconds));
  if(!ms)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
    const abort=()=>{
      clearTimeout(timer);
      signal?.removeEventListener('abort',abort);
      reject(signal.reason||new Error('History download cancelled.'));
    };
    signal?.addEventListener('abort',abort,{once:true});
  });
}
function serverRetryDelay(response){
  const retry=response.headers?.get('Retry-After');
  if(retry){
    const seconds=Number(retry);
    if(Number.isFinite(seconds))return Math.max(0,seconds*1000);
    const date=Date.parse(retry);
    if(Number.isFinite(date))return Math.max(0,date-Date.now());
  }
  const reset=Number(response.headers?.get('X-RateLimit-Reset'));
  return Number.isFinite(reset)&&reset>0?Math.max(0,reset*1000-Date.now()):0;
}
function normalizeConfig(options,requireSymbols){
  const workerBase=canonicalWorkerBase(options.workerUrl||DEFAULT_ALPACA_WORKER);
  let parsedBase;
  try{parsedBase=new URL(workerBase);}catch{throw new Error('Provide a valid Worker URL.');}
  if(!['https:','http:'].includes(parsedBase.protocol))throw new Error('Worker URL must use HTTP or HTTPS.');
  const start=String(options.start??'').trim(),end=String(options.end??'').trim();
  if(!start||!end||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(start)>=Date.parse(end))
    throw new Error('Provide valid start and end dates; start must precede end.');
  const feed=String(options.feed||'iex').toLowerCase();
  if(!FEEDS.has(feed))throw new Error('Unsupported Alpaca data feed: '+feed);
  const timeframe=String(options.timeframe||'1Day');
  if(!TIMEFRAMES.test(timeframe))throw new Error('Unsupported Alpaca timeframe: '+timeframe);
  const adjustment=String(options.adjustment||'all');
  if(!ADJUSTMENTS.has(adjustment))throw new Error('Unsupported corporate-action adjustment: '+adjustment);
  const batchSize=Number(options.batchSize??HISTORY_DOWNLOAD_BATCH_SIZE);
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>HISTORY_DOWNLOAD_BATCH_SIZE)
    throw new Error('Batch size must be an integer from 1 to '+HISTORY_DOWNLOAD_BATCH_SIZE+'.');
  const limit=Number(options.limit??HISTORY_DOWNLOAD_PAGE_LIMIT);
  if(!Number.isInteger(limit)||limit<1||limit>HISTORY_DOWNLOAD_PAGE_LIMIT)
    throw new Error('Page limit must be an integer from 1 to '+HISTORY_DOWNLOAD_PAGE_LIMIT+'.');
  const requestIntervalMs=Number(options.requestIntervalMs??HISTORY_DOWNLOAD_REQUEST_INTERVAL_MS);
  const maxRetries=Number(options.maxRetries??6);
  const retryBaseDelayMs=Number(options.retryBaseDelayMs??1000);
  const maxRetryDelayMs=Number(options.maxRetryDelayMs??60_000);
  const maxPagesPerBatch=Number(options.maxPagesPerBatch??10_000);
  if(!Number.isFinite(requestIntervalMs)||requestIntervalMs<0)throw new Error('Request interval must be zero or greater.');
  if(!Number.isInteger(maxRetries)||maxRetries<0||maxRetries>20)throw new Error('maxRetries must be from 0 to 20.');
  if(!Number.isFinite(retryBaseDelayMs)||retryBaseDelayMs<0||!Number.isFinite(maxRetryDelayMs)||maxRetryDelayMs<0)
    throw new Error('Retry delays must be zero or greater.');
  if(!Number.isInteger(maxPagesPerBatch)||maxPagesPerBatch<1)throw new Error('maxPagesPerBatch must be a positive integer.');
  const fetchImpl=options.fetchImpl||globalThis.fetch?.bind(globalThis);
  if(typeof fetchImpl!=='function')throw new Error('Fetch is unavailable in this environment.');
  const config={workerBase,start,end,feed,timeframe,adjustment,batchSize,limit,requestIntervalMs,
    maxRetries,retryBaseDelayMs,maxRetryDelayMs,maxPagesPerBatch,fetchImpl,signal:options.signal,
    onProgress:typeof options.onProgress==='function'?options.onProgress:null};
  if(requireSymbols)config.symbols=normalizeSymbols(options.symbols);
  return config;
}
function retryable(status){return status===408||status===425||status===429||status>=500;}
async function requestJson(url,config,state,description){
  for(let attempt=0;attempt<=config.maxRetries;attempt++){
    if(config.signal?.aborted)throw config.signal.reason||new Error('History download cancelled.');
    await delay(Math.max(state.nextRequestAt,state.rateLimitUntil)-Date.now(),config.signal);
    state.nextRequestAt=Date.now()+config.requestIntervalMs;
    let response;
    try{
      response=await config.fetchImpl(url,{headers:{Accept:'application/json'},signal:config.signal});
    }catch(error){
      if(config.signal?.aborted)throw config.signal.reason||error;
      if(attempt>=config.maxRetries)throw error;
      state.retries++;
      await delay(Math.min(config.maxRetryDelayMs,config.retryBaseDelayMs*Math.pow(2,attempt)),config.signal);
      continue;
    }
    const reset=Number(response.headers?.get('X-RateLimit-Reset'));
    const remainingHeader=response.headers?.get('X-RateLimit-Remaining');
    const remaining=remainingHeader===null?NaN:Number(remainingHeader);
    if(remaining===0&&Number.isFinite(reset)&&reset>Date.now()/1000)
      state.rateLimitUntil=Math.max(state.rateLimitUntil,reset*1000);
    const payload=await response.json().catch(()=>null);
    if(response.ok)return {payload,response};
    const error=new Error(payload?.detail||payload?.error||description+' failed (HTTP '+response.status+').');
    error.status=response.status;
    if(!retryable(response.status)||attempt>=config.maxRetries)throw error;
    state.retries++;
    const backoff=Math.min(config.maxRetryDelayMs,config.retryBaseDelayMs*Math.pow(2,attempt));
    await delay(Math.max(backoff,serverRetryDelay(response)),config.signal);
  }
  throw new Error(description+' exhausted retries.');
}
function splitBatches(symbols,size){
  const batches=[];
  for(let index=0;index<symbols.length;index+=size)batches.push(symbols.slice(index,index+size));
  return batches;
}
async function downloadSymbols(config,symbols,state,directory){
  const batches=splitBatches(symbols,config.batchSize);
  const bySymbol=new Map(symbols.map(symbol=>[symbol,new Map()]));
  let totalPages=0,totalBars=0;
  for(let batchIndex=0;batchIndex<batches.length;batchIndex++){
    const batch=batches[batchIndex],seenTokens=new Set();
    let pageToken=null,pagesInBatch=0;
    while(true){
      const params=new URLSearchParams({
        symbols:batch.join(','),timeframe:config.timeframe,start:config.start,end:config.end,
        limit:String(config.limit),adjustment:config.adjustment,feed:config.feed,sort:'asc'
      });
      if(pageToken)params.set('page_token',pageToken);
      const url=config.workerBase+'/api/stocks/bars?'+params.toString();
      const {payload}=await requestJson(url,config,state,'Alpaca history batch '+(batchIndex+1));
      if(!payload?.bars||typeof payload.bars!=='object'||Array.isArray(payload.bars))
        throw new Error('Alpaca history batch '+(batchIndex+1)+' returned an invalid bars object.');
      for(const [name,rows] of Object.entries(payload.bars)){
        const symbol=name.toUpperCase(),target=bySymbol.get(symbol);
        if(!target||!Array.isArray(rows))continue;
        for(const bar of rows){
          if(!bar||typeof bar.t!=='string'||!bar.t)continue;
          if(!target.has(bar.t))totalBars++;
          target.set(bar.t,bar);
        }
      }
      pagesInBatch++;totalPages++;
      config.onProgress?.({type:'page',batchIndex:batchIndex+1,batchCount:batches.length,
        page:pagesInBatch,totalPages,requestedSymbols:symbols.length,totalBars});
      const next=payload.next_page_token||null;
      if(!next)break;
      if(typeof next!=='string'||next.length>2000)throw new Error('Alpaca returned an invalid page token.');
      if(seenTokens.has(next))throw new Error('Alpaca repeated a page token; refusing an infinite pagination loop.');
      if(pagesInBatch>=config.maxPagesPerBatch)throw new Error('Alpaca history batch exceeded the page safety limit.');
      seenTokens.add(next);pageToken=next;
    }
    config.onProgress?.({type:'batch',batchIndex:batchIndex+1,batchCount:batches.length,
      completedSymbols:Math.min((batchIndex+1)*config.batchSize,symbols.length),
      requestedSymbols:symbols.length,totalPages,totalBars});
  }
  const bars=Object.create(null);
  for(const symbol of symbols)bars[symbol]=[...bySymbol.get(symbol).values()].sort((a,b)=>a.t.localeCompare(b.t));
  const missing=symbols.filter(symbol=>bars[symbol].length===0);
  return {source:'alpaca',feed:config.feed,timeframe:config.timeframe,start:config.start,end:config.end,
    symbols,requested:symbols.length,returned:symbols.length-missing.length,missing,
    batches:batches.length,pages:totalPages,retries:state.retries,totalBars,bars,
    directory:directory||null,completedAt:new Date().toISOString()};
}

/**
 * Download all requested symbols through the Worker's multi-symbol bars proxy.
 * The 10,000-point page limit is total across the batch, so every page token
 * is followed before moving to the next batch. Requests are serialized and
 * spaced to stay below the Worker's 30/minute IP limit.
 */
export async function downloadHistoricalBars(options={}){
  const config=normalizeConfig(options,true),state={nextRequestAt:0,rateLimitUntil:0,retries:0};
  return downloadSymbols(config,config.symbols,state,null);
}

/**
 * Resolve the current Alpaca U.S. equity directory, then download every symbol.
 * The directory endpoint is read once; no curated/bundled universe is used.
 */
export async function downloadUniverseHistory(options={}){
  const config=normalizeConfig(options,false),state={nextRequestAt:0,rateLimitUntil:0,retries:0};
  const directoryUrl=config.workerBase+'/api/stocks/universe'+(options.refreshUniverse?'?refresh=1':'');
  const {payload}=await requestJson(directoryUrl,config,state,'Alpaca U.S. equity directory');
  if(!Array.isArray(payload?.symbols))throw new Error('The Worker returned an invalid U.S. equity directory.');
  const symbols=normalizeSymbols(payload.symbols);
  const directory={id:payload.id||null,count:Number(payload.count)||symbols.length,
    source:payload.source||'alpaca-v2-assets',refreshedAt:payload.refreshedAt||null};
  return downloadSymbols(config,symbols,state,directory);
}
