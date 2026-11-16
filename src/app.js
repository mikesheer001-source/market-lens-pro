import './styles.css';
import {compilePine, executePine, sweepPine, PineError} from './pine.js';
import {PINE_EXAMPLES} from './pine-examples.js';
import {readableBarDate,normalizeStartupPreferences,intradayCacheFresh,intradayFetchDecision} from './intraday-session.js';
import {availableStrategySignals,evaluateStrategySignals,scanSignalFlips} from './signals.js';
import {expectedNyseBarDate,scanFreshness,staleReasonForSymbol} from './freshness.js';
import {FIT_COLUMNS,sortUniverseFit,bestUniverseFit,fitAcrossUniverse} from './fit.js';
import {compileDailyBriefing,briefingToText,pruneBriefingHistory,saveBriefingHistory} from './briefing.js';
import {renderBriefingView} from './briefing-view.js';
import {compareStrategies,sortLeaderboard,leaderboardBest,updateSymbolMemory,pruneSymbolMemory,symbolMemoryItem,compactLeaderboard,LEADERBOARD_METRICS} from './leaderboard.js';
import {runPortfolio,runPortfolioSweep,portfolioUniverse} from './portfolio.js';
import {windowBacktestBars,windowPortfolioData,validateBacktestRange,actualPortfolioRange,displayBacktestRange} from './date-window.js';
import {runBestFitPortfolio} from './best-fit-portfolio.js';
import {VOL_TICKERS,volatilityRow,contangoPriceProxies} from './volatility.js';
import {restoreWatchlists,watchlistChange,validateAlert,checkAlerts,makeScanSnapshot,analysisSnapshot,restoreAnalysis,WATCHLIST_LIMIT,SCAN_LIMIT,ALERT_LIMIT} from './workspace.js';
import { LIVE_UNIVERSE, DEMO_UNIVERSE, VOLATILITY_UNIVERSE, LIVE_EQUITY_COUNT, LIVE_ETF_COUNT, LIVE_VOLATILITY_COUNT, ALPACA_BATCH_SIZE } from './universe.js';
async function initApp(){
  const {
    parseCsv,normalizeBars,alpacaBars,aggregate,ema,sma,rsi,indicators,statsFor,screenSymbol,backtest,parameterSweep,sampleData,csvDownload,stamp
  }=await import('./engine.js');
  const {
    createChart,CandlestickSeries,BarSeries,LineSeries,AreaSeries,HistogramSeries,PriceScaleMode,createSeriesMarkers
  }=await import('lightweight-charts');
  const $=(q)=>document.querySelector(q),esc=(s)=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const format=(n,d=2)=>n==null||!Number.isFinite(n)?'—':Number(n).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d});
  const pct=n=>n==null||!Number.isFinite(n)?'—':(n>0?'+':'')+format(n)+'%';
  const priceColor=n=>n==null?'muted':n>=0?'positive':'negative';
  const dateLabel=t=>typeof t==='number'?new Date(t*1000).toISOString().slice(0,16).replace('T',' '):String(t);
  const tabNames={screener:'Screener',briefing:'Briefing',charts:'Chart Lab',backtest:'Backtest',optimize:'Optimize',volatility:'Volatility',scripts:'Script Lab',data:'Data Center'};
  const tabIcons={screener:'📊',briefing:'▤',charts:'📈',backtest:'🧪',optimize:'⚙️',volatility:'〽',scripts:'🧩',data:'🗂️'};
  const preset={
    trend:[{metric:'emaDist',tf:'D',op:'>',value:0},{metric:'rsi',tf:'D',op:'<',value:60}],
    original:[{metric:'emaDist',tf:'W',op:'>',value:0},{metric:'rsi',tf:'W',op:'<',value:50},{metric:'rsi',tf:'D',op:'<',value:50},{metric:'rsi',tf:'2H',op:'<',value:50}],
    oversold:[{metric:'rsi',tf:'D',op:'<',value:35}],
    momentum:[{metric:'ret20',tf:'D',op:'>',value:10},{metric:'emaDist',tf:'D',op:'>',value:0}],
    volatility:[{metric:'rsi',tf:'D',op:'<',value:60},{metric:'drawdown',tf:'D',op:'<',value:-5},{metric:'emaDist',tf:'D',op:'<',value:0}],
    all:[]
  };
  const defaultSettings={tf:'D',style:'candles',log:false,ema20:true,ema50:false,ema200:true,sma20:false,bollinger:false,volume:true,rsi:true,macd:false,rsiPeriod:14,bollPeriod:20,ema20Len:20,ema50Len:50,ema200Len:200,sma20Len:20,lines:{}};
  const defaultBacktest={strategy:'ema-cross',side:'long',borrowAnnualPct:0,fast:20,slow:100,rsiPeriod:14,buyLevel:30,sellLevel:65,period:20,multiplier:2,capital:10000,allocation:100,feeBps:1,slipBps:2,stopPct:0,targetPct:0};
  let saved={};try{saved=JSON.parse(localStorage.getItem('market-lens-pro-settings')||'{}')||{};}catch{}
  const startupPrefs=normalizeStartupPreferences(saved);
  const scriptLibraryKey='market-lens-pro-pine-library-v1',scriptDraftKey='market-lens-pro-pine-draft-v1';
  let scriptLibrary=[];
  try{const parsed=JSON.parse(localStorage.getItem(scriptLibraryKey)||'[]');if(Array.isArray(parsed))scriptLibrary=parsed.filter(x=>x&&typeof x.code==='string'&&typeof x.name==='string').slice(0,30);}catch{}
  let draft={};try{draft=JSON.parse(localStorage.getItem(scriptDraftKey)||'{}')||{};}catch{}
  let previousSymbolMemory={};
  try{previousSymbolMemory=pruneSymbolMemory(JSON.parse(localStorage.getItem('market-lens-pro-symbol-memory-v1')||'{}'));}catch{}
  let priorSignalHistory={};
  try{priorSignalHistory=JSON.parse(localStorage.getItem('market-lens-pro-signal-history-v1')||'{}')||{};}catch{}
  const workspaceLists=restoreWatchlists(saved);
  let previousAnalysis=null;
  try{previousAnalysis=restoreAnalysis(JSON.parse(localStorage.getItem('market-lens-pro-analysis-v1')||'null'));}catch{}
  let previousPortfolio=null;
  try{previousPortfolio=JSON.parse(localStorage.getItem('market-lens-pro-portfolio-v1')||'null');}catch{}
  const briefingStorageKey='market-lens-pro-briefing-history-v1';
  let savedBriefings=[];
  try{savedBriefings=pruneBriefingHistory(JSON.parse(localStorage.getItem(briefingStorageKey)||'[]'));}
  catch{savedBriefings=[];}
  const S={tab:startupPrefs.tab,mode:'demo',preferredMode:startupPrefs.mode,
    lastDemoSymbol:startupPrefs.lastDemoSymbol,lastLiveSymbol:startupPrefs.lastLiveSymbol,
    lastBacktestSymbol:startupPrefs.lastBacktestSymbol,lastSymbol:startupPrefs.lastSymbol,
    apiBaseUrl:String(saved.apiBaseUrl||'https://market-lens-pro-api.mikesheer001.workers.dev'),liveFeed:'iex',universeFilter:saved.universeFilter||'all',scan:{status:'idle'},data:new Map(Object.entries(sampleData())),sources:new Map(),symbol:'DEMO-SPY',query:'',symbolQuery:'',watch:workspaceLists.watch,watchlists:workspaceLists.watchlists,
    watchlistId:workspaceLists.watchlistId,watchlistDraft:'',alertDraft:{symbol:'DEMO-SPY',metric:'price',op:'>',threshold:100},
    alerts:Array.isArray(saved.alerts)?saved.alerts.slice(0,ALERT_LIMIT):[],alertHits:[],
    savedScans:Array.isArray(saved.savedScans)?saved.savedScans.slice(0,SCAN_LIMIT):[],
    scanDraft:'',savedScanId:null,savedScanView:null,
    signalSelection:typeof saved.signalSelection==='string'?saved.signalSelection:'none',
    signalsOnly:!!saved.signalsOnly,signalRows:new Map(),signalErrors:[],
    signalHistory:priorSignalHistory,signalAsOf:null,freshness:null,staleDiagnostics:{},
    lastSignalFlips:[],lastSignalFlipBaseline:false,lastSignalFlipStrategy:null,
    rules:saved.rules||preset.trend.map(x=>({...x})),sort:'symbol',ascending:true,showOnlyMatches:false,showWatch:false,chart:(()=>{const restored={...defaultSettings,...saved.chart};if(!saved.chart?.style||saved.chart.style==='line')restored.style='candles';return restored;})(),bt:{...defaultBacktest,...saved.bt},result:previousAnalysis?.result||null,sweep:previousAnalysis?.sweep||null,lastAnalysis:previousAnalysis,resultSymbol:previousAnalysis?.symbol||null,resultTf:previousAnalysis?.tf||null,
    portfolioMode:!!saved.portfolioMode,bestFitMode:!!saved.bestFitMode,
    btRange:{startDate:String(saved.btRange?.startDate||''),endDate:String(saved.btRange?.endDate||'')},
    backtestError:'',portfolioScope:saved.portfolioScope==='watchlist'?'watchlist':'matches',
    portfolioWatchlistId:saved.portfolioWatchlistId||workspaceLists.watchlistId,
    portfolioResult:previousPortfolio?.result||null,portfolioSweep:previousPortfolio?.sweep||null,
    portfolioTimestamp:previousPortfolio?.savedAt||null,portfolioError:'',portfolioLoading:false,
    intraday:new Map(),intradayStatus:new Map(),intradayPromises:new Map(),intradayError:'',
    analysisLoading:'',analysisError:'',
    symbolMemory:previousSymbolMemory,leaderboard:null,leaderboardSort:'sharpe',leaderboardDescending:true,leaderboardError:'',fitReport:null,fitSort:'sharpe',fitDescending:true,fitStatus:'',fitError:'',
    briefing:null,briefingHistory:savedBriefings,briefingLoading:false,briefingError:'',drawLine:false,
    scriptCode:typeof draft.code==='string'?draft.code:PINE_EXAMPLES[0].code,
    scriptName:typeof draft.name==='string'?draft.name:'EMA crossover',
    scriptId:draft.id||null,
    scriptSettings:draft.settings&&typeof draft.settings==='object'?draft.settings:{},
    scriptParsed:null,scriptError:'',scriptOutput:null,scriptLibrary,activeIndicators:[],activeStrategy:null};
  for(const symbol of S.data.keys())S.sources.set(symbol,'SIMULATED');
  if(!symbolMemoryItem(S.symbolMemory,S.symbol)?.backtest&&previousAnalysis?.symbol===S.symbol&&previousAnalysis?.result){
    S.symbolMemory=updateSymbolMemory(S.symbolMemory,S.symbol,{backtest:{
      result:previousAnalysis.result,sweep:previousAnalysis.sweep,options:{...S.bt},
      timeframe:previousAnalysis.tf||S.chart.tf,source:previousAnalysis.source,
      savedAt:previousAnalysis.savedAt
    }});
  }
  // Restore the default symbol's own run. Never mislabel a different symbol's global last analysis.
  restoreSymbolState(S.symbol);
  parseCurrentPine();
  let chart=null,equityChart=null,leaderboardChart=null;
  const saveSettings=()=>{try{localStorage.setItem('market-lens-pro-settings',JSON.stringify({mode:S.preferredMode==='live'?'live':S.mode,
    tab:S.tab,lastSymbol:S.symbol,lastBacktestSymbol:S.lastBacktestSymbol,
    lastLiveSymbol:S.lastLiveSymbol,lastDemoSymbol:S.lastDemoSymbol,watch:[...S.watch],watchlists:S.watchlists,watchlistId:S.watchlistId,alerts:S.alerts,savedScans:S.savedScans,rules:S.rules,chart:S.chart,bt:S.bt,portfolioMode:S.portfolioMode,bestFitMode:S.bestFitMode,btRange:S.btRange,portfolioScope:S.portfolioScope,portfolioWatchlistId:S.portfolioWatchlistId,signalSelection:S.signalSelection,signalsOnly:S.signalsOnly,apiBaseUrl:S.apiBaseUrl,universeFilter:S.universeFilter}));}catch{}};
  function rememberPortfolio(){
    S.portfolioTimestamp=new Date().toISOString();
    try{localStorage.setItem('market-lens-pro-portfolio-v1',JSON.stringify({
      version:1,result:S.portfolioResult,sweep:S.portfolioSweep,savedAt:S.portfolioTimestamp
    }));}catch{notice('Portfolio calculated, but browser storage could not retain the full result.');}
  }
  function persistSymbolState(symbol,changes){
    S.symbolMemory=updateSymbolMemory(S.symbolMemory,symbol,changes);
    try{localStorage.setItem('market-lens-pro-symbol-memory-v1',JSON.stringify(S.symbolMemory));}
    catch(err){notice('Per-symbol history is visible but could not be saved in browser storage. Older comparisons may need deleting.');}
  }
  function rememberLeaderboard(){
    if(S.leaderboard?.symbol===S.symbol)persistSymbolState(S.symbol,{leaderboard:compactLeaderboard(S.leaderboard)});
  }
  function restoreSymbolState(symbol){
    S.symbol=symbol;S.symbolQuery='';
    if(S.mode==='live'&&LIVE_UNIVERSE.includes(symbol))S.lastLiveSymbol=symbol;
    else if(S.mode==='demo'&&symbol.startsWith('DEMO-'))S.lastDemoSymbol=symbol;
    const savedEntry=symbolMemoryItem(S.symbolMemory,symbol);
    const run=savedEntry?.backtest||null;
    S.leaderboard=savedEntry?.leaderboard||null;
    S.leaderboardSort='sharpe';S.leaderboardDescending=true;S.leaderboardError='';
    S.result=run?.result||null;S.sweep=run?.sweep||null;
    S.resultSymbol=run?symbol:null;
    S.resultTf=run?.timeframe||null;
    if(run){
      S.bt={...S.bt,...run.options};S.chart.tf=run.timeframe||'D';
      S.lastAnalysis=analysisSnapshot({result:run.result,sweep:run.sweep,symbol,
        tf:run.timeframe,strategy:run.options?.strategy,source:run.source,savedAt:run.savedAt});
      S.activeStrategy=run.activeStrategy||null;
    }else S.lastAnalysis=null;
    return savedEntry;
  }
  function rememberAnalysis(){
    S.lastAnalysis=analysisSnapshot({result:S.result,sweep:S.sweep,symbol:S.symbol,tf:S.chart.tf,strategy:S.bt.strategy,source:S.sources.get(S.symbol)});
    try{localStorage.setItem('market-lens-pro-analysis-v1',JSON.stringify(S.lastAnalysis));}
    catch{notice('Backtest shown, but this browser cannot save the full result to localStorage.');}
    if(S.result&&S.resultSymbol===S.symbol)persistSymbolState(S.symbol,{backtest:{
      result:S.result,sweep:S.sweep,options:{...S.bt},timeframe:S.resultTf||S.chart.tf,
      source:S.sources.get(S.symbol),activeStrategy:S.bt.strategy==='pine-custom'?S.activeStrategy:null,savedAt:S.lastAnalysis.savedAt
    }});
  }
  function screenerStrategies(){
    return availableStrategySignals(S.scriptLibrary).filter(selection=>{
      if(selection.kind!=='pine')return true;
      try{return compilePine(selection.code).mode==='strategy';}catch{return false;}
    });
  }

  function captureBriefing(){
    if(S.mode!=='live'||S.scan.status!=='complete'||S.scan.source!=='ALPACA')return null;
    const selection=screenerStrategies().find(x=>x.id===S.signalSelection)||null;
    const symbols=LIVE_UNIVERSE.filter(sym=>S.universeFilter!=='volatility'||VOLATILITY_UNIVERSE.includes(sym));
    const briefing=compileDailyBriefing({
      generatedAt:new Date().toISOString(),scan:S.scan,data:S.data,sources:S.sources,
      rules:S.rules,symbols,feed:S.liveFeed,signalSelection:selection?.id||'none',
      strategyName:selection?.name||null,signals:S.signalRows,
      flips:S.lastSignalFlipStrategy===selection?.id?S.lastSignalFlips:[],
      hasFlipBaseline:!!selection&&S.lastSignalFlipStrategy===selection.id&&S.lastSignalFlipBaseline,
      alerts:S.alerts,freshness:S.freshness,diagnostics:S.staleDiagnostics
    });
    S.briefing=briefing;S.briefingHistory=saveBriefingHistory(S.briefingHistory,briefing);
    try{localStorage.setItem(briefingStorageKey,JSON.stringify(S.briefingHistory));}
    catch{notice('Briefing generated but browser storage could not save seven-day history.');}
    return briefing;
  }
  async function generateBriefing(){
    if(S.briefingLoading)return;
    S.briefingLoading=true;S.briefingError='';S.tab='briefing';render();
    try{await fetchLiveUniverse({restoreTab:'briefing',restoreSymbol:S.lastLiveSymbol});}
    catch(error){S.briefingError=String(error.message||error);
      S.scan={status:'fallback',source:'ALPACA',error:S.briefingError};}
    finally{S.briefingLoading=false;S.tab='briefing';render();}
  }
  function briefingView(){
    return renderBriefingView({
      snapshot:S.briefing,history:S.briefingHistory,loading:S.briefingLoading,error:S.briefingError,
      strategies:screenerStrategies(),selection:S.signalSelection,
      head,button,select,metric,esc,format,pct
    });
  }
  function persistSignalHistory(){
    try{
      const keys=Object.keys(S.signalHistory);
      if(keys.length>20)for(const oldKey of keys.slice(0,keys.length-20))delete S.signalHistory[oldKey];
      localStorage.setItem('market-lens-pro-signal-history-v1',JSON.stringify(S.signalHistory));
    }catch{notice('Signal history could not be saved locally. Flip detection may reset after reload.');}
  }
  function evaluateScreenerSignals(detectFlips=false){
    if(S.signalSelection==='none'){S.signalRows=new Map();S.signalErrors=[];
      S.lastSignalFlips=[];S.lastSignalFlipBaseline=false;S.lastSignalFlipStrategy=null;return;}
    const selection=screenerStrategies().find(x=>x.id===S.signalSelection);
    if(!selection){
      S.signalSelection='none';S.signalRows=new Map();S.signalErrors=[];
      S.lastSignalFlips=[];S.lastSignalFlipBaseline=false;S.lastSignalFlipStrategy=null;
      saveSettings();return;
    }
    const available=new Map([...S.data].filter(([symbol])=>modeSymbol(symbol)));
    const answer=evaluateStrategySignals({data:available,selection,
      options:{...S.bt,side:'long',timeframe:'D'},backtest,compilePine,executePine,
      sourceFor:symbol=>S.sources.get(symbol)==='ALPACA'?'ALPACA '+String(S.liveFeed).toUpperCase()+' 1Day':
        S.sources.get(symbol)==='SIMULATED'?'SIMULATED DAILY':'IMPORTED CSV'});
    S.signalRows=new Map(Object.entries(answer.signals));S.signalErrors=answer.errors;
    S.signalAsOf=new Date().toISOString();
    const current={};
    for(const [symbol,signal] of S.signalRows)if(['LONG','FLAT','EXIT'].includes(signal.status))current[symbol]=signal;
    let codeHash=2166136261;
    if(selection.kind==='pine')for(let i=0;i<selection.code.length;i++)
      codeHash=Math.imul(codeHash^selection.code.charCodeAt(i),16777619)>>>0;
    const key=S.mode+'|'+S.signalSelection+(selection.kind==='pine'?'|'+codeHash.toString(16):'');
    const prior=S.signalHistory[key]||{};
    const checked=scanSignalFlips(prior,current,{strategyId:selection.id,strategyName:selection.name,
      checkedAt:S.signalAsOf});
    S.lastSignalFlips=detectFlips&&Object.keys(prior).length?checked.flips:[];
    S.lastSignalFlipBaseline=!!(detectFlips&&Object.keys(prior).length);
    S.lastSignalFlipStrategy=S.signalSelection;
    S.signalHistory[key]=checked.states;persistSignalHistory();
    if(detectFlips&&Object.keys(prior).length){
      for(const flip of checked.flips){
        const event={type:'signal',metric:'signal',id:'signal-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),
          symbol:flip.symbol,strategyId:selection.id,strategyName:selection.name,
          oldValue:flip.from,newValue:flip.to,observedFrom:flip.observedFrom,observedTo:flip.observedTo,
          lastHitAt:flip.checkedAt,lastHitBarDate:flip.barDate,source:flip.source,
          active:false,unread:true};
        S.alerts.push(event);
      }
      // Keep the active alert queue bounded to prevent browser storage growth.
      if(S.alerts.length>ALERT_LIMIT){
        const old=S.alerts.filter(x=>x.type==='signal').slice(0,S.alerts.length-ALERT_LIMIT);
        const removed=new Set(old.map(x=>x.id));S.alerts=S.alerts.filter(x=>!removed.has(x.id)).slice(-ALERT_LIMIT);
      }
      if(checked.flips.length)notice(checked.flips.length+' strategy position change'+(checked.flips.length===1?'':'s')+' detected.');
    }
    saveSettings();
  }
  function evaluateLocalAlerts(){
    const result=checkAlerts(S.alerts,S.data,statsFor,aggregate);
    S.alerts=result.alerts;S.alertHits=result.hits;
    saveSettings();
    if(result.hits.length)notice(result.hits.length+' local price/RSI alert'+(result.hits.length===1?'':'s')+' triggered.');
  }
  function clearSavedScanView(){S.savedScanView=null;S.savedScanId=null;}
  function selectWatchlist(id){
    const list=S.watchlists.find(w=>w.id===id);if(!list)return;
    S.watchlistId=list.id;S.watch=new Set(list.symbols);saveSettings();
  }
  function modeSymbol(symbol){return S.mode==='live'?S.sources.get(symbol)==='ALPACA':S.sources.get(symbol)!=='ALPACA';}
  function persistPineDraft(){
    try{localStorage.setItem(scriptDraftKey,JSON.stringify({code:S.scriptCode,name:S.scriptName,id:S.scriptId,settings:S.scriptSettings}));}
    catch{notice('Unable to save Script Lab draft in localStorage.');}
  }
  function persistPineLibrary(){
    try{localStorage.setItem(scriptLibraryKey,JSON.stringify(S.scriptLibrary));}
    catch{notice('Unable to save scripts. Browser storage may be full.');}
  }
  function parseCurrentPine(){
    try{S.scriptParsed=compilePine(S.scriptCode);S.scriptError='';return S.scriptParsed;}
    catch(err){S.scriptParsed=null;S.scriptError=err.message;return null;}
  }
  function notice(message){document.querySelectorAll('.toast').forEach(x=>x.remove());const el=document.createElement('div');el.className='toast';el.textContent=message;document.body.append(el);setTimeout(()=>el.remove(),4500);}
  function openDb(){return new Promise((resolve,reject)=>{
    const req=indexedDB.open('market-lens-pro-datasets',2);
    req.onupgradeneeded=()=>{
      if(!req.result.objectStoreNames.contains('symbols'))req.result.createObjectStore('symbols',{keyPath:'symbol'});
      if(!req.result.objectStoreNames.contains('intraday'))req.result.createObjectStore('intraday',{keyPath:'key'});
    };
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });}
  async function readCachedIntraday(key){
    try{
      const db=await openDb(),tx=db.transaction('intraday','readonly');
      const req=tx.objectStore('intraday').get(key);
      const row=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});
      db.close();return row;
    }catch{return null;}
  }
  async function persistIntraday(key,record){
    try{
      const db=await openDb(),tx=db.transaction('intraday','readwrite');
      tx.objectStore('intraday').put({...record,key});
      await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
      db.close();
    }catch{notice('Intraday candles loaded, but IndexedDB could not store them for the next reload.');}
  }
  async function loadStored(){
    try{
      const db=await openDb(),tx=db.transaction('symbols','readonly'),req=tx.objectStore('symbols').getAll();
      const rows=await new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);});
      for(const item of rows){S.data.set(item.symbol,item.bars);S.sources.set(item.symbol,'IMPORTED');}
      db.close();
      if(S.preferredMode!=='live'){
        const preferred=startupPrefs.selectedSymbol;
        if(preferred&&S.data.has(preferred))restoreSymbolState(preferred);
        else if(rows.length&&!S.data.has(S.symbol))restoreSymbolState(rows[0].symbol);
      }
      if(rows.length)render();
    }catch{notice('Local database unavailable. Imports still work until this tab closes.');}
  }
  async function storeDataset(symbol,bars){try{const db=await openDb(),tx=db.transaction('symbols','readwrite');tx.objectStore('symbols').put({symbol,bars});await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});db.close();}catch{notice('Import loaded, but this browser could not save it for future visits.');}}
  async function removeImports(){try{const db=await openDb(),tx=db.transaction('symbols','readwrite');tx.objectStore('symbols').clear();await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});db.close();}catch{}S.data=new Map(Object.entries(sampleData()));S.sources=new Map([...S.data.keys()].map(x=>[x,'SIMULATED']));S.symbol='DEMO-SPY';S.result=null;S.sweep=null;render();}
  const intradayTf=tf=>tf==='15m'||tf==='2H';
  const intradayKey=symbol=>symbol+'|'+String(S.liveFeed||'iex');
  const barsFor=(symbol,tf)=>{
    const daily=S.data.get(symbol)||[];
    if(!intradayTf(tf))return aggregate(daily,tf);
    const source=S.sources.get(symbol);
    const raw=source==='ALPACA'?S.intraday.get(intradayKey(symbol))?.bars||[]:
      daily.filter(b=>typeof b.time==='number');
    // No daily-to-intraday interpolation: empty is an explicit unavailable state.
    return aggregate(raw,tf);
  };
  const bars=()=>barsFor(S.symbol,S.chart.tf);
  async function loadLiveIntraday(symbol,force=false){
    if(S.mode!=='live'||S.sources.get(symbol)!=='ALPACA')return null;
    const key=intradayKey(symbol),feed=S.liveFeed;
    if(S.intradayPromises.has(key))return S.intradayPromises.get(key);
    const work=(async()=>{
      const current=S.intraday.get(key);
      if(!force&&intradayCacheFresh({...current,symbol,feed},{
        symbol,feed,expected:expectedNyseBarDate(),now:Date.now()}))return current;
      S.intradayStatus.set(key,{status:'loading'});
      if(S.symbol===symbol&&['charts','backtest','optimize'].includes(S.tab))render();
      try{
        if(!force){
          const cached=await readCachedIntraday(key);
          if(intradayCacheFresh(cached,{symbol,feed,expected:expectedNyseBarDate(),now:Date.now()})){
            S.intraday.set(key,cached);
            S.intradayStatus.set(key,{status:'ready',bars:cached.bars.length,cached:true});
            return cached;
          }
        }
        const base=S.apiBaseUrl.replace(/\/$/,'');
        if(!base.startsWith('https://'))throw Error('Configure an HTTPS Worker URL in Data Center.');
        const response=await fetch(base+'/api/stocks/intraday?symbol='+encodeURIComponent(symbol)+
          '&feed='+encodeURIComponent(feed),{headers:{Accept:'application/json'}});
        const payload=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(payload.detail||payload.error||'Alpaca intraday request failed.');
        const received=alpacaBars(payload.bars||[],'15Min');
        if(!received.length)throw Error('Alpaca '+String(payload.feed||feed).toUpperCase()+
          ' returned no real 15-minute candles for '+symbol+'.');
        const record={symbol,bars:received,source:'ALPACA',feed:payload.feed||feed,
          fetchedAt:Date.now(),start:payload.start,end:payload.end};
        S.intraday.set(key,record);
        S.intradayStatus.set(key,{status:'ready',bars:received.length,cached:false});
        await persistIntraday(key,record);
        return record;
      }catch(err){
        S.intradayStatus.set(key,{status:'error',error:err.message});
        notice('Real Alpaca 15-minute bars unavailable: '+err.message);
        throw err;
      }finally{
        if(S.symbol===symbol&&['charts','backtest','optimize'].includes(S.tab))render();
      }
    })();
    S.intradayPromises.set(key,work);
    try{return await work;}finally{S.intradayPromises.delete(key);}
  }
  async function ensureAnalysisBars(actionLabel='Backtest'){
    if(!intradayTf(S.chart.tf))return true;
    const key=intradayKey(S.symbol);
    const decision=intradayFetchDecision({timeframe:S.chart.tf,mode:S.mode,source:S.sources.get(S.symbol),
      symbol:S.symbol,entry:S.intraday.get(key),feed:S.liveFeed});
    if(decision==='unavailable'){
      S.analysisError=actionLabel+' requires genuine timestamped intraday OHLCV. Select Live Alpaca or import real intraday CSV.';
      notice(S.analysisError);render();return false;
    }
    if(decision==='fetch'){
      S.analysisLoading='Fetching Alpaca 15-minute bars…';
      S.analysisError='';render();
      try{await loadLiveIntraday(S.symbol);}
      catch(err){S.analysisError=actionLabel+' could not obtain real intraday bars: '+err.message;
        S.analysisLoading='';render();return false;}
      S.analysisLoading='';
    }
    if(bars().length<40){
      S.analysisError=actionLabel+' needs at least 40 real '+S.chart.tf+
        ' bars; '+bars().length+' available. Try a longer timeframe or refresh the Alpaca feed.';
      notice(S.analysisError);render();return false;
    }
    S.analysisError='';render();
    return true;
  }

  const status=()=>S.mode==='live'?'ALPACA LIVE · '+String(S.liveFeed||'iex').toUpperCase():S.sources.get(S.symbol)==='SIMULATED'?'SIMULATED SAMPLE':S.sources.get(S.symbol)==='IMPORTED'?'IMPORTED OHLCV':'NO DATA';
  const isVisibleSymbol=symbol=>modeSymbol(symbol)&&(S.universeFilter!=='volatility'||VOLATILITY_UNIVERSE.includes(symbol));
  function destroyCharts(){if(chart){chart.remove();chart=null;}if(equityChart){equityChart.remove();equityChart=null;}if(leaderboardChart){leaderboardChart.remove();leaderboardChart=null;}}
  function shell(){
    const nav=(mobile=false)=>'<nav aria-label="'+(mobile?'Mobile':'Primary')+' navigation" class="'+(mobile?'mobile-nav':'nav')+'">'+Object.entries(tabNames).map(([k,n])=>'<button class="nav-btn '+(S.tab===k?'active':'')+'" data-tab="'+k+'"><span class="nav-icon" aria-hidden="true">'+tabIcons[k]+'</span>'+n+'</button>').join('')+'</nav>';
    $('#app').innerHTML='<a href="#main" class="skip-link">Skip to workspace</a><div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-mark" aria-hidden="true">ML</div><div><strong>MARKET LENS</strong><small>PRO WORKSTATION</small></div></div><div><div class="nav-label">Workspace</div>'+nav()+'</div><div class="sidebar-bottom">DATA NOTICE<br/>Your imported prices stay on this device. Simulated sample data is never live market data.<p>No account. No trades sent.</p></div></aside><div class="workspace"><header class="topbar"><div class="top-left"><strong>Market Lens Pro</strong><span class="workspace-label">/ Independent strategy laboratory</span></div><div class="top-actions"><span class="status"><span class="dot"></span>'+ (S.mode==='live'?'Alpaca data':'Local workspace') +'</span><span class="source-badge">'+status()+'</span><div class="mode-switch flex"><button class="btn small '+(S.mode==='demo'?'selected':'')+'" aria-pressed="'+(S.mode==='demo')+'" data-action="mode-demo">Use Demo</button><button class="btn small '+(S.mode==='live'?'selected':'')+'" aria-pressed="'+(S.mode==='live')+'" data-action="mode-live">Use Live</button></div><button class="btn" data-action="import">Import CSV</button></div></header>'+nav(true)+'<main id="main" class="main" tabindex="-1"></main></div></div><input id="csv-file" type="file" accept=".csv,text/csv" multiple hidden/>';
  }
  const head=(name,desc,tools='')=>'<div class="headrow"><div><div class="eyebrow">Market Lens / '+name+'</div><h1>'+name+'</h1><p class="subtle">'+desc+'</p></div><div class="flex">'+tools+'</div></div>';
  const button=(label,action,variant='')=>'<button type="button" class="btn '+variant+'" data-action="'+action+'">'+label+'</button>';
  const select=(items,value,attr)=>'<select '+attr+'>'+items.map(([v,t])=>'<option value="'+esc(v)+'"'+(v===value?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select>';
  const timeframes=[['D','1 Day · daily OHLCV'],['W','1 Week · daily aggregation'],['M','1 Month · daily aggregation'],['2H','2 Hours · requires 15m OHLCV'],['15m','15 Minutes · requires 15m OHLCV']];
  const symbolSelect=()=>{
    const options=[...S.data.keys()].filter(modeSymbol).sort(),selected=options.includes(S.symbol)?S.symbol:options[0]||'';
    return '<div class="symbol-picker"><label class="control">Find symbol <input type="search" class="symbol-search" data-input="symbol-search" aria-label="Find symbol" placeholder="Search all '+options.length+' loaded tickers" value="'+esc(S.symbolQuery)+'"/></label>'+
      '<label class="control">Symbol '+select(options.map(symbol=>[symbol,symbol]),selected,'data-option="symbol"')+'</label></div>';
  };
  const tfSelect=()=>'<label class="control">Timeframe '+select(timeframes,S.chart.tf,'data-option="tf"')+'</label>';
  const field=(name,key,type='number',min='',max='',step='any')=>'<label class="field">'+name+'<input type="'+type+'" data-bt="'+key+'" value="'+esc(S.bt[key])+'" '+(min!==''?'min="'+min+'"':'')+' '+(max!==''?'max="'+max+'"':'')+' step="'+step+'"/></label>';
  function metric(label,value,foot='',type=''){return '<div class="metric"><label>'+label+'</label><strong class="'+type+'">'+value+'</strong><small>'+foot+'</small></div>';}
  const sourceStrip=()=>intradayTf(S.chart.tf)?(
    S.sources.get(S.symbol)==='ALPACA'?
      '<div class="info-strip '+(S.intradayStatus.get(intradayKey(S.symbol))?.status==='error'?'warning':'')+'">Real '+esc(S.chart.tf)+' candles · '+esc(String(S.liveFeed).toUpperCase())+' Alpaca 15-minute trade-bar OHLCV'+
      (S.chart.tf==='2H'?' aggregated by NYSE 09:30–16:00 ET session buckets, including a partial final 30-minute bucket.':' (no aggregation beyond 15 minutes).')+
      ' · '+(S.intradayStatus.get(intradayKey(S.symbol))?.status==='error'?esc(S.intradayStatus.get(intradayKey(S.symbol)).error):
      S.intradayStatus.get(intradayKey(S.symbol))?.status==='loading'?'Fetching real intraday bars…':
      (S.intraday.get(intradayKey(S.symbol))?.bars.length??0)+' confirmed 15-minute bars')+'</div>':
      '<div class="info-strip warning">Only genuine timestamped CSV bars are eligible for intraday charts. Daily Demo candles are never expanded into fake 15m or 2H candles.</div>'
  ):S.sources.get(S.symbol)==='ALPACA'?'<div class="info-strip">Alpaca market data · '+esc(String(S.liveFeed||'IEX').toUpperCase())+' feed · REST refresh on demand. This is not a tick-by-tick WebSocket stream.</div>':S.sources.get(S.symbol)==='SIMULATED'?'<div class="info-strip warning"><strong>Simulated prices.</strong> These are generated examples for testing the interface; no price, return, or trading result represents a real ticker.</div>':(S.data.get(S.symbol)||[]).some(b=>b.approximateOhlc)?'<div class="info-strip warning">The imported CSV has Close-only bars. Open/high/low are approximated. Stop, target, and next-open fills are unreliable until full OHLCV data is imported.</div>':'';
  function screenerRows(){
    if(S.savedScanView)return S.savedScanView.rows;
    const list=[];
    for(const [symbol,history] of S.data){if(!isVisibleSymbol(symbol))continue;const evalResult=screenSymbol(history,S.rules),d=statsFor(aggregate(history,'D')),w=statsFor(aggregate(history,'W'));
      const strategySignal=S.signalRows.get(symbol)||null;
      if(S.showOnlyMatches&&!evalResult.pass)continue;if(S.showWatch&&!S.watch.has(symbol))continue;
      if(S.signalsOnly&&S.signalSelection!=='none'&&strategySignal?.status!=='LONG')continue;
      if(S.query&&!symbol.toLowerCase().includes(S.query.toLowerCase()))continue;
      list.push({symbol,evalResult,d,w,source:S.sources.get(symbol),
        latestBar:history.at(-1)?.time||null,signal:strategySignal});}
    const value=r=>S.sort==='symbol'?r.symbol:
      S.sort==='rsi'?r.d.rsi:S.sort==='ret20'?r.d.ret20:S.sort==='price'?r.d.price:
      S.sort==='ema'?(r.d.ema200===null?null:100*(r.d.price/r.d.ema200-1)):
      S.sort==='signal'?({LONG:0,EXIT:1,FLAT:2,UNAVAILABLE:3}[r.signal?.status]??4):
      S.sort==='latest'?r.latestBar||'':r.d.drawdown;
    list.sort((a,b)=>{const x=value(a),y=value(b);if(x==null)return 1;if(y==null)return -1;return (typeof x==='string'?x.localeCompare(y):x-y)*(S.ascending?1:-1);});
    return list;
  }
  function staleReason(symbol){
    return S.mode==='live'&&S.scan.status==='complete'&&S.sources.get(symbol)==='ALPACA'?
      staleReasonForSymbol(symbol,S.freshness,S.staleDiagnostics):null;
  }
  function staleNote(symbol){
    const reason=staleReason(symbol);
    return reason?'<small class="stale-reason" role="status" data-stale-symbol="'+esc(symbol)+
      '">'+esc(reason)+'</small>':'';
  }
  function freshnessPanel(){
    if(S.mode!=='live'||S.scan.status!=='complete'||!S.freshness)
      return '<section class="panel" id="data-freshness"><div class="panel-header"><h2>Alpaca daily-bar freshness</h2></div><div class="panel-body"><p class="section-note">Run a live scan to compare actual latest daily bar dates across all '+LIVE_UNIVERSE.length+' symbols.</p></div></section>';
    const f=S.freshness,stale=f.stale||[];
    return '<section class="panel" id="data-freshness"><div class="panel-header"><h2>Alpaca daily-bar freshness</h2>'+
      '<span class="source-badge">'+(f.checked-stale.length)+'/'+f.checked+' current</span></div>'+
      '<div class="panel-body"><div class="info-strip '+(stale.length?'warning':'')+'">'+
      (stale.length?'Stale daily bars':'Fresh daily bars')+
      ' · reference latest-bar session <strong>'+esc(f.expected)+'</strong>'+
      ' · reference selected by most common date across loaded Alpaca symbols · feed '+
      esc(String(S.liveFeed).toUpperCase())+' · '+esc(S.scan.cached?'15-minute cached scan':'live scan')+
      '</div>'+(stale.length?'<div class="freshness-details">'+stale.map(x=>
        '<div class="data-item" data-data-stale-symbol="'+esc(x.symbol)+'"><strong>'+
        esc(x.symbol)+'</strong> · actual latest bar '+esc(x.latest||'missing')+
        staleNote(x.symbol)+'</div>').join('')+'</div>':
      '<p class="section-note">All loaded ticker bar dates match the observed reference session.</p>')+
      '</div></section>';
  }
  function activeAlertBanner(){
    const unread=S.alerts.filter(a=>a.unread);
    const alertsBanner=unread.length?'<div class="alert-banner" role="alert"><strong>'+unread.length+' in-app alert'+(unread.length===1?'':'s')+' triggered</strong>'+
      unread.map(a=>'<div>'+(a.type==='signal'?
        esc(a.strategyName||'Strategy')+' · '+esc(a.symbol)+' · '+esc(a.oldValue)+' → '+esc(a.newValue)+
        ' (observed '+esc(a.observedTo||'')+') · '+esc(a.source||'')+' · bar '+esc(a.lastHitBarDate||''):
        esc(a.symbol)+' · '+esc(a.metric.toUpperCase())+' '+(a.op==='>'?'above':'below')+' '+
        format(a.threshold,2)+' · latest '+format(a.lastValue,2)+' · bar '+esc(a.lastHitBarDate||''))+
        ' '+button('Dismiss alert','alert-ack','small').replace('data-action="alert-ack"','data-action="alert-ack" data-alert-id="'+esc(a.id)+'"')+'</div>').join('')+'</div>':'';
    return alertsBanner;
  }
  function activeSnapshotBanner(){
    const loaded=S.savedScanView;
    const snapshotNote=loaded?'<div class="info-strip warning" role="status">Showing saved scan snapshot: '+esc(loaded.name)+' from '+esc(loaded.savedAt)+' ('+esc(loaded.source)+'). These are archived values, not live quotes. Select Scan/Refresh to replace the snapshot.</div>':'';
    return snapshotNote;
  }
  function screenerView(){
    const symbols=[...S.data.keys()].filter(isVisibleSymbol),all=symbols.map(symbol=>screenSymbol(S.data.get(symbol),S.rules)),rows=screenerRows();
    const matched=S.savedScanView?rows.filter(x=>x.evalResult.pass).length:all.filter(x=>x.pass).length;
    const presetKey=Object.entries(preset).find(([key,r])=>JSON.stringify(r)===JSON.stringify(S.rules)&&(key!=='volatility'||S.universeFilter==='volatility'))?.[0]||'custom';
    const rules=S.rules.map((r,i)=>'<div class="rule"><span class="visually-hidden" id="rule-label-'+i+'">Filter condition '+(i+1)+'</span>'+select([['D','D'],['W','W'],['M','M'],['2H','2H']],r.tf,'aria-label="Filter '+(i+1)+' timeframe" data-rule="'+i+'" data-key="tf"')+select([['rsi','RSI'],['emaDist','% vs EMA200'],['ret20','20-bar %'],['drawdown','Drawdown %'],['atrPct','ATR %'],['price','Price'],['volume','Volume']],r.metric,'aria-label="Filter '+(i+1)+' indicator" data-rule="'+i+'" data-key="metric"')+select([['<','<'],['<=','≤'],['>','>'],['>=','≥']],r.op,'aria-label="Filter '+(i+1)+' comparison" data-rule="'+i+'" data-key="op"')+'<input aria-label="Filter threshold '+(i+1)+'" type="number" step="any" data-rule="'+i+'" data-key="value" value="'+esc(r.value)+'"/><button data-action="remove-rule" data-index="'+i+'" aria-label="Remove filter">×</button></div>').join('');
    const table=rows.map(r=>{const dd=r.d.ema200==null?null:(r.d.price/r.d.ema200-1)*100;
      return '<tr tabindex="0" role="button" aria-label="Open chart for '+esc(r.symbol)+'" class="'+(r.symbol===S.symbol?'chosen':'')+'" data-symbol="'+r.symbol+'"><td><button class="star '+(S.watch.has(r.symbol)?'on':'')+'" data-action="watch" data-symbol="'+r.symbol+'" aria-label="Toggle watchlist">'+(S.watch.has(r.symbol)?'★':'☆')+'</button><span class="table-table-label">'+r.symbol+'</span> <span class="muted">'+(r.source==='ALPACA'?'LIVE':r.source==='SIMULATED'?'DEMO':'CSV')+'</span></td><td>'+format(r.d.price)+'</td><td>'+format(r.d.rsi,1)+'</td><td>'+format(r.w.rsi,1)+'</td><td>'+format(r.d.rsi5,1)+'</td><td class="'+priceColor(dd)+'">'+pct(dd)+'</td><td class="'+priceColor(r.d.ret20)+'">'+pct(r.d.ret20)+'</td><td class="'+priceColor(r.d.drawdown)+'">'+pct(r.d.drawdown)+'</td><td>'+r.d.bars+'</td><td><span class="pill '+(r.evalResult.pass?'':'dim')+'" title="'+esc(r.evalResult.fails.join('; '))+'">'+(r.evalResult.pass?'MATCH':'NO MATCH')+'</span></td>'+
        '<td class="fresh-date">'+esc(r.latestBar||'—')+staleNote(r.symbol)+'</td>'+
        '<td><span class="signal-status '+(r.signal?.status==='LONG'?'signal-long':r.signal?.status==='EXIT'?'signal-exit':'signal-flat')+
        '" title="'+esc((r.signal?.reason||r.signal?.exitReason||'')+' · '+(r.signal?.source||r.source||'unknown'))+
        '">'+esc(r.signal?.status||'—')+'</span><small class="signal-date">'+esc(r.signal?.barDate||'')+'</small></td></tr>';
    }).join('');
    const scanStatus=S.scan.status==='loading'?'<div id="scan-status" class="info-strip">Scanning '+(S.mode==='live'?'the Alpaca market universe':'the Demo universe')+'…</div>':S.scan.status==='complete'?'<div id="scan-status" class="info-strip" data-scan-source="'+esc(S.scan.source||'DEMO')+'">'+(S.scan.source==='ALPACA'?'Live':'Demo')+' scan complete · '+S.scan.returned+'/'+S.scan.requested+' symbols loaded · '+S.scan.matched+' '+(S.scan.matched===1?'match':'matches')+(S.scan.missing?.length?' · '+S.scan.missing.length+' symbols returned no bars':'')+(S.scan.cached?' · served from 15-minute cache':'')+'</div>':S.scan.status==='fallback'?'<div id="scan-status" class="info-strip warning" data-scan-source="DEMO">Live scan failed; Demo mode restored. '+esc(S.scan.error||'Unknown error')+'</div>':'';
    const freshness=S.mode==='live'&&S.scan.status==='complete'?S.freshness:null;
    const stale=freshness?.stale||[];
    const freshnessBadge=freshness?'<div id="scan-freshness" class="freshness-strip '+(freshness.allFresh?'fresh-ok':'fresh-warning')+
      '" role="status"><strong>'+(freshness.allFresh?'Fresh daily bars':'Stale daily bars')+'</strong> · reference latest-bar session '+
      esc(freshness.expected)+' · '+(freshness.checked-stale.length)+'/'+freshness.checked+' current'+
      (stale.length?'<details class="freshness-details" open><summary>'+stale.length+' older or missing symbol(s)</summary>'+
        '<span>'+stale.map(x=>esc(x.symbol)+' ('+esc(x.latest||'missing')+'): '+esc(staleReason(x.symbol))).join(' · ')+'</span></details>':'')+
      '<small>Actual ALPACA '+esc(String(S.liveFeed).toUpperCase())+' 1Day bars · reference is the most common observed last-bar date (not the clock cutoff). '+
      (S.scan.retry?.attempted?.length?'Worker retried '+S.scan.retry.attempted.length+' stale tickers once.':'')+
      '</small></div>':'';
    const selectedStrategy=screenerStrategies().find(x=>x.id===S.signalSelection);
    const selectStrategy=select([['none','No strategy selected'],...screenerStrategies().map(x=>[x.id,x.name+(x.kind==='pine'?' · saved Pine':' · preset')])],
      S.signalSelection,'data-option="signal-strategy"');
    const factSymbol=S.mode==='live'?'VXX':'DEMO-VXX';
    const factBar=(S.mode==='demo'||S.sources.get('VXX')==='ALPACA')?S.data.get(factSymbol)?.at(-1):null;
    const factLabel=S.mode==='live'?'ALPACA VXX DAILY CLOSE':'SIMULATED DAILY CLOSE';
    const fact=factBar?'<div class="market-fact" role="status"><span class="market-fact-label">'+factLabel+'</span><strong>'+esc(factSymbol)+' &nbsp; $'+format(factBar.close)+'</strong><small>Bar date: '+esc(String(factBar.time))+(S.mode==='live'?' · '+esc(String(S.liveFeed).toUpperCase())+' feed · Alpaca daily close, not a last-trade quote':' · simulated, not a market quote')+'</small></div>':S.mode==='live'?'<div class="market-fact warning" role="status">Alpaca VXX daily close unavailable — VXX was not returned by the connected feed.</div>':'';
    return head('Screener','Filter '+symbols.length+' '+(S.mode==='live'?'Alpaca instruments':'demo or imported instruments')+' with explicit technical conditions.',button('Open Chart Lab','view-charts','primary'))+fact+activeAlertBanner()+activeSnapshotBanner()+
      '<div class="metrics">'+metric(S.savedScanView?'Saved rows':'Symbols loaded',S.savedScanView?rows.length:all.length,S.savedScanView?'Historical snapshot':S.mode==='live'?'Alpaca universe':'Demo and imported data')+metric('Matching filters',matched,'All visible symbols')+metric('Visible results',rows.length,'Search and match filter')+metric('Active conditions',S.rules.length,'AND logic; all must pass') +'</div>'+scanStatus+freshnessBadge+
      '<div class="panel"><div class="panel-header"><h2>Screen rules</h2><div class="flex"><label class="control">Preset '+select([['custom','Custom rules'],['trend','Trend pullback'],['original','Original strict W/D/2H'],['oversold','RSI oversold'],['momentum','Momentum'],['volatility','VXX / Volatility'],['all','Show all']],presetKey,'data-option="preset"')+'</label>'+button('+ Add rule','add-rule')+'</div></div><div class="panel-body"><div class="filters">'+(rules||'<span class="muted">No filters — showing all instruments.</span>')+'</div><div class="section-note" style="margin-top:12px">“Original strict” reproduces the weekly EMA200 and weekly/daily/two-hour RSI filter logic. RSI 5D is calculated from daily closes; daily bars cannot reconstruct true two-hour data. The VXX / Volatility preset narrows the universe to VXX, UVXY, SVXY, VIXY, VIXM, VXZ, SVIX, UVIX, SVOL and ZVOL, using daily RSI, 252-session drawdown and % versus daily EMA200. Demo mode uses the clearly labeled synthetic DEMO-VXX proxy.</div></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Market results</h2><div class="flex">'+button(S.mode==='live'?'Refresh live scan':'Scan demo universe','scan-universe','small primary')+button('Export screener CSV','export-screener','small')+
      '<label class="control">Strategy '+selectStrategy+'</label>'+
      '<label class="inline-check"><input type="checkbox" data-option="signals-only" '+(S.signalsOnly?'checked':'')+' '+(S.signalSelection==='none'?'disabled':'')+'/>Signals only (LONG)</label>'+
      '<input class="textinput" aria-label="Search symbols" data-input="search" placeholder="Search symbol…" value="'+esc(S.query)+'"/><label class="inline-check"><input type="checkbox" data-option="matches" '+(S.showOnlyMatches?'checked':'')+'/>Matches only</label><label class="inline-check"><input type="checkbox" data-option="watchonly" '+(S.showWatch?'checked':'')+'/>Watchlist</label><label class="control">Sort '+select([['symbol','Symbol'],['price','Price'],['rsi','RSI'],['ret20','20D return'],['ema','Daily % EMA'],['drawdown','Drawdown'],['signal','Strategy signal'],['latest','Latest bar']],S.sort,'data-option="sort"')+'</label>'+button(S.ascending?'↑':'↓','sort-order','small')+'</div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Symbol</th><th>Close</th><th>RSI D</th><th>RSI W</th><th title="5-period RSI calculated from daily closes; daily OHLC cannot reconstruct true 2-hour bars">RSI 5D</th><th title="Price as percentage difference from 200-period EMA of DAILY closes">% vs D EMA200</th><th>20D return</th><th>DD</th><th>Bars</th><th>Result</th><th>Latest bar</th><th title="Current position based on completed daily bars and next-open fills. EXIT can mean closed this bar or pending exit. Not a live order.">Signal · '+esc(selectedStrategy?.name||'None')+'</th></tr></thead><tbody>'+table+'</tbody></table>'+(rows.length?'':'<div class="empty">No matching symbols. Change a filter or import more price history.</div>')+'</div>'+
      '<p class="section-note">Signal: LONG = strategy currently holds a long at the latest bar close; EXIT = it closed on that bar or has a close order for next open; FLAT = no long. Signals use the same stop/fee/slippage and next-open rules as Backtest, long-side only. Bars and dates are from '+(S.mode==='live'?'Alpaca '+esc(String(S.liveFeed).toUpperCase()):'clearly labeled Demo/CSV')+'. '+
      (S.signalErrors.length?S.signalErrors.length+' unavailable signals: '+esc(S.signalErrors.slice(0,6).map(e=>e.symbol+': '+e.reason).join('; '))+'.':'No live trades or background monitoring.')+
      '</p></div>'+workspaceControls();
  }
  function workspaceControls(){
    const current=S.watchlists.find(x=>x.id===S.watchlistId)||S.watchlists[0];
    const listOptions=S.watchlists.map(x=>[x.id,x.name+' ('+x.symbols.length+')']);
    const alertSymbols=[...S.data.keys()].filter(modeSymbol).sort();
    const alertSymbol=alertSymbols.includes(S.alertDraft.symbol)?S.alertDraft.symbol:alertSymbols[0]||'';
    const alertRows=S.alerts.length?S.alerts.map(a=>'<div class="data-item"><span>'+(a.type==='signal'?
        esc(a.strategyName||'Strategy')+' · '+esc(a.symbol)+' '+esc(a.oldValue)+' → '+esc(a.newValue):
        esc(a.symbol)+' '+esc(a.metric.toUpperCase())+' '+(a.op==='>'?'above':'below')+' '+format(a.threshold,2))+
        ' <small>'+(a.type==='signal'?'At '+esc(a.lastHitBarDate||''):a.active?'Condition met':'Not triggered')+
        '</small></span>'+button('Remove alert','alert-delete','small').replace('data-action="alert-delete"','data-action="alert-delete" data-alert-id="'+esc(a.id)+'"')+'</div>').join(''):'<p class="section-note">No local alerts. They check only when you scan or refresh while this page is running.</p>';
    const savedChoices=S.savedScans.map(x=>[x.id,x.name+' · '+x.rows.length+' rows']);
    const loaded=S.savedScanView;
    return ''+
      '<div class="panel"><div class="panel-header"><h2>Named watchlists</h2><span class="muted">Stars add symbols to the selected list</span></div><div class="panel-body"><div class="workspace-actions">'+
        '<label class="control">Current list '+select(listOptions,S.watchlistId,'data-option="watchlist-select"')+'</label>'+
        '<label class="control">Watchlist name <input class="textinput" data-input="watchlist-name" value="'+esc(S.watchlistDraft)+'" placeholder="e.g. Volatility setups"/></label>'+
        button('Create watchlist','watchlist-create','small')+button('Rename watchlist','watchlist-rename','small')+button('Delete watchlist','watchlist-delete','small')+
        '</div><p class="section-note">Selected: '+esc(current.name)+' · '+current.symbols.length+' symbols. Use the star in the screener to add or remove a symbol.</p></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Saved scans</h2><span class="muted">Rules and a dated snapshot of the filtered table</span></div><div class="panel-body"><div class="workspace-actions">'+
        '<label class="control">Scan name <input class="textinput" data-input="scan-name" value="'+esc(S.scanDraft)+'" placeholder="e.g. VXX oversold"/></label>'+
        button('Save scan','save-scan','primary')+
        '<label class="control">Saved scan '+select([['','Choose saved scan'],...savedChoices],S.savedScanId||'','data-option="saved-scan-select"')+'</label>'+
        button('Load saved scan','load-scan','small')+button('Delete saved scan','delete-scan','small')+'</div>'+
        '<p class="section-note">Snapshots preserve displayed rows and filter conditions. Historical prices are not automatically refreshed when loaded.</p></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>In-app alerts</h2><span class="muted">No email · checks on Scan/Refresh</span></div><div class="panel-body"><div class="workspace-actions">'+
        '<label class="control">Symbol '+select(alertSymbols.map(sym=>[sym,sym]),alertSymbol,'data-alert-field="symbol"')+'</label>'+
        '<label class="control">Indicator '+select([['price','Daily close'],['rsi','Daily RSI(14)']],S.alertDraft.metric,'data-alert-field="metric"')+'</label>'+
        '<label class="control">Condition '+select([['>','Above'],['<','Below']],S.alertDraft.op,'data-alert-field="op"')+'</label>'+
        '<label class="control">Level <input type="number" class="textinput" data-alert-field="threshold" value="'+esc(S.alertDraft.threshold)+'" step="any"/></label>'+
        button('Add alert','alert-create','small primary')+
        '</div><div class="data-list">'+alertRows+'</div></div></div>';
  }
  function chartControls(){
    const styles=[['candles','Candlesticks'],['bars','OHLC bars'],['line','Line'],['area','Area']];
    const box=(k,label)=>'<label><input type="checkbox" data-chart="'+k+'" '+(S.chart[k]?'checked':'')+'/>'+label+'</label>';
    return '<div class="chart-toolbar">'+symbolSelect()+tfSelect()+'<label class="control">Style '+select(styles,S.chart.style,'data-option="style"')+'</label><label class="control">Scale '+select([['false','Linear'],['true','Log']],String(S.chart.log),'data-option="log"')+'</label><div class="flex chart-actions">'+button('1M','range-1m','small')+button('3M','range-3m','small')+button('1Y','range-1y','small')+button('Show all bars','range-all','small')+button('Fit chart','range-fit','small')+'</div></div><div class="chart-readout" id="readout">Move over the chart to inspect OHLCV and indicators.</div><div class="chart-area" id="price-chart"></div><div class="chart-footer"><div class="indicator-options">'+box('ema20','EMA 20')+box('ema50','EMA 50')+box('ema200','EMA 200')+box('sma20','SMA 20')+box('bollinger','Bollinger')+box('volume','Volume')+box('rsi','RSI')+box('macd','MACD')+'<label>EMA A <input type="number" data-chart="ema20Len" min="2" max="500" value="'+S.chart.ema20Len+'"/></label><label>EMA B <input type="number" data-chart="ema50Len" min="2" max="500" value="'+S.chart.ema50Len+'"/></label><label>EMA C <input type="number" data-chart="ema200Len" min="2" max="500" value="'+S.chart.ema200Len+'"/></label><label>SMA <input type="number" data-chart="sma20Len" min="2" max="500" value="'+S.chart.sma20Len+'"/></label><label>Boll <input type="number" data-chart="bollPeriod" min="2" max="500" value="'+S.chart.bollPeriod+'"/></label><label>RSI period <input type="number" data-chart="rsiPeriod" min="2" max="100" value="'+S.chart.rsiPeriod+'"/></label></div><div class="flex">'+button(S.drawLine?'Click price to draw…':'Horizontal line','draw-line',S.drawLine?'selected small':'small')+button('Clear price levels','clear-lines','small')+button('Export PNG','chart-png','small')+'</div></div>';
  }
  function chartsView(){
    const b=bars(),source=S.sources.get(S.symbol);
    return head('Chart Lab','Drag to pan, wheel/pinch to zoom. Daily charts use Alpaca 1Day bars; 15m and 2H require real 15Min bars.',button('Backtest this symbol','view-backtest','primary'))+
      (staleReason(S.symbol)?'<div class="info-strip warning" id="chart-stale-warning" role="status">'+
        '<strong>'+esc(S.symbol)+' daily bars lag the observed universe reference '+esc(S.freshness.expected)+'</strong>'+
        staleNote(S.symbol)+'</div>':'')+
      '<div class="panel">'+chartControls()+'<div class="chart-intraday-control">'+
      (intradayTf(S.chart.tf)?button('Refresh Alpaca 15m candles','refresh-intraday','small'):'')+
      '</div></div><div id="pine-chart-error" role="alert"></div>'+sourceStrip()+
      '<div class="info-strip">Data: <strong>'+esc(S.symbol)+'</strong> · '+(source==='SIMULATED'?'simulated':source==='ALPACA'?'Alpaca '+String(S.liveFeed).toUpperCase():'imported')+' · '+b.length+' '+S.chart.tf+' bars. Price scaling, crosshair, volume, indicator panes, and annotations are interactive. Charts use TradingView Lightweight Charts, not the full TradingView platform.</div>';
  }
  function btOptions(){
    if(S.bt.strategy==='pine-custom'){
      return '<div class="form-grid"><label class="field">Strategy '+select([['ema-cross','EMA crossover'],['rsi-revert','RSI mean reversion'],['trend-rsi','Trend + RSI pullback'],['bollinger','Bollinger mean reversion'],['breakout','Price breakout'],['pine-custom','Pine Script strategy']],S.bt.strategy,'data-bt="strategy"')+'</label>'+
        '<label class="field">Trade direction '+select([['long','Long'],['short','Short']],S.bt.side,'data-bt="side"')+'</label>'+
        field('Starting capital ($)','capital','number',1,100000000,100)+field('Position allocation (%)','allocation','number',1,100,1)+
        field('Commission (bps/side)','feeBps','number',0,1000,.5)+field('Slippage (bps/side)','slipBps','number',0,1000,.5)+
        field('Short borrow cost (%/year)','borrowAnnualPct','number',0,100,.1)+
        field('Stop loss (%)','stopPct','number',0,100,.5)+field('Take profit (%)','targetPct','number',0,1000,.5)+
        '</div><p class="section-note">Pine Script entry and exit signals are defined in Script Lab. Edit input.int / input.float / input.bool there; transaction costs and protective stops use these backtest settings.</p>';
    }
    return '<div class="form-grid"><label class="field">Strategy '+select([['ema-cross','EMA crossover'],['rsi-revert','RSI mean reversion'],['trend-rsi','Trend + RSI pullback'],['bollinger','Bollinger mean reversion'],['breakout','Price breakout'],['pine-custom','Pine Script strategy']],S.bt.strategy,'data-bt="strategy"')+'</label><label class="field">Trade direction '+select([['long','Long'],['short','Short']],S.bt.side,'data-bt="side"')+'</label>'+field('Fast EMA','fast','number',2,500,1)+field('Slow / trend EMA','slow','number',3,500,1)+field('RSI length','rsiPeriod','number',2,100,1)+field('Buy RSI threshold','buyLevel','number',1,99,1)+field('Exit RSI threshold','sellLevel','number',1,99,1)+field('Lookback / band length','period','number',2,200,1)+field('Bollinger deviation','multiplier','number',.1,5,.1)+field('Starting capital ($)','capital','number',1,100000000,100)+field('Position allocation (%)','allocation','number',1,100,1)+field('Commission (bps/side)','feeBps','number',0,1000,.5)+field('Slippage (bps/side)','slipBps','number',0,1000,.5)+field('Short borrow cost (%/year)','borrowAnnualPct','number',0,100,0.1)+field('Stop loss (%)','stopPct','number',0,100,0.5)+field('Take profit (%)','targetPct','number',0,1000,0.5)+'</div>';
  }
  function resultCards(r){
    if(!r)return '<div class="empty"><strong>No backtest run yet</strong>Choose parameters and select Run backtest.</div>';
    const m=r.metrics;return '<div class="metrics" style="margin-bottom:0">'+metric('Net return',pct(m.returnPct),format(m.endEquity)+' ending equity',priceColor(m.returnPct))+metric('Max drawdown','-'+format(m.maxDD)+'%','Peak-to-trough','negative')+metric('Profit factor',format(m.profitFactor),'After modeled costs')+metric('Completed trades',String(m.trades),m.winPct==null?'No trades':format(m.winPct,1)+'% winners')+metric('CAGR',pct(m.cagrPct),'Based on elapsed time',priceColor(m.cagrPct))+metric('Sharpe',format(m.sharpe),'Annualized, no risk-free adjustment')+metric('Exposure',format(m.exposurePct)+'%','Bars with open position')+metric('Buy & hold',pct(m.buyHoldPct),'Raw price reference',priceColor(m.buyHoldPct))+'</div>';
  }
  function tradeTable(r){
    if(!r||!r.trades.length)return '<div class="empty">No completed trades for this strategy on the selected dataset.</div>';
    return '<div class="table-wrap"><table class="data-table"><thead><tr><th>Entry</th><th>Exit</th><th>Entry price</th><th>Exit price</th><th>Quantity</th><th>Net P&amp;L</th><th>Return</th><th>Bars</th><th>Reason</th></tr></thead><tbody>'+r.trades.slice().reverse().slice(0,300).map(t=>'<tr><td>'+dateLabel(t.entry)+'</td><td>'+dateLabel(t.exit)+'</td><td>'+format(t.buy)+'</td><td>'+format(t.sell)+'</td><td>'+format(t.qty,4)+'</td><td class="'+priceColor(t.pnl)+'">'+format(t.pnl)+'</td><td class="'+priceColor(t.pnlPct)+'">'+pct(t.pnlPct)+'</td><td>'+t.barsHeld+'</td><td>'+esc(t.reason)+'</td></tr>').join('')+'</tbody></table></div>';
  }
  const backtestDateControls=()=>'<div class="bt-date-window" id="bt-date-window">'+
    '<label class="control">Start date <input aria-label="Backtest start date" type="date" data-bt-range="startDate" value="'+esc(S.btRange.startDate)+'"/></label>'+
    '<label class="control">End date <input aria-label="Backtest end date" type="date" data-bt-range="endDate" value="'+esc(S.btRange.endDate)+'"/></label>'+
    button('Full range','clear-bt-dates','small')+
    '<span class="section-note">Inclusive dates. Both blank = all available bars. No data outside this window is traded.</span></div>';
  const portfolioModeControl=()=>'<div class="portfolio-mode"><label class="control">Backtest mode '+
    select([['single','Single symbol'],['portfolio','Equal-weight portfolio'],['best-fit','Best-fit portfolio']],
      S.portfolioMode?(S.bestFitMode?'best-fit':'portfolio'):'single','data-option="portfolio-mode"')+
    '</label><span class="muted">Portfolios use daily aligned OHLCV, equal initial allocations and independent next-open trades. Best-fit uses each symbol\'s highest in-sample Sharpe strategy (not a holdout result).</span></div>';
  function activePortfolioResult(){
    return S.portfolioResult&&((S.bestFitMode&&S.portfolioResult.mode==='best-fit')||
      (!S.bestFitMode&&S.portfolioResult.mode!=='best-fit'))?S.portfolioResult:null;
  }
  function portfolioSelection(){
    if(S.portfolioScope==='watchlist'){
      const list=S.watchlists.find(x=>x.id===S.portfolioWatchlistId);
      return [...new Set((list?.symbols||[]).filter(modeSymbol))];
    }
    return [...S.data.keys()].filter(isVisibleSymbol).filter(sym=>screenSymbol(S.data.get(sym),S.rules).pass);
  }
  function portfolioBacktestView(){
    const isBest=S.bestFitMode,selections=portfolioSelection(),result=activePortfolioResult();
    const sourceName=S.mode==='live'?'Alpaca '+String(S.liveFeed).toUpperCase()+' 1Day bars':
      'Simulated Demo or imported daily OHLCV';
    const namedLists=S.watchlists.map(w=>[w.id,w.name+' · '+w.symbols.length+' symbols']);
    const controls='<div class="panel"><div class="panel-header"><h2>'+
      (isBest?'Best-fit portfolio selection':'Portfolio selection & strategy')+'</h2><div class="flex">'+
      button(S.portfolioLoading?'Evaluating portfolio…':(isBest?'Run best-fit portfolio':'Run equal-weight portfolio'),
        isBest?'run-best-fit':'run-portfolio','primary')+
      (isBest?'':button('Sweep portfolio parameters','view-optimize','small'))+
      button('Export portfolio breakdown','export-portfolio','small')+'</div></div><div class="panel-body">'+
      '<div class="portfolio-pick"><label class="control">Symbol source '+
      select([['matches','All current scan matches'],['watchlist','Named watchlist']],S.portfolioScope,'data-option="portfolio-scope"')+'</label>'+
      (S.portfolioScope==='watchlist'?'<label class="control">Watchlist '+
        select(namedLists,S.portfolioWatchlistId,'data-option="portfolio-watchlist"')+'</label>':'')+
      '<strong>'+selections.length+' selected</strong></div>'+
      (S.portfolioScope==='matches'?'<p class="section-note">Current Screener rule matches, including the volatility-universe restriction; saved scan snapshots are never reused.</p>':
        '<p class="section-note">Currently loaded symbols on the chosen named watchlist; unavailable or insufficient-history symbols are reported as omitted.</p>')+
      '<div class="info-strip">Data source: '+esc(sourceName)+
      '. Each included symbol receives the same initial capital fraction. Costs, stops and fills use the existing engine.</div>'+
      (isBest?'<p class="section-note"><strong>Strategy selection:</strong> For each selected symbol, compare executable preset, saved Pine and built-in example strategies on the common aligned daily dates and select the highest finite in-sample Sharpe. All strategies share the portfolio trade assumptions. This is in-sample optimization with selection bias, <strong>not out-of-sample validation</strong>. If no strategy has a finite Sharpe, the symbol is excluded and listed below.</p>':
        btOptions())+
      backtestDateControls()+'</div></div>';
    const summary=result?'<div class="metrics">'+
      metric('Total return',pct(result.metrics.returnPct),'Equal initial capital',priceColor(result.metrics.returnPct))+
      metric('CAGR',pct(result.metrics.cagrPct),'Calendar time, aligned dates')+
      metric('Sharpe',format(result.metrics.sharpe,2),'252 sessions, RF = 0')+
      metric('Maximum DD',pct(-result.metrics.maxDD),'Peak-to-trough portfolio equity')+
      '</div>':'<div class="empty">Select symbols and a date range, then run the portfolio.</div>';
    const rows=result?.breakdown||[];
    const table='<div class="table-wrap"><table class="data-table" id="portfolio-breakdown"><thead><tr>'+
      '<th>Symbol</th><th>Strategy</th><th>Source</th><th>Bar date</th><th>Weight</th>'+
      '<th>Return</th><th>Trades</th><th>Win rate</th><th>Max DD</th><th>Sharpe</th></tr></thead><tbody>'+
      rows.map(r=>'<tr data-portfolio-symbol="'+esc(r.symbol)+'"><td>'+esc(r.symbol)+'</td>'+
        '<td>'+esc(r.strategyName||r.strategy||'—')+
        (isBest?'<small class="fit-stale">Fit Sharpe: '+format(r.fitSharpe,2)+'</small>':'')+'</td>'+
        '<td>'+esc(r.source==='ALPACA'?'ALPACA '+String(S.liveFeed).toUpperCase()+' 1Day':r.source)+'</td>'+
        '<td>'+esc(String(r.barDate||'—').slice(0,10))+'</td>'+
        '<td>'+pct(result.weights[r.symbol]*100)+'</td><td class="'+priceColor(r.returnPct)+'">'+pct(r.returnPct)+'</td>'+
        '<td>'+format(r.trades,0)+'</td><td>'+pct(r.winPct)+'</td>'+
        '<td>'+pct(-r.maxDD)+'</td><td>'+format(r.sharpe,2)+'</td></tr>').join('')+
      '</tbody></table></div>';
    return head('Backtest · '+(isBest?'Best-fit portfolio':'Portfolio'),
      'Equal initial allocations on a shared daily calendar; no live orders.')+
      portfolioModeControl()+controls+
      (S.portfolioError?'<div class="warning info-strip" role="alert">'+esc(S.portfolioError)+'</div>':'')+
      (S.portfolioLoading?'<div class="info-strip" role="status" id="portfolio-loading">Comparing strategies and aligning portfolio equity…</div>':'')+
      (result?'<div class="info-strip" id="portfolio-source">Saved '+(isBest?'best-fit':'equal-weight')+
        ' portfolio · '+esc(result.sourceSummary||'Daily OHLCV')+
        ' · '+result.symbols.length+' symbols · '+result.curve.length+' daily equity points · run '+
        esc(S.portfolioTimestamp||'')+
        '<div class="result-range">'+esc(displayBacktestRange(result.range))+'</div>'+
        (result.omitted?.length?' · excluded '+esc(result.omitted.join(', '))+' (insufficient bars or no rankable strategy)':'')+
        '</div>':'')+
      summary+
      '<div class="panel"><div class="panel-header"><h2>Combined portfolio equity vs. equal-weight buy &amp; hold</h2></div>'+
      (result?.curve?.length?'<div class="equity-legend"><span><i class="equity-swatch strategy"></i>'+
        (isBest?'Best-fit strategies':'Equal-weight strategy')+'</span><span><i class="equity-swatch benchmark"></i>Equal-weight buy &amp; hold</span></div>'+
        '<div id="equity-chart" class="equity-plot"></div>':
        '<div class="empty">Run the portfolio to see the combined curve.</div>')+'</div>'+
      '<div class="panel"><div class="panel-header"><h2>Per-symbol breakdown</h2><span class="muted">'+rows.length+' symbols</span></div>'+
      (rows.length?table:'<div class="empty">No portfolio results yet.</div>')+'</div>'+
      (result?.unranked?.length?'<div class="info-strip warning" id="best-fit-unranked">No finite-Sharpe candidate for: '+
        esc(result.unranked.map(x=>x.symbol+' ('+x.reason+')').join('; '))+'</div>':'')+
      (result?.methodology?'<p class="section-note" id="portfolio-methodology">'+esc(result.methodology)+'</p>':'');
  }
  function portfolioOptimizeView(){
    const rows=S.portfolioSweep||[];
    return head('Optimize · Portfolio','70% common-date training / 30% chronological holdout, same strategy on each equal-capital symbol.')+
      portfolioModeControl()+
      '<div class="panel"><div class="panel-header"><h2>Equal-weight portfolio sweep</h2><div class="flex">'+button('Run portfolio sweep','run-sweep','primary')+
        button('Export portfolio sweep','export-sweep','small')+'</div></div>'+
      '<div class="panel-body"><p class="section-note">Population: '+portfolioSelection().length+' '+(S.portfolioScope==='matches'?'current scan matches':'named watchlist symbols')+
        '. Each parameter set is simulated independently across the same symbols; splits use aligned daily dates. Ranking on the holdout itself may overfit.</p></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Holdout ranking</h2><span class="muted">'+rows.length+' variations</span></div><div class="table-wrap">'+
      (rows.length?'<table class="data-table"><thead><tr><th>Parameters</th><th>Symbols</th><th>Train return</th><th>Train DD</th><th>Test return</th><th>Test DD</th><th>Test Sharpe</th><th></th></tr></thead><tbody>'+
      rows.map((r,i)=>'<tr><td>'+esc(Object.entries(r.params).map(([k,v])=>k+'='+v).join(', '))+'</td><td>'+r.n+'</td>'+
        '<td>'+pct(r.train.returnPct)+'</td><td>'+pct(-r.train.maxDD)+'</td><td>'+pct(r.test.returnPct)+'</td><td>'+pct(-r.test.maxDD)+'</td><td>'+format(r.test.sharpe,2)+'</td>'+
        '<td><button class="btn small" data-action="apply-sweep" data-index="'+i+'">Apply & test</button></td></tr>').join('')+'</tbody></table>':
        '<div class="empty">Run a portfolio sweep to compare parameter variations.</div>')+'</div></div>';
  }

  function leaderboardView(){
    const lb=S.leaderboard?.symbol===S.symbol?S.leaderboard:null;
    if(!lb)return S.leaderboardError?'<div role="alert" class="info-strip warning">'+esc(S.leaderboardError)+'</div>':'';
    const definitions=[['name','Strategy'],['returnPct','Total return'],['cagrPct','CAGR'],['sharpe','Sharpe'],['maxDD','Max DD'],['winPct','Win rate'],['trades','Trades'],['profitFactor','Profit factor']];
    const headers=definitions.map(([key,title])=>{
      const active=S.leaderboardSort===key;
      const arrow=active?(S.leaderboardDescending?' ▼':' ▲'):'';
      return '<th aria-sort="'+(active?(S.leaderboardDescending?'descending':'ascending'):'none')+'"><button class="table-sort" type="button" data-action="sort-leaderboard" data-key="'+key+'" aria-label="Sort by '+esc(title)+'">'+
        esc(title)+arrow+'</button></th>';
    }).join('');
    const order=sortLeaderboard(lb.rows,S.leaderboardSort,S.leaderboardDescending);
    const top=lb.rows.find(row=>row.id===lb.bestId);
    const note=S.chart.tf!==lb.timeframe?'Current timeframe '+esc(S.chart.tf)+' differs from saved comparison timeframe '+esc(lb.timeframe)+'. Results are not recalculated until you rerun comparison.':'';
    const provenance='<div class="info-strip" id="leaderboard-source"><strong>'+esc(lb.symbol)+'</strong> · '+esc(lb.timeframe)+' · '+esc(lb.source)+
      ' · bar date '+esc(readableBarDate(lb.asOf))+' · compared '+lb.compared+' strategies ('+
      (lb.builtInExamples||0)+' built-in examples, '+lb.savedPineStrategies+' saved Pine) · ran '+esc(lb.runAt)+
      ' · same capital, allocation, side, costs and stop/target assumptions for all strategies.'+(note?' '+note:'')+'</div>';
    const cells=order.map((row,index)=>{
      const best=row.id===lb.bestId,m=row.metrics;
      return '<tr data-leaderboard-id="'+esc(row.id)+'" class="'+(best?'leaderboard-best':'')+'"><td><span class="leaderboard-rank">'+(index+1)+'.</span> '+
        esc(row.name)+(row.kind==='example-indicator'?' <small class="muted">Indicator · N/A</small>':'')+
        (best?' <strong class="best-note">Best Sharpe</strong>':'')+'</td>'+
        '<td class="'+priceColor(m.returnPct)+'">'+pct(m.returnPct)+'</td>'+
        '<td>'+pct(m.cagrPct)+'</td><td>'+format(m.sharpe,3)+'</td>'+
        '<td>'+pct(-m.maxDD)+'</td><td>'+pct(m.winPct)+'</td><td>'+format(m.trades,0)+'</td>'+
        '<td>'+format(m.profitFactor,2)+'</td></tr>';
    }).join('');
    const overlay=lb.overlay||{series:[],benchmark:[]};
    const legendColors=['#46d69b','#71b8b3','#e9bd68'];
    const legend=overlay.series.map((entry,i)=>'<span class="leaderboard-legend-item"><i class="leaderboard-swatch" style="--swatch:'+legendColors[i]+'"></i>'+
      (i+1)+'. '+esc(entry.name)+'</span>').join('')+
      '<span class="leaderboard-legend-item"><i class="leaderboard-swatch" style="--swatch:#91a0a7"></i>Buy &amp; hold</span>';
    return '<section class="panel" aria-label="Strategy comparison"><div class="panel-header"><h2>Strategy leaderboard</h2><div class="flex">'+
      button('Compare all strategies','compare-strategies','small')+
      (top?button('Load best into Backtester','load-best-strategy','primary'):'')+
      '</div></div><div class="panel-body">'+provenance+
      (lb.skipped.length?'<div class="info-strip warning" role="status">'+lb.skipped.length+' scripts unavailable: '+
        lb.skipped.map(x=>esc(x.name)+': '+esc(x.reason)).join('; ')+'</div>':'')+
      '<div class="table-wrap"><table class="data-table leaderboard-table"><thead><tr>'+headers+'</tr></thead><tbody>'+cells+'</tbody></table></div>'+
      '<p class="section-note">Sorted by '+esc(definitions.find(x=>x[0]===S.leaderboardSort)?.[1]||'Sharpe')+
      '. Best means highest calculated Sharpe (rows with unavailable Sharpe sort last), not a forecast or a statistically validated winner. Click any column to sort; the Best Sharpe label does not change with sorting.</p>'+
      '</div></section><div class="panel"><div class="panel-header"><h2>Top 3 equity curves vs. buy-and-hold</h2><span class="source-badge">Same source · '+esc(lb.timeframe)+'</span></div>'+
      '<div class="panel-body"><div class="leaderboard-legend">'+legend+'</div>'+
      (overlay.series.length?'<div id="leaderboard-chart" class="equity-plot leaderboard-plot" aria-label="Top three strategy equity curves and buy and hold"></div>':
        '<div class="empty">Run Compare all strategies to generate overlays.</div>')+'</div></div>';
  }

  function universeFitView(){
    const report=S.fitReport;
    const status=S.fitStatus?'<div id="fit-status" role="status" class="info-strip">'+esc(S.fitStatus)+'</div>':
      S.fitError?'<div id="fit-status" role="alert" class="info-strip warning">'+esc(S.fitError)+'</div>':'';
    if(!report)return '<section class="panel" id="universe-fit"><div class="panel-header"><h2>Fit across universe</h2></div>'+
      '<div class="panel-body">'+status+'<p class="section-note">Run the selected preset or Pine strategy on all '+
      LIVE_UNIVERSE.length+' curated live Alpaca symbols with identical capital, fees, slippage and stops. Daily bars only. In-sample research, not proof of future performance.</p></div></section>';
    const defs=[['symbol','Symbol'],['returnPct','Total return'],['cagrPct','CAGR'],['sharpe','Sharpe'],
      ['maxDD','Max DD'],['winPct','Win rate'],['trades','Trades'],['source','Data source'],['barDate','Last bar']];
    const headers=defs.map(([key,name])=>'<th aria-sort="'+(S.fitSort===key?(S.fitDescending?'descending':'ascending'):'none')+
      '"><button type="button" class="table-sort" data-action="sort-fit" data-key="'+key+'">'+name+
      (S.fitSort===key?(S.fitDescending?' ▼':' ▲'):'')+'</button></th>').join('');
    const best=bestUniverseFit(report.rows);
    const cells=sortUniverseFit(report.rows,S.fitSort,S.fitDescending).map(row=>
      '<tr data-fit-symbol="'+esc(row.symbol)+'"'+(best?.symbol===row.symbol?' class="leaderboard-best"':'')+'>'+
      '<td>'+esc(row.symbol)+(row.stale?'<small class="fit-stale">Stale</small>':'')+'</td>'+
      '<td>'+pct(row.metrics?.returnPct)+'</td><td>'+pct(row.metrics?.cagrPct)+'</td>'+
      '<td>'+format(row.metrics?.sharpe)+'</td><td>'+format(row.metrics?.maxDD)+'%</td>'+
      '<td>'+pct(row.metrics?.winPct)+'</td><td>'+(row.metrics?.trades??'—')+'</td>'+
      '<td>'+esc(row.source)+'</td><td>'+esc(row.barDate||'—')+
      (row.error?'<small class="fit-error">'+esc(row.error)+'</small>':'')+'</td></tr>').join('');
    return '<section class="panel" id="universe-fit"><div class="panel-header"><h2>Fit across universe</h2><div class="flex">'+
      (best?button('Load best symbol','load-fit-best','primary'):'')+button('Export fit CSV','export-fit','small')+
      '</div></div><div class="panel-body">'+status+
      '<div id="fit-source" class="info-strip">'+report.completed+'/'+report.requested+' symbols backtested · ALPACA '+
      esc(String(S.liveFeed).toUpperCase())+' 1Day OHLCV · '+esc(report.runAt)+
      '. In-sample research, not proof of future performance. Missing bars are never fabricated.</div>'+
      '<div class="table-wrap"><table class="data-table fit-table"><thead><tr>'+headers+
      '</tr></thead><tbody>'+cells+'</tbody></table></div></div></section>';
  }
  function backtestView(){
    if(S.portfolioMode)return portfolioBacktestView();
    const dataStatus=S.analysisLoading?
      '<div class="info-strip analysis-loading" role="status" aria-live="polite"><strong>'+
      esc(S.analysisLoading)+'</strong> · '+esc(S.symbol)+' · '+esc(S.chart.tf)+
      ' · '+esc(String(S.liveFeed).toUpperCase())+' Alpaca real OHLCV. No daily-to-intraday simulation.</div>':
      S.analysisError?'<div class="info-strip warning" role="alert"><strong>Intraday data unavailable:</strong> '+
      esc(S.analysisError)+'</div>':'';
    const analysisNotice=S.result&&S.lastAnalysis?'<div class="info-strip">Saved analysis for <strong>'+esc(S.resultSymbol||S.symbol)+'</strong> · '+esc(S.resultTf||S.chart.tf)+' · '+esc(S.lastAnalysis.savedAt)+
      (S.resultSymbol!==S.symbol?' · Historical result from another symbol; select the original symbol and rerun for a matching chart.':'')+'</div>':'';
    return head('Backtest','Signals use completed bars and next-open fills. One position at a time, long or short.',symbolSelect()+tfSelect())+portfolioModeControl()+
      '<div class="panel"><div class="panel-header"><h2>Strategy settings</h2><div class="flex">'+button('Run backtest','run-backtest','primary')+button('Compare all strategies','compare-strategies')+button('Fit across universe','fit-universe')+button('Optimize parameters','view-optimize')+'</div></div><div class="panel-body">'+btOptions()+backtestDateControls()+'<p class="section-note">Stop-first rule when stop and target are both hit inside the same bar. Costs are modeled on each side. Short borrow fees are approximate; the engine does not model margin calls, locate availability, dividends, partial fills, taxes, or corporate actions.</p></div></div>'+
      (S.backtestError?'<div class="info-strip warning" role="alert" id="backtest-range-error">'+esc(S.backtestError)+'</div>':'')+
      dataStatus+sourceStrip()+analysisNotice+
      (S.result?'<div class="info-strip" id="backtest-result-range">'+esc(displayBacktestRange(S.result.range))+
        ' · source: '+esc(S.result.source||S.sources.get(S.resultSymbol)||'UNKNOWN')+
        ' · last bar date '+esc(S.result.range?.actualEnd||'unknown')+'</div>':'')+
      '<div class="panel"><div class="panel-header"><h2>Performance</h2><div class="flex">'+button('Export trades CSV','export-trades','small')+button('View trade markers','view-charts','small')+'</div></div><div class="panel-body">'+resultCards(S.result)+'</div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Equity curve vs. buy-and-hold</h2></div>'+(S.result?.curve?.length?'<div class="equity-legend"><span><i class="equity-swatch strategy"></i>Strategy</span><span><i class="equity-swatch benchmark"></i>Buy &amp; hold</span></div><div id="equity-chart" class="equity-plot"></div>':'<div class="empty">Run a backtest to generate an equity curve.</div>')+'</div>'+
      '<div class="panel"><div class="panel-header"><h2>Trade log</h2></div>'+tradeTable(S.result)+'</div>'+
      leaderboardView()+universeFitView();
  }
  function optimizeView(){
    if(S.portfolioMode)return portfolioOptimizeView();
    const rows=S.sweep||[];
    return head('Optimize','Parameter sweep with a 70% training / 30% chronological holdout split.',symbolSelect()+tfSelect())+portfolioModeControl()+
      '<div class="panel"><div class="panel-header"><h2>Run sweep</h2><div class="flex"><label class="control">Strategy '+select([['ema-cross','EMA cross'],['rsi-revert','RSI reversion'],['trend-rsi','Trend + RSI'],['bollinger','Bollinger'],['breakout','Breakout'],['pine-custom','Pine Script strategy']],S.bt.strategy,'data-bt="strategy"')+'</label>'+button('Run 5–9 variations','run-sweep','primary')+button('Export CSV','export-sweep','small')+'</div></div><div class="panel-body"><p class="section-note">Each variation is trained on the first 70% of the dataset and independently simulated on the last 30%, using earlier bars only for indicator warm-up. The table sorts by holdout return. Choosing the best holdout result itself introduces selection bias; confirm on unseen data.</p></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Parameter ranking</h2><span class="muted">'+rows.length+' variations</span></div><div class="table-wrap">'+(rows.length?'<table class="data-table"><thead><tr><th>Parameters</th><th>Train return</th><th>Train DD</th><th>Test return</th><th>Test DD</th><th>Test trades</th><th>Test PF</th><th></th></tr></thead><tbody>'+rows.map((r,i)=>'<tr class="'+(i===0?'sweep-best':'')+'"><td>'+esc(Object.entries(r.params).map(([k,v])=>k+'='+v).join(', '))+'</td><td class="'+priceColor(r.train.returnPct)+'">'+pct(r.train.returnPct)+'</td><td>-'+format(r.train.maxDD)+'%</td><td class="'+priceColor(r.test.returnPct)+'">'+pct(r.test.returnPct)+'</td><td>-'+format(r.test.maxDD)+'%</td><td>'+r.test.trades+'</td><td>'+format(r.test.profitFactor)+'</td><td><button class="btn small" data-action="apply-sweep" data-index="'+i+'">Apply & test</button></td></tr>').join('')+'</tbody></table>':'<div class="empty"><strong>No sweep yet</strong>Choose a strategy and run a parameter sweep.</div>')+'</div></div>';
  }
  function volatilityView(){
    const available=new Map([...S.data].filter(([sym])=>VOL_TICKERS.includes(sym)&&modeSymbol(sym)));
    const vSource=sym=>S.sources.get(sym)==='ALPACA'?'ALPACA '+String(S.liveFeed).toUpperCase()+' 1Day':
      S.sources.get(sym)==='IMPORTED'?'IMPORTED CSV daily':'UNAVAILABLE';
    const proxy=contangoPriceProxies(available,{sources:S.mode==='live'?'ALPACA '+S.liveFeed:'IMPORTED CSV'});
    const rows=VOL_TICKERS.map(sym=>volatilityRow(sym,available.get(sym),available.has(sym)?vSource(sym):'NOT LOADED'));
    const sourceNote=S.mode==='live'?'Live mode: '+esc(String(S.liveFeed).toUpperCase())+' Alpaca Worker daily OHLCV, cached scan '+esc(S.scan.at||'not yet scanned'):
      'Demo mode: no real volatility symbols in the synthetic universe. Import genuine OHLCV CSV for these tickers or switch to Alpaca Live.';
    return head('Volatility','Market-data volatility products and explicitly price-based roll/contango proxies; no futures or options pricing.',
      button(S.mode==='live'?'Refresh real Alpaca scan':'Load real Alpaca scan','refresh-volatility','primary'))+
      '<div class="info-strip" id="volatility-source">'+sourceNote+'</div>'+
      '<div class="panel"><div class="panel-header"><h2>Price-based regime heuristic</h2><span class="source-badge">NOT VIX FUTURES CONTANGO</span></div>'+
      '<div class="panel-body"><div class="vol-regime" id="contango-regime">'+esc(proxy.regime)+'</div>'+
      '<div class="metrics">'+
        metric('VXZ − VXX',''+pct(proxy.relativeReturn20),'20-day return spread · percentage points')+
        metric('SVXY/VXX ratio trend',pct(proxy.svxyVxxRatioTrend20),'20-session relative-price ratio change')+
        metric('Proxy date',esc(proxy.asOf||'Unavailable'),'Last aligned daily session')+
        '</div><p class="section-note"><strong>Rule:</strong> '+esc(proxy.rule)+'</p>'+
        '<p class="section-note"><strong>Meaning:</strong> '+esc(proxy.method)+
        ' Source: '+esc(proxy.sources||'No ticker data loaded')+'. No VIX futures maturities, options implied volatility or actual roll yield are available in this feed.</p></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Volatility product metrics</h2><span class="muted">'+available.size+' of '+VOL_TICKERS.length+' products with daily bars</span></div>'+
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Symbol</th><th>OHLCV source</th><th>Bar date</th><th>Close</th><th>20D return</th><th>RV 20D</th><th>RV 60D</th><th>252D high DD</th><th>Bars</th></tr></thead><tbody>'+
      rows.map(r=>'<tr data-vol-symbol="'+esc(r.symbol)+'"><td>'+esc(r.symbol)+'</td><td>'+esc(r.source)+'</td><td>'+esc(r.asOf||'—')+staleNote(r.symbol)+'</td>'+
        '<td>'+format(r.close)+'</td><td class="'+priceColor(r.return20)+'">'+pct(r.return20)+'</td><td>'+pct(r.rv20)+'</td><td>'+pct(r.rv60)+'</td>'+
        '<td class="'+priceColor(r.drawdown252)+'">'+pct(r.drawdown252)+'</td><td>'+format(r.bars,0)+'</td></tr>').join('')+'</tbody></table></div></div>'+
      '<div class="info-strip">Method: 20D return = Close(t)/Close(t−20)−1. RV 20D/60D = sample standard deviation of 20/60 daily logarithmic returns × sqrt(252), annualized. High DD = Close / maximum daily HIGH across the last 252 sessions − 1. Values shown only with sufficient history.</div>';
  }

  function scriptView(){
    const parsed=S.scriptParsed,inputs=parsed?.inputs||[];
    const examples=PINE_EXAMPLES.map(ex=>button(ex.label,'pine-example','small').replace('data-action="pine-example"','data-action="pine-example" data-example="'+esc(ex.id)+'"')).join('');
    const library=S.scriptLibrary.length?S.scriptLibrary.map(item=>
      '<option value="'+esc(item.id)+'"'+(S.scriptId===item.id?' selected':'')+'>'+esc(item.name)+'</option>').join(''):'';
    const settings=inputs.length?'<div class="pine-settings">'+inputs.map(spec=>{
      const value=Object.hasOwn(S.scriptSettings,spec.name)?S.scriptSettings[spec.name]:spec.default;
      const input=spec.type==='bool'?'<input type="checkbox" data-pine-input="'+esc(spec.name)+'" '+(value?'checked':'')+'/>':
        '<input type="number" data-pine-input="'+esc(spec.name)+'" value="'+esc(value)+'" step="'+esc(spec.step|| (spec.type==='int'?1:.1))+'"'+(spec.min!==undefined?' min="'+esc(spec.min)+'"':'')+(spec.max!==undefined?' max="'+esc(spec.max)+'"':'')+'/>';
      return '<label class="field">'+esc(spec.title)+' <small>('+esc(spec.name)+')</small>'+input+'</label>';
    }).join('')+'</div>':'<div class="section-note">This script has no editable input.int(), input.float(), or input.bool() controls.</div>';
    const status=S.scriptError?'<div class="pine-error" role="alert">'+esc(S.scriptError)+'</div>':
      S.scriptOutput?'<div class="info-strip" role="status">'+esc(S.scriptOutput)+'</div>':
      parsed?'<div class="info-strip" role="status">'+esc(parsed.mode.toUpperCase())+' · '+esc(parsed.title)+' · '+(parsed.overlay?'Price overlay':'Own indicator pane')+'</div>':'';
    return head('Script Lab','Write and run the supported Pine Script v5 subset locally. Scripts never leave this device.',symbolSelect()+tfSelect())+
      '<div class="panel"><div class="panel-header"><h2>Example scripts</h2><span class="muted">Load to edit</span></div><div class="panel-body"><div class="pine-examples">'+examples+'</div></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Source editor</h2><span class="source-badge">Pine v5 subset · local only</span></div><div class="panel-body">'+
        '<div class="pine-editor-actions"><label class="field">Script name<input id="pine-name" maxlength="100" value="'+esc(S.scriptName)+'" aria-label="Script name"/></label><label class="field">Saved scripts<select id="pine-library"><option value="">Choose saved script</option>'+library+'</select></label></div>'+
        '<label class="field" for="pine-editor">Pine Script source</label><textarea id="pine-editor" class="pine-editor" spellcheck="false" aria-label="Pine Script v5 source" rows="21">'+esc(S.scriptCode)+'</textarea>'+
        '<div class="flex pine-actions">'+button('Check syntax','pine-check','small')+button('Run script','pine-run','primary')+button('Sweep script inputs','pine-sweep','small')+button('Save script','pine-save','small')+button('Save copy','pine-copy','small')+button('Rename saved script','pine-rename','small')+button('Delete saved script','pine-delete','small')+'</div>'+status+
        '<p class="section-note">Execution is a bounded JavaScript interpreter, not TradingView itself. It supports v5 declarations, common ta.* functions, history references, input controls, conditional assignments, plot/plotshape, and strategy orders with when=. Unsupported Pine language features return line-numbered errors. Script exits use next-bar order fills, and the existing backtest cost model.</p>'+
      '</div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Input settings</h2><span class="muted">'+inputs.length+' controls</span></div><div class="panel-body">'+settings+'</div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Active chart indicators</h2>'+button('Clear Pine plots','pine-clear-plots','small')+'</div><div class="panel-body"><p class="section-note">'+
        (S.activeIndicators.length?S.activeIndicators.map(x=>esc(x.name)).join(', '):'No custom indicators applied to Chart Lab yet.')+
        '</p></div></div>';
  }

  function dataView(){
    const imported=[...S.data].filter(([k])=>S.sources.get(k)==='IMPORTED');
    return head('Data Center','Import historical prices or configure the secure Alpaca market-wide scanner.',button('Import CSV files','import','primary'))+
      freshnessPanel()+
      '<div class="panel"><div class="panel-header"><h2>Live market scanner · Alpaca</h2><span class="source-badge">Keys stay server-side</span></div><div class="panel-body"><label class="field">Cloudflare Worker API URL<input type="url" data-setting="apiBaseUrl" placeholder="https://market-lens-pro-api.your-subdomain.workers.dev" value="'+esc(S.apiBaseUrl)+'"/></label><div class="flex" style="margin-top:13px">'+button('Test backend','test-live','small')+button('Scan live universe & switch to Live','mode-live','primary')+button('Switch to Demo','mode-demo','small')+'</div><div class="info-strip">The live universe is '+LIVE_UNIVERSE.length+' curated symbols — not a full S&P 500 constituent list: '+LIVE_EQUITY_COUNT+' liquid US equities, '+LIVE_ETF_COUNT+' broad-market ETFs and '+LIVE_VOLATILITY_COUNT+' live volatility tickers. The volatility filter list has '+VOLATILITY_UNIVERSE.length+' entries, including the synthetic DEMO-VXX proxy; Demo mode scans '+DEMO_UNIVERSE.length+' synthetic symbols. Live volatility tickers include VXX, UVXY, SVXY, VIXY, VIXM, VXZ, SVIX, UVIX, SVOL and ZVOL. The Worker requests 550 calendar days of daily bars in batches of '+ALPACA_BATCH_SIZE+' symbols ('+Math.ceil(LIVE_UNIVERSE.length/ALPACA_BATCH_SIZE)+' batches for the current universe), paginates if necessary, and caches completed scans for 15 minutes. The default feed is IEX; consolidated SIP data requires an eligible Alpaca subscription.</div><p class="section-note">Alpaca credentials remain in encrypted Cloudflare Worker secrets. The browser receives OHLCV only. If the live request fails, the app returns to Demo mode automatically. The market-wide scanner uses daily bars over REST. Chart Lab fetches genuine Alpaca 15Min bars for the selected Live symbol when 15m or 2H is chosen; it never fabricates intraday from daily. No streaming WebSocket.</p><p class="section-note">The setup guide is in <code>docs/ALPACA_SETUP.md</code>. No keys belong in this website, browser storage, or chat.</p></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Import historical data</h2><span class="source-badge">Browser only · IndexedDB</span></div><div class="panel-body"><div class="upload" id="dropzone"><strong>Drop one or more CSV files here</strong><p class="subtle">Or tap to browse. Multiple symbols are supported in a single file.</p>'+button('Choose CSV files','import')+'</div><div class="info-strip">Required columns: <code>Date,Open,High,Low,Close</code>. Optional: <code>Symbol,Volume</code>. For daily files, enter ISO dates like 2026-01-05. Chart Lab in Live mode fetches real 15Min bars, aggregates them into 2H OHLCV, and labels the IEX source. Market-wide 2H screener rules still require timestamped intraday inputs. Imported CSV prices should be split-adjusted consistently. Close-only files are permitted but weaken fill accuracy.</div></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Saved imported symbols</h2><div class="flex">'+button('Reset to demo data','clear-imports','small')+button('Export sample CSV','export-sample','small')+'</div></div><div class="panel-body"><div class="data-list">'+(imported.length?imported.map(([symbol,b])=>'<div class="data-item"><div><strong>'+esc(symbol)+'</strong><br/><small>'+b.length+' bars · '+dateLabel(b[0].time)+' to '+dateLabel(b.at(-1).time)+'</small></div><button class="btn small" data-action="choose-symbol" data-symbol="'+esc(symbol)+'">Open chart</button></div>').join(''):'<div class="empty"><strong>No imported data yet.</strong>Four clearly labeled synthetic symbols are included to demonstrate the interface.</div>')+'</div></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Market data policy</h2></div><div class="panel-body"><p class="section-note">GitHub Pages serves the public frontend only. Alpaca credentials are stored as Cloudflare Worker secrets and are never sent to this browser. Live data requests go through the Worker proxy.</p><p class="section-note">Imported and demo data remain available in Demo mode. Backtesting is research-only and does not submit orders.</p></div></div>';
  }
  function render(){
    destroyCharts();shell();
    const views={screener:screenerView,briefing:briefingView,charts:chartsView,backtest:backtestView,optimize:optimizeView,volatility:volatilityView,scripts:scriptView,data:dataView};
    $('#main').innerHTML=views[S.tab]();
    if(S.tab==='charts'){
      mountPriceChart();
      if(intradayTf(S.chart.tf)&&S.mode==='live'&&S.sources.get(S.symbol)==='ALPACA'&&
        !S.intraday.get(intradayKey(S.symbol))&&!S.intradayStatus.get(intradayKey(S.symbol)))
        void Promise.resolve().then(()=>loadLiveIntraday(S.symbol)).catch(()=>{});
    }
    if(['backtest','optimize'].includes(S.tab)&&intradayTf(S.chart.tf)&&S.mode==='live'&&
      S.sources.get(S.symbol)==='ALPACA'&&!S.intraday.get(intradayKey(S.symbol))&&
      !S.intradayStatus.get(intradayKey(S.symbol)))
      void Promise.resolve().then(()=>loadLiveIntraday(S.symbol)).catch(()=>{});
    if(S.tab==='backtest'&&(S.portfolioMode?activePortfolioResult()?.curve?.length:S.result?.curve?.length))mountEquity();
    if(S.tab==='backtest'&&!S.portfolioMode&&S.leaderboard?.symbol===S.symbol)mountLeaderboardChart();
    saveSettings();
  }
  const colors={background:'#101515',text:'#a8b7b0',grid:'#23302b',up:'#46d69b',down:'#f08480',yellow:'#e9bd68',blue:'#71b8b3',indicator:'#d69c65'};
  function newChart(el,height=535,priceScaleWidth=55){
    return createChart(el,{autoSize:true,height,layout:{background:{type:'solid',color:colors.background},textColor:colors.text,fontFamily:'system-ui, sans-serif',fontSize:11,panes:{separatorColor:'#314459',separatorHoverColor:'#456278'}},grid:{vertLines:{color:colors.grid},horzLines:{color:colors.grid}},crosshair:{mode:0},rightPriceScale:{borderColor:'#304357',minimumWidth:priceScaleWidth},timeScale:{borderColor:'#304357',rightOffset:10,barSpacing:8},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:{time:true,price:true}},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false}});
  }
  function mountPriceChart(){
    const b=bars(),el=$('#price-chart');if(!b.length){const state=S.intradayStatus.get(intradayKey(S.symbol));
      el.innerHTML='<div class="empty"><strong>'+ (state?.status==='loading'?'Loading real Alpaca intraday bars':state?.status==='error'?'Live intraday unavailable':'No genuine '+esc(S.chart.tf)+' bars available')+
        '</strong>'+esc(state?.error||'Select a daily timeframe or import timestamped intraday OHLCV. We do not simulate market data.')+'</div>';return;}
    chart=newChart(el);
    const baseOptions={priceLineVisible:false,lastValueVisible:true};
    const type=S.chart.style==='line'?LineSeries:S.chart.style==='area'?AreaSeries:S.chart.style==='bars'?BarSeries:CandlestickSeries;
    const style=S.chart.style==='candles'?{upColor:colors.up,downColor:colors.down,borderVisible:false,wickUpColor:colors.up,wickDownColor:colors.down}:S.chart.style==='bars'?{upColor:colors.up,downColor:colors.down}:{color:colors.blue,lineColor:colors.blue,topColor:'#278cb263',bottomColor:'#278cb200',lineWidth:2};
    const base=chart.addSeries(type,{...baseOptions,...style});
    const datapoints=b.map(x=>S.chart.style==='line'||S.chart.style==='area'?{time:x.time,value:x.close}:{time:x.time,open:x.open,high:x.high,low:x.low,close:x.close});
    base.setData(datapoints);
    const c=b.map(x=>x.close),ind=indicators(b,{rsiPeriod:S.chart.rsiPeriod,period:S.chart.bollPeriod});
    for(const [name,vals,color] of [['ema20',ema(c,S.chart.ema20Len),colors.yellow],['ema50',ema(c,S.chart.ema50Len),colors.blue],['ema200',ema(c,S.chart.ema200Len),colors.indicator],['sma20',sma(c,S.chart.sma20Len),'#f7a75c']]){
      if(!S.chart[name])continue;
      const series=chart.addSeries(LineSeries,{color,lineWidth:2,priceLineVisible:false,lastValueVisible:true,title:name.toUpperCase()+'('+S.chart[name+'Len']+')'});
      series.setData(vals.flatMap((v,i)=>v==null?[]:[{time:b[i].time,value:v}]));
    }
    if(S.chart.bollinger){
      const basev=sma(c,S.chart.bollPeriod);
      for(const direction of [-1,1]){const ln=chart.addSeries(LineSeries,{color:'#758ead',lineWidth:1,priceLineVisible:false,title:direction>0?'Upper BB':'Lower BB'});ln.setData(basev.flatMap((v,i)=>{if(v==null)return [];const win=c.slice(i-S.chart.bollPeriod+1,i+1),std=Math.sqrt(win.reduce((sum,x)=>sum+(x-v)**2,0)/win.length);return [{time:b[i].time,value:v+direction*2*std}];}));}
    }
    if(S.chart.volume){const vol=chart.addSeries(HistogramSeries,{priceScaleId:'volume',priceLineVisible:false,lastValueVisible:false,priceFormat:{type:'volume'}});vol.setData(b.map(x=>({time:x.time,value:x.volume||0,color:x.close>=x.open?'#317c6c88':'#8a3c5388'})));vol.priceScale().applyOptions({scaleMargins:{top:.83,bottom:0}});}
    let pane=1;
    if(S.chart.rsi){
      const rs=chart.addSeries(LineSeries,{color:colors.indicator,lineWidth:2,priceLineVisible:false,title:'RSI('+S.chart.rsiPeriod+')'},pane++);
      rs.setData(rsi(c,S.chart.rsiPeriod).flatMap((v,i)=>v==null?[]:[{time:b[i].time,value:v}]));
      for(const v of [30,50,70])rs.createPriceLine({price:v,color:v===50?'#536980':'#9c6a70',lineWidth:1,lineStyle:2,axisLabelVisible:false});
    }
    if(S.chart.macd){
      const m=chart.addSeries(LineSeries,{color:colors.blue,lineWidth:2,priceLineVisible:false,title:'MACD'},pane);
      const sig=chart.addSeries(LineSeries,{color:colors.yellow,lineWidth:1,priceLineVisible:false,title:'Signal'},pane);
      m.setData(ind.macd.flatMap((v,i)=>v==null?[]:[{time:b[i].time,value:v}]));
      sig.setData(ind.signal.flatMap((v,i)=>v==null?[]:[{time:b[i].time,value:v}]));
    }
    if(pane>1){try{chart.panes()[0].setHeight(S.chart.macd?310:360);}catch{}}
    if(S.chart.log)base.priceScale().applyOptions({mode:PriceScaleMode.Logarithmic});
    for(const p of S.chart.lines[S.symbol]||[])base.createPriceLine({price:p,color:'#e4b766',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'Level'});
    const pineMarkers=[];
    if(S.result&&S.resultSymbol===S.symbol&&S.resultTf===S.chart.tf){
      pineMarkers.push(...S.result.trades.flatMap(t=>[
        {time:t.entry,position:t.side==='short'?'aboveBar':'belowBar',color:t.side==='short'?colors.down:colors.up,shape:t.side==='short'?'arrowDown':'arrowUp',text:t.side==='short'?'SHORT':'BUY'},
        {time:t.exit,position:t.side==='short'?'belowBar':'aboveBar',color:t.pnl>=0?colors.up:colors.down,shape:t.side==='short'?'arrowUp':'arrowDown',text:'EXIT'}
      ]));
    }
    const custom=[...S.activeIndicators];
    if(S.bt.strategy==='pine-custom'&&S.activeStrategy)custom.push({...S.activeStrategy,id:'strategy'});
    const pineErrors=[];
    for(const item of custom){
      try{
        const program=compilePine(item.code),evaluated=executePine(program,b,item.settings||{});
        const paneIndex=program.overlay?0:chart.panes().length;
        let firstScriptSeries=null;
        for(const p of evaluated.plots){
          const data=p.values.flatMap((v,k)=>Number.isFinite(v)?[{time:b[k].time,value:v}]:[]);
          if(!data.length)continue;
          const series=chart.addSeries(LineSeries,{color:p.color,lineWidth:2,priceLineVisible:false,lastValueVisible:false,title:String(item.name||program.title)+' · '+p.title},paneIndex);
          series.setData(data);firstScriptSeries ||= series;
        }
        const scriptMarkers=[];
        for(const shape of evaluated.shapes){
          shape.values.forEach((active,k)=>{
            if(active)scriptMarkers.push({time:b[k].time,position:shape.position==='location.abovebar'?'aboveBar':'belowBar',shape:shape.position==='location.abovebar'?'arrowDown':'arrowUp',color:shape.color,text:shape.title.slice(0,20)});
          });
        }
        if(!program.overlay&&firstScriptSeries&&scriptMarkers.length)
          createSeriesMarkers(firstScriptSeries,scriptMarkers.sort((a,b)=>stamp(a.time)-stamp(b.time)));
        else pineMarkers.push(...scriptMarkers);
      }catch(error){pineErrors.push((item.name||'Custom script')+': '+error.message);}
    }
    if(pineMarkers.length)createSeriesMarkers(base,pineMarkers.sort((a,b)=>stamp(a.time)-stamp(b.time)));
    const errorBox=$('#pine-chart-error');
    if(errorBox&&pineErrors.length){errorBox.className='pine-error';errorBox.textContent=pineErrors.join(' | ');}

    chart.subscribeClick(param=>{if(!S.drawLine||!param.point)return;const p=base.coordinateToPrice(param.point.y);if(p==null||!Number.isFinite(p))return;const price=Number(p.toFixed(4));(S.chart.lines[S.symbol]??=[]).push(price);base.createPriceLine({price,color:'#e4b766',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'Level'});S.drawLine=false;saveSettings();notice('Added horizontal price level at '+format(price,4));});
    chart.subscribeCrosshairMove(param=>{const d=param.seriesData.get(base),el=$('#readout');if(!el||!d)return;const v=('close' in d?d.close:d.value),o='open'in d?d.open:null;
      el.innerHTML='<b>'+dateLabel(param.time||b.at(-1).time)+'</b><span>Open '+format(o)+'</span><span>High '+format('high' in d?d.high:null)+'</span><span>Low '+format('low' in d?d.low:null)+'</span><span>Close <b>'+format(v)+'</b></span>';});
    showRange(180);
  }
  function showRange(n){
    if(!chart)return;const total=bars().length;
    try{if(!n||n>=total)chart.timeScale().fitContent();else chart.timeScale().setVisibleLogicalRange({from:Math.max(0,total-n),to:total+3});}catch{}
  }
  function mountEquity(){
    const el=$('#equity-chart');if(!el)return;equityChart=newChart(el,275,92);
    const line=equityChart.addSeries(AreaSeries,{lineColor:colors.up,topColor:'#2aac765a',bottomColor:'#2aac7610',lineWidth:2,priceLineVisible:false,lastValueVisible:false,title:'Strategy'});
    const active=S.portfolioMode?activePortfolioResult():S.result;
    line.setData(active.curve);
    const bb=equityChart.addSeries(LineSeries,{color:'#6c89a4',lineWidth:1,priceLineVisible:false,lastValueVisible:false,title:'Buy & hold'});
    if(S.portfolioMode&&active.benchmarkCurve?.length)bb.setData(active.benchmarkCurve);
    else {
      const all=bars(),byTime=new Map(all.map(b=>[stamp(b.time),b])),first=byTime.get(stamp(active.curve[0].time));
      if(first)bb.setData(active.curve.map(p=>({time:p.time,value:S.bt.capital*(byTime.get(stamp(p.time))?.close||first.open)/first.open})));
    }
    equityChart.timeScale().fitContent();
  }
  async function importFiles(files){
    let symbols=0,total=0,skipped=0;
    for(const file of files){try{const fallback=file.name.replace(/\.csv$/i,'').toUpperCase().replace(/[^A-Z0-9.^_-]/g,'').slice(0,20)||'IMPORT';const parsed=parseCsv(await file.text(),fallback);
      skipped+=parsed.skipped;
      for(const [s,b] of Object.entries(parsed.groups)){const mix=normalizeBars([...(S.sources.get(s)==='IMPORTED'?S.data.get(s):[]||[]),...b]);S.data.set(s,mix);S.sources.set(s,'IMPORTED');await storeDataset(s,mix);S.symbol=s;total+=b.length;symbols++;}}
      catch(err){notice('Cannot read '+file.name+': '+err.message);}
    }
    if(symbols){S.tab='data';S.result=null;S.sweep=null;render();notice('Loaded '+total+' bars across '+symbols+' symbol file sets. '+skipped+' invalid rows skipped.');}
  }
  function exportFile(name,contents,mime='text/csv'){
    const obj=new Blob([contents],{type:mime}),url=URL.createObjectURL(obj),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const runBt=()=>{
    let window;
    try{
      window=windowBacktestBars(bars(),S.btRange);
      if(window.bars.length<40)throw Error('Selected backtest date range has only '+
        window.bars.length+' bars; at least 40 are required. Choose a wider range.');
    }catch(error){S.backtestError=String(error.message||error);notice(S.backtestError);return false;}
    const b=window.bars;
    try{
      const cfg={...S.bt,timeframe:S.chart.tf};
      if(cfg.strategy==='pine-custom'){
        const active=S.activeStrategy||{code:S.scriptCode,settings:{...S.scriptSettings}};
        const program=compilePine(active.code);
        if(program.mode!=='strategy')throw new PineError(1,'Select a strategy() script to backtest');
        const calculated=executePine(program,b,active.settings);
        cfg.customSignals=calculated.signals;
      }
      S.result=backtest(b,cfg);
      S.result.range=window.range;
      S.result.source=S.sources.get(S.symbol)==='ALPACA'?
        'ALPACA '+String(S.liveFeed).toUpperCase()+' '+S.chart.tf:
        S.sources.get(S.symbol)==='SIMULATED'?'SIMULATED OHLCV':'IMPORTED CSV OHLCV';
      S.backtestError='';S.resultSymbol=S.symbol;S.resultTf=S.chart.tf;rememberAnalysis();return true;
    }catch(err){
      S.scriptError=err.message;S.tab='scripts';render();notice(err.message);return false;
    }
  };
  async function testLiveBackend(){
    let base=S.apiBaseUrl.trim();while(base.endsWith('/'))base=base.slice(0,-1);
    if(!base.startsWith('https://'))throw new Error('Enter the Cloudflare Worker URL in Data Center first.');
    const response=await fetch(base+'/api/health',{headers:{Accept:'application/json'}}),payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||'Worker health check failed ('+response.status+').');
    if(!payload.configured)throw new Error('Worker is reachable, but Alpaca secrets have not been configured yet.');
    S.liveFeed=payload.feed||'iex';notice('Alpaca backend is ready · '+String(S.liveFeed).toUpperCase()+' feed.');return payload;
  }
  function runDemoScan(){
    const symbols=[...S.data.keys()].filter(symbol=>S.sources.get(symbol)!=='ALPACA'&&isVisibleSymbol(symbol));
    const matches=symbols.filter(symbol=>screenSymbol(S.data.get(symbol),S.rules).pass);
    S.scan={status:'complete',source:'DEMO',requested:symbols.length,returned:symbols.length,matched:matches.length,missing:[],cached:false,at:new Date().toISOString()};
    S.freshness=null;evaluateScreenerSignals(true);
    evaluateLocalAlerts();S.tab='screener';render();
    notice('Demo scan complete: '+matches.length+' '+(matches.length===1?'match':'matches')+' across '+symbols.length+' symbols.');
  }
  async function fetchLiveUniverse(options={}){
    let base=S.apiBaseUrl.trim();while(base.endsWith('/'))base=base.slice(0,-1);
    if(!base.startsWith('https://'))throw new Error('Enter the Cloudflare Worker URL in Data Center first.');
    clearSavedScanView();S.scan={status:'loading',source:'ALPACA'};S.tab=options.restoreTab||'screener';render();
    const response=await fetch(base+'/api/stocks/scan?feed='+encodeURIComponent(S.liveFeed||'iex'),{headers:{Accept:'application/json'}});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||payload.detail||'Alpaca market scan failed ('+response.status+').');
    const raw=payload.bars&&typeof payload.bars==='object'?payload.bars:{},parsed=[];
    for(const [symbol,items] of Object.entries(raw)){
      const liveBars=alpacaBars(items,'1Day');
      if(liveBars.length)parsed.push([symbol,liveBars]);
    }
    if(!parsed.length)throw new Error('Alpaca returned no daily bars for the bundled universe. Check the feed and subscription.');
    if(S.sources.get(S.symbol)!=='ALPACA')S.lastDemoSymbol=S.symbol;
    for(const [symbol,source] of S.sources)if(source==='ALPACA'){S.sources.delete(symbol);S.data.delete(symbol);}
    const loaded=[];
    for(const [symbol,liveBars] of parsed){S.data.set(symbol,liveBars);S.sources.set(symbol,'ALPACA');loaded.push(symbol);}
    S.mode='live';S.liveFeed=payload.feed||'iex';
    const visible=loaded.filter(isVisibleSymbol);
    const remembered=options.restoreSymbol||S.lastBacktestSymbol||S.lastLiveSymbol||S.symbol;
    const target=loaded.includes(remembered)?remembered:
      loaded.includes(S.lastLiveSymbol)?S.lastLiveSymbol:loaded.includes(S.symbol)?S.symbol:visible[0]||loaded[0];
    S.preferredMode='live';
    restoreSymbolState(target);
    const matched=visible.filter(symbol=>screenSymbol(S.data.get(symbol),S.rules).pass).length;
    const expected=payload.freshness?.expected||expectedNyseBarDate(new Date());
    const allBars=Object.fromEntries(LIVE_UNIVERSE.map(sym=>[sym,S.sources.get(sym)==='ALPACA'?S.data.get(sym):[]]));
    S.freshness=scanFreshness(allBars,expected);
    S.staleDiagnostics=payload.diagnostics||{};
    S.scan={status:'complete',source:'ALPACA',requested:payload.requested||LIVE_UNIVERSE.length,returned:loaded.length,
      matched,missing:payload.missing||[],cached:response.headers.get('X-Scan-Cache')==='HIT',
      retry:payload.retry||null,at:new Date().toISOString()};
    evaluateScreenerSignals(true);
    evaluateLocalAlerts();S.tab=options.restoreTab||'screener';
    if(S.tab==='briefing')captureBriefing();
    render();
    notice('Live scan complete: '+matched+' '+(matched===1?'match':'matches')+' across '+visible.length+' visible symbols ('+loaded.length+'/'+S.scan.requested+' returned).');
  }
  async function switchToLive(options={}){
    S.preferredMode='live';
    try{await fetchLiveUniverse(options);}
    catch(err){
      S.mode='demo';S.preferredMode=options.restoreTab?'live':'demo';
      if(S.sources.get(S.symbol)==='ALPACA')S.symbol=S.lastDemoSymbol&&S.sources.get(S.lastDemoSymbol)!=='ALPACA'?S.lastDemoSymbol:'DEMO-SPY';
      S.scan={status:'fallback',source:'DEMO',error:err.message};
      S.result=null;S.sweep=null;S.tab='screener';render();
      notice('Live scan failed; switched back to Demo mode. '+err.message);
    }
  }
  function loadPineSource(code,name,id=null){
    S.scriptCode=code;S.scriptName=name;S.scriptId=id;S.scriptSettings={};S.scriptOutput=null;
    parseCurrentPine();persistPineDraft();S.tab='scripts';render();
  }
  function savePine(asCopy=false){
    const name=String(S.scriptName||'').trim();
    if(!name){S.scriptError='line 1: Enter a script name before saving';render();return;}
    if(S.scriptCode.length>32000){S.scriptError='line 1: Script must have fewer than 32,000 characters';render();return;}
    if(S.scriptLibrary.length>=30&&(asCopy||!S.scriptId)){notice('Local script library is limited to 30 scripts.');return;}
    const exists=S.scriptLibrary.find(x=>x.id===S.scriptId);
    const id=asCopy||!exists?'pine-'+Date.now()+'-'+Math.random().toString(36).slice(2,7):exists.id;
    const record={id,name,code:S.scriptCode,settings:{...S.scriptSettings}};
    if(exists&&!asCopy)Object.assign(exists,record);else S.scriptLibrary.push(record);
    S.scriptId=id;persistPineLibrary();persistPineDraft();S.scriptOutput='Saved locally: '+name;render();
  }
  function executeCurrentPine(){
    try{
      const program=compilePine(S.scriptCode);
      S.scriptParsed=program;S.scriptError='';
      const evaluated=executePine(program,bars(),S.scriptSettings);
      if(program.mode==='indicator'){
        const id=S.scriptId||'draft',record={id,name:S.scriptName,code:S.scriptCode,settings:{...S.scriptSettings}};
        S.activeIndicators=[...S.activeIndicators.filter(x=>x.id!==id),record].slice(-4);
        S.scriptOutput='Indicator applied to Chart Lab: '+program.title+' ('+evaluated.plots.length+' lines, '+evaluated.shapes.length+' shape series).';
        S.tab='charts';
      }else{
        S.activeStrategy={code:S.scriptCode,settings:{...S.scriptSettings},name:program.title};
        S.bt.strategy='pine-custom';
        S.result=backtest(bars(),{...S.bt,timeframe:S.chart.tf,customSignals:evaluated.signals});
        S.resultSymbol=S.symbol;S.resultTf=S.chart.tf;S.sweep=null;rememberAnalysis();
        S.scriptOutput='Strategy backtest completed: '+S.result.trades.length+' trades.';
        S.tab='backtest';
      }
      persistPineDraft();render();
    }catch(err){S.scriptError=err.message;S.scriptOutput=null;S.tab='scripts';render();}
  }
  function sweepCurrentPine(){
    try{
      const program=compilePine(S.activeStrategy?.code||S.scriptCode);
      if(program.mode!=='strategy')throw new PineError(1,'A parameter sweep needs a strategy() script');
      const settings=S.activeStrategy?.settings||S.scriptSettings;
      const rows=sweepPine(program,bars(),backtest,{...S.bt,timeframe:S.chart.tf},settings);
      S.sweep=rows;S.bt.strategy='pine-custom';rememberAnalysis();S.scriptError='';S.scriptOutput='Tested '+rows.length+' Pine input variations with 70/30 train and holdout periods.';
      S.tab='optimize';render();
    }catch(err){S.scriptError=err.message;S.tab='scripts';render();}
  }
  function loadSavedScan(id){
    const found=S.savedScans.find(item=>item.id===id);
    if(!found){notice('Choose a saved scan first.');return;}
    S.rules=found.rules.map(x=>({...x}));S.universeFilter=found.universeFilter;
    S.query=found.query;S.showOnlyMatches=found.showOnlyMatches;S.showWatch=found.showWatch;
    S.sort=found.sort;S.ascending=found.ascending;S.savedScanView=found;S.savedScanId=id;
    S.tab='screener';render();
  }
  function exportScreenerCsv(){
    const data=screenerRows();
    const rows=data.map(r=>{
      const ema=r.d.ema200==null?null:100*(r.d.price/r.d.ema200-1);
      return {Symbol:r.symbol,Source:r.source,Close:r.d.price,RSI_D:r.d.rsi,RSI_W:r.w.rsi,RSI_5D:r.d.rsi5,
        Pct_vs_D_EMA200:ema,Return_20D_pct:r.d.ret20,Drawdown_pct:r.d.drawdown,Bars:r.d.bars,
        Match:r.evalResult.pass?'MATCH':'NO MATCH',
        LatestBar:r.latestBar||'',SignalStrategy:S.signalSelection,Signal:r.signal?.status||'',
        SignalBar:r.signal?.barDate||'',Source:r.source,
        SnapshotDate:S.savedScanView?.savedAt||new Date().toISOString()};
    });
    exportFile('market-lens-screener-'+new Date().toISOString().slice(0,10)+'.csv',csvDownload(rows));
  }
  function addLocalAlert(){
    try{
      if(S.alerts.length>=ALERT_LIMIT)throw Error('Maximum '+ALERT_LIMIT+' in-app alerts reached');
      const available=[...S.data.keys()].filter(modeSymbol);
      const candidate={...S.alertDraft,symbol:available.includes(S.alertDraft.symbol)?S.alertDraft.symbol:available[0]};
      const valid=validateAlert(candidate);
      const id='alert-'+Date.now()+'-'+Math.random().toString(36).slice(2,5);
      S.alerts.push({...valid,id,active:false,unread:false});
      saveSettings();render();notice('Alert added. Run or refresh the scan to evaluate it.');
    }catch(err){notice(err.message);}
  }
  function changeWatchlist(mode){
    const name=S.watchlistDraft.trim().slice(0,80),chosen=S.watchlists.find(x=>x.id===S.watchlistId);
    if(mode==='create'){
      if(!name){notice('Enter a name before creating a watchlist.');return;}
      if(S.watchlists.length>=WATCHLIST_LIMIT){notice('Maximum '+WATCHLIST_LIMIT+' watchlists reached.');return;}
      const id='wl-'+Date.now();
      S.watchlists.push({id,name,symbols:[]});selectWatchlist(id);
    }else if(mode==='rename'){
      if(!name){notice('Enter a name before renaming a watchlist.');return;}
      if(chosen)chosen.name=name;
    }else if(mode==='delete'){
      if(S.watchlists.length<=1){notice('Keep at least one watchlist.');return;}
      if(!window.confirm('Delete watchlist "'+chosen.name+'"?'))return;
      S.watchlists=S.watchlists.filter(w=>w.id!==chosen.id);selectWatchlist(S.watchlists[0].id);
    }
    S.watchlistDraft='';saveSettings();render();
  }
  function saveCurrentScan(){
    const name=S.scanDraft.trim();
    if(!name){notice('Enter a scan name before saving.');return;}
    if(S.savedScans.length>=SCAN_LIMIT){notice('Maximum '+SCAN_LIMIT+' saved scans reached.');return;}
    const id='scan-'+Date.now();
    const snapshot=makeScanSnapshot(screenerRows(),{
      id,name,source:S.savedScanView?.source|| (S.mode==='live'?'ALPACA':'DEMO'),rules:S.rules,
      universeFilter:S.universeFilter,query:S.query,showOnlyMatches:S.showOnlyMatches,
      showWatch:S.showWatch,sort:S.sort,ascending:S.ascending
    });
    S.savedScans.push(snapshot);S.savedScanId=id;S.scanDraft='';saveSettings();render();
    notice('Saved '+snapshot.rows.length+' screener rows and rules as "'+name+'".');
  }
  function portfolioStrategyContext(){
    const option={...S.bt,timeframe:'D'},active=S.activeStrategy||{code:S.scriptCode,settings:S.scriptSettings};
    if(option.strategy!=='pine-custom')return {option,signals:null,inputs:null};
    const compiled=compilePine(active.code);
    if(compiled.mode!=='strategy')throw Error('Load a strategy() Pine script in Script Lab before running the portfolio.');
    option.pineParams={...(active.settings||{})};
    return {option,inputs:compiled.inputs,
      signals:(symbol,bars,params)=>executePine(compiled,bars,{...option.pineParams,...params}).signals};
  }
  function runPortfolioCurrent(){
    try{
      const symbols=portfolioSelection(),{option,signals}=portfolioStrategyContext();
      S.portfolioResult=runPortfolio(S.data,symbols,option,backtest,signals,{
        sources:S.sources,sourceSummary:S.mode==='live'?
          'ALPACA '+String(S.liveFeed).toUpperCase()+' 1Day bars · Worker scan '+(S.scan.at||'not available'):
          'SIMULATED Demo / imported OHLCV daily bars'
      });
      S.portfolioError='';rememberPortfolio();S.tab='backtest';render();
    }catch(error){S.portfolioError=error.message;S.tab='backtest';render();notice(error.message);}
  }
  function runPortfolioOptimization(){
    try{
      const symbols=portfolioSelection(),{option,signals,inputs}=portfolioStrategyContext();
      S.portfolioSweep=runPortfolioSweep(S.data,symbols,option,backtest,signals,{pineInputs:inputs,sources:S.sources});
      S.portfolioError='';rememberPortfolio();S.tab='optimize';render();
    }catch(error){S.portfolioError=error.message;S.tab='optimize';render();notice(error.message);}
  }


  async function runUniverseFitCurrent(){
    if(S.fitStatus)return;
    const cfg={...S.bt},script=cfg.strategy==='pine-custom'?
      {...(S.activeStrategy||{code:S.scriptCode,settings:{...S.scriptSettings}})}:null;
    S.fitReport=null;S.fitError='';S.fitStatus='Fetching 133 Alpaca daily OHLCV histories…';render();
    try{
      await fetchLiveUniverse({restoreTab:'backtest',restoreSymbol:S.mode==='live'?S.symbol:S.lastLiveSymbol});
      S.bt={...cfg};S.activeStrategy=script;
      S.fitStatus='Running selected strategy across all live symbols…';render();
      await new Promise(resolve=>setTimeout(resolve,0));
      const histories=new Map(LIVE_UNIVERSE.filter(sym=>S.sources.get(sym)==='ALPACA')
        .map(sym=>[sym,S.data.get(sym)]));
      S.fitReport=fitAcrossUniverse({symbols:LIVE_UNIVERSE,data:histories,
        options:cfg,strategyScript:script,backtest,compilePine,executePine,
        expectedBarDate:S.freshness?.expected||expectedNyseBarDate(),
        sourceFor:sym=>histories.has(sym)?'ALPACA '+String(S.liveFeed).toUpperCase()+' 1Day':'NO ALPACA BARS'});
      S.fitSort='sharpe';S.fitDescending=true;S.fitStatus='';render();
    }catch(err){S.fitStatus='';S.fitError=String(err.message||err);render();}
  }
  function loadUniverseFitBest(){
    const best=bestUniverseFit(S.fitReport?.rows||[]);
    if(!best){notice('No symbol has a finite Sharpe in this fit.');return;}
    const report=S.fitReport;
    restoreSymbolState(best.symbol);S.bt={...S.bt,...report.settings};
    S.chart.tf='D';S.activeStrategy=report.script?{...report.script}:null;
    if(report.script){
      S.scriptCode=report.script.code;S.scriptSettings={...(report.script.settings||{})};
      parseCurrentPine();persistPineDraft();
    }
    S.lastBacktestSymbol=best.symbol;S.tab='backtest';
    if(runBt())render();
  }
  function runComparison(){
    try{
      const history=bars();
      const report=compareStrategies({symbol:S.symbol,bars:history,builtInExamples:PINE_EXAMPLES,
        options:{...S.bt,timeframe:S.chart.tf},source:S.sources.get(S.symbol)==='ALPACA'?
          'Alpaca '+String(S.liveFeed).toUpperCase()+' OHLCV':S.sources.get(S.symbol)==='SIMULATED'?
          'SIMULATED Demo OHLCV':'IMPORTED CSV OHLCV',
        backtest,compilePine,executePine,savedScripts:S.scriptLibrary});
      S.leaderboard=report;S.leaderboardSort='sharpe';S.leaderboardDescending=true;S.leaderboardError='';
      rememberLeaderboard();render();
    }catch(err){S.leaderboardError=err.message;notice('Comparison failed: '+err.message);render();}
  }
  function loadComparisonStrategy(id){
    const lb=S.leaderboard?.symbol===S.symbol?S.leaderboard:null;
    const choice=lb?.rows.find(x=>x.id===id);
    if(!choice){notice('Run a strategy comparison for this symbol first.');return;}
    S.portfolioMode=false;S.bt={...S.bt,...lb.settings,strategy:choice.strategy};
    S.chart.tf=lb.timeframe;S.activeStrategy=choice.script?{
      code:choice.script.code,settings:{...choice.script.settings},name:choice.name
    }:null;
    if(choice.script){
      S.scriptCode=choice.script.code;S.scriptName=choice.name;
      S.scriptId=choice.script.id;S.scriptSettings={...choice.script.settings};
      parseCurrentPine();persistPineDraft();
    }
    S.result={metrics:choice.metrics,curve:choice.curve,trades:choice.trades};
    S.resultSymbol=lb.symbol;S.resultTf=lb.timeframe;S.sweep=null;S.tab='backtest';
    rememberAnalysis();render();
  }
  function mountLeaderboardChart(){
    const el=$('#leaderboard-chart'),lb=S.leaderboard;
    if(!el||!lb?.overlay)return;
    leaderboardChart=newChart(el,320,90);
    const palette=['#46d69b','#71b8b3','#e9bd68'];
    for(const [i,entry] of lb.overlay.series.entries()){
      const line=leaderboardChart.addSeries(LineSeries,{color:palette[i],lineWidth:i===0?3:2,
        priceLineVisible:false,lastValueVisible:false,title:entry.name});
      line.setData(entry.points);
    }
    if(lb.overlay.benchmark.length){
      const reference=leaderboardChart.addSeries(LineSeries,{color:'#91a0a7',lineWidth:2,
        priceLineVisible:false,lastValueVisible:false,title:'Buy & hold'});
      reference.setData(lb.overlay.benchmark);
    }
    leaderboardChart.timeScale().fitContent();
  }

  const action={
    'generate-briefing':()=>void generateBriefing(),
    'copy-briefing':async ()=>{
      if(!S.briefing){notice('Generate a live briefing before copying.');return;}
      try{await navigator.clipboard.writeText(briefingToText(S.briefing));
        notice('Daily briefing copied as plain text.');}
      catch(error){notice('Clipboard access failed: '+String(error.message||error));}
    },
    'export-screener':()=>exportScreenerCsv(),
    'run-portfolio':()=>runPortfolioCurrent(),
    'refresh-volatility':async ()=>{await switchToLive();if(S.mode==='live'){S.tab='volatility';render();}},
    'export-portfolio':()=>{if(!S.portfolioResult){notice('Run an equal-weight portfolio before exporting its results.');return;}
      const p=S.portfolioResult;
      exportFile('equal-weight-portfolio-breakdown.csv',csvDownload(p.breakdown.map(r=>({symbol:r.symbol,source:r.source,weight:p.weights[r.symbol],
        returnPct:r.returnPct,trades:r.trades,winRatePct:r.winPct,maxDrawdownPct:r.maxDD,sharpe:r.sharpe,
        portfolioSource:p.sourceSummary,runAt:S.portfolioTimestamp}))));},
    'watchlist-create':()=>changeWatchlist('create'),
    'watchlist-rename':()=>changeWatchlist('rename'),
    'watchlist-delete':()=>changeWatchlist('delete'),
    'save-scan':()=>saveCurrentScan(),
    'load-scan':()=>loadSavedScan(S.savedScanId),
    'delete-scan':()=>{if(!S.savedScanId){notice('Choose a saved scan to delete.');return;}
      S.savedScans=S.savedScans.filter(x=>x.id!==S.savedScanId);clearSavedScanView();saveSettings();render();},
    'alert-create':()=>addLocalAlert(),
    'alert-delete':el=>{S.alerts=S.alerts.filter(a=>a.id!==el.dataset.alertId);saveSettings();render();},
    'alert-ack':el=>{const a=S.alerts.find(a=>a.id===el.dataset.alertId);if(a)a.unread=false;saveSettings();render();},
    'pine-check':()=>{parseCurrentPine();S.scriptOutput=S.scriptError?null:'Pine syntax OK — '+S.scriptParsed.mode+' script with '+S.scriptParsed.inputs.length+' inputs.';render();},
    'pine-example':el=>{const ex=PINE_EXAMPLES.find(x=>x.id===el.dataset.example);if(ex)loadPineSource(ex.code,ex.label);},
    'pine-run':()=>executeCurrentPine(),
    'pine-sweep':()=>sweepCurrentPine(),
    'pine-save':()=>savePine(false),
    'pine-copy':()=>savePine(true),
    'pine-rename':()=>{const item=S.scriptLibrary.find(x=>x.id===S.scriptId);if(!item){notice('Load a saved script to rename it.');return;}item.name=S.scriptName;persistPineLibrary();persistPineDraft();S.scriptOutput='Renamed saved script to '+S.scriptName;render();},
    'pine-delete':()=>{const id=S.scriptId;if(!id){notice('Load a saved script to delete it.');return;}if(!window.confirm('Delete this locally saved script?'))return;S.scriptLibrary=S.scriptLibrary.filter(x=>x.id!==id);persistPineLibrary();loadPineSource(PINE_EXAMPLES[0].code,'EMA crossover');},
    'pine-clear-plots':()=>{S.activeIndicators=[];S.scriptOutput='Removed all custom indicator plots from Chart Lab.';render();},
    import:()=>$('#csv-file')?.click(),
    'mode-demo':()=>{clearSavedScanView();S.mode='demo';S.preferredMode='demo';if(S.sources.get(S.symbol)==='ALPACA')S.symbol=S.lastDemoSymbol&&S.sources.get(S.lastDemoSymbol)!=='ALPACA'?S.lastDemoSymbol:'DEMO-SPY';restoreSymbolState(S.symbol);S.scan={status:'idle'};render();},
    'mode-live':()=>switchToLive({restoreSymbol:S.lastLiveSymbol}),
    'scan-universe':()=>{clearSavedScanView();return S.mode==='live'?switchToLive():runDemoScan();},
    'test-live':()=>testLiveBackend().catch(err=>notice('Backend test failed: '+err.message)),
    'view-charts':()=>{S.tab='charts';render();},
    'refresh-intraday':()=>{if(S.mode==='live')void loadLiveIntraday(S.symbol,true).catch(()=>{});
      else notice('Only Alpaca Live mode can refresh real intraday bars.');},
    'view-backtest':()=>{S.tab='backtest';S.lastBacktestSymbol=S.symbol;render();},
    'view-optimize':()=>{S.tab='optimize';render();},
    'add-rule':()=>{clearSavedScanView();S.universeFilter='all';S.rules.push({metric:'rsi',tf:'D',op:'<',value:50});S.scan={status:'idle'};render();},
    'remove-rule':el=>{clearSavedScanView();S.rules.splice(Number(el.dataset.index),1);render();},
    'watch':el=>{const sym=el.dataset.symbol;
      S.watchlists=watchlistChange(S.watchlists,S.watchlistId,sym);
      const chosen=S.watchlists.find(x=>x.id===S.watchlistId);
      S.watch=new Set(chosen?.symbols||[]);saveSettings();render();},
    'sort-order':()=>{S.ascending=!S.ascending;render();},
    'range-1m':()=>showRange(S.chart.tf==='D'?22:5),
    'range-3m':()=>showRange(S.chart.tf==='D'?66:14),
    'range-1y':()=>showRange(S.chart.tf==='D'?252:52),
    'range-all':()=>showRange(0),
    'range-fit':()=>showRange(180),
    'draw-line':()=>{S.drawLine=!S.drawLine;render();},
    'clear-lines':()=>{S.chart.lines[S.symbol]=[];render();},
    'chart-png':()=>{if(!chart)return;try{const canvas=chart.takeScreenshot();canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='market-lens-'+S.symbol+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}catch{notice('Chart image export is unsupported in this browser.');}},
    'run-backtest':async ()=>{
      if(S.portfolioMode){runPortfolioCurrent();return;}
      S.lastBacktestSymbol=S.symbol;saveSettings();
      if(!await ensureAnalysisBars('Backtest'))return;
      if(runBt())render();
    },

    'fit-universe':()=>void runUniverseFitCurrent(),
    'load-fit-best':()=>loadUniverseFitBest(),
    'sort-fit':el=>{const key=el.dataset.key;if(!FIT_COLUMNS.includes(key))return;
      if(S.fitSort===key)S.fitDescending=!S.fitDescending;
      else{S.fitSort=key;S.fitDescending=!['symbol','source','barDate','maxDD'].includes(key);}
      render();},
    'export-fit':()=>{if(!S.fitReport)return;exportFile('market-lens-universe-fit.csv',
      csvDownload(S.fitReport.rows.map(r=>({symbol:r.symbol,returnPct:r.metrics?.returnPct??'',
        cagrPct:r.metrics?.cagrPct??'',sharpe:r.metrics?.sharpe??'',
        maxDD:r.metrics?.maxDD??'',winPct:r.metrics?.winPct??'',trades:r.metrics?.trades??'',
        source:r.source,barDate:r.barDate||'',error:r.error||''}))));},
    'compare-strategies':async ()=>{
      if(S.portfolioMode){notice('Switch to Single symbol mode to compare individual strategies.');return;}
      S.lastBacktestSymbol=S.symbol;saveSettings();
      if(!await ensureAnalysisBars('Compare all strategies'))return;
      runComparison();
    },
    'load-best-strategy':()=>{const id=S.leaderboard?.bestId;if(id)loadComparisonStrategy(id);},
    'sort-leaderboard':el=>{
      const key=el.dataset.key;
      if(!LEADERBOARD_METRICS.includes(key))return;
      if(S.leaderboardSort===key)S.leaderboardDescending=!S.leaderboardDescending;
      else {S.leaderboardSort=key;S.leaderboardDescending=!['name','maxDD'].includes(key);}
      render();
    },
    'run-sweep':async ()=>{if(S.portfolioMode){runPortfolioOptimization();return;}if(!await ensureAnalysisBars('Parameter sweep'))return;if(bars().length<60){notice('A parameter sweep needs at least 60 bars.');return;}if(S.bt.strategy==='pine-custom'){sweepCurrentPine();return;}S.sweep=parameterSweep(bars(),{...S.bt,timeframe:S.chart.tf});rememberAnalysis();render();},
    'apply-sweep':el=>{
      if(S.portfolioMode){
        const params=S.portfolioSweep?.[Number(el.dataset.index)]?.params;
        if(!params){notice('Run a portfolio sweep first.');return;}
        if(S.bt.strategy==='pine-custom'){
          S.scriptSettings={...S.scriptSettings,...params};
          if(S.activeStrategy)S.activeStrategy.settings={...S.activeStrategy.settings,...params};
          persistPineDraft();
        }else Object.assign(S.bt,params);
        runPortfolioCurrent();return;
      }
      const params=S.sweep[Number(el.dataset.index)].params;if(S.bt.strategy==='pine-custom'){S.scriptSettings={...S.scriptSettings,...params};if(S.activeStrategy)S.activeStrategy.settings={...S.activeStrategy.settings,...params};persistPineDraft();}else Object.assign(S.bt,params);if(runBt()){S.tab='backtest';render();}},
    'export-trades':()=>{if(!S.result){notice('Run a backtest before exporting.');return;}exportFile(S.symbol+'-trades.csv',csvDownload(S.result.trades.map(t=>({symbol:S.symbol,strategy:S.bt.strategy,...t}))));},
    'export-sweep':()=>{const sweep=S.portfolioMode?S.portfolioSweep:S.sweep;
      if(!sweep){notice('Run a parameter sweep first.');return;}
      exportFile((S.portfolioMode?'equal-weight-portfolio':S.symbol)+'-sweep.csv',csvDownload(sweep.map(r=>({
        params:JSON.stringify(r.params),source:S.portfolioMode?'Equal-weight daily sourced bars':S.sources.get(S.symbol),
        symbolCount:r.n??1,trainReturn:r.train.returnPct,trainDrawdown:r.train.maxDD,
        trainTrades:r.train.trades,testReturn:r.test.returnPct,testDrawdown:r.test.maxDD,
        testTrades:r.test.trades,testSharpe:r.test.sharpe,testProfitFactor:r.test.profitFactor}))));},
    'export-sample':()=>{const b=S.data.get('DEMO-SPY');exportFile('SIMULATED-DEMO-SPY.csv',csvDownload(b.map(x=>({Date:x.time,Symbol:'DEMO-SPY',Open:x.open,High:x.high,Low:x.low,Close:x.close,Volume:x.volume}))));},
    'clear-imports':()=>removeImports(),
    'choose-symbol':el=>{restoreSymbolState(el.dataset.symbol);S.tab='charts';render();}
  };
  document.addEventListener('click',ev=>{
    const btn=ev.target.closest('[data-tab],[data-action]');if(btn){
      if(btn.dataset.tab){
        S.tab=btn.dataset.tab;
        if(S.tab==='briefing'&&S.mode==='live'&&S.scan.status==='complete')
          try{captureBriefing();S.briefingError='';}
          catch(error){S.briefingError=String(error.message||error);}
        render();return;
      }
      const handler=action[btn.dataset.action];if(handler){ev.stopPropagation();handler(btn);return;}
    }
    const row=ev.target.closest('tr[data-symbol]');if(row){restoreSymbolState(row.dataset.symbol);S.tab='charts';render();}
    if(ev.target.closest('#dropzone'))$('#csv-file')?.click();
  });
  document.addEventListener('keydown',ev=>{
    const row=ev.target.closest('tr[data-symbol]');
    if(row&&(ev.key==='Enter'||ev.key===' ')&&!ev.target.closest('button,input,select')){
      ev.preventDefault();restoreSymbolState(row.dataset.symbol);S.tab='charts';render();
    }
    if(ev.key==='Escape'&&S.drawLine){S.drawLine=false;render();}
  });
  document.addEventListener('input',ev=>{
    const el=ev.target;
    if(el.id==='pine-editor'){S.scriptCode=el.value;S.scriptOutput=null;persistPineDraft();return;}
    if(el.id==='pine-name'){S.scriptName=el.value;persistPineDraft();return;}
    if(el.dataset.setting){S[el.dataset.setting]=el.value;saveSettings();return;}
    if(el.dataset.input==='watchlist-name'){S.watchlistDraft=el.value;return;}
    if(el.dataset.input==='scan-name'){S.scanDraft=el.value;return;}
    if(el.dataset.input==='symbol-search'){
      S.symbolQuery=el.value;
      const dropdown=$('[data-option="symbol"]');
      if(dropdown){
        const options=[...S.data.keys()].filter(modeSymbol).filter(s=>s.toLowerCase().includes(el.value.trim().toLowerCase())||s===S.symbol).sort();
        dropdown.innerHTML=options.map(s=>'<option value="'+esc(s)+'"'+(s===S.symbol?' selected':'')+'>'+esc(s)+'</option>').join('');
      }
      return;
    }
    if(el.dataset.input==='search'){S.query=el.value;const focus=el.selectionStart;render();const input=$('[data-input="search"]');if(input){input.focus();input.setSelectionRange(focus,focus);}}
  });
  document.addEventListener('change',async ev=>{
    const el=ev.target;
    if(el.id==='csv-file'){if(el.files?.length)await importFiles(el.files);el.value='';return;}
    if(el.id==='pine-library'){const found=S.scriptLibrary.find(x=>x.id===el.value);if(found){loadPineSource(found.code,found.name,found.id);S.scriptSettings={...(found.settings||{})};persistPineDraft();render();}return;}
    if(el.dataset.pineInput){S.scriptSettings[el.dataset.pineInput]=el.type==='checkbox'?el.checked:Number(el.value);persistPineDraft();return;}
    if(el.dataset.alertField){
      const key=el.dataset.alertField;S.alertDraft[key]=key==='threshold'?Number(el.value):el.value;return;
    }
    if(el.dataset.option){
      const opt=el.dataset.option,val=el.value;
      if(opt==='briefing-strategy'){
        S.signalSelection=val;S.signalsOnly=false;
        evaluateScreenerSignals(false);saveSettings();
        if(S.mode==='live'&&S.scan.status==='complete')
          try{captureBriefing();S.briefingError='';}
          catch(error){S.briefingError=String(error.message||error);}
        render();return;
      }
      if(opt==='signal-strategy'){S.signalSelection=val;S.signalsOnly=false;
        evaluateScreenerSignals(false);saveSettings();render();return;}
      if(opt==='signals-only'){S.signalsOnly=el.checked;saveSettings();render();return;}
      if(opt==='watchlist-select'){selectWatchlist(val);render();return;}
      if(opt==='portfolio-mode'){S.portfolioMode=val==='portfolio';saveSettings();render();return;}
      if(opt==='portfolio-scope'){S.portfolioScope=val;saveSettings();render();return;}
      if(opt==='portfolio-watchlist'){S.portfolioWatchlistId=val;saveSettings();render();return;}
      if(opt==='saved-scan-select'){if(val)loadSavedScan(val);else{clearSavedScanView();render();}return;}
      if(opt==='preset'){if(val==='custom')return;clearSavedScanView();S.rules=(preset[val]||[]).map(x=>({...x}));S.universeFilter=val==='volatility'?'volatility':'all';S.scan={status:'idle'};}
      else if(opt==='symbol'){
        restoreSymbolState(val);
        if(['backtest','optimize'].includes(S.tab))S.lastBacktestSymbol=val;
      }
      else if(opt==='tf'){S.chart.tf=val;S.result=null;S.sweep=null;}
      else if(opt==='style')S.chart.style=val;
      else if(opt==='log')S.chart.log=val==='true';
      else if(opt==='matches')S.showOnlyMatches=el.checked;
      else if(opt==='watchonly')S.showWatch=el.checked;
      else if(opt==='sort')S.sort=val;
      render();return;
    }
    if(el.dataset.rule!==undefined){clearSavedScanView();const r=S.rules[Number(el.dataset.rule)];if(r){r[el.dataset.key]=el.dataset.key==='value'?Number(el.value):el.value;render();}return;}
    if(el.dataset.chart){const key=el.dataset.chart;S.chart[key]=el.type==='checkbox'?el.checked:el.type==='number'?Math.max(2,Math.round(Number(el.value)||14)):el.value;render();return;}
    if(el.dataset.bt){const key=el.dataset.bt;S.bt[key]=el.type==='number'?Number(el.value):el.value;S.result=null;S.sweep=null;saveSettings();return;}
  });
  document.addEventListener('dragover',ev=>{if(ev.target.closest('#dropzone')){ev.preventDefault();ev.target.closest('#dropzone').classList.add('dragging');}});
  document.addEventListener('drop',async ev=>{const drop=ev.target.closest('#dropzone');if(drop){ev.preventDefault();drop.classList.remove('dragging');await importFiles([...ev.dataTransfer.files].filter(f=>f.name.toLowerCase().endsWith('.csv')));}});
  if(S.signalSelection!=='none')evaluateScreenerSignals(false);
  render();
  await loadStored();
  if(startupPrefs.mode==='live'){
    // Restore Live by rehydrating the real market scan, never relabel Demo prices.
    const destination=startupPrefs.tab;
    await switchToLive({restoreTab:destination,restoreSymbol:startupPrefs.selectedSymbol});
  }else{
    if(startupPrefs.selectedSymbol&&S.data.has(startupPrefs.selectedSymbol))
      restoreSymbolState(startupPrefs.selectedSymbol);
    render();
  }
}
initApp().catch(err=>{document.getElementById('app').textContent='App startup failed: '+err.message;console.error(err);});
