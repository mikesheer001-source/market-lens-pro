import {createHistoryCache,frameLatest} from './history-cache.js';
import {createMedianDotLayer} from './options-median-chart.js';
import {readChartWorkspace,writeChartWorkspace,chartAlertLevels,chartOptionLevels,matchingTradeMarkers} from './chart-workspace.js';
import {readWorkspaceLayout,writeWorkspaceLayout,moveWorkspace} from './workspace-layout.js';
import {getOptionsDevice, requestOptions} from './options-api.js';
import {loadOptionsMedians, medianHorizons, loadOptionsProbability, probabilityHorizons, probabilityBands} from './options-median.js';
import {createOptionsBuilder, optionsApprovalLink} from './options-builder.js';
import {mergeWorkspace, workspaceSync} from './workspace-sync.js';
import {scanMarket} from './market-scan.js';
import './styles.css';
import {CHART_FRAMES,INTRADAY_MINUTES,isIntraday,sourceResolution,resolutionDays,selectedFrames} from './timeframes.js';
import {compilePine, executePine, sweepPine, PineError} from './pine.js';
import {PINE_EXAMPLES} from './pine-examples.js';
import {readableBarDate,normalizeStartupPreferences,intradayCacheFresh,intradayFetchDecision} from './intraday-session.js';
import {availableStrategySignals,evaluateStrategySignals,scanSignalFlips} from './signals.js';
import {expectedNyseBarDate,scanFreshness,staleReasonForSymbol} from './freshness.js';
import {FIT_COLUMNS,sortUniverseFit,bestUniverseFit,fitAcrossUniverse} from './fit.js';
import {leaderboardDisplayRows,fitDisplayRows,leaderboardRankingCsv,fitRankingCsv,portfolioRankingCsv} from './ranking-export.js';
import {fitValidatedAcrossUniverse,NO_VALIDATED_FIT} from './fit-validated.js';
import {compareStrategies,sortLeaderboard,leaderboardBest,updateSymbolMemory,pruneSymbolMemory,symbolMemoryItem,compactLeaderboard,LEADERBOARD_METRICS} from './leaderboard.js';
import {runPortfolio,runPortfolioSweep,portfolioUniverse} from './portfolio.js';
import {windowBacktestBars,windowPortfolioData,validateBacktestRange,actualPortfolioRange,displayBacktestRange} from './date-window.js';
import {runBestFitPortfolio} from './best-fit-portfolio.js';
import {assessHoldout,holdoutSummary} from './validation.js';
import {compareStrategiesInRange,leaderboardRangeStatus,rangeLabel} from './leaderboard-range.js';
import {rollingPositiveText,rollingWindowDates,rollingLeaderboardSummary,ROLLING_WINDOW_COUNT} from './rolling-validation.js';
import {VALIDATION_RULE,validationReasons,validationStatus,filterValidatedLeaderboard,
  bestRollingValidatedStrategy} from './validated-strategies.js';
import {restoreWatchlists,watchlistChange,validateAlert,checkAlerts,makeScanSnapshot,analysisSnapshot,restoreAnalysis,WATCHLIST_LIMIT,SCAN_LIMIT,ALERT_LIMIT} from './workspace.js';
import { LIVE_UNIVERSE, VOLATILITY_UNIVERSE, LIVE_EQUITY_COUNT, LIVE_ETF_COUNT, LIVE_VOLATILITY_COUNT, ALPACA_BATCH_SIZE, ALPACA_SCAN_LOOKBACK_DAYS } from './universe.js';
import {DEFAULT_ALPACA_WORKER,inspectLiveHistory,shouldTryDefaultWorker,liveScanUrl,canonicalWorkerBase}
  from './live-history.js';
import {INDICATOR_ORDER,activeIndicatorReadings,indicatorInputs,indicatorLabel,updateIndicatorSetting,
  movingAverages,addMovingAverage,editMovingAverage,
  nextFullscreenState,chartScaleOptions,resetPriceScale,mountPriceAxisTouch,macdSeries,bollingerSeries} from './chart-usability.js';
async function initApp(){
  const engine=await import('./engine.js');
  const {parseCsv,normalizeBars,alpacaBars,ema,sma,rsi,indicators,screenStats,backtest,parameterSweep,csvDownload,stamp}=engine;
  const {aggregate,statsFor,screenSymbol}=createHistoryCache(engine);
  const {
    createChart,CandlestickSeries,BarSeries,LineSeries,AreaSeries,HistogramSeries,PriceScaleMode,TrackingModeExitMode,createSeriesMarkers
  }=await import('lightweight-charts');
  const $=(q)=>document.querySelector(q),esc=(s)=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const numberFormatters=new Map();
  const format=(n,d=2)=>{
    if(n==null||!Number.isFinite(n))return '—';
    if(!numberFormatters.has(d))numberFormatters.set(d,new Intl.NumberFormat('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}));
    return numberFormatters.get(d).format(n);
  };
  const pct=n=>n==null||!Number.isFinite(n)?'—':(n>0?'+':'')+format(n)+'%';
  const priceColor=n=>n==null?'muted':n>=0?'positive':'negative';
  const dateLabel=t=>typeof t==='number'?new Date(t*1000).toISOString().slice(0,16).replace('T',' '):String(t);
  const tabNames={screener:'Screener',charts:'Chart Lab',backtest:'Backtest',options:'Options Builder',optimize:'Optimize',scripts:'Script Lab',data:'Data Center'};
  const tabIcons={screener:'📊',charts:'📈',backtest:'🧪',options:'◫',optimize:'⚙️',scripts:'🧩',data:'🗂️'};
  const preset={
    trend:[{metric:'emaDist',tf:'D',op:'>',value:0},{metric:'rsi',tf:'D',op:'<',value:60}],
    original:[{metric:'emaDist',tf:'W',op:'>',value:0},{metric:'rsi',tf:'W',op:'<',value:50},{metric:'rsi',tf:'D',op:'<',value:50},{metric:'rsi',tf:'2H',op:'<',value:50}],
    oversold:[{metric:'rsi',tf:'D',op:'<',value:35}],
    momentum:[{metric:'ret20',tf:'D',op:'>',value:10},{metric:'emaDist',tf:'D',op:'>',value:0}],
    volatility:[{metric:'rsi',tf:'D',op:'<',value:60},{metric:'drawdown',tf:'D',op:'<',value:-5},{metric:'emaDist',tf:'D',op:'<',value:0}],
    all:[]
  };
  const defaultSettings={tf:'D',sliderFrames:CHART_FRAMES.map(([id])=>id),style:'candles',log:false,ema20:true,ema50:false,ema200:true,sma20:false,movingAverages:[],indicatorCopies:[],bollinger:false,volume:true,rsi:true,macd:false,rsiPeriod:14,bollPeriod:20,optionsMedian:false,optionsMedianRate:4,optionsProbability:false,optionsProbabilityRate:4,ema20Len:20,ema50Len:50,ema200Len:200,sma20Len:20,volumeHeight:17,macdFast:12,macdSlow:26,macdSignal:9,lines:{}};
  const defaultBacktest={strategy:'ema-cross',side:'long',borrowAnnualPct:0,fast:20,slow:100,rsiPeriod:14,buyLevel:30,sellLevel:65,period:20,multiplier:2,capital:10000,allocation:100,feeBps:1,slipBps:2,stopPct:0,targetPct:0};
  const workspaceKeys={
    settings:'market-lens-pro-settings',library:'market-lens-pro-pine-library-v1',
    draft:'market-lens-pro-pine-draft-v1',memory:'market-lens-pro-symbol-memory-v1',
    signals:'market-lens-pro-signal-history-v1',analysis:'market-lens-pro-analysis-v1',portfolio:'market-lens-pro-portfolio-v1'
  };
  let syncText='';
  const sharedSettings=({tab,apiBaseUrl,workspaceSections,...rest}={})=>rest;
  const workspaceLayout=readWorkspaceLayout(localStorage);
  let chartTools=readChartWorkspace(localStorage),refreshWorkspaceOverlays=null;
  // Visibility is browser-local, like other chart overlay visibility. Never
  // rewrite shared indicator settings merely to hide a median projection.
  const medianVisibilityKey='market-lens-pro-options-median-visibility-v1';
  let medianVisibility=null,syncMedianChart=null,viewMedianDots=null;
  try{const stored=localStorage.getItem(medianVisibilityKey);if(stored==='shown'||stored==='hidden')medianVisibility=stored;}catch{}
  function setMedianVisibility(value){
    medianVisibility=value;
    try{if(value===null)localStorage.removeItem(medianVisibilityKey);else localStorage.setItem(medianVisibilityKey,value);}catch{}
  }
  writeWorkspaceLayout(localStorage,workspaceLayout);
  const syncEnabled=localStorage.getItem('market-lens-sync-disabled')!=='1';
  const workspace=workspaceSync({
    endpoint:DEFAULT_ALPACA_WORKER+'/api/shared-workspace',enabled:syncEnabled,names:[...Object.keys(workspaceKeys),'imports','market'],
    backgroundDocuments:['market','settings','signals'],
    read:async name=>{
      if(name==='imports')return databaseRead('symbols');
      if(name==='market')return (await databaseRead('workspace','market'))?.value;
      const raw=localStorage.getItem(workspaceKeys[name]);
      if(raw===null)return undefined;
      const value=JSON.parse(raw);
      return name==='settings'?sharedSettings(value):value;
    },
    write:async (name,value)=>{
      if(name==='imports'){await replaceDatasets(value);return;}
      if(name==='market'){
        await storeMarket(value);
        if(workspaceReady&&!market.controller&&readMarketSnapshot(value))refreshScreenerResults();
        return;
      }
      if(name==='settings'){
        const prior=JSON.parse(localStorage.getItem(workspaceKeys.settings)||'{}');
        const {tab,apiBaseUrl}=prior;
        value={...sharedSettings(value),tab,apiBaseUrl};
        if(workspaceReady)receiveSharedSettings(prior,value);
      }
      if(name==='signals'&&workspaceReady)S.signalHistory=value||{};
      localStorage.setItem(workspaceKeys[name],JSON.stringify(value));
    },
    notify:(message,updated)=>{
      syncText=updated?'Workspace updates available on next open':message;
      const status=$('#workspace-sync-status');
      if(status)status.textContent=syncText;

    }
  });
  let lastSettingsSnapshot;
  const saveLocal=(name,value)=>{
    const key=workspaceKeys[name];
    const previous=localStorage.getItem(key);
    if(name==='settings'){
      const current=JSON.parse(value);
      if(lastSettingsSnapshot&&previous)
        value=JSON.stringify(mergeWorkspace(lastSettingsSnapshot,current,JSON.parse(previous)));
      lastSettingsSnapshot=current;
    }
    if(previous===value)return;
    localStorage.setItem(key,value);
    if(!workspaceReady)return;
    const prior=previous===null?undefined:JSON.parse(previous);
    if(name==='settings'){
      const before=sharedSettings(prior);
      if(JSON.stringify(before)===JSON.stringify(sharedSettings(JSON.parse(value))))return;
      workspace.changed(name,before);
    }else workspace.changed(name,prior);
  };
  let workspaceReady=false;
  await workspace.flush('startup');
  let saved={};try{saved=JSON.parse(localStorage.getItem('market-lens-pro-settings')||'{}')||{};}catch{}
  const startupPrefs=normalizeStartupPreferences(saved);
  if(optionsApprovalLink() !== null)startupPrefs.tab='options';
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
  const S={tab:startupPrefs.tab,mode:'live',preferredMode:'live',
    lastLiveSymbol:startupPrefs.lastLiveSymbol,
    lastBacktestSymbol:startupPrefs.lastBacktestSymbol,lastSymbol:startupPrefs.lastSymbol,
    apiBaseUrl:String(saved.apiBaseUrl||DEFAULT_ALPACA_WORKER),liveFeed:'iex',universeFilter:saved.universeFilter||'all',scan:{status:'idle'},data:new Map(),sources:new Map(),symbol:startupPrefs.selectedSymbol,query:saved.query||'',symbolQuery:'',watch:workspaceLists.watch,watchlists:workspaceLists.watchlists,
    watchlistId:workspaceLists.watchlistId,watchlistDraft:'',alertDraft:{symbol:startupPrefs.selectedSymbol,metric:'price',op:'>',threshold:100},
    alerts:Array.isArray(saved.alerts)?saved.alerts.slice(0,ALERT_LIMIT):[],alertHits:[],
    serverNotifications:[],serverScanStatus:'idle',serverScanLastRun:null,
    savedScans:Array.isArray(saved.savedScans)?saved.savedScans.slice(0,SCAN_LIMIT):[],
    scanDraft:'',savedScanId:saved.savedScanId||null,
    savedScanView:saved.viewingSavedScan&&Array.isArray(saved.savedScans)?saved.savedScans.find(scan=>scan.id===saved.savedScanId)||null:null,
    signalSelection:typeof saved.signalSelection==='string'?saved.signalSelection:'none',
    signalsOnly:!!saved.signalsOnly,signalRows:new Map(),signalErrors:[],
    signalHistory:priorSignalHistory,signalAsOf:null,freshness:null,staleDiagnostics:{},
    rules:saved.rules||preset.trend.map(x=>({...x})),sort:saved.sort||'symbol',ascending:saved.ascending!==false,showOnlyMatches:!!saved.showOnlyMatches,showWatch:!!saved.showWatch,chart:{...defaultSettings,...saved.chart},bt:{...defaultBacktest,...saved.bt},result:previousAnalysis?.result||null,sweep:previousAnalysis?.sweep||null,lastAnalysis:previousAnalysis,resultSymbol:previousAnalysis?.symbol||null,resultTf:previousAnalysis?.tf||null,
    portfolioMode:!!saved.portfolioMode,bestFitMode:!!saved.bestFitMode,bestFitValidatedOnly:!!saved.bestFitValidatedOnly,
    btRange:{startDate:String(saved.btRange?.startDate||''),endDate:String(saved.btRange?.endDate||'')},
    backtestError:'',portfolioScope:saved.portfolioScope==='watchlist'?'watchlist':'matches',
    portfolioWatchlistId:saved.portfolioWatchlistId||workspaceLists.watchlistId,
    portfolioResult:previousPortfolio?.result||null,portfolioSweep:previousPortfolio?.sweep||null,
    portfolioTimestamp:previousPortfolio?.savedAt||null,portfolioError:'',portfolioLoading:false,
    intraday:new Map(),intradayStatus:new Map(),intradayPromises:new Map(),intradayError:'',
    analysisLoading:'',analysisError:'',
    symbolMemory:previousSymbolMemory,leaderboard:null,leaderboardSort:'sharpe',leaderboardDescending:true,
    leaderboardValidatedOnly:!!saved.leaderboardValidatedOnly,leaderboardError:'',fitReport:null,fitValidatedReport:null,fitValidatedOnly:!!saved.fitValidatedOnly,fitSort:'sharpe',fitDescending:true,fitStatus:'',fitError:'',
    drawLine:false,
    chartFullscreen:false,pendingChartRange:null,fullscreenScrollY:0,chartHeight:Number.isFinite(saved.chartHeight)?Math.max(250,Math.min(1600,saved.chartHeight)):null,
    chartRecentSymbols:Array.isArray(saved.chartRecentSymbols)?saved.chartRecentSymbols.filter(s=>typeof s==='string').slice(0,6):[],
    chartRecentFrames:Array.isArray(saved.chartRecentFrames)?saved.chartRecentFrames.slice(0,3):[],
    hiddenScreenColumns:Array.isArray(saved.hiddenScreenColumns)?saved.hiddenScreenColumns.filter(i=>Number.isInteger(i)&&i>=2&&i<=13):[],
    backtestSections:saved.backtestSections||{},workspaceSections:workspaceLayout.open,chartViews:saved.chartViews||{},scanReview:null,
    variantBaseline:saved.variantBaseline?.options&&typeof saved.variantBaseline.symbol==='string'?saved.variantBaseline:null,
    variantComparison:null,
    scriptCode:typeof draft.code==='string'?draft.code:PINE_EXAMPLES[0].code,
    scriptName:typeof draft.name==='string'?draft.name:'EMA crossover',
    scriptId:draft.id||null,
    scriptSettings:draft.settings&&typeof draft.settings==='object'?draft.settings:{},
    scriptParsed:null,scriptError:'',scriptOutput:null,scriptLibrary,activeIndicators:Array.isArray(saved.activeIndicators)?saved.activeIndicators.slice(0,4):[],activeStrategy:null,
    backtestPineDraft:typeof saved.backtestPineDraft?.code==='string'?saved.backtestPineDraft:null};
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
  let chart=null,equityChart=null,leaderboardChart=null,tradeChart=null;
  let serverConfigSignature='',serverConfigRetryAfter=0;
  const serverScanEndpoint=path=>canonicalWorkerBase(S.apiBaseUrl).replace(/\/+$/,'')+'/api/server-scan'+path;
  const saveSettings=()=>{try{saveLocal('settings',JSON.stringify({mode:S.preferredMode==='live'?'live':S.mode,
    tab:S.tab,lastSymbol:S.symbol,lastBacktestSymbol:S.lastBacktestSymbol,
    lastLiveSymbol:S.lastLiveSymbol,watch:[...S.watch],watchlists:S.watchlists,watchlistId:S.watchlistId,alerts:S.alerts,savedScans:S.savedScans,rules:S.rules,chart:S.chart,bt:S.bt,portfolioMode:S.portfolioMode,bestFitMode:S.bestFitMode,bestFitValidatedOnly:S.bestFitValidatedOnly,btRange:S.btRange,portfolioScope:S.portfolioScope,portfolioWatchlistId:S.portfolioWatchlistId,signalSelection:S.signalSelection,signalsOnly:S.signalsOnly,
    leaderboardValidatedOnly:S.leaderboardValidatedOnly,fitValidatedOnly:S.fitValidatedOnly,apiBaseUrl:S.apiBaseUrl,universeFilter:S.universeFilter,
    chartHeight:S.chartHeight,chartRecentSymbols:S.chartRecentSymbols,chartRecentFrames:S.chartRecentFrames,hiddenScreenColumns:S.hiddenScreenColumns,variantBaseline:S.variantBaseline,backtestPineDraft:S.backtestPineDraft,
    activeIndicators:S.activeIndicators,chartViews:S.chartViews,backtestSections:S.backtestSections,query:S.query,sort:S.sort,ascending:S.ascending,showOnlyMatches:S.showOnlyMatches,showWatch:S.showWatch,marketShown:market.shown,savedScanId:S.savedScanId,viewingSavedScan:!!S.savedScanView}));}catch{};void syncServerScanConfig();};
  async function syncServerScanConfig(force=false){
    const config={rules:S.rules,universeFilter:S.universeFilter,feed:S.liveFeed||'iex'};
    const signature=JSON.stringify(config);
    if(!force&&signature===serverConfigSignature)return true;
    if(!force&&Date.now()<serverConfigRetryAfter)return false;
    try{
      const response=await fetch(serverScanEndpoint('/config'),{method:'PUT',
        headers:{'Content-Type':'application/json'},body:JSON.stringify(config),cache:'no-store'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(data.error||'Server scan settings could not be saved.');
      serverConfigSignature=signature;serverConfigRetryAfter=0;return true;
    }catch(error){
      serverConfigRetryAfter=Date.now()+60_000;
      return false;
    }
  }
  async function refreshServerNotifications(shouldRender=false){
    try{
      const before=JSON.stringify(S.serverNotifications);
      const response=await fetch(serverScanEndpoint('/notifications'),{cache:'no-store'});
      if(!response.ok)return;
      const data=await response.json();
      S.serverNotifications=Array.isArray(data.notifications)?data.notifications:[];
      S.serverScanLastRun=data.lastRun||null;
      if(shouldRender&&before!==JSON.stringify(S.serverNotifications))render();
    }catch{}
  }
  async function runServerScreener(){
    if(S.serverScanStatus==='loading')return;
    if(S.mode!=='live'){notice('Switch to Alpaca Live mode to run a server scan.');return;}
    S.serverScanStatus='loading';render();
    try{
      const config={rules:S.rules,universeFilter:S.universeFilter,feed:S.liveFeed||'iex'};
      const response=await fetch(serverScanEndpoint('/run'),{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify(config),cache:'no-store'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(data.error||'Server scan failed.');
      const sample=(data.matches||[]).slice(0,8).map(match=>match.symbol).join(', ');
      S.serverScanStatus='Server scan complete · '+data.requested+' checked · '+data.matchCount+
        ' matches · '+data.newMatchCount+' new alerts'+(sample?' · '+sample:'');
      await refreshServerNotifications(false);
      notice(data.newMatchCount?data.newMatchCount+' new server scan alert'+(data.newMatchCount===1?'':'s')+' created.':
        'Server scan complete: '+data.matchCount+' matches; no new alerts.');
    }catch(error){
      S.serverScanStatus='Server scan failed · '+error.message;
      notice(error.message);
    }
    render();
  }
  async function acknowledgeServerNotification(id){
    try{
      const response=await fetch(serverScanEndpoint('/notifications/ack'),{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({id}),cache:'no-store'});
      if(!response.ok)throw Error('Could not dismiss the server scan alert.');
      const data=await response.json().catch(()=>({}));
      S.serverNotifications=S.serverNotifications.map(alert=>alert.id===id?
        {...alert,readAt:data.readAt||new Date().toISOString(),unread:false}:alert);
      render();
    }catch(error){notice(error.message);}
  }
  function receiveSharedSettings(prior,value){
    if(JSON.stringify(prior.savedScans)!==JSON.stringify(value.savedScans)){
      S.savedScans=Array.isArray(value.savedScans)?value.savedScans.slice(0,SCAN_LIMIT):[];
      const picker=$('[data-option="saved-scan-select"]');
      if(picker){
        const selected=picker.value;
        const options=[['','Choose saved scan'],...S.savedScans.map(item=>[item.id,item.name+' · '+item.rows.length+' rows'])];
        picker.replaceChildren(...options.map(([id,label])=>new Option(label,id)));
        if(options.some(([id])=>id===selected))picker.value=selected;
      }
    }
    if(JSON.stringify(prior.chart)!==JSON.stringify(value.chart)){
      // The mounted chart keeps its own series and viewport. Load shared styling on the next chart mount.
      let next={...S.chart};
      for(const key of Object.keys(defaultSettings)){
        if(JSON.stringify(prior.chart?.[key])!==JSON.stringify(value.chart?.[key]))
          next[key]=value.chart?.[key]??defaultSettings[key];
      }
      S.chart=next;
    }
    if(JSON.stringify(prior.watchlists)!==JSON.stringify(value.watchlists)){
      const lists=restoreWatchlists({...value,watchlistId:S.watchlistId});
      Object.assign(S,{watch:lists.watch,watchlists:lists.watchlists,watchlistId:lists.watchlistId});
    }
    if(JSON.stringify(prior.alerts)!==JSON.stringify(value.alerts))
      S.alerts=Array.isArray(value.alerts)?value.alerts.slice(0,ALERT_LIMIT):[];
    refreshWorkspaceOverlays?.();
  }
  function rememberPortfolio(){
    S.portfolioTimestamp=new Date().toISOString();
    try{saveLocal('portfolio',JSON.stringify({
      version:1,result:S.portfolioResult,sweep:S.portfolioSweep,savedAt:S.portfolioTimestamp
    }));}catch{notice('Portfolio calculated, but browser storage could not retain the full result.');}
  }
  function persistSymbolState(symbol,changes){
    S.symbolMemory=updateSymbolMemory(S.symbolMemory,symbol,changes);
    try{saveLocal('memory',JSON.stringify(S.symbolMemory));}
    catch(err){notice('Per-symbol history is visible but could not be saved in browser storage. Older comparisons may need deleting.');}
  }
  function rememberLeaderboard(){
    if(S.leaderboard?.symbol===S.symbol)persistSymbolState(S.symbol,{leaderboard:compactLeaderboard(S.leaderboard)});
  }
  function restoreSymbolState(symbol){
    S.symbol=symbol;S.symbolQuery='';
    if(S.mode==='live'&&S.sources.get(symbol)==='ALPACA')S.lastLiveSymbol=symbol;
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
    try{saveLocal('analysis',JSON.stringify(S.lastAnalysis));}
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

  function persistSignalHistory(){
    try{
      const keys=Object.keys(S.signalHistory);
      if(keys.length>20)for(const oldKey of keys.slice(0,keys.length-20))delete S.signalHistory[oldKey];
      saveLocal('signals',JSON.stringify(S.signalHistory));
    }catch{notice('Signal history could not be saved locally. Flip detection may reset after reload.');}
  }
  function evaluateScreenerSignals(detectFlips=false){
    if(S.signalSelection==='none'){S.signalRows=new Map();S.signalErrors=[];
      return;}
    const selection=screenerStrategies().find(x=>x.id===S.signalSelection);
    if(!selection){
      S.signalSelection='none';S.signalRows=new Map();S.signalErrors=[];
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
  function modeSymbol(symbol){return ['ALPACA','IMPORTED'].includes(S.sources.get(symbol));}
  function persistPineDraft(){
    try{saveLocal('draft',JSON.stringify({code:S.scriptCode,name:S.scriptName,id:S.scriptId,settings:S.scriptSettings}));}
    catch{notice('Unable to save Script Lab draft in localStorage.');}
  }
  function persistPineLibrary(){
    try{saveLocal('library',JSON.stringify(S.scriptLibrary));}
    catch{notice('Unable to save scripts. Browser storage may be full.');}
  }
  function parseCurrentPine(){
    try{S.scriptParsed=compilePine(S.scriptCode);S.scriptError='';return S.scriptParsed;}
    catch(err){S.scriptParsed=null;S.scriptError=err.message;return null;}
  }
  function notice(message){document.querySelectorAll('.toast').forEach(x=>x.remove());const el=document.createElement('div');el.className='toast';el.textContent=message;document.body.append(el);setTimeout(()=>el.remove(),4500);}
  function openDb(){return new Promise((resolve,reject)=>{
    const req=indexedDB.open('market-lens-pro-datasets',3);
    req.onupgradeneeded=()=>{
      if(!req.result.objectStoreNames.contains('symbols'))req.result.createObjectStore('symbols',{keyPath:'symbol'});
      if(!req.result.objectStoreNames.contains('intraday'))req.result.createObjectStore('intraday',{keyPath:'key'});
      if(!req.result.objectStoreNames.contains('workspace'))req.result.createObjectStore('workspace',{keyPath:'key'});
    };
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });}
  async function databaseRead(store,key){
    const db=await openDb();
    try{
      const entries=db.transaction(store,'readonly').objectStore(store);
      const req=key===undefined?entries.getAll():entries.get(key);
      return await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    }finally{db.close();}
  }
  async function writeDatabase(store, write){
    const db=await openDb();
    try{
      const tx=db.transaction(store,'readwrite');
      write(tx.objectStore(store));
      await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
    }finally{db.close();}
  }
  function replaceDatasets(rows){
    return writeDatabase('symbols',store=>{store.clear();for(const row of rows)store.put(row);});
  }
  function storeMarket(value){
    return writeDatabase('workspace',store=>store.put({key:'market',value}));
  }
  async function checkpointMarket(){
    if(!market.id)return;
    const {checked,requested,next,session,id,rows}=market;
    try{
      await storeMarket({checked,requested,next,session,id,rows:[...rows.values()]});
      workspace.changed('market');
    }catch{notice('Could not save the full-market scan on this device.');}
  }
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
      if(S.data.has(startupPrefs.selectedSymbol))restoreSymbolState(startupPrefs.selectedSymbol);
      if(rows.length)render();
    }catch{notice('Local database unavailable. Imports still work until this tab closes.');}
  }
  async function storeDataset(symbol,bars){try{const previous=syncEnabled?await databaseRead('symbols'):undefined;const db=await openDb(),tx=db.transaction('symbols','readwrite');tx.objectStore('symbols').put({symbol,bars});await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});db.close();workspace.changed('imports',previous);}catch{notice('Import loaded, but this browser could not save it for future visits.');}}
  async function removeImports(){try{const db=await openDb(),tx=db.transaction('symbols','readwrite');tx.objectStore('symbols').clear();await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});db.close();workspace.changed('imports');}catch{}for(const [symbol,source] of S.sources)if(source==='IMPORTED'){S.sources.delete(symbol);S.data.delete(symbol);}if(!S.data.has(S.symbol))restoreSymbolState(S.data.has(S.lastLiveSymbol)?S.lastLiveSymbol:[...S.data.keys()][0]||S.lastLiveSymbol);S.result=null;S.sweep=null;render();}
  const intradayTf=isIntraday;
  const intradayKey=(symbol,tf=S.chart.tf)=>symbol+'|'+String(S.liveFeed||'iex')+(sourceResolution(tf)==='15Min'?'':'|'+sourceResolution(tf));
  const emptyHistory=[],importedIntraday=new WeakMap();
  const barsFor=(symbol,tf)=>{
    const daily=S.data.get(symbol)||emptyHistory;
    if(!intradayTf(tf))return aggregate(daily,tf);
    const source=S.sources.get(symbol);
    if(source!=='ALPACA'&&!importedIntraday.has(daily))
      importedIntraday.set(daily,daily.filter(b=>typeof b.time==='number'));
    const raw=source==='ALPACA'?S.intraday.get(intradayKey(symbol,tf))?.bars||emptyHistory:importedIntraday.get(daily);
    // Reject known coarser imported bars instead of relabeling them as finer candles.
    if(source!=='ALPACA'&&['1m','5m'].includes(tf)){
      const gap=raw.slice(1).reduce((min,b,i)=>Math.min(min,b.time-raw[i].time),Infinity);
      if(gap>INTRADAY_MINUTES[tf]*60)return [];
    }
    return aggregate(raw,tf);
  };
  const bars=()=>barsFor(S.symbol,S.chart.tf);
  const historyStart=Date.UTC(2016,0,1);
  const olderHistory=new Map();
  function liveChartHistory(){
    if(S.mode!=='live'||S.sources.get(S.symbol)!=='ALPACA')return null;
    const intraday=intradayTf(S.chart.tf);
    const raw=intraday?S.intraday.get(intradayKey(S.symbol))?.bars:S.data.get(S.symbol);
    if(!raw?.length)return null;
    const base=S.apiBaseUrl.replace(/\/$/,'');
    const resolution=intraday?sourceResolution(S.chart.tf):'1Day';
    const key=JSON.stringify([base,S.liveFeed,S.symbol,resolution]);
    return {base,key,raw,intraday,resolution,symbol:S.symbol,feed:S.liveFeed};
  }
  let combinedChartHistory;
  function chartBars(){
    const series=liveChartHistory();
    const older=series&&olderHistory.get(series.key)?.bars;
    if(!older?.length)return bars();
    if(combinedChartHistory?.older!==older||combinedChartHistory?.raw!==series.raw)
      combinedChartHistory={older,raw:series.raw,bars:normalizeBars([...older,...series.raw])};
    return aggregate(combinedChartHistory.bars,S.chart.tf);
  }
  function olderHistoryControl(){
    const series=liveChartHistory();
    if(!series)return '';
    const state=olderHistory.get(series.key);
    if(state?.status==='done')return '<span role="status">Earliest available history loaded</span>';
    const loading=state?.status==='loading';
    const label=loading?'Loading older bars…':state?.status==='error'?'Retry older bars':'Older bars';
    return '<button type="button" class="btn small" data-action="load-older-chart"'+
      (loading?' disabled':'')+'>'+label+'</button>'+
      (state?.message?'<span role="status">'+esc(state.message)+'</span>':'');
  }
  async function loadOlderChart(manual=false){
    const series=liveChartHistory();
    if(!series)return;
    const {base,key,raw,intraday,resolution,symbol,feed}=series;
    const prior=olderHistory.get(key)||{bars:[]};
    if(prior.status==='loading'||prior.status==='done'||(prior.status==='error'&&!manual))return;
    const refreshControl=()=>{
      const el=$('#older-history-control');
      if(el&&liveChartHistory()?.key===key)el.innerHTML=olderHistoryControl();
    };
    const end=Math.min(prior.before??Infinity,1000*stamp(raw[0].time))-1;
    if(end<historyStart){
      olderHistory.set(key,{...prior,status:'done',message:''});refreshControl();return;
    }
    const start=Math.max(historyStart,end-(intraday?resolutionDays(resolution):730)*86_400_000);
    olderHistory.set(key,{...prior,status:'loading',message:''});refreshControl();
    try{
      const params=new URLSearchParams({symbol,feed,timeframe:resolution,
        start:new Date(start).toISOString(),end:new Date(end).toISOString(),limit:'10000'});
      const pages=[];
      for(let page=0;;page++){
        const response=await fetch(base+'/api/stocks/bars?'+params,{headers:{Accept:'application/json'}});
        const payload=await response.json().catch(()=>null);
        if(!response.ok||!Array.isArray(payload?.bars))
          throw Error(payload?.detail||payload?.error||'Could not load older bars.');
        pages.push(...alpacaBars(payload.bars,params.get('timeframe')));
        if(!payload.next_page_token)break;
        if(page>=3)throw Error('Older bars exceeded the page limit.');
        params.set('page_token',payload.next_page_token);
      }
      const active=S.tab==='charts'&&liveChartHistory()?.key===key;
      const previous=active&&chart?chartBars():null;
      const range=previous?.length?chart.timeScale().getVisibleLogicalRange():null;
      const older=pages.filter(bar=>1000*stamp(bar.time)<=end);
      olderHistory.set(key,{bars:normalizeBars([...older,...prior.bars]),before:start,
        status:start===historyStart?'done':older.length?'ready':'error',
        message:older.length?'':'No candles in this window. Try the preceding window.'});
      if(active&&older.length){
        if(range){
          const anchor=Math.min(1,previous.length-1);
          const index=chartBars().findIndex(bar=>stamp(bar.time)===stamp(previous[anchor].time));
          const shift=index<0?0:index-anchor;
          S.pendingChartRange={from:range.from+shift,to:range.to+shift};
        }
        render();
      }else refreshControl();
    }catch(error){
      olderHistory.set(key,{...prior,status:'error',message:error.message});
      refreshControl();
    }
  }
  async function loadLiveIntraday(symbol,force=false,tf=S.chart.tf){
    if(S.mode!=='live'||S.sources.get(symbol)!=='ALPACA'||!intradayTf(tf))return null;
    const key=intradayKey(symbol,tf),feed=S.liveFeed,resolution=sourceResolution(tf);
    const isActive=()=>S.symbol===symbol&&intradayTf(S.chart.tf)&&intradayKey(symbol)===key;
    if(S.intradayPromises.has(key))return S.intradayPromises.get(key);
    const work=(async()=>{
      const current=S.intraday.get(key);
      if(!force&&intradayCacheFresh({...current,symbol,feed},{
        symbol,feed,expected:expectedNyseBarDate(),now:Date.now()}))return current;
      S.intradayStatus.set(key,{status:'loading'});
      if(isActive()&&['charts','backtest','optimize'].includes(S.tab))render();
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
        let payload,received;
        if(resolution==='15Min'){
          const response=await fetch(base+'/api/stocks/intraday?symbol='+encodeURIComponent(symbol)+
            '&feed='+encodeURIComponent(feed),{headers:{Accept:'application/json'}});
          payload=await response.json().catch(()=>({}));
          if(!response.ok)throw Error(payload.detail||payload.error||'Alpaca intraday request failed.');
          received=alpacaBars(payload.bars||[],resolution);
        }else{
          const end=new Date().toISOString(),start=new Date(Date.now()-resolutionDays(resolution)*86400000).toISOString();
          const params=new URLSearchParams({symbol,feed,timeframe:resolution,start,end,limit:'10000'});
          const pages=[];
          for(let n=0;;n++){
            const response=await fetch(base+'/api/stocks/bars?'+params,{headers:{Accept:'application/json'}});
            payload=await response.json().catch(()=>({}));
            if(!response.ok||!Array.isArray(payload.bars))throw Error(payload.detail||payload.error||'Alpaca intraday request failed.');
            if(payload.timeframe&&payload.timeframe!==resolution)throw Error('Provider returned a different candle interval.');
            pages.push(...alpacaBars(payload.bars,resolution));
            if(!payload.next_page_token)break;
            if(n>=3)throw Error('Intraday history exceeded the page limit.');
            params.set('page_token',payload.next_page_token);
          }
          received=normalizeBars(pages);
          payload={...payload,start,end};
        }
        if(!received.length)throw Error('Alpaca '+String(payload.feed||feed).toUpperCase()+
          ' returned no real '+resolution+' candles for '+symbol+'.');
        const record={symbol,bars:received,source:'ALPACA',feed:payload.feed||feed,
          fetchedAt:Date.now(),resolution,start:payload.start,end:payload.end};
        S.intraday.set(key,record);
        S.intradayStatus.set(key,{status:'ready',bars:received.length,cached:false});
        await persistIntraday(key,record);
        return record;
      }catch(err){
        S.intradayStatus.set(key,{status:'error',error:err.message});
        if(isActive())notice('Real Alpaca '+resolution+' bars unavailable: '+err.message);
        throw err;
      }finally{
        if(isActive()&&['charts','backtest','optimize'].includes(S.tab))render();
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
      S.analysisError=actionLabel+' requires genuine timestamped intraday OHLCV. Connect to Alpaca or import real intraday CSV.';
      notice(S.analysisError);render();return false;
    }
    if(decision==='fetch'){
      S.analysisLoading='Fetching Alpaca '+sourceResolution(S.chart.tf)+' bars…';
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

  const hasLiveData=()=>[...S.sources.values()].includes('ALPACA');
  const status=()=>S.sources.get(S.symbol)==='IMPORTED'?'IMPORTED OHLCV':
    S.scan.status==='loading'?'CONNECTING TO ALPACA':S.scan.status==='fallback'?(hasLiveData()?'ALPACA · PREVIOUS DATA':'ALPACA UNAVAILABLE'):
    hasLiveData()?'ALPACA LIVE · '+String(S.liveFeed||'iex').toUpperCase():'ALPACA · NO DATA';
  const isVisibleSymbol=symbol=>modeSymbol(symbol)&&(S.universeFilter!=='volatility'||VOLATILITY_UNIVERSE.includes(symbol));
  const medianUnmount=[];
  function destroyCharts(){refreshWorkspaceOverlays=null;syncMedianChart=null;viewMedianDots=null;for(const stop of medianUnmount.splice(0))stop();if(chart){chart.remove();chart=null;}if(equityChart){equityChart.remove();equityChart=null;}if(leaderboardChart){leaderboardChart.remove();leaderboardChart=null;}if(tradeChart){tradeChart.remove();tradeChart=null;}}
  function shell(){
    const links=keys=>keys.map(key=>'<button class="nav-btn '+(S.tab===key?'active':'')+'" data-tab="'+key+
      '"'+(S.tab===key?' aria-current="page"':'')+'><span class="nav-icon" aria-hidden="true">'+tabIcons[key]+'</span>'+tabNames[key]+'</button>').join('');
    const nav=mobile=>{
      const keys=Object.keys(tabNames);
      if(!mobile)return '<nav aria-label="Primary navigation" class="nav">'+links(keys)+'</nav>';
      const primary=['screener','charts','backtest'],extra=keys.filter(key=>!primary.includes(key));
      return '<nav aria-label="Mobile navigation" class="mobile-nav">'+links(primary)+
        '<details class="mobile-more"><summary class="nav-btn '+(extra.includes(S.tab)?'active':'')+
        '">More <span aria-hidden="true">⌄</span></summary><div class="mobile-more-links">'+links(extra)+'</div></details></nav>';
    };
    $('#app').innerHTML='<a href="#main" class="skip-link">Skip to workspace</a><div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-mark" aria-hidden="true">ML</div><div><strong>MARKET LENS</strong><small>PRO WORKSTATION</small></div></div><div><div class="nav-label">Workspace</div>'+nav()+'</div><div class="sidebar-bottom">DATA NOTICE<br/>Changes sync to the public site automatically. Anyone using the site can view and edit shared data.<p>No trades sent.</p></div></aside><div class="workspace"><header class="topbar"><div class="top-left"><strong>Market Lens Pro</strong><span class="workspace-label">/ Independent strategy laboratory</span></div><div class="top-actions"><span class="status"><span class="dot"></span>Alpaca data</span><span class="source-badge" role="status">'+status()+'</span>'+(!hasLiveData()&&S.scan.status==='fallback'?button('Retry data','mode-live','small'):'')+'<button class="btn" data-action="import">Import CSV</button></div></header>'+nav(true)+'<main id="main" class="main" tabindex="-1"></main></div></div><input id="csv-file" type="file" accept=".csv,text/csv" multiple hidden/>';
  }
  const head=(name,desc,tools='')=>'<div class="headrow"><div><div class="eyebrow">Market Lens / '+name+'</div><h1>'+name+'</h1><p class="subtle">'+desc+'</p></div><div class="flex">'+tools+'</div></div>';
  const button=(label,action,variant='')=>'<button type="button" class="btn '+variant+'" data-action="'+action+'">'+label+'</button>';
  const select=(items,value,attr)=>'<select '+attr+'>'+items.map(([v,t])=>'<option value="'+esc(v)+'"'+(v===value?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select>';
  const timeframes=CHART_FRAMES.map(([id,label])=>[id,label+(isIntraday(id)?' · genuine intraday OHLCV':' · daily OHLCV')]);
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
      '<div class="info-strip '+(S.intradayStatus.get(intradayKey(S.symbol))?.status==='error'?'warning':'')+'">Real '+esc(S.chart.tf)+' candles · '+esc(String(S.liveFeed).toUpperCase())+' Alpaca '+sourceResolution(S.chart.tf).replace('Min','-minute')+' trade-bar OHLCV'+
      (S.chart.tf==='2H'?' aggregated by NYSE 09:30–16:00 ET session buckets, including a partial final 30-minute bucket.':INTRADAY_MINUTES[S.chart.tf]>15?' aggregated by NYSE 09:30–16:00 ET session buckets; final bucket may be partial.':' (regular-session candles).')+
      ' · '+(S.intradayStatus.get(intradayKey(S.symbol))?.status==='error'?esc(S.intradayStatus.get(intradayKey(S.symbol)).error):
      S.intradayStatus.get(intradayKey(S.symbol))?.status==='loading'?'Fetching real intraday bars…':
      (S.intraday.get(intradayKey(S.symbol))?.bars.length??0)+' confirmed '+sourceResolution(S.chart.tf).replace('Min','-minute')+' bars')+'</div>':
      '<div class="info-strip warning">Intraday charts require genuine timestamped Alpaca or imported CSV bars.</div>'
  ):S.sources.get(S.symbol)==='ALPACA'?'<div class="info-strip">Alpaca market data · '+esc(String(S.liveFeed||'IEX').toUpperCase())+' feed · REST refresh on demand. This is not a tick-by-tick WebSocket stream.</div>':(S.data.get(S.symbol)||[]).some(b=>b.approximateOhlc)?'<div class="info-strip warning">The imported CSV has Close-only bars. Open/high/low are approximated. Stop, target, and next-open fills are unreliable until full OHLCV data is imported.</div>':'';
  const market={shown:false,controller:null,checked:0,requested:0,next:0,rows:new Map(),page:0,error:''};
  const marketPageSize=100;
  function readMarketSnapshot(value){
    if(!value?.id||!Array.isArray(value.rows))return false;
    if(market.session>value.session||market.session===value.session&&market.id===value.id&&market.next>=value.next)return false;
    const {checked,requested,next,session,id,rows}=value;
    Object.assign(market,{checked,requested,next,session,id,rows:new Map(rows.map(row=>[row.symbol,row]))});
    return true;
  }
  let liveScanPending, liveScanActive, deferredScreenerFocus;
  const mountedWorkspaceKeys=new Set();
  const workspaceActive=key=>S.tab===key||S.tab==='charts'&&mountedWorkspaceKeys.has(key);
  const persistWorkspaceLayout=()=>writeWorkspaceLayout(localStorage,workspaceLayout);
  function showWorkspace(key){
    if(S.tab==='charts'&&key!=='charts'&&Object.hasOwn(S.workspaceSections,key)){
      S.chartFullscreen=false;S.workspaceSections[key]=true;mountedWorkspaceKeys.add(key);persistWorkspaceLayout();
    }else S.tab=key;
  }
  const quickScreenerVisible=()=>S.tab==='screener'&&!marketShown()&&!S.savedScanView;
  function refreshScreenerResults(){
    if(!workspaceActive('screener'))return;
    const current=S.tab==='charts'?$('#chart-workspaces [data-workspace-section="screener"] .workspace-content'):$('#main');
    if(!current?.querySelector('.screener-results'))return;
    const active=document.activeElement;
    const template=document.createElement('template');
    template.innerHTML=screenerView(S.tab!=='charts');
    let deferred=false;
    for(const id of ['screener-intro','screener-facts','screener-metrics','screener-status',
      'screener-results-content','screener-refresh','screener-workspace']){
      const existing=current.querySelector('#'+id), next=template.content.querySelector('#'+id);
      if(!existing||!next||existing.innerHTML===next.innerHTML)continue;
      if(existing.contains(active)){deferred=true;continue;}
      const scroller=existing.querySelector('.table-wrap');
      const left=scroller?.scrollLeft;
      existing.replaceChildren(...next.childNodes);
      if(left)existing.querySelector('.table-wrap').scrollLeft=left;
    }
    if(deferred&&deferredScreenerFocus!==active){
      deferredScreenerFocus=active;
      active.addEventListener('blur',()=>{
        if(deferredScreenerFocus!==active)return;
        deferredScreenerFocus=null;queueMicrotask(refreshScreenerResults);
      },{once:true});
    }
  }
  const marketShown=()=>market.shown&&!S.savedScanView;
  const marketVisible=()=>[...market.rows.values()].filter(row=>
    S.universeFilter!=='volatility'||VOLATILITY_UNIVERSE.includes(row.symbol));
  const marketRules=row=>screenStats(tf=>row.frames[tf]||{},S.rules);
  function marketMessage(){
    if(market.error)return market.error;
    if(!market.requested)return market.controller?'Loading the U.S. listings directory…':'Scan paused.';
    return market.rows.size+' tickers with daily data · '+market.checked+' / '+market.requested+
      ' listings checked · '+(market.checked===market.requested?'complete':market.controller?'scanning':'paused');
  }
  async function scanUSMarket(){
    if(market.controller)return;
    clearSavedScanView();
    const controller=new AbortController();
    Object.assign(market,{shown:true,error:'',page:0,controller});
    render();
    try{
      await scanMarket(canonicalWorkerBase(S.apiBaseUrl),market,controller.signal,message=>{
        if(!message&&market.next%15===0)void checkpointMarket();
        const status=$('#market-scan-status');
        if(!status)return;
        status.textContent=message||marketMessage();
      });
    }catch(error){
      if(!controller.signal.aborted)market.error=error.message;
    }finally{
      market.controller=null;
      refreshScreenerResults();
      await checkpointMarket();
    }
  }
  function marketControls(){
    const scan=market.controller?button('Pause scan','market-pause','small'):
      button(market.requested&&market.next&&market.checked<market.requested?'Resume U.S. scan':'Scan all U.S. listings','market-scan','small primary');
    return scan+(marketShown()?button('Quick screener','market-close','small'):'');
  }
  function screenerRows(){
    if(S.savedScanView)return S.savedScanView.rows;
    const list=[];
    const full=marketShown();
    const candidates=full?marketVisible().map(row=>[row.symbol,row]):S.data;
    for(const [symbol,history] of candidates){
      if(!full&&!isVisibleSymbol(symbol))continue;
      const evalResult=full?marketRules(history):screenSymbol(history,S.rules);
      const d=full?history.frames.D:evalResult.stats,w=full?history.frames.W:statsFor(aggregate(history,'W'));
      const strategySignal=full?null:S.signalRows.get(symbol)||null;
      if(S.showOnlyMatches&&!evalResult.pass)continue;if(S.showWatch&&!S.watch.has(symbol))continue;
      if(!full&&S.signalsOnly&&S.signalSelection!=='none'&&strategySignal?.status!=='LONG')continue;
      if(S.query&&!symbol.toLowerCase().includes(S.query.toLowerCase()))continue;
      list.push({symbol,evalResult,d,w,source:full?'ALPACA':S.sources.get(symbol),
        latestBar:full?history.latestBar:history.at(-1)?.time||null,signal:strategySignal});}
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
    const serverUnread=S.serverNotifications.filter(alert=>!alert.readAt);
    const serverAlertsBanner=serverUnread.length?'<div class="alert-banner server-alert-banner" role="alert"><strong>'+
      serverUnread.length+' server scan notification'+(serverUnread.length===1?'':'s')+'</strong>'+
      serverUnread.map(alert=>'<div>Server scan · '+alert.matchCount+' new match'+(alert.matchCount===1?'':'es')+
        ': '+esc(alert.symbols.slice(0,8).join(', '))+(alert.symbols.length>8?' +' +(alert.symbols.length-8)+' more':'')+
        (alert.barDate?' · bar '+esc(alert.barDate):'')+' '+
        button('Dismiss server alert','server-alert-ack','small').replace('data-action="server-alert-ack"','data-action="server-alert-ack" data-alert-id="'+esc(alert.id)+'"')+
        '</div>').join('')+'</div>':'';
    return alertsBanner+serverAlertsBanner;
  }
  function activeSnapshotBanner(){
    const loaded=S.savedScanView;
    const snapshotNote=loaded?'<div class="info-strip warning" role="status">Showing saved scan snapshot: '+esc(loaded.name)+' from '+esc(loaded.savedAt)+' ('+esc(loaded.source)+'). These are archived values, not live quotes. Select Scan/Refresh to replace the snapshot.</div>':'';
    return snapshotNote;
  }
  const screenMetrics={price:'Close',rsi:'RSI',emaDist:'vs. EMA200',ret20:'20-bar return',
    drawdown:'Drawdown',atrPct:'ATR',volume:'Volume'};
  const screenFrames={D:'Daily',W:'Weekly',M:'Monthly'};
  function screenRuleValues(result){
    if(!result.checks)return '<p>This saved scan has no recorded rule readings.</p>'+
      (result.fails?.length?'<p>'+esc(result.fails.join(' · '))+'</p>':'');
    if(!result.checks.length)return '<p>No active screen rules.</p>';
    return '<ul class="scan-rule-values">'+result.checks.map(({tf,metric,op,threshold,value,pass})=>{
      const unit=['emaDist','ret20','drawdown','atrPct'].includes(metric)?'%':'';
      const precise=Math.abs(value-threshold)<.01&&value!==threshold;
      const num=n=>Number.isFinite(n)?(precise?String(n):n.toLocaleString('en-US',{maximumFractionDigits:2}))+unit:'—';
      return '<li><span>'+esc((screenFrames[tf]||tf)+' '+(screenMetrics[metric]||metric))+'</span><strong>'+
        (Number.isFinite(value)?esc(num(value)+' '+op+' '+num(threshold)):'Unavailable')+'</strong><span class="'+
        (pass?'positive':'negative')+'">'+(pass?'Pass':'Fail')+'</span></li>';
    }).join('')+'</ul>';
  }
  function reviewableMatches(rows){
    return rows.filter(row=>row.evalResult.pass&&(marketShown()||row.source==='ALPACA'&&!!S.savedScanView||S.data.has(row.symbol)&&modeSymbol(row.symbol)));
  }
  let chartSelection=0;
  async function openScannedChart(symbol){
    const rows=reviewableMatches(screenerRows());
    const target=symbol||rows[0]?.symbol;
    if(!target)return;
    const dialog=$('#screener-dialog');
    if(dialog?.open)dialog.close();
    const full=marketShown()||S.savedScanView?.rows.some(row=>row.symbol===target&&row.source==='ALPACA');
    if(full&&!await loadMarketChart(target))return;
    S.scanReview={rows,mode:S.mode,embedded:S.tab==='charts',market:full,snapshot:S.savedScanView?.savedAt,scrollY:window.scrollY,
      scrollLeft:$('.screener-results')?.parentElement.scrollLeft||0};
    restoreSymbolState(target);S.tab='charts';render();
    window.scrollTo(0,0);
  }
  async function loadMarketChart(symbol){
    const selection=++chartSelection;
    if(S.sources.get(symbol)!=='ALPACA'){
      notice('Loading daily bars for '+symbol+'…');
      try{
        const url=new URL('/api/stocks/bars',canonicalWorkerBase(S.apiBaseUrl));
        url.searchParams.set('symbol',symbol);
        const response=await fetch(url);
        const payload=await response.json();
        const history=alpacaBars(payload.bars,'1Day');
        if(!response.ok||!history.length)throw new Error(payload.error||'No daily bars returned.');
        S.data.set(symbol,history);S.sources.set(symbol,'ALPACA');
      }catch(error){
        if(selection===chartSelection)notice('Could not open '+symbol+': '+error.message);
        return false;
      }
    }
    if(selection!==chartSelection)return false;
    S.mode='live';S.preferredMode='live';
    return true;
  }
  function returnToScreener(){
    const review=S.scanReview?.mode===S.mode?S.scanReview:null;
    S.scanReview=null;S.chartFullscreen=false;if(review?.embedded)showWorkspace('screener');else S.tab='screener';render();
    if(review){
      $('.screener-results').parentElement.scrollLeft=review.scrollLeft;
      window.scrollTo(0,review.scrollY);
    }
  }
  function scanReviewControls(){
    const review=S.scanReview;
    if(review?.mode!==S.mode)return '';
    const index=review.rows.findIndex(row=>row.symbol===S.symbol);
    const nav=(label,direction,disabled)=>'<button type="button" class="btn small" data-action="review-step" data-step="'+
      direction+'"'+(disabled?' disabled':'')+'>'+label+'</button>';
    return '<div class="match-review" aria-label="Screener review">'+
      button('Screener','return-screener','small')+(index<0?'':nav('Previous',-1,index===0)+
      '<span role="status">'+(index+1)+' / '+review.rows.length+'</span>'+
      nav('Next match',1,index===review.rows.length-1)+button('Rules','review-rules','small'))+'</div>';
  }
  async function stepScanReview(direction){
    const review=S.scanReview;
    if(review?.mode!==S.mode)return;
    const index=review.rows.findIndex(row=>row.symbol===S.symbol);
    const target=review.rows[index+direction];
    if(index<0||!target)return;
    if(review.market&&target.source==='ALPACA'){if(!await loadMarketChart(target.symbol))return;}
    else if(!S.data.has(target.symbol)||!modeSymbol(target.symbol))return;
    const tf=S.chart.tf;
    restoreSymbolState(target.symbol);S.chart.tf=tf;render();
    const buttons=[...document.querySelectorAll('[data-action="review-step"]')];
    (buttons.find(btn=>Number(btn.dataset.step)===direction&&!btn.disabled)||
      buttons.find(btn=>!btn.disabled))?.focus({preventScroll:true});
  }
  function showReviewRules(){
    const review=S.scanReview,row=review?.rows.find(item=>item.symbol===S.symbol);
    const dialog=$('#scan-rules-dialog');
    if(!row||!dialog)return;
    dialog.innerHTML=dialogHeader(row.symbol+' scan rules','scan-rules-title')+
      '<div class="screener-detail"><p>'+esc(review.snapshot?'Saved scan · '+review.snapshot:
        'Screener readings'+(row.latestBar?' · bars through '+dateLabel(row.latestBar):''))+
      '</p>'+screenRuleValues(row.evalResult)+'</div>';
    dialog.showModal();
  }
  const screenColumns=['Close','RSI D','RSI W','RSI 5D','% vs D EMA200','20D return','Drawdown','Bars','Result','Latest bar','% vs W EMA200','Strategy signal'];
  function openScreenerDialog(symbol){
    const dialog=$('#screener-dialog');
    if(!symbol){
      dialog.innerHTML=dialogHeader('Screener columns','screener-dialog-title')+
        '<div class="screener-column-options">'+screenColumns.map((label,i)=>
        '<label><input type="checkbox" data-screen-column="'+(i+2)+'" '+(S.hiddenScreenColumns.includes(i+2)?'':'checked')+
        '/> '+label+'</label>').join('')+'</div>';
    }else{
      const row=screenerRows().find(r=>r.symbol===symbol);
      if(!row)return;
      const {d,w,signal}=row;
      const distance=(price,average)=>Number.isFinite(price)&&Number.isFinite(average)&&average!==0?pct(100*(price/average-1)):'—';
      const values=[format(d.price),format(d.rsi,1),format(w?.rsi,1),format(d.rsi5,1),
        distance(d.price,d.ema200),pct(d.ret20),pct(d.drawdown),String(d.bars),
        row.evalResult.pass?'Match':'No match',row.latestBar||'—',distance(w?.price,w?.ema200),
        [signal?.status||'—',signal?.barDate].filter(Boolean).join(' · ')];
      dialog.innerHTML=dialogHeader(symbol,'screener-dialog-title')+
        '<div class="screener-detail"><p>'+esc(row.source||'Unknown source')+'</p>'+staleNote(symbol)+
        '<dl>'+screenColumns.map((label,i)=>'<div><dt>'+label+'</dt><dd>'+esc(values[i])+'</dd></div>').join('')+'</dl>'+
        screenRuleValues(row.evalResult)+
        '<button type="button" class="btn primary small" data-action="screener-chart" data-symbol="'+esc(symbol)+'">Open chart</button></div>';
    }
    dialog.showModal();
  }
  function openScreenerRow(row){
    if(matchMedia('(max-width: 800px)').matches)openScreenerDialog(row.dataset.symbol);
    else openScannedChart(row.dataset.symbol);
  }
  function screenerView(includeWorkspace=true){
    const full=marketShown();
    const symbols=full?marketVisible():[...S.data.keys()].filter(isVisibleSymbol);
    const all=full?symbols.map(marketRules):symbols.map(symbol=>screenSymbol(S.data.get(symbol),S.rules));
    const rows=screenerRows();
    const pages=Math.max(1,Math.ceil(rows.length/marketPageSize));
    market.page=Math.min(market.page,pages-1);
    const start=market.page*marketPageSize;
    const pageRows=full?rows.slice(start,start+marketPageSize):rows;
    const pagination=full&&pages>1?'<div class="flex panel-body">'+
      (market.page?button('Previous page','market-previous','small'):'')+
      '<span>Page '+(market.page+1)+' of '+pages+'</span>'+
      (market.page<pages-1?button('Next page','market-next','small'):'')+'</div>':'';
    const matched=S.savedScanView?rows.filter(x=>x.evalResult.pass).length:all.filter(x=>x.pass).length;
    const presetKey=Object.entries(preset).find(([key,r])=>JSON.stringify(r)===JSON.stringify(S.rules)&&(key!=='volatility'||S.universeFilter==='volatility'))?.[0]||'custom';
    const rules=S.rules.map((r,i)=>'<div class="rule"><span class="visually-hidden" id="rule-label-'+i+'">Filter condition '+(i+1)+'</span>'+select([['D','D'],['W','W'],['M','M'],['2H','2H']],r.tf,'aria-label="Filter '+(i+1)+' timeframe" data-rule="'+i+'" data-key="tf"')+select([['rsi','RSI'],['emaDist','% vs EMA200'],['ret20','20-bar %'],['drawdown','Drawdown %'],['atrPct','ATR %'],['price','Price'],['volume','Volume']],r.metric,'aria-label="Filter '+(i+1)+' indicator" data-rule="'+i+'" data-key="metric"')+select([['<','<'],['<=','≤'],['>','>'],['>=','≥']],r.op,'aria-label="Filter '+(i+1)+' comparison" data-rule="'+i+'" data-key="op"')+'<input aria-label="Filter threshold '+(i+1)+'" type="number" step="any" data-rule="'+i+'" data-key="value" value="'+esc(r.value)+'"/><button data-action="remove-rule" data-index="'+i+'" aria-label="Remove filter">×</button></div>').join('');
    const table=pageRows.map(r=>{const dd=r.d.ema200==null?null:(r.d.price/r.d.ema200-1)*100;
      const wd=r.w?.ema200==null||r.w?.price==null?null:(r.w.price/r.w.ema200-1)*100;
      return '<tr tabindex="0" role="button" aria-label="View '+esc(r.symbol)+'" class="'+(r.symbol===S.symbol?'chosen':'')+'" data-symbol="'+esc(r.symbol)+'"><td><button class="star '+(S.watch.has(r.symbol)?'on':'')+'" data-action="watch" data-symbol="'+esc(r.symbol)+'" aria-label="Toggle watchlist">'+(S.watch.has(r.symbol)?'★':'☆')+'</button><span class="table-table-label">'+esc(r.symbol)+'</span> <span class="muted">'+(r.source==='ALPACA'?'LIVE':r.source==='SIMULATED'?'DEMO':'CSV')+'</span></td><td>'+format(r.d.price)+'</td><td>'+format(r.d.rsi,1)+'</td><td>'+format(r.w.rsi,1)+'</td><td>'+format(r.d.rsi5,1)+'</td><td class="'+priceColor(dd)+'">'+pct(dd)+'</td><td class="'+priceColor(r.d.ret20)+'">'+pct(r.d.ret20)+'</td><td class="'+priceColor(r.d.drawdown)+'">'+pct(r.d.drawdown)+'</td><td>'+esc(r.d.bars)+'</td><td><span class="pill '+(r.evalResult.pass?'':'dim')+'" title="'+esc(r.evalResult.fails.join('; '))+'">'+(r.evalResult.pass?'MATCH':'NO MATCH')+'</span></td>'+
        '<td class="fresh-date">'+esc(r.latestBar||'—')+staleNote(r.symbol)+'</td>'+
        '<td class="'+priceColor(wd)+'" data-weekly-ema200="'+esc(r.symbol)+'">'+pct(wd)+'</td>'+
        '<td><span class="signal-status '+(r.signal?.status==='LONG'?'signal-long':r.signal?.status==='EXIT'?'signal-exit':'signal-flat')+
        '" title="'+esc((r.signal?.reason||r.signal?.exitReason||'')+' · '+(r.signal?.source||r.source||'unknown'))+
        '">'+esc(r.signal?.status||'—')+'</span><small class="signal-date">'+esc(r.signal?.barDate||'')+'</small></td></tr>';
    }).join('');
    const scanStatus=S.scan.status==='loading'?'<div id="scan-status" class="info-strip">Scanning '+('the Alpaca market universe')+'…</div>':S.scan.status==='complete'?'<div id="scan-status" class="info-strip" data-scan-source="'+esc(S.scan.source||'ALPACA')+'">'+'Live'+' scan complete · '+S.scan.returned+'/'+S.scan.requested+' symbols loaded · '+S.scan.matched+' '+(S.scan.matched===1?'match':'matches')+(S.scan.missing?.length?' · '+S.scan.missing.length+' symbols returned no bars':'')+(S.scan.cached?' · served from 15-minute cache':'')+'</div>':S.scan.status==='fallback'?'<div id="scan-status" class="info-strip warning" data-scan-source="'+esc(S.scan.source||'ALPACA')+'">'+(hasLiveData()?'Live scan failed; showing the previous data. ':'Live data unavailable; retry the scan. ')+esc(S.scan.error||'Unknown error')+'</div>':'';
    const freshness=!full&&S.mode==='live'&&S.scan.status==='complete'?S.freshness:null;
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
    const factSymbol='VXX';
    const factBar=(S.sources.get('VXX')==='ALPACA')?S.data.get(factSymbol)?.at(-1):null;
    const factLabel='ALPACA VXX DAILY CLOSE';
    const serverScanStatus=S.serverScanStatus==='idle'?'':'<p id="server-scan-status" class="info-strip" role="status">'+
      esc(S.serverScanStatus==='loading'?'Running server-side screener…':S.serverScanStatus)+'</p>';
    const fact=factBar?'<div class="market-fact" role="status"><span class="market-fact-label">'+factLabel+'</span><strong>'+esc(factSymbol)+' &nbsp; $'+format(factBar.close)+'</strong><small>Bar date: '+esc(String(factBar.time))+(S.mode==='live'?' · '+esc(String(S.liveFeed).toUpperCase())+' feed · Alpaca daily close, not a last-trade quote':' · simulated, not a market quote')+'</small></div>':S.mode==='live'?'<div class="market-fact warning" role="status">Alpaca VXX daily close unavailable — VXX was not returned by the connected feed.</div>':'';
    return '<div id="screener-intro">'+head('Screener',full?'U.S. exchange listings · Alpaca daily, weekly and monthly filters.':'Filter '+symbols.length+' '+('Alpaca or imported instruments')+' with explicit technical conditions.',marketControls()+(!full&&S.mode==='live'?button(S.serverScanStatus==='loading'?'Server scanning…':'Run server scan','server-scan','small'):'')+button('Open Chart Lab','view-charts','small')+
        (reviewableMatches(rows).length?button('Review matches','screener-chart','primary'):''))+'</div>'+
      '<div id="screener-facts">'+(full?'':fact)+activeAlertBanner()+activeSnapshotBanner()+'</div>'+
      '<div id="screener-metrics" class="metrics">'+metric(S.savedScanView?'Saved rows':'Symbols loaded',S.savedScanView?rows.length:all.length,S.savedScanView?'Historical snapshot':'Alpaca and imported data')+metric('Matching filters',matched,'All visible symbols')+metric('Visible results',rows.length,'Search and match filter')+metric('Active conditions',S.rules.length,'AND logic; all must pass') +'</div><div id="screener-status">'+(full?'<p id="market-scan-status" class="info-strip" role="status">'+esc(marketMessage())+'</p><p class="section-note">Covers active U.S. exchange listings in Alpaca’s directory. Thinly traded tickers may have older or missing bars. Two-hour filters and strategy signals are available in the quick screener.</p>':scanStatus)+freshnessBadge+serverScanStatus+'</div>'+
      '<div class="panel"><div class="panel-header"><h2>Screen rules</h2><div class="flex"><label class="control">Preset '+select([['custom','Custom rules'],['trend','Trend pullback'],['original','Original strict W/D/2H'],['oversold','RSI oversold'],['momentum','Momentum'],['volatility','VXX / Volatility'],['all','Show all']],presetKey,'data-option="preset"')+'</label>'+button('+ Add rule','add-rule')+'</div></div><div class="panel-body"><div class="filters">'+(rules||'<span class="muted">No filters — showing all instruments.</span>')+'</div><div class="section-note" style="margin-top:12px">“Original strict” reproduces the weekly EMA200 and weekly/daily/two-hour RSI filter logic. RSI 5D is calculated from daily closes; daily bars cannot reconstruct true two-hour data. The VXX / Volatility preset narrows the universe to VXX, UVXY, SVXY, VIXY, VIXM, VXZ, SVIX, UVIX, SVOL and ZVOL, using daily RSI, 252-session drawdown and % versus daily EMA200.</div></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Market results</h2><div class="flex"><span id="screener-refresh">'+(full?'':button(S.scan.status==='loading'?'Scanning…':'Refresh live scan','scan-universe','small primary'))+'</span>'+button('Export screener CSV','export-screener','small')+button('Columns','screener-columns','small')+
      (full?'':'<label class="control">Strategy '+selectStrategy+'</label>'+
      '<label class="inline-check"><input type="checkbox" data-option="signals-only" '+(S.signalsOnly?'checked':'')+' '+(S.signalSelection==='none'?'disabled':'')+'/>Signals only (LONG)</label>')+
      '<input class="textinput" aria-label="Search symbols" data-input="search" placeholder="Search symbol…" value="'+esc(S.query)+'"/><label class="inline-check"><input type="checkbox" data-option="matches" '+(S.showOnlyMatches?'checked':'')+'/>Matches only</label><label class="inline-check"><input type="checkbox" data-option="watchonly" '+(S.showWatch?'checked':'')+'/>Watchlist</label><label class="control">Sort '+select([['symbol','Symbol'],['price','Price'],['rsi','RSI'],['ret20','20D return'],['ema','Daily % EMA'],['drawdown','Drawdown'],['signal','Strategy signal'],['latest','Latest bar']],S.sort,'data-option="sort"')+'</label>'+button(S.ascending?'↑':'↓','sort-order','small')+'</div></div><div id="screener-results-content"><div class="table-wrap"><table class="data-table screener-results" data-hidden-columns="'+S.hiddenScreenColumns.join(' ')+'"><thead><tr><th scope="col">Symbol</th><th>Close</th><th>RSI D</th><th>RSI W</th><th title="5-period RSI calculated from daily closes; daily OHLC cannot reconstruct true 2-hour bars">RSI 5D</th><th title="Price as percentage difference from 200-period EMA of DAILY closes">% vs D EMA200</th><th>20D return</th><th>DD</th><th>Bars</th><th>Result</th><th>Latest bar</th><th title="Percentage difference from the 200-period EMA of WEEKLY closes; needs 200 real weekly bars">% vs W EMA200</th><th title="Current position based on completed daily bars and next-open fills. EXIT can mean closed this bar or pending exit. Not a live order.">Signal · '+esc(selectedStrategy?.name||'None')+'</th></tr></thead><tbody>'+table+'</tbody></table>'+(rows.length?'':'<div class="empty">No matching symbols. Change a filter or import more price history.</div>')+'</div>'+pagination+'</div>'+
      (full?'':'<p class="section-note">Signal: LONG = strategy currently holds a long at the latest bar close; EXIT = it closed on that bar or has a close order for next open; FLAT = no long. Signals use the same stop/fee/slippage and next-open rules as Backtest, long-side only. Bars and dates are from '+('Alpaca '+esc(String(S.liveFeed).toUpperCase())+' or imported CSV')+'. '+
      (S.signalErrors.length?S.signalErrors.length+' unavailable signals: '+esc(S.signalErrors.slice(0,6).map(e=>e.symbol+': '+e.reason).join('; '))+'.':'No live trades or background monitoring.')+
      '</p>')+'</div><dialog id="screener-dialog" class="chart-dialog" aria-labelledby="screener-dialog-title"></dialog>'+(includeWorkspace?'<div id="screener-workspace">'+workspaceControls()+'</div>':'');
  }
  function workspaceControls(collapsible=false){
    const current=S.watchlists.find(x=>x.id===S.watchlistId)||S.watchlists[0];
    const listOptions=S.watchlists.map(x=>[x.id,x.name+' ('+x.symbols.length+')']);
    const alertSymbols=[...S.data.keys()].filter(modeSymbol).sort();
    const alertSymbol=alertSymbols.includes(S.alertDraft.symbol)?S.alertDraft.symbol:alertSymbols[0]||'';
    const alertRows=S.alerts.length?S.alerts.map(a=>'<div class="data-item"><span>'+(a.type==='signal'?
        esc(a.strategyName||'Strategy')+' · '+esc(a.symbol)+' '+esc(a.oldValue)+' → '+esc(a.newValue):
        esc(a.symbol)+' '+esc(a.metric.toUpperCase())+' '+(a.op==='>'?'above':'below')+' '+format(a.threshold,2))+
        ' <small>'+(a.type==='signal'?'At '+esc(a.lastHitBarDate||''):a.active?'Condition met':'Not triggered')+
        '</small></span>'+button('Remove alert','alert-delete','small').replace('data-action="alert-delete"','data-action="alert-delete" data-alert-id="'+esc(a.id)+'"')+'</div>').join(''):'<p class="section-note">No local alerts. They check only when you scan or refresh while this page is running.</p>';
    const serverAlertRows=S.serverNotifications.length?S.serverNotifications.map(alert=>'<div class="data-item"><span>Server scan · '+
      alert.matchCount+' new match'+(alert.matchCount===1?'':'es')+' · '+esc(alert.symbols.slice(0,8).join(', '))+
      (alert.symbols.length>8?' +'+(alert.symbols.length-8)+' more':'')+
      ' <small>'+esc(alert.createdAt)+' · '+(alert.readAt?'Read':'Unread')+'</small></span>'+
      (alert.readAt?'':button('Dismiss server alert','server-alert-ack','small').replace('data-action="server-alert-ack"','data-action="server-alert-ack" data-alert-id="'+esc(alert.id)+'"'))+
      '</div>').join(''):'<p class="section-note">No server scan notifications yet. Scheduled scans run weekdays at 23:00 UTC.</p>';
    const savedChoices=S.savedScans.map(x=>[x.id,x.name+' · '+x.rows.length+' rows']);
    const section=(key,title,note)=>collapsible?
      workspaceStart(key,title)+'<div class="panel-body"><p class="section-note">'+note+'</p>':
      '<div class="panel"><div class="panel-header"><h2>'+title+'</h2><span class="muted">'+note+'</span></div><div class="panel-body">';
    const end=collapsible?'</div></details>':'</div></div>';
    return ''+
      section('watchlists','Named watchlists','Stars add symbols to the selected list')+'<div class="workspace-actions">'+
        '<label class="control">Current list '+select(listOptions,S.watchlistId,'data-option="watchlist-select"')+'</label>'+
        '<label class="control">Watchlist name <input class="textinput" data-input="watchlist-name" value="'+esc(S.watchlistDraft)+'" placeholder="e.g. Volatility setups"/></label>'+
        button('Create watchlist','watchlist-create','small')+button('Rename watchlist','watchlist-rename','small')+button('Delete watchlist','watchlist-delete','small')+
        '</div><p class="section-note">Selected: '+esc(current.name)+' · '+current.symbols.length+' symbols. Use the star in the screener to add or remove a symbol.</p>'+end+
      section('scans','Saved scans','Rules and a dated snapshot of the filtered table')+'<div class="workspace-actions">'+
        '<label class="control">Scan name <input class="textinput" data-input="scan-name" value="'+esc(S.scanDraft)+'" placeholder="e.g. VXX oversold"/></label>'+
        button('Save scan','save-scan','primary')+
        '<label class="control">Saved scan '+select([['','Choose saved scan'],...savedChoices],S.savedScanId||'','data-option="saved-scan-select"')+'</label>'+
        button('Load saved scan','load-scan','small')+button('Delete saved scan','delete-scan','small')+'</div>'+
        '<p class="section-note">Snapshots preserve displayed rows and filter conditions. Historical prices are not automatically refreshed when loaded.</p>'+end+
      section('alerts','In-app alerts','Local alerts check on refresh · server scan weekdays 23:00 UTC')+'<div class="workspace-actions">'+
        '<label class="control">Symbol '+select(alertSymbols.map(sym=>[sym,sym]),alertSymbol,'data-alert-field="symbol"')+'</label>'+
        '<label class="control">Indicator '+select([['price','Daily close'],['rsi','Daily RSI(14)']],S.alertDraft.metric,'data-alert-field="metric"')+'</label>'+
        '<label class="control">Condition '+select([['>','Above'],['<','Below']],S.alertDraft.op,'data-alert-field="op"')+'</label>'+
        '<label class="control">Level <input type="number" class="textinput" data-alert-field="threshold" value="'+esc(S.alertDraft.threshold)+'" step="any"/></label>'+
        button('Add alert','alert-create','small primary')+
        '</div><div class="data-list">'+alertRows+'</div><h3>Server scan notifications</h3><div class="data-list">'+serverAlertRows+'</div>'+end;
  }
  function preserveChartViewport(){
    try{S.pendingChartRange=chart?.timeScale().getVisibleLogicalRange()||null;}
    catch{S.pendingChartRange=null;}
  }
  function setChartFullscreen(enabled){
    if(S.tab!=='charts')return;
    preserveChartViewport();
    const next=nextFullscreenState(S.chartFullscreen,enabled);
    if(next&&!S.chartFullscreen)S.fullscreenScrollY=window.scrollY;
    S.chartFullscreen=next;
    render();
    if(!next){
      window.scrollTo(0,S.fullscreenScrollY);
      $('[data-action="chart-fullscreen"]')?.focus({preventScroll:true});
    }else $('[data-action="chart-exit-fullscreen"]')?.focus({preventScroll:true});
  }
  const chartIcon=path=>'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg>';
  const gearIcon=chartIcon('<circle cx="12" cy="12" r="3"/><path d="M9 3h6l.6 3 2.6 1.5 2.8-1 3 5-2.2 2.1v3L24 19l-3 5-2.8-1-2.6 1.5-.6 3H9l-.6-3-2.6-1.5-2.8 1-3-5 2.2-2.4v-3L0 11.5l3-5 2.8 1L8.4 6z" transform="translate(2 0) scale(.83)"/>');
  const closeIcon=chartIcon('<path d="m6 6 12 12M6 18 18 6"/>');
  const dialogHeader=(title,id)=>'<div class="chart-dialog-header"><h2 id="'+id+'">'+esc(title)+'</h2>'+
    '<button type="button" class="chart-icon" data-action="close-dialog" aria-label="Close">'+closeIcon+'</button></div>';
  const indicatorColors={ema20:'#e9bd68',ema50:'#71b8b3',ema200:'#d69c65',sma20:'#f7a75c',
    bollinger:'#8fa9c7',volume:'#76b2a1',rsi:'#d69c65',macd:'#71b8b3'};
  const volumeFormat=new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1});
  function indicatorValue(key,value,details=[]){
    if(key==='volume'&&Number.isFinite(value))return volumeFormat.format(value);
    if(key==='macd'&&Number.isFinite(details[0]))return format(value)+' / '+format(details[0]);
    if(key==='bollinger'&&details.every(Number.isFinite)&&details.length)return format(details[0])+' / '+format(value)+' / '+format(details[1]);
    return format(value);
  }
  const movingAverageLabel=average=>average.type.toUpperCase()+' '+average.length;
  const isAveragePreset=key=>key.startsWith('ema')||key.startsWith('sma');
  const repeatableIndicators=[...INDICATOR_ORDER.filter(key=>!isAveragePreset(key)),'optionsMedian','optionsProbability'];
  const isOptionProjection=type=>type==='optionsMedian'||type==='optionsProbability';
  const indicatorCopies=()=>Array.isArray(S.chart.indicatorCopies)?S.chart.indicatorCopies.filter(copy=>
    /^ind-[a-f0-9-]+$/.test(copy?.id??'')&&repeatableIndicators.includes(copy.type)):[];
  const configuredIndicatorInstances=()=>[
    ...repeatableIndicators.filter(type=>S.chart[type]).map(type=>({id:type,type,settings:S.chart})),
    ...indicatorCopies().map(copy=>({...copy,settings:{...defaultSettings,...copy.settings,[copy.type]:true}}))
  ];
  const indicatorInstances=()=>{
    const configured=configuredIndicatorInstances();
    if(medianVisibility==='hidden')return configured.filter(item=>item.type!=='optionsMedian');
    if(medianVisibility==='shown'&&!configured.some(item=>item.type==='optionsMedian'))
      configured.push({id:'optionsMedian',type:'optionsMedian',settings:S.chart});
    return configured;
  };
  const instanceLabel=({type,settings})=>type==='optionsProbability'?'Options Probability Forecast':type==='optionsMedian'?'Options 50/50':indicatorLabel(type,settings);
  function chartIndicatorLegend(b){
    const averages=movingAverages(S.chart);
    const readings=new Map(activeIndicatorReadings(b,S.chart).map(row=>[row.key,row]));
    const closes=b.map(bar=>bar.close);
    const visible=averages.map(average=>{
      const value=readings.has(average.id)?readings.get(average.id).value:(average.type==='ema'?ema:sma)(closes,average.length).at(-1);
      return {key:average.id,label:movingAverageLabel(average),color:average.color,value};
    });
    for(const instance of indicatorInstances()){
      const {id:key,type,settings}=instance;
      const reading=key===type?readings.get(type):activeIndicatorReadings(b,settings).find(row=>row.key===type);
      visible.push({...reading,key,type,label:instanceLabel(instance),color:indicatorColors[type]||'#7bdac6'});
    }
    const rows=visible.map(({key,type=key,label,color,value,details})=>{
      const results=isOptionProjection(type)?'<span '+(key==='optionsMedian'?'id="chart-options-median-result" ':'')+
        'class="chart-options-median-result chart-indicator-value" role="status">No 50/50 dots: waiting for chart data and valid option chain quotes.</span>':
        '<span class="chart-indicator-value">'+indicatorValue(type,value,details)+'</span>';
      return '<div class="chart-indicator-row" data-indicator-row="'+key+'" style="--indicator-color:'+color+'">'+
        '<span class="chart-indicator-name">'+esc(label)+'</span>'+
        '<button type="button" class="chart-icon chart-indicator-gear" data-action="indicator-settings" data-indicator-key="'+key+
        '" aria-label="Settings for '+esc(label)+'" title="Settings for '+esc(label)+'" aria-haspopup="dialog">'+gearIcon+'</button>'+
        indicatorRemoveButton(label,'indicator-remove','data-indicator-key',key)+results+'</div>';
    }).join('');
    const custom=S.activeIndicators.map(item=>'<div class="chart-indicator-row"><span class="chart-indicator-name">'+
      esc(item.name)+'</span>'+indicatorRemoveButton(item.name,'pine-remove-plot','data-plot-id',item.id)+'</div>').join('');
    return '<div class="chart-indicator-legend" id="chart-indicator-legend" role="group" aria-label="Active chart indicators">'+rows+custom+'</div>';
  }
  function indicatorRemoveButton(label,action,attribute,key){
    return '<button type="button" class="chart-icon chart-indicator-remove" data-action="'+action+'" '+attribute+'="'+
      esc(key)+'" aria-label="Remove '+esc(label)+'" title="Remove '+esc(label)+'">×</button>';
  }
  function openIndicatorDialog(key){
    const dialog=$('#chart-indicator-dialog');
    if(!dialog||dialog.open&&!key)return;
    const average=movingAverages(S.chart).find(item=>item.id===key);
    const customAverage=average&&key.startsWith('ma-');
    const instance=indicatorInstances().find(item=>item.id===key);
    const type=instance?.type??key;
    const median=isOptionProjection(type);
    const title=key?(average?movingAverageLabel(average):instanceLabel(instance))+' settings':'New indicator';
    const header=dialogHeader(title,'chart-dialog-title');
    if(key){
      const fields=customAverage?[['length','Length',2,500]]:median?
        [[type==='optionsProbability'?'optionsProbabilityRate':'optionsMedianRate','Rate assumption (%)',-10,25,0.1]]:indicatorInputs(type);
      const inputs=fields.map(([field,label,min,max,step=1])=>
        '<label for="chart-indicator-'+field+'">'+esc(average?'Length':label)+
        '<input id="chart-indicator-'+field+'" type="number" name="'+field+'" data-indicator-field="'+field+'" min="'+min+
        '" max="'+max+'" step="'+step+'" required value="'+esc(customAverage?average.length:(instance?.settings??S.chart)[field])+'"/></label>').join('');
      const note=median?'<p class="chart-median-note">Risk-neutral expiry estimates based on Alpaca Indicative quotes. The indicator automatically loads chains on an approved browser; changing the rate alone cannot produce a median. Tap a level for quote quality or failure reasons.</p>'+
        '<p class="chart-median-note" id="options-median-refresh-status" role="status">'+esc(medianStatuses.get(key)||'Waiting for chart data.')+'</p>':'';
      dialog.innerHTML=header+'<form id="indicator-settings-'+key+'" data-indicator-key="'+key+'">'+
        '<div class="chart-indicator-fields">'+inputs+'</div>'+note+'<div class="chart-dialog-actions">'+
        '<button type="button" class="chart-remove-indicator" data-action="indicator-remove" data-indicator-key="'+key+'">Remove</button>'+
        (median?'<button type="button" class="btn small" data-action="options-median-refresh" data-indicator-key="'+key+'">Refresh levels</button>':'')+
        '<button type="submit" class="chart-dialog-apply">Apply</button></div></form>';
    }else{
      const activeTypes=indicatorInstances().map(item=>item.type);
      const choose=(action,id,label,color,active)=>
        '<button type="button" data-action="'+action+'" data-indicator-key="'+id+'" style="--indicator-color:'+color+'">'+
        '<span>'+esc(label)+'</span><span aria-hidden="true"'+(active?' class="chart-indicator-added"':'')+'>'+
        (active?'Add another':'+')+'</span></button>';
      const choices=repeatableIndicators.map(type=>choose('indicator-add',type,
        type==='optionsProbability'?'Options Probability Forecast (25/50/75%)':type==='optionsMedian'?'Options 50/50 levels':indicatorLabel(type,S.chart),
        indicatorColors[type]||'#7bdac6',activeTypes.includes(type))).join('');
      const averages=movingAverages(S.chart);
      const averageChoices=['ema','sma'].map(type=>choose('indicator-add-average',type,type.toUpperCase(),
        type==='ema'?'#e9bd68':'#8bb9eb',averages.some(item=>item.type===type))).join('');
      dialog.innerHTML=header+'<div class="chart-indicator-choices">'+averageChoices+choices+'</div>';
    }
    if(!dialog.open)dialog.showModal();
    else dialog.querySelector('input')?.focus();
  }
  function applyIndicatorChange(key,changes){
    $('#chart-indicator-dialog')?.close();
    preserveChartViewport();
    const hadMedian=!!viewMedianDots||indicatorInstances().some(item=>isOptionProjection(item.type));
    S.chart=changes;
    if(hadMedian&&!indicatorInstances().some(item=>isOptionProjection(item.type))&&S.pendingChartRange){
      const total=chartBars().length,range=S.pendingChartRange;
      if(range.to>total+3)S.pendingChartRange={from:Math.max(0,total-Math.min(180,Math.max(30,range.to-range.from))),to:total+3};
    }
    render();
    const target=(S.chart[key]||indicatorCopies().some(item=>item.id===key)||movingAverages(S.chart).some(average=>average.id===key))?'[data-action="indicator-settings"][data-indicator-key="'+key+'"]':'[data-action="indicator-picker"]';
    $(target)?.focus({preventScroll:true});
  }
  function chartReadout(bar,time=bar?.time){
    if(!bar)return '';
    const close=bar.close??bar.value;
    const valueClass=close>=bar.open?'up':'down';
    return '<time>'+esc(dateLabel(time))+'</time>'+[['O',bar.open],['H',bar.high],['L',bar.low],['C',close]]
      .filter(([,value])=>Number.isFinite(value)).map(([label,value])=>'<span>'+label+' <b class="'+valueClass+'">'+format(value)+'</b></span>').join('');
  }
  function chartSymbolChoices(query=''){
    const all=[...S.data.keys()].filter(modeSymbol).sort();
    const available=new Set(all);
    const choices=(symbols,id,title)=>symbols.length?'<section id="'+id+'"><h3>'+title+'</h3>'+
      symbols.map(symbol=>'<button type="button" data-action="chart-choose-symbol" data-symbol="'+esc(symbol)+'"'+
        (symbol===S.symbol?' aria-current="true"':'')+'>'+esc(symbol)+'</button>').join('')+'</section>':'';
    const q=query.trim().toUpperCase();
    if(q)return choices(all.filter(symbol=>symbol.toUpperCase().includes(q)),'chart-symbol-all','Matches')||'<p>No matching symbols.</p>';
    return choices(S.chartRecentSymbols.filter(symbol=>available.has(symbol)),'chart-symbol-recent','Recent')+
      choices([...S.watch].filter(symbol=>available.has(symbol)),'chart-symbol-watchlist','Watchlist')+
      choices(all,'chart-symbol-all','All symbols');
  }
  function openChartSymbolPicker(){
    const dialog=$('#chart-symbol-dialog');
    dialog.innerHTML=dialogHeader('Find symbol','chart-symbol-title')+
      '<input type="search" class="chart-symbol-search" data-input="chart-symbol-query" aria-label="Search chart symbols" placeholder="Search ticker" autocomplete="off" autofocus>'+
      '<div class="chart-symbol-choices">'+chartSymbolChoices()+'</div>';
    dialog.showModal();
  }
  function setTimeframe(value){
    S.chart.tf=value;S.result=null;S.sweep=null;
    if(S.tab==='charts')S.chartRecentFrames=[value,...S.chartRecentFrames.filter(tf=>tf!==value)].slice(0,3);
  }
  const chartFrameScale=()=>selectedFrames(S.chart.sliderFrames,S.chart.tf);
  const chartStyles=[['candles','Candles'],['bars','Bars'],['line','Line'],['area','Area']];
  function openChartSettings(){
    const dialog=$('#chart-settings-dialog');
    dialog.innerHTML=dialogHeader('Chart settings','chart-settings-title')+
      '<div class="chart-settings-content"><label class="field">Candle / chart style '+select(chartStyles,S.chart.style,'data-option="style" aria-label="Chart style"')+'</label>'+
      '<h3>Timeframes on slider</h3><div class="chart-frame-options">'+CHART_FRAMES.map(([id,label])=>
        '<label><input type="checkbox" data-frame-choice="'+id+'" '+(chartFrameScale().some(([v])=>v===id)?'checked':'')+'/> '+label+'</label>').join('')+
      '</div><p class="section-note">8H uses the regular 6.5-hour US trading session; the last bucket is partial. No simulated candles.</p>'+
      '<button class="btn primary" data-action="apply-chart-settings">Apply settings</button></div>';
    dialog.showModal();
  }
  function chartControls(){
    const frames=chartFrameScale();
    const index=Math.max(0,frames.findIndex(([id])=>id===S.chart.tf));
    const shortcuts=frames.map(([id,label])=>
      '<button type="button" data-action="chart-timeframe" data-timeframe="'+id+'" aria-pressed="'+(id===S.chart.tf)+'">'+label+'</button>').join('');
    const frameScale='<div class="chart-frame-scale"><div class="chart-timeframes" style="--frame-count:'+frames.length+'" role="group" aria-label="Timeframe shortcuts">'+shortcuts+'</div>'+
      '<input type="range" min="0" max="'+(frames.length-1)+'" step="1" value="'+index+'" data-chart-frame-scale aria-label="Timeframe scale" aria-valuetext="'+frames[index][1]+'"></div>';
    const fullscreenLabel=S.chartFullscreen?'Exit fullscreen':'Fullscreen';
    const fullscreenIcon=S.chartFullscreen?
      chartIcon('<path d="M4 9h5V4m6 0v5h5m0 6h-5v5m-6 0v-5H4"/>'):
      chartIcon('<path d="M9 4H4v5m11-5h5v5m0 6v5h-5m-6 0H4v-5"/>');
    return '<div class="chart-toolbar"><div class="chart-toolbar-symbol">'+
      '<span class="chart-ticker-caption" aria-hidden="true">Active ticker</span>'+
      '<button type="button" class="chart-ticker" data-action="chart-symbol-picker" data-symbol="'+esc(S.symbol)+
      '" aria-label="Change symbol, '+esc(S.symbol)+'" aria-haspopup="dialog"><span class="chart-ticker-name">'+esc(S.symbol)+'</span>'+
      chartIcon('<path d="m6 9 6 6 6-6"/>')+'</button></div>'+
      '<div class="chart-toolbar-controls">'+frameScale+
      '<div class="chart-toolbar-actions">'+
      '<button type="button" class="chart-add-indicator" data-action="indicator-picker" aria-haspopup="dialog"><span aria-hidden="true">+</span> New indicator</button>'+
      '<button type="button" data-action="reset-price-scale" title="Reset price scale" aria-label="Reset price scale">Auto</button>'+
      '<button type="button" class="chart-icon" data-action="'+(S.chartFullscreen?'chart-exit-fullscreen':'chart-fullscreen')+
      '" aria-label="'+fullscreenLabel+'" title="'+fullscreenLabel+'">'+fullscreenIcon+'</button>'+
      '<details class="chart-tools"><summary class="chart-icon" aria-label="Chart tools" title="Chart tools">'+
      chartIcon('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>')+
      '</summary><div class="chart-tools-menu">'+
      button(S.drawLine?'Cancel price line':'Horizontal line','draw-line','small')+
      button(indicatorInstances().some(item=>item.type==='optionsMedian')?'Hide options 50/50':'Show options 50/50','options-median-toggle','small')+
      button('View 50/50 dots','options-median-view','small')+
      button('Workspace tools & overlays','chart-workspace-tools','small')+
      button('Clear price levels','clear-lines','small')+button('Export PNG','chart-png','small')+
      button('Backtest this symbol','view-backtest','small chart-mobile-backtest')+'</div></details>'+
      '<button type="button" class="chart-icon" data-action="chart-settings" aria-label="Chart settings" title="Chart settings" aria-haspopup="dialog">'+chartIcon('<path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/>')+'</button></div></div></div>';
  }
  const optionsMedianCache = new Map();
  const refreshOptionsMedian=new Map(),medianStatuses=new Map();
  const noMedianQuotes='No 50/50 dots: options quote access is not enabled in this browser. Open your existing Options Builder quote link, then return to Chart Lab. Indicative quotes also require browser approval.';
  function medianStatus(id,message){
    medianStatuses.set(id,message);
    const dialog=$('#chart-indicator-dialog');
    if(dialog?.open&&dialog.querySelector('form')?.dataset.indicatorKey===id){
      const status=$('#options-median-refresh-status');if(status)status.textContent=message;
    }
  }
  function mountOptionsMedian(dotLayer,{id,type,settings}){
    const panel=$('[data-indicator-row="'+id+'"] .chart-options-median-result');
    if(!panel)return ()=>{};
    const forecast=type==='optionsProbability';
    const symbol=S.symbol, worker=S.apiBaseUrl, rate=Number(forecast?settings.optionsProbabilityRate:settings.optionsMedianRate)/100;
    let controller, active=true, hasLevels=false, retryAt=0, nextAt=0, expanded='';
    const key=JSON.stringify([symbol,rate,worker,type]);
    const clock=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York',timeZoneName:'short'});
    const shortcut='<button type="button" class="chart-options-median-view" data-median-show data-action="options-median-view" title="Show expiration dots or explain why none are available">View dots</button>';
    const unavailable=message=>{
      hasLevels=false;if(forecast){for(const b of probabilityBands)dotLayer.set(id+'-'+b.probability,[]);}else dotLayer.set(id,[]);medianStatus(id,message);
      panel.innerHTML='<span class="chart-options-median-status">'+esc(message)+'</span>'+shortcut;
    };
    panel.addEventListener('click',event=>{
      const button=event.target.closest('[data-median-detail]');
      if(!button)return;
      event.stopPropagation();
      expanded=expanded===button.dataset.medianDetail?'':button.dataset.medianDetail;
      for(const item of panel.querySelectorAll('[data-median-detail]'))
        item.setAttribute('aria-expanded',String(item.dataset.medianDetail===expanded));
      for(const detail of panel.querySelectorAll('[data-median-explanation]'))
        detail.hidden=detail.dataset.medianExplanation!==expanded;
    });
    const paint=({levels,message})=>{
      if(!active)return;
      const valid=levels.filter(item=>Number.isFinite(item.price)&&item.expiry);
      hasLevels=valid.length>0;
      if(forecast){
        for(const band of probabilityBands){
          dotLayer.set(id+'-'+band.probability,valid.filter(x=>x.probability===band.probability));
        }
        const summary=message||valid.length+' of 9 probability levels available · risk-neutral chance of finishing above each price.';
        medianStatus(id,summary);
        const rowsHtml=probabilityHorizons.map(h=>{
          const rows=levels.filter(x=>x.label===h.label);
          const expiry=rows.find(x=>x.expiry)?.expiry||'';
          const cells=probabilityBands.map(band=>{
            const estimate=rows.find(x=>x.probability===band.probability);
            const price=Number.isFinite(estimate?.price)?'$'+format(estimate.price)+(estimate.confidence==='lower'?'*':''):'—';
            const detail=estimate?.error||(estimate?.confidence==='lower'?(estimate.sensitivityBounded?'Low confidence · bid/ask crossing bounds':'Low confidence · midpoint bracket only'):'Risk-neutral probability quantile');
            return '<span class="chart-options-median-level" style="--level-color:'+band.color+'" title="'+esc(detail)+'"><strong>'+band.probability+'%</strong> '+price+'</span>';
          }).join('');
          return '<span class="chart-options-median-level" style="--level-color:var(--muted)" title="'+esc(rows.map(x=>x.error).filter(Boolean).join(' · '))+'"><strong>'+h.label+'</strong> '+esc(expiry)+'</span>'+cells;
        }).join('');
        panel.innerHTML='<span class="chart-options-median-status">'+esc(summary)+'</span>'+rowsHtml+shortcut;
        return;
      }
      dotLayer.set(id,valid);
      const summary=message||(!hasLevels?'No 50/50 dots: '+levels.map(row=>row.label+': '+(row.error||'No reliable estimate')).join(' · '):
        valid.length+' expiration dot'+(valid.length===1?'':'s')+' available. Use View dots to fit the time and price axes.');
      medianStatus(id,summary);
      panel.innerHTML=(message?'<span class="chart-options-median-status">'+esc(message)+'</span>':
        (!hasLevels?'<span class="chart-options-median-status">No reliable 50/50 dots. Tap each horizon for the reason.</span>':'')+
        medianHorizons.map(({label,color})=>{
        const row=levels.find(item=>item.label===label);
        const hasPrice=Number.isFinite(row?.price), low=row?.confidence==='lower';
        const details=[row?.expiry,hasPrice?(low?'Lower confidence: wider bid/ask spreads or strike intervals.':'Standard quote-quality filters passed.'):row?.error||'Unavailable',
          hasPrice?'Quotes as of '+clock.format(row.quoteTime):'',hasPrice?'Strike search ±'+Math.round(row.range*100)+'% · '+row.spreadCount+' vertical spreads':'',
          low&&row.sensitivity?(row.sensitivityBounded?'Bid/ask crossing bounds: $'+format(row.sensitivity[0])+'–$'+format(row.sensitivity[1])+' (not a statistical confidence interval)':'Midpoint bracket: $'+format(row.sensitivity[0])+'–$'+format(row.sensitivity[1])+' (bid/ask intervals overlap target)'):'',
          hasPrice?'Risk-neutral approximation, not a real-world price forecast.':''].filter(Boolean).join(' · ');
        return '<button type="button" class="chart-options-median-level" data-median-detail="'+label+'" aria-expanded="'+(expanded===label)+'" style="--level-color:'+color+'" title="'+esc(details)+'"><strong>'+
          label+'</strong> '+(hasPrice?'50/50 · '+esc(row.expiry)+' · ≈ $'+format(row.price)+(low?' · Low conf.':''):'Unavailable')+' <span aria-hidden="true">ⓘ</span></button>'+
          '<span class="chart-options-median-explanation" data-median-explanation="'+label+'"'+(expanded===label?'':' hidden')+'>'+esc(details)+'</span>';
      }).join(''))+shortcut+
        (hasLevels&&intradayTf(S.chart.tf)?'<span class="chart-median-note" title="Future weekday slots are not minute candles; 20:00 UTC is the calculation time convention.">Future: daily slots</span>':'');
    };
    const load=async (force=false)=>{
      if(!active||(!force&&document.hidden))return;
      if(!modeSymbol(symbol)){unavailable('No 50/50 dots: select a loaded optionable ticker.');return;}
      const token=getOptionsDevice();
      if(!token){unavailable(noMedianQuotes);return;}
      if(controller){if(force)medianStatus(id,'Loading option chains…');return;}
      if(Date.now()<retryAt){if(force)medianStatus(id,'Quote rate limit reached. Retry after '+clock.format(retryAt)+'.');return;}
      const current=optionsMedianCache.get(key);
      if(!force&&current&&Date.now()-current.time<60_000){
        paint(current.result);
        nextAt=current.time+60_000;
        return;
      }
      if(!force&&Date.now()<nextAt)return;
      controller=new AbortController();
      const {signal}=controller;
      medianStatus(id,'Loading option chains…');
      if(!hasLevels)panel.innerHTML='Loading option chains…'+shortcut;
      try{
        const request=(path,params,signal)=>requestOptions(path,params,signal,{worker,token});
        const result=await (forecast?loadOptionsProbability:loadOptionsMedians)({request,symbol,rate,signal});
        if(!active)return;
        retryAt=Date.now()+Math.max(0,...result.levels.map(row=>row.retryAfter||0))*1_000;
        optionsMedianCache.set(key,{time:Date.now(),result});
        if(optionsMedianCache.size>24)optionsMedianCache.delete(optionsMedianCache.keys().next().value);
        paint(result);
      }catch(error){
        if(!signal.aborted&&active){
          if(error.status===429)retryAt=Date.now()+error.retryAfter*1_000;
          unavailable('No 50/50 dots: '+error.message);
        }
      }finally{
        controller=null;
        nextAt=Date.now()+60_000;
      }
    };
    refreshOptionsMedian.set(id,()=>void load(true));
    void load();
    const timer=setInterval(()=>void load(),10_000);
    return ()=>{active=false;controller?.abort();clearInterval(timer);refreshOptionsMedian.delete(id);medianStatuses.delete(id);};
  }
  function toggleMedianVisibility(){
    const visible=indicatorInstances().some(item=>item.type==='optionsMedian');
    setMedianVisibility(visible?'hidden':'shown');
    const toggle=$('[data-action="options-median-toggle"]');
    if(toggle)toggle.textContent=visible?'Show options 50/50':'Hide options 50/50';
    // No shell/price-chart reconstruction or shared indicator edits on this path.
    if(syncMedianChart)syncMedianChart();
    else if(S.tab==='charts')render();
  }
  function showMedianDots(){
    if(!indicatorInstances().some(item=>isOptionProjection(item.type))){
      notice('Options 50/50 is hidden. Choose Show options 50/50 first.');return;
    }
    if(viewMedianDots?.())return;
    notice([...medianStatuses.values()][0]||'No 50/50 dots: waiting for chart data and valid option chain quotes.');
  }
  const workspaceToolGroups=[
    ['Chart controls',[
      ['watchlist','Watchlist','Star the active symbol, select a list and jump between its symbols.'],
      ['scan','Screener & saved scans','See the current match, load an archived scan or review matches.'],
      ['backtest','Backtest & Optimize','Run the current strategy and open its full settings.'],
      ['alerts','In-app alerts','Add a daily-close alert for the active symbol.'],
      ['options','Options Builder','Open the builder and see whether its positions match the chart.'],
      ['scripts','Script Lab','Open the editor without leaving Chart Lab.'],
      ['data','Data Center','See source and last bar, refresh the curated universe.']
    ]],
    ['Chart overlays',[
      ['trades','Backtest trade markers','Only actual saved backtest fills for this symbol and timeframe.'],
      ['pine','Pine plots & shapes','Keep the applied scripts; hide or show their output.'],
      ['alertLevels','Price alert levels','Daily-close thresholds for the active symbol. RSI alerts remain in the alert list.'],
      ['strikes','Options strike levels','Matching builder contract strikes or user-entered assumptions, not quotes.']
    ]]
  ];
  function openChartWorkspaceTools(){
    const dialog=$('#chart-workspace-dialog');
    dialog.innerHTML=dialogHeader('Workspace tools & overlays','chart-workspace-title')+
      '<div class="chart-workspace-settings">'+workspaceToolGroups.map(([title,items])=>
        '<fieldset><legend>'+title+'</legend>'+items.map(([key,label,help])=>
          '<label class="chart-workspace-choice"><input type="checkbox" data-chart-workspace-choice="'+key+'" '+(chartTools[key]?'checked':'')+'><span><strong>'+label+'</strong><small>'+help+'</small></span></label>').join('')+'</fieldset>').join('')+
      '<p class="section-note">Visibility is saved in this browser. Turning an item off never deletes workspace settings or positions. Options 50/50 remains available in the indicator menu.</p>'+
      '<button type="button" class="btn primary" data-action="apply-chart-workspace-tools">Apply visibility</button></div>';
    dialog.showModal();
  }
  function optionWorkspaceStatus(){
    const snapshot=optionsBuilder.chartPositions(),levels=chartOptionLevels(snapshot,S.symbol);
    if(snapshot.symbol!==S.symbol)return 'Builder: '+snapshot.symbol+' · no strikes for '+S.symbol;
    return levels.length?levels.length+' strike level'+(levels.length===1?'':'s')+' · positions, not quotes':'No valid strikes for '+S.symbol;
  }
  function alertWorkspaceStatus(){
    const alerts=S.alerts.filter(a=>a.symbol===S.symbol&&a.type!=='signal');
    return alerts.length+' daily alert'+(alerts.length===1?'':'s')+' · '+alerts.filter(a=>a.unread).length+' unread · checks on scan/refresh';
  }
  function chartScanStatus(){
    const snapshot=S.savedScanView;
    if(snapshot){
      const row=snapshot.rows.find(r=>r.symbol===S.symbol);
      return 'Archived '+snapshot.name+' · '+String(snapshot.savedAt).slice(0,10)+' · '+(row?(row.evalResult.pass?'match':'no match'):'not in saved rows')+' (not live)';
    }
    const row=marketShown()?market.rows.get(S.symbol):null,history=S.data.get(S.symbol);
    const result=row?marketRules(row):history?.length?screenSymbol(history,S.rules):null;
    return result?'Current rules: '+(result.pass?'match':'no match')+' · '+S.rules.length+' rule'+(S.rules.length===1?'':'s'):'No current scan data';
  }
  function workspaceShortcut(key,label){
    return '<button type="button" class="btn small" data-action="chart-workspace-open" data-workspace-key="'+key+'">'+label+'</button>';
  }
  function chartWorkspaceControls(){
    if(!workspaceToolGroups[0][1].some(([key])=>chartTools[key]))return '';
    const row=(key,title,body)=>chartTools[key]?'<div class="chart-workspace-row" data-chart-workspace-row="'+key+'"><strong>'+title+'</strong>'+body+'</div>':'';
    const list=S.watchlists.find(item=>item.id===S.watchlistId);
    const watchSymbols=(list?.symbols||[]).filter(modeSymbol);
    const currentResult=S.result&&S.resultSymbol===S.symbol&&S.resultTf===S.chart.tf;
    const source=S.sources.get(S.symbol),last=chartBars().at(-1);
    const controls=
      row('watchlist','Watchlist','<select aria-label="Chart watchlist" data-chart-workspace-input="watchlist">'+
        S.watchlists.map(item=>'<option value="'+esc(item.id)+'"'+(item.id===S.watchlistId?' selected':'')+'>'+esc(item.name)+'</option>').join('')+'</select>'+
        '<button type="button" class="btn small" data-action="chart-workspace-star" aria-pressed="'+S.watch.has(S.symbol)+'" '+(!modeSymbol(S.symbol)?'disabled':'')+'>'+(S.watch.has(S.symbol)?'★ Remove':'☆ Add')+' '+esc(S.symbol)+'</button>'+
        '<select aria-label="Jump to watchlist symbol" data-chart-workspace-input="watch-symbol"><option value="">Jump to symbol</option>'+watchSymbols.map(sym=>'<option value="'+esc(sym)+'">'+esc(sym)+'</option>').join('')+'</select>')+
      row('scan','Screener','<span class="chart-workspace-note">'+esc(chartTools.scan?chartScanStatus():'')+'</span>'+
        '<select aria-label="Chart saved scan" data-chart-workspace-input="scan"><option value="">Current rules</option>'+S.savedScans.map(item=>'<option value="'+esc(item.id)+'"'+(S.savedScanView?.id===item.id?' selected':'')+'>'+esc(item.name)+'</option>').join('')+'</select>'+
        button('Review matches','chart-workspace-review','small')+workspaceShortcut('screener','Screener'))+
      row('backtest','Backtest','<span class="chart-workspace-note">'+esc(S.bt.strategy)+(currentResult?' · '+S.result.trades.length+' trades':' · no matching result')+'</span>'+
        '<button type="button" class="btn small" data-action="chart-workspace-run" '+(S.portfolioMode||S.analysisLoading?'disabled':'')+'>Run on chart</button>'+
        workspaceShortcut('backtest','Settings')+workspaceShortcut('optimize','Optimize')+
        (S.portfolioMode?'<span class="chart-workspace-note">Portfolio mode: use full Backtest.</span>':'')+
        (S.backtestError?'<span class="chart-workspace-note" role="alert">'+esc(S.backtestError)+'</span>':''))+
      row('alerts','Alerts','<span id="chart-workspace-alert-status" class="chart-workspace-note">'+esc(alertWorkspaceStatus())+'</span>'+
        '<select aria-label="Chart alert condition" data-chart-workspace-input="alert-op"><option value=">">Above</option><option value="<">Below</option></select>'+
        '<input aria-label="Chart alert price" type="number" min="0.01" step="any" data-chart-workspace-input="alert-price" placeholder="Daily close">'+
        '<button type="button" class="btn small" data-action="chart-workspace-add-alert" '+(!modeSymbol(S.symbol)?'disabled':'')+'>Add price alert</button>'+workspaceShortcut('alerts','Manage'))+
      row('options','Options','<span id="chart-workspace-options-status" class="chart-workspace-note">'+esc(optionWorkspaceStatus())+'</span>'+workspaceShortcut('options','Open builder'))+
      row('scripts','Scripts','<span class="chart-workspace-note">'+S.activeIndicators.length+' applied indicator'+(S.activeIndicators.length===1?'':'s')+'</span>'+workspaceShortcut('scripts','Script Lab'))+
      row('data','Data','<span class="chart-workspace-note">'+esc(source==='ALPACA'?'Alpaca '+String(S.liveFeed).toUpperCase():source==='IMPORTED'?'Imported':'No data')+' · '+esc(last?dateLabel(last.time):'no bar')+'</span>'+
        button('Refresh scan','chart-workspace-refresh','small')+workspaceShortcut('data','Data Center'));
    return controls?'<section class="chart-workspace-controls" aria-label="On-chart workspace controls">'+controls+'</section>':'';
  }
  function openChartWorkspace(key){
    if(S.tab!=='charts'||!Object.hasOwn(S.workspaceSections,key))return;
    preserveChartViewport();showWorkspace(key);render();
    const section=$('#chart-workspaces > [data-workspace-section="'+key+'"]');
    section?.scrollIntoView({block:'start'});section?.querySelector('summary')?.focus({preventScroll:true});
  }
  async function runChartBacktest(){
    if(S.portfolioMode)return;
    const symbol=S.symbol,tf=S.chart.tf;
    preserveChartViewport();
    if(!await ensureAnalysisBars('Backtest'))return;
    if(S.tab!=='charts'||S.symbol!==symbol||S.chart.tf!==tf||S.portfolioMode)return;
    S.lastBacktestSymbol=symbol;preserveChartViewport();runBt();render();
  }
  function chartsView(){
    const b=chartBars(),source=S.sources.get(S.symbol);
    const intro=S.chartFullscreen?'':'<div class="headrow chart-page-heading"><h1>Chart Lab</h1>'+
      button('Backtest this symbol','view-backtest','small')+'</div>';
    const stale=!S.chartFullscreen&&staleReason(S.symbol)?
      '<div class="info-strip warning" id="chart-stale-warning" role="status">'+
      '<strong>'+esc(S.symbol)+' daily bars lag the observed universe reference '+esc(S.freshness.expected)+'</strong>'+
      staleNote(S.symbol)+'</div>':'';
    const panel='<div class="panel '+(S.chartFullscreen?'chart-is-fullscreen':'')+
      '" id="chart-lab-panel" data-fullscreen="'+S.chartFullscreen+'">'+chartControls()+scanReviewControls()+
      '<div class="chart-readout" id="readout">'+chartReadout(b.at(-1))+'</div>'+chartWorkspaceControls()+
      '<div class="chart-stage" id="chart-stage"><div class="chart-area" id="price-chart"'+(!S.chartFullscreen&&S.chartHeight!=null?' style="height:'+S.chartHeight+'px"':'')+'></div>'+
      chartIndicatorLegend(b)+'</div><div class="chart-ranges" aria-label="Chart range" role="group">'+
      button('1M','range-1m','small')+button('3M','range-3m','small')+button('1Y','range-1y','small')+
      button('All','range-all','small')+button('Fit','range-fit','small')+
      (intradayTf(S.chart.tf)?button('Refresh '+sourceResolution(S.chart.tf).replace('Min','m')+' bars','refresh-intraday','small chart-refresh'):'')+
       '<button type="button" class="btn small chart-log-toggle" data-action="chart-log-toggle" aria-label="Logarithmic price scale" aria-pressed="'+S.chart.log+'">LOG</button>'+
      '<span id="older-history-control">'+olderHistoryControl()+'</span>'+
      '<span class="visually-hidden" id="chart-axis-hint" role="status"></span>'+
      (!S.chartFullscreen?'<button type="button" id="chart-resize-handle" class="chart-resize-handle" aria-label="Resize chart height" title="Drag up or down to resize chart; double-click to reset">'+chartIcon('<path d="M7 17 17 7M12 17l5-5"/>')+'</button>':'')+'</div>'+
      '<dialog id="chart-workspace-dialog" class="chart-dialog" aria-labelledby="chart-workspace-title"></dialog>'+
      '<dialog id="chart-settings-dialog" class="chart-dialog" aria-labelledby="chart-settings-title"></dialog>'+
       '<dialog id="chart-indicator-dialog" class="chart-dialog" aria-labelledby="chart-dialog-title"></dialog>'+
      '<dialog id="chart-symbol-dialog" class="chart-dialog" aria-labelledby="chart-symbol-title"></dialog>'+
      '<dialog id="scan-rules-dialog" class="chart-dialog" aria-labelledby="scan-rules-title"></dialog></div>';
    const footer=S.chartFullscreen?'':'<p class="chart-data">'+esc(S.symbol)+' · '+
      (source==='ALPACA'?'Alpaca '+esc(String(S.liveFeed).toUpperCase()):source==='IMPORTED'?'Imported':'No data')+
      ' · '+b.length+' '+esc(S.chart.tf)+' bars</p>';
    return intro+stale+panel+(S.chartFullscreen?'':'<div id="pine-chart-error" role="alert"></div>')+
      footer+(S.chartFullscreen?'':sourceStrip()+
        '<section id="chart-workspaces" aria-label="Workspaces"></section>');
  }
  function btOptions(){
    if(S.bt.strategy==='pine-custom'){
      return '<div class="form-grid"><label class="field">Strategy '+select([['ema-cross','EMA crossover'],['rsi-revert','RSI mean reversion'],['trend-rsi','Trend + RSI pullback'],['bollinger','Bollinger mean reversion'],['breakout','Price breakout'],['pine-custom','Pine Script strategy']],S.bt.strategy,'data-bt="strategy"')+'</label>'+
        field('Starting capital ($)','capital','number',1,100000000,100)+field('Position allocation (%)','allocation','number',1,100,1)+
        field('Commission (bps/side)','feeBps','number',0,1000,.5)+field('Slippage (bps/side)','slipBps','number',0,1000,.5)+
        field('Short borrow cost (%/year)','borrowAnnualPct','number',0,100,.1)+
        field('Stop loss (%)','stopPct','number',0,100,.5)+field('Take profit (%)','targetPct','number',0,1000,.5)+
        '</div>';
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
  // Single 70/30 OR 3/5 rolling is the same rule used for filtering,
  // qualified-symbol counts and exports. Do not inspect only validation.validated.
  function holdoutLabel(row){
    const status=validationStatus(row);
    if(status.validated)return '<span class="oos-validated" title="'+esc(VALIDATION_RULE)+'">'+
      esc(status.label)+'</span>';
    if(status.label==='Indicator · N/A')return '<span class="muted">Indicator · N/A</span>';
    return '<span class="muted">Not validated</span>'+
      (row?.validation?.note?'<small class="oos-note">'+esc(row.validation.note)+'</small>':'');
  }
  function holdoutSharpe(row){
    return row?.validation?.enoughTestBars?format(row.testMetrics?.sharpe,2):'—';
  }
  const portfolioModeControl=()=>'<div class="portfolio-mode"><label class="control">Backtest mode '+
    select([['single','Single symbol'],['portfolio','Equal-weight portfolio'],['best-fit','Best-fit portfolio']],
      S.portfolioMode?(S.bestFitMode?'best-fit':'portfolio'):'single','data-option="portfolio-mode"')+
    '</label><span class="muted">Portfolios use daily aligned OHLCV, equal initial allocations and independent next-open trades. Best-fit selects each symbol from the first 70% training bars only; the final 30% is untouched holdout data.</span></div>';
  function activePortfolioResult(){
    const report=S.portfolioResult;
    if(!report)return null;
    if(!S.bestFitMode)return report.mode==='best-fit'?null:report;
    const fitMode=S.bestFitValidatedOnly?'validated':'training';
    return report.mode==='best-fit'&&(report.fitMode||'training')===fitMode&&
      report.range?.startDate===S.btRange.startDate&&
      report.range?.endDate===S.btRange.endDate?report:null;
  }
  function portfolioSelection(){
    if(S.portfolioScope==='watchlist'){
      const list=S.watchlists.find(x=>x.id===S.portfolioWatchlistId);
      return [...new Set((list?.symbols||[]).filter(modeSymbol))];
    }
    return [...S.data.keys()].filter(isVisibleSymbol).filter(sym=>screenSymbol(S.data.get(sym),S.rules).pass);
  }
  function portfolioBacktestView(){
    const isBest=S.bestFitMode,validated=isBest&&S.bestFitValidatedOnly;
    const selections=portfolioSelection(),result=activePortfolioResult();
    const noValidated=validated&&result?.noValidated;
    const qualified=result?(validated?
      result.breakdown.filter(row=>validationStatus(row).validated).length:result.ranked):null;
    const selectedCount=result?.selectedCount??selections.length;
    const qualifier=validated?' · '+(qualified===null?'—':qualified)+' of '+
      selectedCount+' selected qualified':'';
    const sourceName='Alpaca '+String(S.liveFeed).toUpperCase()+' or imported daily OHLCV';
    const namedLists=S.watchlists.map(w=>[w.id,w.name+' · '+w.symbols.length+' symbols']);
    const controls='<div class="panel"><div class="panel-header"><h2>'+
      (isBest?'Best-fit portfolio selection · '+(validated?'Validated OOS':'In-sample')+qualifier:
        'Portfolio selection & strategy')+'</h2><div class="flex">'+
      button(S.portfolioLoading?'Evaluating portfolio…':(isBest?'Run best-fit portfolio':'Run equal-weight portfolio'),
        isBest?'run-best-fit':'run-portfolio','primary')+
      (isBest?'':button('Sweep portfolio parameters','view-optimize','small'))+
      button('Download CSV','export-portfolio','small')+'</div></div><div class="panel-body">'+
      '<div class="portfolio-pick"><label class="control">Symbol source '+
      select([['matches','All current scan matches'],['watchlist','Named watchlist']],
        S.portfolioScope,'data-option="portfolio-scope"')+'</label>'+
      (S.portfolioScope==='watchlist'?'<label class="control">Watchlist '+
        select(namedLists,S.portfolioWatchlistId,'data-option="portfolio-watchlist"')+'</label>':'')+
      '<strong>'+selections.length+' selected</strong></div>'+
      (isBest?'<div class="leaderboard-validation-controls">'+
        '<label class="inline-check"><input type="checkbox" id="best-fit-validated-only" '+
        'data-option="best-fit-validated-only" '+(S.bestFitValidatedOnly?'checked':'')+
        '/> Validated only</label>'+
        '<span id="best-fit-validation-count" role="status">'+
        (validated?(qualified===null?'Not calculated · ':qualified+' of ')+
          selectedCount+' selected symbols qualify':
          'In-sample strategy selection (default)')+'</span></div>':'')+
      (S.portfolioScope==='matches'?'<p class="section-note">Current Screener rule matches, including the volatility-universe restriction; saved scan snapshots are never reused.</p>':
        '<p class="section-note">Currently loaded symbols on the chosen named watchlist; unavailable or insufficient-history symbols are reported as omitted.</p>')+
      '<div class="info-strip">Data source: '+esc(sourceName)+
      '. Each included symbol receives the same initial capital fraction. Costs, stops and fills use the existing engine.</div>'+
      (isBest?'<p class="section-note"><strong>Strategy selection:</strong> '+
        (validated?'Only strategies passing the exact leaderboard 70/30 or 3-of-5 rolling OOS rule qualify. Each symbol uses the highest rolling mean OOS Sharpe among its validated strategies; symbols without one are excluded. Single-split validated strategies with an unavailable rolling mean rank last. OOS-based selection introduces selection bias; the combined full-period curve is not independent OOS evidence.':
          'Evaluate each executable preset, saved Pine and built-in example strategy on the first 70% of aligned daily bars. Choose the highest training Sharpe for each symbol without inspecting test performance. The remaining 30% is scored separately. A positive holdout Sharpe earns a descriptive Validated label, not proof of predictive ability. Ranking is strictly in-sample; symbols without a finite training Sharpe are excluded.')+
        '</p>':btOptions())+
      backtestDateControls()+'</div></div>';
    const summary=noValidated?
      '<div class="empty" role="status" id="best-fit-validated-empty">No symbol has a validated strategy on this window</div>':
      result?'<div class="metrics">'+
        metric('Total return',pct(result.metrics.returnPct),'Equal initial capital',priceColor(result.metrics.returnPct))+
        metric('CAGR',pct(result.metrics.cagrPct),'Calendar time, aligned dates')+
        metric('Sharpe',format(result.metrics.sharpe,2),'252 sessions, RF = 0')+
        metric('Maximum DD',pct(-result.metrics.maxDD),'Peak-to-trough portfolio equity')+
        '</div>':'<div class="empty">Select symbols and a date range, then run the portfolio.</div>';
    const rows=result?.breakdown||[];
    const table='<div class="table-wrap"><table class="data-table" id="portfolio-breakdown"><thead><tr>'+
      '<th>Symbol</th><th>Strategy</th>'+
      (validated?'<th>Rolling mean OOS Sharpe</th><th>Rolling positive windows</th>':'')+
      '<th>Source</th><th>Bar date</th><th>Weight</th>'+
      (isBest?'<th>Train return</th><th>Train Sharpe</th><th>OOS return</th><th>OOS Sharpe</th><th>Validation</th>':'')+
      '<th>Full return</th><th>Trades</th><th>Win rate</th><th>Max DD</th><th>Full Sharpe</th></tr></thead><tbody>'+
      rows.map(r=>'<tr data-portfolio-symbol="'+esc(r.symbol)+'"><td>'+esc(r.symbol)+'</td>'+
        '<td>'+esc(r.strategyName||r.strategy||'—')+
        (isBest&&!validated?'<small class="fit-stale">Fit Sharpe: '+format(r.fitSharpe,2)+'</small>':'')+'</td>'+
        (validated?'<td>'+format(r.rollingMeanSharpe,3)+'</td><td>'+
          (r.rollingPositiveCount??0)+'/'+(r.rollingWindowCount??5)+
          (r.rollingAssessableCount<r.rollingWindowCount?' ('+r.rollingAssessableCount+
            '/'+r.rollingWindowCount+' assessable)':'')+'</td>':'')+
        '<td>'+esc(r.source==='ALPACA'?'ALPACA '+String(S.liveFeed).toUpperCase()+' 1Day':r.source)+'</td>'+
        '<td>'+esc(String(r.barDate||'—').slice(0,10))+'</td>'+
        '<td>'+pct(result.weights[r.symbol]*100)+'</td>'+
        (isBest?'<td>'+pct(r.trainMetrics?.returnPct)+'</td>'+
          '<td>'+format(r.trainMetrics?.sharpe,2)+'</td>'+
          '<td>'+pct(r.testMetrics?.returnPct)+'</td>'+
          '<td>'+holdoutSharpe(r)+'</td><td>'+holdoutLabel(r)+'</td>':'')+
        '<td class="'+priceColor(r.returnPct)+'">'+pct(r.returnPct)+'</td>'+
        '<td>'+format(r.trades,0)+'</td><td>'+pct(r.winPct)+'</td>'+
        '<td>'+pct(-r.maxDD)+'</td><td>'+format(r.sharpe,2)+'</td></tr>').join('')+
      '</tbody></table></div>';
    return head('Backtest · '+(isBest?'Best-fit portfolio'+(validated?' · validated only':''):'Portfolio'),
      'Equal initial allocations on a shared daily calendar; no live orders.')+
      portfolioModeControl()+(result?'':backtestSection('portfolio','Portfolio settings',controls,true))+
      (S.portfolioError?'<div class="warning info-strip" role="alert">'+esc(S.portfolioError)+'</div>':'')+
      (S.portfolioLoading?'<div class="info-strip" role="status" id="portfolio-loading">Comparing strategies and aligning portfolio equity…</div>':'')+
      (result?'<div class="info-strip" id="portfolio-source">Saved '+(isBest?'best-fit':'equal-weight')+
        ' portfolio · '+esc(result.sourceSummary||'Daily OHLCV')+
        ' · '+result.symbols.length+' symbols · '+result.curve.length+' daily equity points · run '+
        esc(S.portfolioTimestamp||'')+
        '<div class="result-range">'+esc(displayBacktestRange(result.range))+'</div>'+
        (isBest?' · '+(validated?qualified:result.ranked)+' of '+
          result.selectedCount+' selected qualified':'')+
        (result.omitted?.length?' · excluded '+result.omitted.length+
          ' symbols (insufficient bars or no '+(validated?'validated':'rankable')+' strategy)':'')+
        '</div>':'')+
      summary+
      (noValidated?'':'<div class="panel"><div class="panel-header"><h2>Combined portfolio equity vs. equal-weight buy &amp; hold</h2></div>'+
        (result?.curve?.length?'<div class="equity-legend"><span><i class="equity-swatch strategy"></i>'+
          (isBest?'Best-fit strategies':'Equal-weight strategy')+'</span><span><i class="equity-swatch benchmark"></i>Equal-weight buy &amp; hold</span></div>'+
          '<div id="equity-chart" class="equity-plot"></div>':
          '<div class="empty">Run the portfolio to see the combined curve.</div>')+'</div>')+
      (result?backtestSection('portfolio','Portfolio settings',controls,true):'')+
      (noValidated?'':'<div class="panel"><div class="panel-header"><h2>Per-symbol breakdown</h2><span class="muted">'+rows.length+' symbols</span></div>'+
        (rows.length?table:'<div class="empty">No portfolio results yet.</div>')+
        (isBest?'<p class="section-note">Train = first 70%; OOS = final 30% of the selected date range. Full portfolio return and equity curve cover both periods. OOS runs reset capital at the split, with prior bars used only for indicator warmup; minimum 30 holdout bars to judge Sharpe. '+
          (validated?'Validation-selected strategies use the test period for selection and are not independently validated by the combined curve. ':'')+
          'Per-symbol dates and sources appear in the rows.</p>':'')+'</div>')+
      (result?.unranked?.length?'<div class="info-strip warning" id="best-fit-unranked">'+
        (validated?'Excluded for validation: ':'No finite-Sharpe candidate for: ')+
        esc(result.unranked.slice(0,10).map(x=>x.symbol+' ('+x.reason+')').join('; '))+
        (result.unranked.length>10?' · +'+(result.unranked.length-10)+' more':'')+'</div>':'')+
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
    const match=leaderboardRangeStatus(lb,comparisonContext());
    if(!match.matches){
      // NEVER display historical ranking data or a mismatched walk-forward
      // summary under newly selected date controls.
      const oldFull=!lb.range?.startDate&&!lb.range?.endDate;
      const savedLabel=oldFull?'Full-history leaderboard — range not applied':
        'Saved leaderboard — selected date range not applied';
      return '<section class="panel" aria-label="Strategy comparison">'+
        '<div class="panel-header"><h2>Strategy leaderboard</h2>'+
        button('Recompute on selected range','compare-strategies','primary')+'</div>'+
        '<div class="panel-body"><div role="alert" class="info-strip warning" id="leaderboard-range-mismatch">'+
        '<strong>'+savedLabel+'</strong> · '+esc(rangeLabel(S.btRange))+
        '. '+esc(S.leaderboardError||match.reason||'Recompute required.')+
        ' Previous returns, Sharpe, equity overlays and walk-forward results are hidden to avoid misleading comparisons.'+
        '</div></div></section>';
    }
    const definitions=[['name','Strategy'],['trainReturnPct','Train return (70%)'],
      ['sharpe','Train Sharpe (rank)'],['testReturnPct','OOS return (30%)'],
      ['testSharpe','OOS Sharpe (30%)'],
      ['rollingMean','Rolling mean OOS Sharpe (5)'],
      ['rollingMedian','Rolling median OOS Sharpe (5)'],
      ['rollingPositive','Rolling positive windows (5)'],
      ['validation','Validation'],
      ['returnPct','Full return'],['cagrPct','Full CAGR'],['maxDD','Full max DD'],
      ['winPct','Full win rate'],['trades','Full trades'],['profitFactor','Full profit factor']];
    const headers=definitions.map(([key,title])=>{
      const active=S.leaderboardSort===key,arrow=active?(S.leaderboardDescending?' ▼':' ▲'):'';
      return '<th aria-sort="'+(active?(S.leaderboardDescending?'descending':'ascending'):'none')+
        '"><button class="table-sort" type="button" data-action="sort-leaderboard" data-key="'+key+
        '" aria-label="Sort by '+esc(title)+'">'+esc(title)+arrow+'</button></th>';
    }).join('');
    const visibleRows=filterValidatedLeaderboard(lb.rows,S.leaderboardValidatedOnly);
    const order=leaderboardDisplayRows(lb,{validatedOnly:S.leaderboardValidatedOnly,
      sort:S.leaderboardSort,descending:S.leaderboardDescending});
    const top=lb.rows.find(row=>row.id===lb.bestId);
    const bestValidated=bestRollingValidatedStrategy(lb.rows)||
      sortLeaderboard(filterValidatedLeaderboard(lb.rows,true),'sharpe',true)[0]||null;
    const note=S.chart.tf!==lb.timeframe?'Current timeframe '+esc(S.chart.tf)+
      ' differs from saved comparison timeframe '+esc(lb.timeframe)+'. Rerun to update.':'';
    const provenance='<div class="info-strip" id="leaderboard-source"><strong>'+esc(lb.symbol)+
      '</strong> · '+esc(lb.timeframe)+' · '+esc(lb.source)+' · bar date '+
      esc(readableBarDate(lb.asOf))+' · compared '+lb.compared+' strategies ('+
      (lb.builtInExamples||0)+' built-in examples, '+lb.savedPineStrategies+
      ' saved Pine) · ran '+esc(lb.runAt)+
      ' · same capital, allocation, side, costs and stop/target assumptions.'+
      (lb.range?' · '+esc(displayBacktestRange(lb.range)):'')+
      (note?' '+note:'')+'</div>';
    const cells=order.map((row,index)=>{
      const best=row.id===lb.bestId,m=row.metrics||{},train=row.trainMetrics||{};
      return '<tr data-leaderboard-id="'+esc(row.id)+'" class="'+(best?'leaderboard-best':'')+'"><td>'+
        '<span class="leaderboard-rank">'+(index+1)+'.</span> '+esc(row.name)+
        (row.kind==='example-indicator'?' <small class="muted">Indicator · N/A</small>':'')+
        (best?' <strong class="best-note">Best Sharpe</strong>':'')+'</td>'+
        '<td>'+pct(train.returnPct)+'</td><td>'+format(train.sharpe,3)+'</td>'+
        '<td>'+pct(row.testMetrics?.returnPct)+'</td><td>'+holdoutSharpe(row)+'</td>'+
        '<td>'+format(row.rolling?.meanSharpe,2)+'</td>'+
        '<td>'+format(row.rolling?.medianSharpe,2)+'</td>'+
        '<td>'+esc(rollingPositiveText(row.rolling))+
          (row.rolling?.note?'<small class="oos-note">'+esc(row.rolling.note)+'</small>':'')+
        '</td>'+
        '<td>'+holdoutLabel(row)+'</td>'+
        '<td class="'+priceColor(m.returnPct)+'">'+pct(m.returnPct)+'</td>'+
        '<td>'+pct(m.cagrPct)+'</td><td>'+pct(-m.maxDD)+'</td>'+
        '<td>'+pct(m.winPct)+'</td><td>'+format(m.trades,0)+'</td>'+
        '<td>'+format(m.profitFactor,2)+'</td></tr>';
    }).join('');
    const overlay=lb.overlay||{series:[],benchmark:[]};
    const legendColors=['#46d69b','#71b8b3','#e9bd68'];
    const legend=overlay.series.map((entry,i)=>'<span class="leaderboard-legend-item">'+
      '<i class="leaderboard-swatch" style="--swatch:'+legendColors[i]+'"></i>'+
      (i+1)+'. '+esc(entry.name)+'</span>').join('')+
      '<span class="leaderboard-legend-item"><i class="leaderboard-swatch" style="--swatch:#91a0a7"></i>Buy &amp; hold</span>';
    const assessment=holdoutSummary(lb.rows),rollingAssessment=rollingLeaderboardSummary(lb.rows),
      split=lb.rows.find(x=>x.validation)?.validation;
    const walk='<div class="info-strip" id="walk-forward-summary">Walk-forward summary (single 70/30 chronological holdout): '+
      assessment.positive+' of '+assessment.assessable+' assessable strategies retained positive OOS Sharpe'+
      (assessment.assessable<assessment.total?' ('+(assessment.total-assessment.assessable)+
        ' had insufficient/unmeasurable test Sharpe)':'')+'. '+
      (assessment.best?'Best OOS Sharpe: '+esc(assessment.best.name)+' ('+
        format(assessment.best.testMetrics.sharpe,3)+').':
        'No strategy has an assessable out-of-sample Sharpe.')+
      ' · Source: '+esc(lb.source)+' · bar date: '+esc(readableBarDate(lb.asOf))+
      (split?' · holdout '+esc(split.testStart||'—')+' to '+esc(split.testEnd||'—'):'')+
      ' · '+esc(rangeLabel(lb.range||{}))+
      '<div class="rolling-wf-result" id="rolling-wf-result"><strong>Five-window rolling mean OOS Sharpe:</strong> '+
      rollingAssessment.positive+' of '+rollingAssessment.assessable+
      ' assessable strategies have a positive rolling mean OOS Sharpe'+
      (rollingAssessment.unassessable?' ('+rollingAssessment.unassessable+
        ' strategies have no numeric rolling mean/median; shown as — in the table)':'')+
      '. This count uses only the numeric rolling cells in the table; it is NOT the single-split holdout count.</div>'+
      '<div class="rolling-wf-dates" id="rolling-window-dates"><strong>Repeated rolling OOS ('+
      (lb.rollingWindowCount||ROLLING_WINDOW_COUNT)+' sliding 70/30 windows):</strong> '+
      (lb.rollingWindows?.length?esc(rollingWindowDates(lb.rollingWindows)):
        'Not calculated — rerun comparison')+'</div>'+
      '<div class="rolling-wf-note">A strategy positive in most windows is steadier evidence than a single holdout, but these overlapping training windows are not independent proof.</div>'+
      '</div>';
    return '<section class="panel" aria-label="Strategy comparison"><div class="panel-header"><h2>Strategy leaderboard</h2><div class="flex">'+
      '<span class="source-badge" id="leaderboard-window">'+esc(rangeLabel(lb.range||{}))+'</span>'+
      button('Compare all strategies','compare-strategies','small')+
      button('Download CSV','export-leaderboard','small')+
      (S.leaderboardValidatedOnly?
        (bestValidated?button('Load best validated into Backtester','load-best-validated','primary'):''):
        (top?button('Load best into Backtester','load-best-strategy','primary'):''))+
      '</div></div><div class="panel-body">'+provenance+
      '<div class="leaderboard-validation-controls">'+
      '<label class="inline-check"><input type="checkbox" id="leaderboard-validated-only" '+
      'data-option="leaderboard-validated-only" '+(S.leaderboardValidatedOnly?'checked':'')+
      '/> Validated only</label>'+
      '<span id="leaderboard-validation-count" role="status">Showing '+visibleRows.length+
      ' of '+lb.rows.length+' total leaderboard rows · '+esc(rangeLabel(lb.range||{}))+
      ' · definition: '+esc(VALIDATION_RULE)+'</span></div>'+
      (lb.skipped.length?'<div class="info-strip warning" role="status">'+lb.skipped.length+
        ' scripts unavailable: '+lb.skipped.map(x=>esc(x.name)+': '+esc(x.reason)).join('; ')+'</div>':'')+
      (S.leaderboardValidatedOnly&&!visibleRows.length?
        '<div class="empty" role="status" id="leaderboard-validation-empty">No strategy validated on this window</div>':
        '<div class="table-wrap"><table class="data-table leaderboard-table"><thead><tr>'+
        headers+'</tr></thead><tbody>'+cells+'</tbody></table></div>')+
      backtestSection('validation','Validation windows',walk)+
      '<p class="section-note">Rank remains by <strong>training Sharpe</strong>, not OOS or rolling Sharpe. The original single 70/30 split, its Validated badge and Full-period equity overlay are unchanged. Rolling uses five windows, each 40% of selected history and stepped 15% forward, with disjoint test periods; the fixed strategy is tested on the final 30% of each window after indicator warm-up. Rolling mean/median use only windows with at least 30 test bars and finite Sharpe; missing windows are disclosed, never counted as losses. '+esc(definitions.find(x=>x[0]===S.leaderboardSort)?.[1]||'Train Sharpe')+
      ' is currently selected for table sorting. Rerun older saved comparisons to populate holdout values.</p>'+
      '</div></section><div class="panel"><div class="panel-header"><h2>Top 3 equity curves vs. buy-and-hold</h2>'+
      '<span class="source-badge">Same source · '+esc(lb.timeframe)+'</span></div>'+
      '<div class="panel-body"><div class="leaderboard-legend">'+legend+'</div>'+
      (overlay.series.length?'<div id="leaderboard-chart" class="equity-plot leaderboard-plot" aria-label="Top three strategy equity curves and buy and hold"></div>':
        '<div class="empty">Run Compare all strategies to generate overlays.</div>')+'</div></div>';
  }

  function universeFitView(){
    const validated=S.fitValidatedOnly,report=validated?S.fitValidatedReport:S.fitReport;
    const mode=validated?'Validated OOS ranking':'In-sample ranking';
    const count=S.fitValidatedReport?
      S.fitValidatedReport.rows.filter(row=>validationStatus(row).validated).length+
        ' of '+LIVE_UNIVERSE.length+
        ' symbols have a validated strategy':
      'Validated-strategy count pending · 0 of '+LIVE_UNIVERSE.length+' evaluated';
    const controls='<label class="inline-check"><input type="checkbox" id="fit-validated-only" '+
      'data-option="fit-validated-only" '+(validated?'checked':'')+'/> Validated only</label>';
    const status=S.fitStatus?'<div id="fit-status" role="status" class="info-strip">'+esc(S.fitStatus)+'</div>':
      S.fitError?'<div id="fit-status" role="alert" class="info-strip warning">'+esc(S.fitError)+'</div>':'';
    const header='<div class="panel-header"><h2>Fit across universe · '+mode+' · '+esc(count)+'</h2><div class="flex">'+
      controls+(report&&(!validated||report.rows.length)?
        button(validated?'Load best validated symbol':'Load best symbol','load-fit-best','primary'):'')+
        (report?button('Download CSV','export-fit','small'):'')+'</div></div>';
    const range=report?.dateRange;
    if(!report)return '<section class="panel" id="universe-fit">'+header+
      '<div class="panel-body">'+status+'<div id="fit-validated-count" role="status">'+esc(count)+'</div>'+
      '<p class="section-note">Apply the selected strategy to all '+LIVE_UNIVERSE.length+
      ' curated Alpaca symbols for the default training-Sharpe ranking. Validated mode checks presets, saved Pine strategies and built-in strategy examples against the same 70/30 and five rolling OOS windows as the leaderboard.</p></div></section>';
    const provenance='<div id="fit-source" class="info-strip">'+
      (S.fitReport?.completed??report.completed)+'/'+LIVE_UNIVERSE.length+
      ' symbols backtested · '+mode+' · ALPACA '+esc(String(S.liveFeed).toUpperCase())+
      ' 1Day OHLCV · '+esc(report.runAt)+
      (range?.startDate||range?.endDate?
        ' · selected range '+esc(range.startDate||'first available')+
        ' to '+esc(range.endDate||'last available'):' · full available range')+
      '</div><div id="fit-validated-count" role="status">'+esc(count)+'</div>';
    if(validated){
      const cells=report.rows.map((row,index)=>
        '<tr data-fit-symbol="'+esc(row.symbol)+'"'+(index===0?' class="leaderboard-best"':'')+'>'+
        '<td>'+esc(row.symbol)+(row.stale?'<small class="fit-stale">Stale</small>':'')+'</td>'+
        '<td>'+esc(row.validatingStrategy.name)+'</td>'+
        '<td>'+format(row.rollingMeanSharpe,3)+'</td>'+
        '<td>'+format(row.rollingMedianSharpe,3)+'</td>'+
        '<td>'+row.positiveWindows+'/'+row.totalWindows+
          (row.assessableWindows<row.totalWindows?' ('+row.assessableWindows+
            '/'+row.totalWindows+' assessable)':'')+'</td>'+
        '<td>'+holdoutLabel(row)+'</td>'+
        '<td>'+esc(row.source)+'</td>'+
        '<td>'+esc(row.barDate||'—')+'</td></tr>').join('');
      return '<section class="panel" id="universe-fit">'+header+
        '<div class="panel-body">'+status+provenance+
        (report.rows.length?'<div class="table-wrap"><table class="data-table fit-validated-table"><thead><tr>'+
          '<th>Symbol</th><th>Validating strategy</th><th>Rolling mean OOS Sharpe</th>'+
          '<th>Rolling median OOS Sharpe</th><th>Positive windows</th>'+
          '<th>Validation rule</th><th>Data source</th><th>Last bar</th>'+
          '</tr></thead><tbody>'+cells+'</tbody></table></div>':
          '<div class="empty" id="fit-validated-empty" role="status">'+NO_VALIDATED_FIT+'</div>')+
        '<p class="section-note">Ranked by the best validated strategy\'s numeric rolling mean OOS Sharpe, never training Sharpe. Single-split validated symbols with no measurable rolling mean are listed last as —. '+esc(VALIDATION_RULE)+'. Five sliding windows use the selected date range; insufficient or undefined OOS scores are never counted positive. Research only; selecting among OOS winners introduces selection bias.</p>'+
        '</div></section>';
    }
    const defs=[['symbol','Symbol'],['trainReturnPct','Train return (70%)'],
      ['sharpe','Train Sharpe (rank)'],['testReturnPct','OOS return (30%)'],
      ['testSharpe','OOS Sharpe (30%)'],['validation','Validation'],
      ['returnPct','Full return'],['cagrPct','Full CAGR'],
      ['maxDD','Full max DD'],['winPct','Full win rate'],['trades','Full trades'],
      ['source','Data source'],['barDate','Last bar']];
    const headers=defs.map(([key,name])=>'<th aria-sort="'+
      (S.fitSort===key?(S.fitDescending?'descending':'ascending'):'none')+
      '"><button type="button" class="table-sort" data-action="sort-fit" data-key="'+key+'">'+
      name+(S.fitSort===key?(S.fitDescending?' ▼':' ▲'):'')+'</button></th>').join('');
    const best=bestUniverseFit(report.rows);
    const cells=fitDisplayRows(report,{validatedOnly:false,sort:S.fitSort,
      descending:S.fitDescending}).map(row=>
      '<tr data-fit-symbol="'+esc(row.symbol)+'"'+(best?.symbol===row.symbol?' class="leaderboard-best"':'')+'>'+
      '<td>'+esc(row.symbol)+(row.stale?'<small class="fit-stale">Stale</small>':'')+'</td>'+
      '<td>'+pct(row.trainMetrics?.returnPct)+'</td>'+
      '<td>'+format(row.trainMetrics?.sharpe,2)+'</td>'+
      '<td>'+pct(row.testMetrics?.returnPct)+'</td>'+
      '<td>'+holdoutSharpe(row)+'</td>'+
      '<td>'+holdoutLabel(row)+'</td>'+
      '<td>'+pct(row.metrics?.returnPct)+'</td>'+
      '<td>'+pct(row.metrics?.cagrPct)+'</td>'+
      '<td>'+format(row.metrics?.maxDD)+'%</td>'+
      '<td>'+pct(row.metrics?.winPct)+'</td><td>'+(row.metrics?.trades??'—')+'</td>'+
      '<td>'+esc(row.source)+'</td><td>'+esc(row.barDate||'—')+
      (row.error?'<small class="fit-error">'+esc(row.error)+'</small>':'')+'</td></tr>').join('');
    return '<section class="panel" id="universe-fit">'+header+
      '<div class="panel-body">'+status+provenance+
      '<p class="section-note">Default ranking uses training Sharpe, not OOS Sharpe. The 70/30 holdout and modeled costs are unchanged; no missing bars are fabricated.</p>'+
      '<div class="table-wrap"><table class="data-table fit-table"><thead><tr>'+
      headers+'</tr></thead><tbody>'+cells+'</tbody></table></div></div></section>';
  }

  function backtestSection(key,title,body,open=false){
    return '<details class="panel backtest-details" data-backtest-section="'+key+'"'+
      ((S.backtestSections[key]??open)?' open':'')+'><summary><h2>'+title+'</h2></summary>'+body+'</details>';
  }
  const variantSharedFields=['capital','allocation','feeBps','slipBps','borrowAnnualPct'];
  const variantLabels={strategy:'Strategy',side:'Trade direction',fast:'Fast EMA',slow:'Slow / trend EMA',
    rsiPeriod:'RSI length',buyLevel:'Buy RSI threshold',sellLevel:'Exit RSI threshold',
    period:'Lookback / band length',multiplier:'Bollinger deviation',stopPct:'Stop loss (%)',targetPct:'Take profit (%)'};
  function backtestScript(){
    return S.backtestPineDraft||S.activeStrategy||{code:S.scriptCode,settings:S.scriptSettings,name:S.scriptName};
  }
  function backtestPineEditor(){
    if(S.bt.strategy!=='pine-custom')return '<div class="backtest-pine">'+button('Use Pine code','enable-backtest-pine','small')+'</div>';
    const script=backtestScript();
    const builtin=PINE_EXAMPLES.filter(example=>!example.id.endsWith('-indicator'));
    const options=[['','Load an example or saved script'],
      ...builtin.map(example=>['example:'+example.id,example.label]),
      ...S.scriptLibrary.map(item=>['saved:'+item.id,item.name])];
    let inputs=[];
    try{inputs=compilePine(script.code).inputs;}catch{}
    return '<div class="backtest-pine"><label class="field">Pine script library '+
      select(options,'','data-bt-pine-source')+'</label>'+
      '<label class="field" for="backtest-pine-source">Pine strategy code · v5</label>'+
      '<textarea id="backtest-pine-source" data-bt-pine-code class="pine-editor" rows="12" spellcheck="false">'+esc(script.code)+'</textarea>'+
      '<div class="flex">'+button('Check Pine syntax','check-backtest-pine','small')+button('Run Pine strategy','run-backtest','primary small')+'</div>'+
      (inputs.length?pineInputFields(inputs,script.settings||{},'data-bt-pine-input'):'')+
      '<p class="section-note">Use strategy() and order calls to trade on your indicator conditions. The script sets entries, exits and trade direction. The settings above model position size and trading costs.</p></div>';
  }
  function variantSetup(){
    return {symbol:S.symbol,tf:S.chart.tf,source:comparisonSource(),options:{...S.bt},
      script:S.bt.strategy==='pine-custom'?backtestScript():null};
  }
  function canCompareVariant(setup){
    const base=S.variantBaseline;
    return !!base&&base.symbol===setup.symbol&&base.tf===setup.tf&&base.source===setup.source;
  }
  function variantKey(setup){return JSON.stringify([setup,S.btRange]);}
  function variantData(){
    return intradayTf(S.chart.tf)&&S.sources.get(S.symbol)==='ALPACA'?
      S.intraday.get(intradayKey(S.symbol)):S.data.get(S.symbol);
  }
  function variantResultView(){
    const setup=variantSetup(),base=S.variantBaseline,report=S.variantComparison;
    if(!base)return '<p>Pin your current strategy settings, then change a parameter and compare.</p>';
    const caption='<p><strong>Baseline</strong> · '+esc(base.symbol+' · '+base.tf+' · '+base.source+' · '+
      (base.script?.name||base.options.strategy))+'</p>';
    if(!canCompareVariant(setup))return caption+'<p>To compare, return to the baseline symbol, timeframe and source.</p>';
    const shared=base.options;
    const costs='<p>Both runs use the selected dates and baseline costs · '+format(shared.feeBps)+' bps commission and '+
      format(shared.slipBps)+' bps slippage per side · '+format(shared.borrowAnnualPct)+'% annual short borrow · $'+
      format(shared.capital)+' starting capital · '+format(shared.allocation)+'% allocation.</p>';
    if(!report||report.key!==variantKey(setup)||report.data!==variantData())return caption+costs;
    const diffs=Object.entries(variantLabels).filter(([key])=>base.options[key]!==setup.options[key])
      .map(([key,label])=>label+' '+base.options[key]+' → '+setup.options[key]);
    if(JSON.stringify(base.script)!==JSON.stringify(setup.script)&&base.script&&setup.script)
      diffs.push('Pine script or inputs changed');
    const table=[
      ['Return','returnPct',2,'%',' pp'],
      ['Max drawdown','maxDD',2,'%',' pp'],
      ['Trade count','trades',0,'',''],
      ['OOS Sharpe','oosSharpe',3,'','']
    ].map(([label,key,digits,unit,deltaUnit])=>{
      const first=report.baseline[key],second=report.variant[key];
      const value=n=>Number.isFinite(n)?format(n,digits)+unit:'—';
      const delta=Number.isFinite(first)&&Number.isFinite(second)?second-first:null;
      return '<tr><th scope="row">'+label+'</th><td>'+value(first)+'</td><td>'+value(second)+'</td><td>'+
        (delta===null?'—':(delta>0?'+':'')+format(delta,digits)+deltaUnit)+'</td></tr>';
    }).join('');
    return caption+costs+'<p>'+esc(displayBacktestRange(report.range))+'</p>'+
      '<p>'+esc(diffs.length?diffs.join(' · '):'Same strategy settings')+'</p>'+
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Metric</th><th>Baseline</th>'+
      '<th>Variant</th><th>Δ</th></tr></thead><tbody>'+table+'</tbody></table></div>'+
      '<p>OOS Sharpe uses the final 30% holdout · '+esc(report.test.testStart||'—')+' to '+
      esc(report.test.testEnd||'—')+' ('+report.test.testBars+' bars).'+
      (report.test.enoughTestBars?'':' At least 30 holdout bars are required.')+'</p>'+
      (report.notice?'<p>'+esc(report.notice)+'</p>':'');
  }
  function variantComparisonView(){
    const compatible=canCompareVariant(variantSetup());
    return '<section class="panel" id="variant-comparison"><div class="panel-header"><h2>Compare variants</h2><div class="flex">'+
      button(S.variantBaseline?'Replace baseline':'Pin baseline','pin-variant-baseline','small')+
      '<button type="button" class="btn small primary" data-action="compare-variant"'+(compatible?'':' disabled')+
      '>Compare current settings</button></div></div><div class="panel-body" id="variant-result">'+variantResultView()+'</div></section>';
  }
  async function compareVariant(){
    const setup=variantSetup(),baseline=S.variantBaseline,key=variantKey(setup);
    if(!canCompareVariant(setup)||!await ensureAnalysisBars('Compare variants'))return;
    if(!workspaceActive('backtest')||S.portfolioMode||baseline!==S.variantBaseline||key!==variantKey(variantSetup()))return;
    S.variantComparison=null;
    try{
      const window=selectedBacktestWindow();
      const overrides=Object.fromEntries(variantSharedFields.map(name=>[name,baseline.options[name]]));
      const evaluate=(options,script)=>{
        const cfg=backtestConfig(window.bars,{...options,...overrides},script);
        const result=backtest(window.bars,cfg),holdout=assessHoldout(window.bars,cfg,backtest);
        return {metrics:{...result.metrics,oosSharpe:holdout.validation.enoughTestBars?holdout.testMetrics?.sharpe:null},
          test:holdout.validation,notice:result.notice};
      };
      const a=evaluate(baseline.options,baseline.script),b=evaluate(setup.options,setup.script);
      S.variantComparison={key,data:variantData(),range:window.range,baseline:a.metrics,variant:b.metrics,test:a.test,notice:a.notice};
    }catch(err){notice(err.message);}
    $('#variant-result').innerHTML=variantResultView();
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
    const settings=backtestSection('strategy','Strategy settings','<div class="panel-header"><div class="flex">'+(S.bt.strategy==='pine-custom'?'':button('Run backtest','run-backtest','primary'))+button('Compare all strategies','compare-strategies')+button('Fit across universe','fit-universe')+button('Optimize parameters','view-optimize')+'</div></div><div class="panel-body">'+btOptions()+backtestPineEditor()+backtestDateControls()+'<p class="section-note">Stop-first rule when stop and target are both hit inside the same bar. Costs are modeled on each side. Short borrow fees are approximate; the engine does not model margin calls, locate availability, dividends, partial fills, taxes, or corporate actions.</p></div>',true);
    const performance='<div class="panel"><div class="panel-header"><h2>Performance</h2><div class="flex">'+button('Export trades CSV','export-trades','small')+button('View trade markers','view-charts','small')+'</div></div><div class="panel-body">'+resultCards(S.result)+'</div></div>';
    const tradeView=S.result?.curve?.length?'<div class="panel"><div class="panel-header"><h2>Price and trade fills</h2>'+
      '<span class="muted">'+esc(S.resultSymbol)+' · '+esc(S.resultTf)+'</span></div>'+
      '<div id="backtest-price-chart" class="backtest-price-chart" aria-label="Candlestick chart with entry and exit markers"></div></div>':'';
    const equity='<div class="panel"><div class="panel-header"><h2>Equity curve vs. buy-and-hold</h2></div>'+(S.result?.curve?.length?'<div class="equity-legend"><span><i class="equity-swatch strategy"></i>Strategy</span><span><i class="equity-swatch benchmark"></i>Buy &amp; hold</span></div><div id="equity-chart" class="equity-plot"></div>':'<div class="empty">Run a backtest to generate an equity curve.</div>')+'</div>';
    const comparison=S.leaderboard?.symbol===S.symbol?S.leaderboard:null;
    const validation=comparison&&leaderboardRangeStatus(comparison,comparisonContext()).matches?
      '<p class="backtest-validation" role="status"><strong>Leaderboard validation</strong> · '+
      filterValidatedLeaderboard(comparison.rows,true).length+' of '+comparison.rows.length+' strategies qualified on this range</p>':'';
    const provenance=
      (S.backtestError?'<div class="info-strip warning" role="alert" id="backtest-range-error">'+esc(S.backtestError)+'</div>':'')+
      dataStatus+sourceStrip()+analysisNotice+
      (S.result?'<div class="info-strip" id="backtest-result-range">'+esc(displayBacktestRange(S.result.range))+
        ' · source: '+esc(S.result.source||S.sources.get(S.resultSymbol)||'UNKNOWN')+
        ' · last bar date '+esc(S.result.range?.actualEnd||'unknown')+'</div>':'');
    return head('Backtest','Signals use completed bars and next-open fills. One position at a time, long or short.',symbolSelect()+tfSelect())+
      portfolioModeControl()+provenance+(S.result?validation+performance+tradeView+equity+settings:settings+performance+equity)+
      variantComparisonView()+backtestSection('trades','Trade log',tradeTable(S.result))+
      leaderboardView()+universeFitView();
  }
  function optimizeView(){
    if(S.portfolioMode)return portfolioOptimizeView();
    const rows=S.sweep||[];
    return head('Optimize','Parameter sweep with a 70% training / 30% chronological holdout split.',symbolSelect()+tfSelect())+portfolioModeControl()+
      '<div class="panel"><div class="panel-header"><h2>Run sweep</h2><div class="flex"><label class="control">Strategy '+select([['ema-cross','EMA cross'],['rsi-revert','RSI reversion'],['trend-rsi','Trend + RSI'],['bollinger','Bollinger'],['breakout','Breakout'],['pine-custom','Pine Script strategy']],S.bt.strategy,'data-bt="strategy"')+'</label>'+button('Run 5–9 variations','run-sweep','primary')+button('Export CSV','export-sweep','small')+'</div></div><div class="panel-body"><p class="section-note">Each variation is trained on the first 70% of the dataset and independently simulated on the last 30%, using earlier bars only for indicator warm-up. The table sorts by holdout return. Choosing the best holdout result itself introduces selection bias; confirm on unseen data.</p></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Parameter ranking</h2><span class="muted">'+rows.length+' variations</span></div><div class="table-wrap">'+(rows.length?'<table class="data-table"><thead><tr><th>Parameters</th><th>Train return</th><th>Train DD</th><th>Test return</th><th>Test DD</th><th>Test trades</th><th>Test PF</th><th></th></tr></thead><tbody>'+rows.map((r,i)=>'<tr class="'+(i===0?'sweep-best':'')+'"><td>'+esc(Object.entries(r.params).map(([k,v])=>k+'='+v).join(', '))+'</td><td class="'+priceColor(r.train.returnPct)+'">'+pct(r.train.returnPct)+'</td><td>-'+format(r.train.maxDD)+'%</td><td class="'+priceColor(r.test.returnPct)+'">'+pct(r.test.returnPct)+'</td><td>-'+format(r.test.maxDD)+'%</td><td>'+r.test.trades+'</td><td>'+format(r.test.profitFactor)+'</td><td><button class="btn small" data-action="apply-sweep" data-index="'+i+'">Apply & test</button></td></tr>').join('')+'</tbody></table>':'<div class="empty"><strong>No sweep yet</strong>Choose a strategy and run a parameter sweep.</div>')+'</div></div>';
  }
  function pineInputFields(inputs,values,attribute='data-pine-input'){
    return inputs.length?'<div class="pine-settings">'+inputs.map(spec=>{
      const value=Object.hasOwn(values,spec.name)?values[spec.name]:spec.default;
      const input=spec.type==='bool'?'<input type="checkbox" '+attribute+'="'+esc(spec.name)+'" '+(value?'checked':'')+'/>':
        '<input type="number" '+attribute+'="'+esc(spec.name)+'" value="'+esc(value)+'" step="'+esc(spec.step|| (spec.type==='int'?1:.1))+'"'+(spec.min!==undefined?' min="'+esc(spec.min)+'"':'')+(spec.max!==undefined?' max="'+esc(spec.max)+'"':'')+'/>';
      return '<label class="field">'+esc(spec.title)+' <small>('+esc(spec.name)+')</small>'+input+'</label>';
    }).join('')+'</div>':'<div class="section-note">This script has no editable input.int(), input.float(), or input.bool() controls.</div>';
  }
  function scriptView(){
    const parsed=S.scriptParsed,inputs=parsed?.inputs||[];
    const examples=PINE_EXAMPLES.map(ex=>button(ex.label,'pine-example','small').replace('data-action="pine-example"','data-action="pine-example" data-example="'+esc(ex.id)+'"')).join('');
    const library=S.scriptLibrary.length?S.scriptLibrary.map(item=>
      '<option value="'+esc(item.id)+'"'+(S.scriptId===item.id?' selected':'')+'>'+esc(item.name)+'</option>').join(''):'';
    const settings=pineInputFields(inputs,S.scriptSettings);
    const status=S.scriptError?'<div class="pine-error" role="alert">'+esc(S.scriptError)+'</div>':
      S.scriptOutput?'<div class="info-strip" role="status">'+esc(S.scriptOutput)+'</div>':
      parsed?'<div class="info-strip" role="status">'+esc(parsed.mode.toUpperCase())+' · '+esc(parsed.title)+' · '+(parsed.overlay?'Price overlay':'Own indicator pane')+'</div>':'';
    return head('Script Lab','Write and run the supported Pine Script v5 subset in your browser.',symbolSelect()+tfSelect())+
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

  function workspacePanel(){
    return '<section class="panel"><div class="panel-header"><h2>Shared workspace</h2><span id="workspace-sync-status" role="status">'+
      esc(syncText||'Changes saved automatically')+'</span></div><div class="panel-body">'+
      '<p class="section-note">Open this same site on any device. Charts, scripts, scans, and imported data are shared publicly.</p></div></section>';
  }
  function dataView(){
    const imported=[...S.data].filter(([k])=>S.sources.get(k)==='IMPORTED');
    return head('Data Center','Import historical prices or configure the Alpaca scanner.',button('Import CSV files','import','primary'))+workspacePanel()+
      freshnessPanel()+
      (S.scan.status==='complete'&&S.scan.source==='ALPACA'?
        '<div class="info-strip" id="scan-duration">Last live scan: <strong>'+
        format(S.scan.durationMs/1000,2)+' seconds</strong> measured in this browser (request, download and data processing) · '+
        S.scan.returned+'/'+S.scan.requested+' symbols · '+
        (S.scan.cached?'15-minute cache HIT':'fresh scan')+
        (Number.isFinite(S.scan.workerDurationMs)?' · Worker acquisition '+format(S.scan.workerDurationMs/1000,2)+' seconds':'')+
        ' · Worker reported '+(S.scan.history?.reportedDays??'unknown')+' daily lookback days'+
        ' · ABBV '+(S.scan.history?.counts?.ABBV??'unavailable')+
        ' actual bars · SPY '+(S.scan.history?.counts?.SPY??'unavailable')+' actual bars'+
        ' · Worker '+esc(S.scan.history?.baseUrl||S.apiBaseUrl)+
        ' · cache revision '+esc(S.scan.history?.revision||'unknown')+
        (S.scan.history?.recovered?' · Outdated saved Worker automatically replaced with the official Worker':'')+
        '. Longer history may make uncached scans and browser processing slower.</div>':'')+
      '<div class="panel"><div class="panel-header"><h2>Live market scanner · Alpaca</h2><span class="source-badge">Keys stay server-side</span></div><div class="panel-body"><label class="field">Cloudflare Worker API URL<input type="url" data-setting="apiBaseUrl" placeholder="https://market-lens-pro-api.your-subdomain.workers.dev" value="'+esc(S.apiBaseUrl)+'"/></label><div class="flex" style="margin-top:13px">'+button('Test backend','test-live','small')+button('Refresh live universe','mode-live','primary')+'</div><div class="info-strip">The quick live scan covers '+LIVE_UNIVERSE.length+' curated symbols — not a full S&P 500 constituent list: '+LIVE_EQUITY_COUNT+' liquid US equities, '+LIVE_ETF_COUNT+' broad-market ETFs and '+LIVE_VOLATILITY_COUNT+' live volatility tickers. Live volatility tickers include VXX, UVXY, SVXY, VIXY, VIXM, VXZ, SVIX, UVIX, SVOL and ZVOL. The Worker requests '+ALPACA_SCAN_LOOKBACK_DAYS+' calendar days (approximately five years) of daily bars in batches of '+ALPACA_BATCH_SIZE+' symbols ('+Math.ceil(LIVE_UNIVERSE.length/ALPACA_BATCH_SIZE)+' batches for the current universe), paginates if necessary, and caches completed scans for 15 minutes. The default feed is IEX; consolidated SIP data requires an eligible Alpaca subscription.</div><p class="section-note">Alpaca credentials remain in encrypted Cloudflare Worker secrets. The browser receives OHLCV only. If the live request fails, the app retains previous real data when available and otherwise shows an error. The market-wide scanner uses daily bars over REST. Chart Lab fetches genuine Alpaca 1Min, 5Min or 15Min bars for intraday intervals; it never fabricates intraday from daily. No streaming WebSocket.</p><p class="section-note">The setup guide is in <code>docs/ALPACA_SETUP.md</code>. No keys belong in this website, browser storage, or chat.</p></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Import historical data</h2><span class="source-badge">Saved workspace data</span></div><div class="panel-body"><div class="upload" id="dropzone"><strong>Drop one or more CSV files here</strong><p class="subtle">Or tap to browse. Multiple symbols are supported in a single file.</p>'+button('Choose CSV files','import')+'</div><div class="info-strip">Required columns: <code>Date,Open,High,Low,Close</code>. Optional: <code>Symbol,Volume</code>. For daily files, enter ISO dates like 2026-01-05. Chart Lab fetches real intraday bars, aggregates hourly intervals within regular US trading sessions, and labels the IEX source. Market-wide 2H screener rules still require timestamped intraday inputs. Imported CSV prices should be split-adjusted consistently. Close-only files are permitted but weaken fill accuracy.</div></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Saved imported symbols</h2><div class="flex">'+button('Clear imported data','clear-imports','small')+'</div></div><div class="panel-body"><div class="data-list">'+(imported.length?imported.map(([symbol,b])=>'<div class="data-item"><div><strong>'+esc(symbol)+'</strong><br/><small>'+b.length+' bars · '+dateLabel(b[0].time)+' to '+dateLabel(b.at(-1).time)+'</small></div><button class="btn small" data-action="choose-symbol" data-symbol="'+esc(symbol)+'">Open chart</button></div>').join(''):'<div class="empty"><strong>No imported data yet.</strong>Import actual historical OHLCV data to use it alongside Alpaca.</div>')+'</div></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Market data policy</h2></div><div class="panel-body"><p class="section-note">GitHub Pages serves the public frontend only. Alpaca credentials are stored as Cloudflare Worker secrets and are never sent to this browser. Live data requests go through the Worker proxy.</p><p class="section-note">Imported data remains available alongside Alpaca data. Backtesting is research-only and does not submit orders.</p></div></div>';
  }
  const optionsBuilder=createOptionsBuilder({onPositionsChange:()=>refreshWorkspaceOverlays?.()});
  window.addEventListener('hashchange',()=>{
    if(optionsApprovalLink()===null)return;
    if(S.tab==='options')optionsBuilder.openApproval();
    else{S.tab='options';render();}
  });
  const views={screener:screenerView,charts:chartsView,backtest:backtestView,optimize:optimizeView,scripts:scriptView,data:dataView};
  const workspaceTitles={...tabNames,watchlists:'Named watchlists',scans:'Saved scans',alerts:'In-app alerts'};
  let retainedOptionsHost=null;
  function workspaceStart(key,title){
    return '<details class="panel backtest-details chart-workspace-section" data-workspace-section="'+key+'"'+
      (S.workspaceSections[key]?' open':'')+'><summary><h2>'+esc(title)+'</h2>'+
      '<button type="button" class="workspace-drag-handle" data-workspace-drag="'+key+'" aria-label="Move '+esc(title)+' panel" title="Drag to reorder, or use Up and Down arrow keys">⠿</button></summary>';
  }
  function mountOptionsIn(parent){
    if(!retainedOptionsHost){
      retainedOptionsHost=document.createElement('section');retainedOptionsHost.id='options-builder';
      parent.append(retainedOptionsHost);optionsBuilder.mount(retainedOptionsHost,S.apiBaseUrl);
    }else parent.append(retainedOptionsHost);
  }
  function mountBacktestCharts(){
    if(!equityChart&&(S.portfolioMode?activePortfolioResult()?.curve?.length:S.result?.curve?.length))mountEquity();
    if(!S.portfolioMode){
      if(!tradeChart&&S.result?.curve?.length)mountBacktestPriceChart();
      if(!leaderboardChart&&S.leaderboard?.symbol===S.symbol)mountLeaderboardChart();
    }
  }
  function mountWorkspaceContent(section){
    const key=section.dataset.workspaceSection,body=section.querySelector(':scope > .workspace-content');
    if(!body)return;
    if(!body.dataset.mounted){
      if(key==='options')mountOptionsIn(body);
      else body.innerHTML=key==='screener'?screenerView(false):views[key]();
      body.dataset.mounted='true';mountedWorkspaceKeys.add(key);
    }
    if(key==='backtest'&&section.open)mountBacktestCharts();
  }
  function populateChartWorkspaces(){
    const container=$('#chart-workspaces');if(!container)return;
    const template=document.createElement('template');template.innerHTML=workspaceControls(true);
    const existing=new Map([...template.content.children].map(el=>[el.dataset.workspaceSection,el]));
    for(const key of workspaceLayout.order){
      if(existing.has(key))container.append(existing.get(key));
      else{
        const fragment=document.createElement('template');
        fragment.innerHTML=workspaceStart(key,workspaceTitles[key])+'<div class="workspace-content"></div></details>';
        const section=fragment.content.firstElementChild;container.append(section);
        if(section.open||mountedWorkspaceKeys.has(key)||key==='options'&&retainedOptionsHost)mountWorkspaceContent(section);
        else mountedWorkspaceKeys.delete(key);
      }
    }
  }
  function setWorkspaceOpen(section,open){
    const key=section.dataset.workspaceSection;
    if(!Object.hasOwn(S.workspaceSections,key))return;
    section.open=open;S.workspaceSections[key]=open;persistWorkspaceLayout();
    if(open)mountWorkspaceContent(section);
  }
  function reorderWorkspace(source,target,after){
    const next=moveWorkspace(workspaceLayout.order,source,target,after);
    if(next.every((key,i)=>key===workspaceLayout.order[i]))return;
    workspaceLayout.order=next;persistWorkspaceLayout();
    const container=$('#chart-workspaces');
    const moved=container.querySelector('[data-workspace-section="'+source+'"]');
    const following=next[next.indexOf(source)+1];
    const anchor=following?container.querySelector('[data-workspace-section="'+following+'"]'):null;
    if(container.moveBefore)container.moveBefore(moved,anchor);else container.insertBefore(moved,anchor);
    moved.querySelector(':scope > summary > .workspace-drag-handle')?.focus({preventScroll:true});
  }
  let workspaceDrag=null;
  function clearWorkspaceDrag(){
    if(!workspaceDrag)return;
    updateWorkspaceDrag.cancel();
    workspaceDrag.handle.closest('details')?.classList.remove('workspace-dragging');
    $('#chart-workspaces')?.querySelectorAll('[data-workspace-drop]').forEach(el=>delete el.dataset.workspaceDrop);
    workspaceDrag=null;
  }
  document.addEventListener('pointerdown',ev=>{
    const handle=ev.target.closest('[data-workspace-drag]');
    if(!handle||ev.button!==0)return;
    ev.preventDefault();clearWorkspaceDrag();
    workspaceDrag={handle,key:handle.dataset.workspaceDrag,pointer:ev.pointerId,startY:ev.clientY,target:null,after:false,started:false};
    handle.setPointerCapture(ev.pointerId);
  });
  const updateWorkspaceDrag=frameLatest(clientY=>{
    const drag=workspaceDrag;if(!drag)return;
    const container=$('#chart-workspaces');if(!container)return;
    // Read geometry before mutating classes / drop markers.
    const sections=[...container.children].filter(el=>el.dataset.workspaceSection!==drag.key);
    const bounds=sections.map(el=>({el,rect:el.getBoundingClientRect()}));
    const target=bounds.find(({rect})=>clientY<=rect.bottom)||bounds.at(-1);
    if(!target)return;
    const after=clientY>target.rect.top+target.rect.height/2;
    if(drag.target!==target.el.dataset.workspaceSection||drag.after!==after){
      container.querySelectorAll('[data-workspace-drop]').forEach(el=>delete el.dataset.workspaceDrop);
      drag.target=target.el.dataset.workspaceSection;drag.after=after;
      target.el.dataset.workspaceDrop=after?'after':'before';
    }
    drag.handle.closest('details').classList.add('workspace-dragging');
    if(clientY<65)window.scrollBy(0,-25);else if(clientY>innerHeight-65)window.scrollBy(0,25);
  });
  document.addEventListener('pointermove',ev=>{
    const drag=workspaceDrag;if(!drag||drag.pointer!==ev.pointerId)return;
    if(!drag.started&&Math.abs(ev.clientY-drag.startY)<5)return;
    drag.started=true;updateWorkspaceDrag(ev.clientY);
  });
  document.addEventListener('pointerup',ev=>{
    const drag=workspaceDrag;if(!drag||drag.pointer!==ev.pointerId)return;
    updateWorkspaceDrag.flush();
    clearWorkspaceDrag();
    if(drag.started&&drag.target)reorderWorkspace(drag.key,drag.target,drag.after);
  });
  document.addEventListener('pointercancel',()=>{updateWorkspaceDrag.cancel();clearWorkspaceDrag();});
  document.addEventListener('keydown',ev=>{
    const handle=ev.target.closest('[data-workspace-drag]');
    if(!handle||!['ArrowUp','ArrowDown','Home','End'].includes(ev.key))return;
    ev.preventDefault();
    const key=handle.dataset.workspaceDrag,index=workspaceLayout.order.indexOf(key);
    const next=ev.key==='Home'?0:ev.key==='End'?workspaceLayout.order.length-1:index+(ev.key==='ArrowUp'?-1:1);
    const target=workspaceLayout.order[next];if(target)reorderWorkspace(key,target,next>index);
  });
  function render(){
    clearWorkspaceDrag();
    if(liveScanPending&&(quickScreenerVisible()||S.tab==='charts'||S.tab==='data'))applyPendingLiveScan();
    const keepOptions=S.tab==='options'||S.tab==='charts'&&(S.workspaceSections.options||mountedWorkspaceKeys.has('options'));
    if(retainedOptionsHost){
      if(keepOptions)retainedOptionsHost.remove();
      else{optionsBuilder.unmount();retainedOptionsHost=null;mountedWorkspaceKeys.delete('options');}
    }
    refreshLeaderboardIfRangeChanged();
    destroyCharts();shell();
    document.body.classList.toggle('chart-fullscreen-active',S.chartFullscreen&&S.tab==='charts');
    document.body.classList.toggle('chart-page-active',S.tab==='charts');
    const main=$('#main');
    if(S.tab==='options')mountOptionsIn(main);
    else main.innerHTML=views[S.tab]();
    if(S.tab==='charts'){
      if(S.data.has(S.symbol)){
        S.chartRecentSymbols=[S.symbol,...S.chartRecentSymbols.filter(symbol=>symbol!==S.symbol)].slice(0,6);
      }
      mountChartResize();mountPriceChart();populateChartWorkspaces();
    }
    if(['charts','backtest','optimize'].includes(S.tab)&&intradayTf(S.chart.tf)&&S.mode==='live'&&
      S.sources.get(S.symbol)==='ALPACA'&&!S.intraday.get(intradayKey(S.symbol))&&
      !S.intradayStatus.get(intradayKey(S.symbol)))
      void Promise.resolve().then(()=>loadLiveIntraday(S.symbol)).catch(()=>{});
    if(S.tab==='backtest')mountBacktestCharts();
    saveSettings();
  }
  const colors={background:'#101515',text:'#a8b7b0',grid:'#23302b',up:'#46d69b',down:'#f08480',yellow:'#e9bd68',blue:'#71b8b3',indicator:'#d69c65'};
  function newChart(el,height=535,priceScaleWidth=55){
    return createChart(el,{autoSize:true,height,layout:{background:{type:'solid',color:colors.background},textColor:colors.text,fontFamily:'system-ui, sans-serif',fontSize:11,panes:{enableResize:true,separatorColor:'#46534d',separatorHoverColor:'#7a9385'}},grid:{vertLines:{color:colors.grid},horzLines:{color:colors.grid}},crosshair:{mode:0},trackingMode:{exitMode:TrackingModeExitMode.OnNextTap},rightPriceScale:{borderColor:'#304357',visible:true,autoScale:true,minimumWidth:priceScaleWidth},timeScale:{borderColor:'#304357',rightOffset:10,barSpacing:8},handleScale:chartScaleOptions(),handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false}});
  }
  function mountChartResize(){
    const handle=$('#chart-resize-handle'), area=$('#price-chart');
    if(!handle||!area)return;
    let drag=null;
    const setHeight=value=>{
      S.chartHeight=Math.round(Math.max(250,Math.min(1600,value)));
      area.style.height=S.chartHeight+'px';
      handle.setAttribute('aria-label','Resize chart height ('+S.chartHeight+' pixels)');
    };
    handle.addEventListener('pointerdown',event=>{
      if((event.pointerType==='mouse'&&event.button!==0)||drag)return;
      drag={pointer:event.pointerId,y:event.clientY,height:area.getBoundingClientRect().height,previous:S.chartHeight};
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-resizing');
      event.preventDefault();
    });
    const resizeFrame=frameLatest(value=>{if(area.isConnected)setHeight(value);});
    handle.addEventListener('pointermove',event=>{
      if(drag?.pointer!==event.pointerId)return;
      resizeFrame(drag.height+event.clientY-drag.y);
    });
    const finish=event=>{
      if(drag?.pointer!==event.pointerId)return;
      const previous=drag.previous;
      if(event.type==='pointercancel')resizeFrame.cancel();else resizeFrame.flush();
      drag=null;
      handle.classList.remove('is-resizing');
      if(event.type==='pointercancel'){
        S.chartHeight=previous;
        area.style.height=previous==null?'':previous+'px';
      }
      saveSettings();
    };
    handle.addEventListener('pointerup',finish);
    handle.addEventListener('pointercancel',finish);
    handle.addEventListener('lostpointercapture',finish);
    const reset=()=>{S.chartHeight=null;area.style.height='';handle.setAttribute('aria-label','Resize chart height');saveSettings();};
    handle.addEventListener('dblclick',reset);
    handle.addEventListener('keydown',event=>{
      if(!['ArrowUp','ArrowDown','Home'].includes(event.key))return;
      event.preventDefault();
      if(event.key==='Home')return reset();
      setHeight(area.getBoundingClientRect().height+(event.key==='ArrowDown'?40:-40));saveSettings();
    });
  }
  function mountPriceChart(){
    const b=chartBars(),el=$('#price-chart');if(!b.length){const state=S.intradayStatus.get(intradayKey(S.symbol));
      el.innerHTML='<div class="empty"><strong>'+ (state?.status==='loading'?'Loading real Alpaca intraday bars':state?.status==='error'?'Live intraday unavailable':'No genuine '+esc(S.chart.tf)+' bars available')+
        '</strong>'+esc(state?.error||'Select a daily timeframe or import timestamped intraday OHLCV. We do not simulate market data.')+'</div>';return;}
    chart=newChart(el);
    chart.timeScale().applyOptions({timeVisible:intradayTf(S.chart.tf),secondsVisible:false});
    mountPriceAxisTouch(el,chart);
    const baseOptions={priceLineVisible:false,lastValueVisible:true};
    const type=S.chart.style==='line'?LineSeries:S.chart.style==='area'?AreaSeries:S.chart.style==='bars'?BarSeries:CandlestickSeries;
    const style=S.chart.style==='candles'?{upColor:colors.up,downColor:colors.down,borderVisible:false,wickUpColor:colors.up,wickDownColor:colors.down}:S.chart.style==='bars'?{upColor:colors.up,downColor:colors.down}:{color:colors.blue,lineColor:colors.blue,topColor:'#278cb263',bottomColor:'#278cb200',lineWidth:2};
    const base=chart.addSeries(type,{...baseOptions,...style});
    const datapoints=b.map(x=>S.chart.style==='line'||S.chart.style==='area'?{time:x.time,value:x.close}:{time:x.time,open:x.open,high:x.high,low:x.low,close:x.close});
    base.setData(datapoints);
    let workspaceLines=[],lastWorkspaceLevels='';
    refreshWorkspaceOverlays=()=>{
      if(!el.isConnected)return;
      const alerts=chartTools.alertLevels?chartAlertLevels(S.alerts,S.symbol):[];
      const strikes=chartTools.strikes?chartOptionLevels(optionsBuilder.chartPositions(),S.symbol):[];
      const key=JSON.stringify([alerts,strikes]);
      if(lastWorkspaceLevels!==key){
        lastWorkspaceLevels=key;
        for(const line of workspaceLines)base.removePriceLine(line);
        workspaceLines=[
          ...alerts.map(level=>base.createPriceLine({price:level.price,title:level.label,color:level.active?'#e9bd68':'#d69c65',lineWidth:1,lineStyle:2,axisLabelVisible:true})),
          ...strikes.map(level=>base.createPriceLine({price:level.price,title:level.label,color:'#71b8b3',lineWidth:1,lineStyle:3,axisLabelVisible:true}))
        ];
        el.dataset.workspaceAlertLevels=String(alerts.length);
        el.dataset.workspaceStrikeLevels=String(strikes.length);
      }
      const status=$('#chart-workspace-options-status');
      if(status)status.textContent=optionWorkspaceStatus();
      const alertStatus=$('#chart-workspace-alert-status');
      if(alertStatus)alertStatus.textContent=alertWorkspaceStatus();
    };
    refreshWorkspaceOverlays();
    const instances=indicatorInstances();
    const c=b.map(x=>x.close),indicatorData=new Map(),indicatorPanes=new Map();
    for(const {id,type,length,color} of movingAverages(S.chart)){
      const vals=(type==='ema'?ema:sma)(c,length);
      indicatorData.set(id,[vals]);
      const series=chart.addSeries(LineSeries,{color,lineWidth:1,priceLineVisible:false,lastValueVisible:true});
      series.setData(vals.flatMap((v,i)=>v==null?[]:[{time:b[i].time,value:v}]));
    }
    const plot=(values,options,pane=0)=>{
      const series=chart.addSeries(LineSeries,{lineWidth:1,priceLineVisible:false,...options},pane);
      series.setData(values.flatMap((value,i)=>value==null?[]:[{time:b[i].time,value}]));
      return series;
    };
    let pane=1;
    for(const {id,type,settings} of instances){
      if(type==='bollinger'){
        const {basis,upper,lower}=bollingerSeries(c,settings.bollPeriod);
        indicatorData.set(id,[basis,upper,lower]);
        for(const values of [upper,lower])plot(values,{color:indicatorColors.bollinger});
      }
      if(type==='volume'){
        indicatorData.set(id,[b.map(bar=>bar.volume??null)]);
        const vol=chart.addSeries(HistogramSeries,{priceScaleId:id,priceLineVisible:false,lastValueVisible:false,priceFormat:{type:'volume'}});
        vol.setData(b.map(x=>({time:x.time,value:x.volume||0,color:x.close>=x.open?'#317c6c88':'#8a3c5388'})));
        vol.priceScale().applyOptions({scaleMargins:{top:1-settings.volumeHeight/100,bottom:0}});
      }
      if(type==='rsi'){
        indicatorPanes.set(id,pane);
        const values=rsi(c,settings.rsiPeriod);
        indicatorData.set(id,[values]);
        const rs=plot(values,{color:colors.indicator},pane++);
        for(const v of [30,50,70])rs.createPriceLine({price:v,color:v===50?'#536980':'#9c6a70',lineWidth:1,lineStyle:2,axisLabelVisible:false});
      }
      if(type==='macd'){
        indicatorPanes.set(id,pane);
        const {macd,signal}=macdSeries(c,settings);
        indicatorData.set(id,[macd,signal]);
        plot(macd,{color:colors.blue},pane);
        plot(signal,{color:colors.yellow},pane++);
      }
    }
    if(S.chart.log)base.priceScale().applyOptions({mode:PriceScaleMode.Logarithmic});
    for(const p of S.chart.lines[S.symbol]||[])base.createPriceLine({price:p,color:'#e4b766',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'Level'});
    const pineMarkers=[];
    const tradeMarkers=chartTools.trades&&S.result&&S.resultSymbol===S.symbol&&S.resultTf===S.chart.tf?
      matchingTradeMarkers(tradeFillMarkers(S.result.trades),b):[];
    pineMarkers.push(...tradeMarkers);
    el.dataset.workspaceTradeMarkers=String(tradeMarkers.length);
    const custom=chartTools.pine?[...S.activeIndicators]:[];
    if(chartTools.pine&&S.bt.strategy==='pine-custom'&&S.activeStrategy)custom.push({...S.activeStrategy,id:'strategy'});
    let renderedPineScripts=0;
    const pineErrors=[],pineBars=b.slice(-6000);
    for(const item of custom){
      try{
        const program=compilePine(item.code),evaluated=executePine(program,pineBars,item.settings||{});
        const paneIndex=program.overlay?0:chart.panes().length;
        let firstScriptSeries=null;
        for(const p of evaluated.plots){
          const data=p.values.flatMap((v,k)=>Number.isFinite(v)?[{time:pineBars[k].time,value:v}]:[]);
          if(!data.length)continue;
          const series=chart.addSeries(LineSeries,{color:p.color,lineWidth:2,priceLineVisible:false,lastValueVisible:false,title:String(item.name||program.title)+' · '+p.title},paneIndex);
          series.setData(data);firstScriptSeries ||= series;
        }
        const scriptMarkers=[];
        for(const shape of evaluated.shapes){
          shape.values.forEach((active,k)=>{
            if(active)scriptMarkers.push({time:pineBars[k].time,position:shape.position==='location.abovebar'?'aboveBar':'belowBar',shape:shape.position==='location.abovebar'?'arrowDown':'arrowUp',color:shape.color,text:shape.title.slice(0,20)});
          });
        }
        if(!program.overlay&&firstScriptSeries&&scriptMarkers.length)
          createSeriesMarkers(firstScriptSeries,scriptMarkers.sort((a,b)=>stamp(a.time)-stamp(b.time)));
        else pineMarkers.push(...scriptMarkers);
        if(firstScriptSeries||scriptMarkers.length)renderedPineScripts++;
      }catch(error){pineErrors.push((item.name||'Custom script')+': '+error.message);}
    }
    el.dataset.workspacePineScripts=String(renderedPineScripts);
    const panes=chart.panes();
    if(panes.length>1)panes[0].setStretchFactor(3);
    const legend=$('#chart-indicator-legend');
    const valuesByIndicator=new Map([...legend.querySelectorAll('[data-indicator-row]')].map(row=>
      [row.dataset.indicatorRow,row.querySelector('.chart-indicator-value')]));
    requestAnimationFrame(()=>{
      if(!el.isConnected)return;
      for(const [key,index] of indicatorPanes){
        const cell=panes[index]?.getHTMLElement()?.children[1];
        const row=legend.querySelector('[data-indicator-row="'+key+'"]');
        if(cell&&row){
          const localLegend=document.createElement('div');
          localLegend.className='chart-indicator-legend chart-pane-legend';
          localLegend.setAttribute('role','group');
          localLegend.setAttribute('aria-label',instanceLabel(instances.find(item=>item.id===key))+' pane');
          localLegend.append(row);
          cell.append(localLegend);
        }
      }
    });
    if(pineMarkers.length)createSeriesMarkers(base,pineMarkers.sort((a,b)=>stamp(a.time)-stamp(b.time)));
    const errorBox=$('#pine-chart-error');
    if(errorBox&&pineErrors.length){errorBox.className='pine-error';errorBox.textContent=pineErrors.join(' | ');}

    chart.subscribeClick(param=>{if(!S.drawLine||!param.point)return;const p=base.coordinateToPrice(param.point.y);if(p==null||!Number.isFinite(p))return;const price=Number(p.toFixed(4));(S.chart.lines[S.symbol]??=[]).push(price);base.createPriceLine({price,color:'#e4b766',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'Level'});S.drawLine=false;saveSettings();notice('Added horizontal price level at '+format(price,4));});
    const barIndices=new Map(b.map((bar,index)=>[stamp(bar.time),index]));
    const readout=$('#readout');
    let displayedIndex=b.length-1;
    const indicatorTypes=new Map(instances.map(item=>[item.id,item.type]));
    const updateReadout=frameLatest(index=>{
      if(!el.isConnected||index===displayedIndex)return;
      displayedIndex=index;
      readout.innerHTML=chartReadout(b[index]);
      for(const [key,series] of indicatorData){
        const [value,...details]=series.map(values=>values[index]);
        const node=valuesByIndicator.get(key),next=indicatorValue(indicatorTypes.get(key)??key,value,details);
        if(node&&node.textContent!==next)node.textContent=next;
      }
    });
    chart.subscribeCrosshairMove(param=>updateReadout((param.time==null?undefined:barIndices.get(stamp(param.time)))??b.length-1));
    const viewKey=S.symbol+'|'+S.chart.tf;
    const savedView=S.chartViews[viewKey];
    const timeScale=chart.timeScale();
    const scale=base.priceScale();
    showRange(180);
    if(savedView?.range&&!S.pendingChartRange){
      try{timeScale.setVisibleRange(savedView.range);}catch{}
    }
    if(savedView?.price?.from<savedView?.price?.to){
      scale.setAutoScale(false);
      scale.setVisibleRange(savedView.price);
    }
    if(savedView?.panes?.length===panes.length){
      panes.forEach((pane,index)=>pane.setStretchFactor(savedView.panes[index]));
    }
    if(S.pendingChartRange){
      try{chart.timeScale().setVisibleLogicalRange(S.pendingChartRange);}catch{}
      S.pendingChartRange=null;
    }
    let dotLayer=null,medianStops=[];
    const stopMedian=()=>{
      for(const stop of medianStops.splice(0))stop();
      if(dotLayer){dotLayer.dispose();dotLayer=null;}
      viewMedianDots=null;
      legend.querySelectorAll('[data-indicator-row]').forEach(row=>{
        if(row.querySelector('.chart-options-median-result'))row.remove();
      });
    };
    syncMedianChart=()=>{
      const before=timeScale.getVisibleLogicalRange(),hadDots=dotLayer?.hasPoints();
      stopMedian();
      const medians=indicatorInstances().filter(item=>isOptionProjection(item.type));
      if(!medians.length){
        if(hadDots&&before&&before.to>b.length+3)
          timeScale.setVisibleLogicalRange({from:Math.max(0,b.length-Math.min(180,Math.max(30,before.to-before.from))),to:b.length+3});
        else if(before)timeScale.setVisibleLogicalRange(before);
        return;
      }
      const template=document.createElement('template');template.innerHTML=chartIndicatorLegend(b);
      for(const row of template.content.querySelectorAll('[data-indicator-row]')){
        if(row.querySelector('.chart-options-median-result'))legend.append(row);
      }
      dotLayer=createMedianDotLayer({chart,base,lineSeries:LineSeries,lastTime:b.at(-1).time,tf:S.chart.tf,
        onView:()=>{if(S.chartViews[viewKey]?.price){S.chartViews[viewKey].price=null;saveSettings();}}});
      viewMedianDots=()=>dotLayer?.show()||false;
      for(const instance of medians)medianStops.push(mountOptionsMedian(dotLayer,instance));
    };
    medianUnmount.push(stopMedian);
    syncMedianChart();
    let viewTimer;
    const rememberChartView=()=>{
      clearTimeout(viewTimer);
      viewTimer=setTimeout(()=>{
        if(!el.isConnected)return;
        const range=timeScale.getVisibleRange();
        if(!range)return;
        const price=scale.options().autoScale?null:scale.getVisibleRange();
        delete S.chartViews[viewKey];
        S.chartViews[viewKey]={range,price,panes:panes.map(pane=>pane.getStretchFactor())};
        const keys=Object.keys(S.chartViews);
        if(keys.length>100)delete S.chartViews[keys[0]];
        saveSettings();
      },200);
    };
    timeScale.subscribeVisibleTimeRangeChange(rememberChartView);
    el.addEventListener('pointerup',rememberChartView);
    el.addEventListener('touchend',rememberChartView,{passive:true});
    el.addEventListener('dblclick',rememberChartView);
    $('[data-action="reset-price-scale"]')?.addEventListener('click',rememberChartView);
    if(liveChartHistory()){
      let gestureUntil=0;
      const atLeftEdge=range=>{
        if(!el.isConnected||!range||range.from>1||performance.now()>gestureUntil)return;
        gestureUntil=0;
        void loadOlderChart();
      };
      const checkLeftEdge=frameLatest(()=>{if(el.isConnected)atLeftEdge(timeScale.getVisibleLogicalRange());});
      const arm=()=>{
        gestureUntil=performance.now()+400;
        checkLeftEdge();
      };
      timeScale.subscribeVisibleLogicalRangeChange(atLeftEdge);
      el.addEventListener('wheel',arm,{passive:true});
      el.addEventListener('mousemove',event=>{if(event.buttons===1)arm();},{passive:true});
      el.addEventListener('touchmove',arm,{passive:true});
    }
  }
  function showChartMonths(months){
    const history=chartBars();if(!history.length)return;
    const cutoff=new Date(stamp(history.at(-1).time)*1000);
    cutoff.setUTCMonth(cutoff.getUTCMonth()-months);
    const first=history.findIndex(b=>stamp(b.time)*1000>=cutoff.getTime());
    showRange(first<0?history.length:history.length-first);
  }
  function showRange(n){
    if(!chart)return;const total=chartBars().length;
    try{if(!n||n>=total)chart.timeScale().fitContent();else chart.timeScale().setVisibleLogicalRange({from:Math.max(0,total-n),to:total+3});}catch{}
  }
  function tradeFillMarkers(trades){
    return trades.flatMap(t=>[
      {time:t.entry,position:t.side==='short'?'aboveBar':'belowBar',color:t.side==='short'?colors.down:colors.up,shape:t.side==='short'?'arrowDown':'arrowUp',text:t.side==='short'?'SHORT':'BUY'},
      {time:t.exit,position:t.side==='short'?'belowBar':'aboveBar',color:t.pnl>=0?colors.up:colors.down,shape:t.side==='short'?'arrowUp':'arrowDown',text:'EXIT'}
    ]);
  }
  function mountBacktestPriceChart(){
    const el=$('#backtest-price-chart'),result=S.result;
    if(!el)return;
    const history=barsFor(S.resultSymbol,S.resultTf);
    const first=result.range?.actualStart||dateLabel(result.curve[0].time).slice(0,10);
    const last=result.range?.actualEnd||dateLabel(result.curve.at(-1).time).slice(0,10);
    const selected=windowBacktestBars(history,{startDate:first,endDate:last},{allowEmpty:true}).bars;
    if(!selected.length){el.textContent='Price candles for this saved result are unavailable.';return;}
    tradeChart=newChart(el,380);
    const price=tradeChart.addSeries(CandlestickSeries,{upColor:colors.up,downColor:colors.down,
      wickUpColor:colors.up,wickDownColor:colors.down,borderVisible:false});
    price.setData(selected);
    const times=new Set(selected.map(bar=>stamp(bar.time)));
    const markers=tradeFillMarkers(result.trades).filter(marker=>times.has(stamp(marker.time)))
      .sort((a,b)=>stamp(a.time)-stamp(b.time));
    if(markers.length)createSeriesMarkers(price,markers);
    el.dataset.tradeMarkers=String(markers.length);
    if(S.bt.strategy==='pine-custom'&&S.activeStrategy){
      try{
        const {code,settings}=S.activeStrategy;
        const plots=executePine(code,selected,settings);
        const pane=plots.overlay?0:1;
        for(const plot of plots.plots){
          const data=plot.values.flatMap((value,i)=>Number.isFinite(value)?[{time:selected[i].time,value}]:[]);
          if(!data.length)continue;
          tradeChart.addSeries(LineSeries,{color:plot.color,title:plot.title,lineWidth:1,
            priceLineVisible:false,lastValueVisible:false},pane).setData(data);
        }
        if(tradeChart.panes().length>1)tradeChart.panes()[0].setStretchFactor(3);
      }catch(error){el.setAttribute('aria-description',error.message);}
    }
    tradeChart.timeScale().fitContent();
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
    if(symbols){showWorkspace('data');S.result=null;S.sweep=null;render();notice('Loaded '+total+' bars across '+symbols+' symbol file sets. '+skipped+' invalid rows skipped.');}
  }
  function exportFile(name,contents,mime='text/csv'){
    const obj=new Blob([contents],{type:mime}),url=URL.createObjectURL(obj),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function selectedBacktestWindow(){
    const window=windowBacktestBars(bars(),S.btRange);
    if(window.bars.length<40)throw Error('Selected backtest date range has only '+
      window.bars.length+' bars; at least 40 are required. Choose a wider range.');
    return window;
  }
  function backtestConfig(bars,options,script){
    const cfg={...options,timeframe:S.chart.tf};
    if(cfg.strategy==='pine-custom'){
      const program=compilePine(script.code);
      if(program.mode!=='strategy')throw new PineError(1,'Select a strategy() script to backtest');
      cfg.side='script';
      cfg.customSignals=executePine(program,bars,script.settings).signals;
    }
    return cfg;
  }
  const runBt=()=>{
    let window;
    try{window=selectedBacktestWindow();}
    catch(error){S.backtestError=String(error.message||error);notice(S.backtestError);return false;}
    try{
      const script=backtestScript();
      S.result=backtest(window.bars,backtestConfig(window.bars,S.bt,script));
      if(S.bt.strategy==='pine-custom')S.activeStrategy=structuredClone(script);
      S.result.range=window.range;
      S.result.source=S.sources.get(S.symbol)==='ALPACA'?
        'ALPACA '+String(S.liveFeed).toUpperCase()+' '+S.chart.tf:
        'IMPORTED CSV OHLCV';
      S.backtestError='';S.resultSymbol=S.symbol;S.resultTf=S.chart.tf;rememberAnalysis();return true;
    }catch(err){
      S.backtestError=err.message;notice(err.message);return false;
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
  async function fetchLiveUniverse(options={}){
    let base=canonicalWorkerBase(S.apiBaseUrl);
    if(!base.startsWith('https://'))throw new Error('Enter the Cloudflare Worker URL in Data Center first.');
    S.scan={status:'loading',source:'ALPACA'};
    refreshMarketMode();
    if(quickScreenerVisible())refreshScreenerResults();
    const scanStartedAt=performance.now();
    const requestHistory=async (workerBase)=>{
      const response=await fetch(liveScanUrl(workerBase,S.liveFeed||'iex'),{
        headers:{Accept:'application/json'},cache:'no-store'});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||payload.detail||
        'Alpaca market scan failed ('+response.status+').');
      return {response,payload,history:inspectLiveHistory(payload)};
    };
    let {response,payload,history}=await requestHistory(base),recovered=false;
    if(shouldTryDefaultWorker(base,history)){
      const fallback=await requestHistory(DEFAULT_ALPACA_WORKER);
      if(!fallback.history.ok)throw new Error('Both selected and default Workers returned short history. '+
        fallback.history.reason);
      ({response,payload,history}=fallback);
      base=DEFAULT_ALPACA_WORKER;
      recovered=true;
    }
    if(!history.ok)throw new Error('Stale or truncated live daily history rejected. '+
      history.reason+' Check the configured Worker URL or reload the site.');
    const raw=payload.bars&&typeof payload.bars==='object'?payload.bars:{},parsed=[];
    let sliceStart=performance.now();
    for(const [symbol,items] of Object.entries(raw)){
      const liveBars=alpacaBars(items,'1Day');
      if(liveBars.length)parsed.push([symbol,liveBars]);
      // Large scans should yield between symbols rather than monopolize input
      // and chart painting for the entire normalization pass.
      if(performance.now()-sliceStart>=12){
        await new Promise(resolve=>setTimeout(resolve,0));sliceStart=performance.now();
      }
    }
    if(!parsed.length)throw new Error('Alpaca returned no daily bars for the bundled universe. Check the feed and subscription.');
    const remembered=options.restoreSymbol;
    if(options.restoreTab&&remembered&&!parsed.some(([symbol])=>symbol===remembered)&&
      (market.rows.has(remembered)||saved.lastLiveSymbol===remembered)){
      try{
        const url=new URL('/api/stocks/bars',base);
        url.searchParams.set('symbol',remembered);
        const extra=await fetch(url);
        if(extra.ok){
          const bars=alpacaBars((await extra.json()).bars,'1Day');
          if(bars.length)parsed.push([remembered,bars]);
        }
      }catch{}
    }
    return {base,response,payload,history,recovered,parsed,durationMs:performance.now()-scanStartedAt};
  }
  function applyLiveUniverse(result,options){
    const {base,response,payload,history,recovered,parsed,durationMs}=result;
    if(recovered)S.apiBaseUrl=base;
    const selected=S.symbol;
    for(const [symbol,source] of S.sources)if(source==='ALPACA'&&symbol!==selected){S.sources.delete(symbol);S.data.delete(symbol);}
    const loaded=[];
    for(const [symbol,liveBars] of parsed){S.data.set(symbol,liveBars);S.sources.set(symbol,'ALPACA');loaded.push(symbol);}
    S.mode='live';S.liveFeed=payload.feed||'iex';
    const visible=loaded.filter(isVisibleSymbol);
    const remembered=modeSymbol(selected)?selected:options.restoreSymbol||S.lastBacktestSymbol||S.lastLiveSymbol;
    const target=remembered&&modeSymbol(remembered)?remembered:visible[0]||loaded[0];
    S.preferredMode='live';
    if(target!==selected){
      const timeframe=S.chart.tf;
      restoreSymbolState(target);
      if(options.restoreTab==='charts')S.chart.tf=timeframe;
    }
    const matched=visible.filter(symbol=>screenSymbol(S.data.get(symbol),S.rules).pass).length;
    const expected=payload.freshness?.expected||expectedNyseBarDate(new Date());
    const allBars=Object.fromEntries(LIVE_UNIVERSE.map(sym=>[sym,S.sources.get(sym)==='ALPACA'?S.data.get(sym):[]]));
    S.freshness=scanFreshness(allBars,expected);
    S.staleDiagnostics=payload.diagnostics||{};
    S.scan={status:'complete',source:'ALPACA',requested:payload.requested||LIVE_UNIVERSE.length,returned:loaded.length,
      matched,missing:payload.missing||[],cached:response.headers.get('X-Scan-Cache')==='HIT',
      retry:payload.retry||null,at:new Date().toISOString(),
      durationMs,workerDurationMs:payload.scan_duration_ms??null,
      history:{...history,baseUrl:base,revision:payload.scan_cache_revision||'unreported',
        recovered}};
    evaluateScreenerSignals(true);
    evaluateLocalAlerts();
    saveSettings();
  }
  function applyPendingLiveScan(){
    const pending=liveScanPending;
    liveScanPending=null;
    if(pending.error){
      S.scan={status:'fallback',source:'ALPACA',error:pending.error};
      saveSettings();
    }else applyLiveUniverse(pending.result,pending.options);
  }
  function refreshMarketMode(){
    const header=$('.topbar .top-actions');
    if(!header)return;
    header.querySelector('.source-badge').textContent=status();
    const existing=header.querySelector('[data-action="mode-live"]');
    if(!hasLiveData()&&S.scan.status==='fallback'&&!existing){
      const retry=document.createElement('button');
      retry.type='button';retry.className='btn small live-retry';retry.dataset.action='mode-live';retry.textContent='Retry data';
      header.querySelector('.source-badge').after(retry);
    }else if(existing&&(hasLiveData()||S.scan.status!=='fallback'))existing.remove();
  }
  async function switchToLive(options={}){
    if(liveScanActive)return liveScanActive;
    liveScanPending=null;
    const initialMain=$('#main');
    S.preferredMode='live';
    liveScanActive=(async()=>{
      let pending;
      try{pending={result:await fetchLiveUniverse(options),options};}
      catch(err){pending={error:err.message,options};}
      if(S.preferredMode!=='live')return;
      liveScanPending=pending;
      if(quickScreenerVisible()){
        applyPendingLiveScan();refreshMarketMode();refreshScreenerResults();
      }else if((options.restoreTab&&initialMain===$('#main'))||!hasLiveData()||S.tab==='data'||options.chartRefresh&&S.tab==='charts'){
        // Refresh integrated workspaces and chart from the same live-data snapshot.
        if(S.tab==='charts'&&chart)preserveChartViewport();
        applyPendingLiveScan();render();
      }
    })();
    try{await liveScanActive;}
    finally{liveScanActive=null;}
  }
  function loadPineSource(code,name,id=null){
    S.scriptCode=code;S.scriptName=name;S.scriptId=id;S.scriptSettings={};S.scriptOutput=null;
    parseCurrentPine();persistPineDraft();showWorkspace('scripts');render();
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
    S.scriptId=id;persistPineLibrary();persistPineDraft();S.scriptOutput='Saved: '+name;render();
  }
  async function executeCurrentPine(){
    try{
      const program=compilePine(S.scriptCode);
      S.scriptParsed=program;S.scriptError='';
      if(program.mode==='indicator'){
        const evaluated=executePine(program,bars(),S.scriptSettings);
        const id=S.scriptId||'draft',record={id,name:S.scriptName,code:S.scriptCode,settings:{...S.scriptSettings}};
        S.activeIndicators=[...S.activeIndicators.filter(x=>x.id!==id),record].slice(-4);
        S.scriptOutput='Indicator applied to Chart Lab: '+program.title+' ('+evaluated.plots.length+' lines, '+evaluated.shapes.length+' shape series).';
        S.tab='charts';
      }else{
        S.backtestPineDraft={code:S.scriptCode,settings:{...S.scriptSettings},name:program.title};
        S.bt.strategy='pine-custom';
        S.portfolioMode=false;
        showWorkspace('backtest');
        S.lastBacktestSymbol=S.symbol;
        S.result=null;S.sweep=null;
        if(!await ensureAnalysisBars('Backtest'))return;
        if(workspaceActive('backtest'))runBt();
      }
      persistPineDraft();render();
    }catch(err){S.scriptError=err.message;S.scriptOutput=null;showWorkspace('scripts');render();}
  }
  function sweepCurrentPine(fromScript=false){
    try{
      const script=(fromScript||S.tab==='scripts')?{code:S.scriptCode,settings:S.scriptSettings}:backtestScript();
      const program=compilePine(script.code);
      if(program.mode!=='strategy')throw new PineError(1,'A parameter sweep needs a strategy() script');
      const rows=sweepPine(program,bars(),backtest,{...S.bt,side:'script',timeframe:S.chart.tf},script.settings);
      S.sweep=rows;S.bt.strategy='pine-custom';rememberAnalysis();S.scriptError='';S.scriptOutput='Tested '+rows.length+' Pine input variations with 70/30 train and holdout periods.';
      showWorkspace('optimize');render();
    }catch(err){S.scriptError=err.message;showWorkspace('scripts');render();}
  }
  function loadSavedScan(id,openPanel=true){
    const found=S.savedScans.find(item=>item.id===id);
    if(!found){notice('Choose a saved scan first.');return;}
    S.rules=found.rules.map(x=>({...x}));S.universeFilter=found.universeFilter;
    S.query=found.query;S.showOnlyMatches=found.showOnlyMatches;S.showWatch=found.showWatch;
    S.sort=found.sort;S.ascending=found.ascending;S.savedScanView=found;S.savedScanId=id;
    if(openPanel)showWorkspace('screener');else{S.scanReview=null;preserveChartViewport();}render();
  }
  function exportScreenerCsv(){
    const data=screenerRows();
    const rows=data.map(r=>{
      const ema=r.d.ema200==null?null:100*(r.d.price/r.d.ema200-1);
      const weeklyEma=r.w?.ema200==null?null:100*(r.w.price/r.w.ema200-1);
      return {Symbol:r.symbol,Source:r.source,Close:r.d.price,RSI_D:r.d.rsi,RSI_W:r.w.rsi,RSI_5D:r.d.rsi5,
        Pct_vs_D_EMA200:ema,Pct_vs_W_EMA200:weeklyEma,Return_20D_pct:r.d.ret20,Drawdown_pct:r.d.drawdown,Bars:r.d.bars,
        Match:r.evalResult.pass?'MATCH':'NO MATCH',
        LatestBar:r.latestBar||'',SignalStrategy:marketShown()?'':S.signalSelection,Signal:r.signal?.status||'',
        SignalBar:r.signal?.barDate||'',Source:r.source,
        SnapshotDate:S.savedScanView?.savedAt||new Date().toISOString()};
    });
    exportFile('market-lens-screener-'+new Date().toISOString().slice(0,10)+'.csv',csvDownload(rows));
  }
  function addLocalAlert(draft=S.alertDraft){
    try{
      if(S.alerts.length>=ALERT_LIMIT)throw Error('Maximum '+ALERT_LIMIT+' in-app alerts reached');
      const available=[...S.data.keys()].filter(modeSymbol);
      const candidate={...draft,symbol:available.includes(draft.symbol)?draft.symbol:available[0]};
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
      id,name,source:S.savedScanView?.source||'ALPACA / IMPORTED',rules:S.rules,
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
      const window=validateBacktestRange(S.btRange);
      const filtered=windowPortfolioData(S.data,symbols,window);
      S.portfolioResult=runPortfolio(filtered,symbols,option,backtest,signals,{
        sources:S.sources,sourceSummary:S.mode==='live'?
          'ALPACA '+String(S.liveFeed).toUpperCase()+' 1Day bars · Worker scan '+(S.scan.at||'not available'):
          'SIMULATED Demo / imported OHLCV daily bars'
      });
      S.portfolioResult.mode='portfolio';
      S.portfolioResult.range=actualPortfolioRange(S.portfolioResult.curve,window);
      S.portfolioError='';rememberPortfolio();showWorkspace('backtest');render();
    }catch(error){S.portfolioError=String(error.message||error);showWorkspace('backtest');render();notice(S.portfolioError);}
  }
  let bestFitRunSerial=0,bestFitAttempted=S.portfolioResult?.mode==='best-fit';
  async function runBestFitCurrent(){
    const runId=++bestFitRunSerial;
    bestFitAttempted=true;
    let symbols,window;
    try{
      symbols=portfolioSelection();
      window=validateBacktestRange(S.btRange);
      if(!symbols.length)throw Error('No symbols selected. Choose scan matches or a populated watchlist.');
    }catch(error){S.portfolioError=String(error.message||error);showWorkspace('backtest');render();return;}
    S.portfolioError='';S.portfolioLoading=true;showWorkspace('backtest');render();
    // Yield to render progress; an edited date or toggle supersedes an obsolete run.
    await new Promise(resolve=>setTimeout(resolve,0));
    if(runId!==bestFitRunSerial)return;
    try{
      const result=runBestFitPortfolio({data:S.data,symbols,range:window,options:{...S.bt,timeframe:'D'},
        validatedOnly:S.bestFitValidatedOnly,
        backtest,compilePine,executePine,sources:S.sources,
        savedScripts:S.scriptLibrary,builtInExamples:PINE_EXAMPLES,
        sourceSummary:S.mode==='live'?
          'ALPACA '+String(S.liveFeed).toUpperCase()+' 1Day bars · Worker scan '+(S.scan.at||'not available'):
          'SIMULATED Demo / imported daily OHLCV'});
      if(runId!==bestFitRunSerial)return;
      S.portfolioResult=result;S.portfolioError='';rememberPortfolio();
    }catch(error){if(runId===bestFitRunSerial){S.portfolioError=String(error.message||error);notice(S.portfolioError);}}
    finally{if(runId===bestFitRunSerial){S.portfolioLoading=false;showWorkspace('backtest');render();}}
  }
  function runPortfolioOptimization(){
    try{
      const symbols=portfolioSelection(),{option,signals,inputs}=portfolioStrategyContext();
      S.portfolioSweep=runPortfolioSweep(S.data,symbols,option,backtest,signals,{pineInputs:inputs,sources:S.sources});
      S.portfolioError='';rememberPortfolio();showWorkspace('optimize');render();
    }catch(error){S.portfolioError=error.message;showWorkspace('optimize');render();notice(error.message);}
  }


  let fitRunSerial=0,fitEverStarted=false,fitConfig=null;
  async function runUniverseFitCurrent({reuseData=false}={}){
    const runId=++fitRunSerial;
    if(!reuseData||!fitConfig){
      const cfg={...S.bt};
      const script=cfg.strategy==='pine-custom'?
        {...(S.activeStrategy||{code:S.scriptCode,settings:{...S.scriptSettings}})}:null;
      fitConfig={cfg,script};
    }
    fitEverStarted=true;
    const {cfg,script}=fitConfig;
    S.fitReport=null;S.fitValidatedReport=null;
    S.fitError='';S.fitStatus=reuseData?'Recalculating both rankings for selected dates…':
      'Fetching '+LIVE_UNIVERSE.length+' Alpaca daily OHLCV histories…';
    render();
    try{
      if(!reuseData){
        const options={restoreTab:'backtest',restoreSymbol:S.mode==='live'?S.symbol:S.lastLiveSymbol};
        const result=await fetchLiveUniverse(options);
        if(runId!==fitRunSerial)return;
        if(!workspaceActive('backtest')){
          liveScanPending={result,options};
          S.fitStatus='';
          return;
        }
        applyLiveUniverse(result,options);
      }
      if(runId!==fitRunSerial)return;
      S.fitStatus='Ranking '+LIVE_UNIVERSE.length+' symbols by training Sharpe…';
      if(workspaceActive('backtest'))render();
      await new Promise(resolve=>setTimeout(resolve,0));
      const histories=new Map(LIVE_UNIVERSE.filter(sym=>S.sources.get(sym)==='ALPACA')
        .map(sym=>[sym,S.data.get(sym)]));
      const common={symbols:LIVE_UNIVERSE,data:histories,options:cfg,
        backtest,compilePine,executePine,dateRange:{...S.btRange},
        expectedBarDate:S.freshness?.expected||expectedNyseBarDate(),
        sourceFor:sym=>histories.has(sym)?
          'ALPACA '+String(S.liveFeed).toUpperCase()+' 1Day':'NO ALPACA BARS'};
      S.fitReport=fitAcrossUniverse({...common,strategyScript:script});
      S.fitSort='sharpe';S.fitDescending=true;
      S.fitStatus='Evaluating preset and Pine strategies for validated OOS fit…';if(workspaceActive('backtest'))render();
      const validated=await fitValidatedAcrossUniverse({...common,
        savedScripts:S.scriptLibrary,builtInExamples:PINE_EXAMPLES,
        isCancelled:()=>runId!==fitRunSerial,
        onProgress:(done,passing)=>{
          if(runId!==fitRunSerial)return;
          S.fitStatus='Validating '+done+'/'+LIVE_UNIVERSE.length+
            ' symbols · '+passing+' currently qualify…';
          const el=document.getElementById('fit-status');
          if(el)el.textContent=S.fitStatus;
        }});
      if(runId!==fitRunSerial)return;
      S.fitValidatedReport=validated;S.fitStatus='';S.fitError='';if(workspaceActive('backtest'))render();
    }catch(err){
      if(runId!==fitRunSerial)return;
      S.fitStatus='';S.fitError=String(err.message||err);if(workspaceActive('backtest'))render();
    }
  }
  function loadUniverseFitBest(){
    const report=S.fitValidatedOnly?S.fitValidatedReport:S.fitReport;
    const best=S.fitValidatedOnly?report?.rows[0]:bestUniverseFit(report?.rows||[]);
    if(!best){notice('No eligible symbol in this fit.');return;}
    if(S.fitValidatedOnly&&!Number.isFinite(best.rollingMeanSharpe)){
      notice('No validated symbol has a numeric rolling mean OOS Sharpe.');return;
    }
    restoreSymbolState(best.symbol);S.bt={...S.bt,...report.settings};
    const winner=S.fitValidatedOnly?best.validatingStrategy:null;
    if(winner)S.bt.strategy=winner.strategy;
    const script=winner?.script||report.script;
    S.chart.tf='D';S.activeStrategy=script?{...script}:null;
    if(script){
      S.scriptCode=script.code;S.scriptSettings={...(script.settings||{})};
      parseCurrentPine();persistPineDraft();
    }
    S.lastBacktestSymbol=best.symbol;showWorkspace('backtest');
    if(runBt())render();
  }

  function comparisonSource(){
    return S.sources.get(S.symbol)==='ALPACA'?
      'Alpaca '+String(S.liveFeed).toUpperCase()+' OHLCV':
      'IMPORTED CSV OHLCV';
  }
  function comparisonContext(){
    return {bars:bars(),range:S.btRange,symbol:S.symbol,
      timeframe:S.chart.tf,source:comparisonSource()};
  }
  function recalculateComparison(){
    const context=comparisonContext();
    const report=compareStrategiesInRange({...context,
      options:{...S.bt,timeframe:S.chart.tf},
      builtInExamples:PINE_EXAMPLES,backtest,compilePine,executePine,savedScripts:S.scriptLibrary});
    S.leaderboard=report;S.leaderboardSort='sharpe';S.leaderboardDescending=true;
    S.leaderboardError='';rememberLeaderboard();
    return report;
  }
  // A restored report or a date-picker edit may not match today's controls.
  // Rebuild before rendering, or show a conspicuous warning WITHOUT stale rows.
  let leaderboardRefreshAttempt='';
  function refreshLeaderboardIfRangeChanged(){
    if(!workspaceActive('backtest')||S.portfolioMode||S.leaderboard?.symbol!==S.symbol)return;
    const context=comparisonContext(),status=leaderboardRangeStatus(S.leaderboard,context);
    if(status.matches&&S.leaderboard?.rollingWindowCount===ROLLING_WINDOW_COUNT&&
      S.leaderboard?.rows.every(row=>!row.strategy||row.rolling))return;
    const key=JSON.stringify([S.symbol,S.chart.tf,S.btRange.startDate,S.btRange.endDate,
      context.bars.length,context.bars.at(-1)?.time,context.source,
      S.leaderboard?.runAt]);
    if(key===leaderboardRefreshAttempt)return;
    leaderboardRefreshAttempt=key;
    try{recalculateComparison();}
    catch(error){S.leaderboardError=String(error.message||error);}
  }
  function runComparison(){
    try{recalculateComparison();render();}
    catch(err){S.leaderboardError=String(err.message||err);
      notice('Comparison failed: '+S.leaderboardError);render();}
  }
  function loadComparisonStrategy(id){
    const lb=S.leaderboard?.symbol===S.symbol?S.leaderboard:null;
    const choice=lb?.rows.find(x=>x.id===id);
    if(!choice){notice('Run a strategy comparison for this symbol first.');return;}
    S.portfolioMode=false;S.bt={...S.bt,...lb.settings,strategy:choice.strategy};
    S.chart.tf=lb.timeframe;S.backtestPineDraft=null;S.activeStrategy=choice.script?{
      code:choice.script.code,settings:{...choice.script.settings},name:choice.name
    }:null;
    if(choice.script){
      S.scriptCode=choice.script.code;S.scriptName=choice.name;
      S.scriptId=choice.script.id;S.scriptSettings={...choice.script.settings};
      parseCurrentPine();persistPineDraft();
    }
    S.result={metrics:choice.metrics,curve:choice.curve,trades:choice.trades,
      source:lb.source,range:lb.range||null};
    S.resultSymbol=lb.symbol;S.resultTf=lb.timeframe;S.sweep=null;showWorkspace('backtest');
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
    'chart-workspace-tools':openChartWorkspaceTools,
    'apply-chart-workspace-tools':()=>{
      const dialog=$('#chart-workspace-dialog');
      for(const input of dialog.querySelectorAll('[data-chart-workspace-choice]'))chartTools[input.dataset.chartWorkspaceChoice]=input.checked;
      writeChartWorkspace(localStorage,chartTools);dialog.close();preserveChartViewport();render();
      $('.chart-tools summary')?.focus({preventScroll:true});
    },
    'chart-workspace-open':el=>openChartWorkspace(el.dataset.workspaceKey),
    'chart-workspace-star':()=>{
      preserveChartViewport();S.watchlists=watchlistChange(S.watchlists,S.watchlistId,S.symbol);
      selectWatchlist(S.watchlistId);render();
    },
    'chart-workspace-review':()=>openScannedChart(),
    'chart-workspace-run':()=>void runChartBacktest(),
    'chart-workspace-add-alert':()=>{
      const price=$('[data-chart-workspace-input="alert-price"]'),op=$('[data-chart-workspace-input="alert-op"]');
      if(!price||!Number.isFinite(price.valueAsNumber)||price.valueAsNumber<=0)return notice('Enter a positive daily-close threshold.');
      preserveChartViewport();addLocalAlert({symbol:S.symbol,metric:'price',op:op.value,threshold:price.valueAsNumber});
    },
    'chart-workspace-refresh':()=>{
      if(liveScanActive)return;preserveChartViewport();clearSavedScanView();void switchToLive({chartRefresh:true,restoreSymbol:S.symbol});
    },
    'options-median-toggle':toggleMedianVisibility,
    'options-median-view':showMedianDots,
    'options-median-refresh':el=>{
      const key=el.dataset.indicatorKey,refresh=refreshOptionsMedian.get(key);
      if(refresh)refresh();else medianStatus(key,'No 50/50 dots: waiting for chart data and valid option chain quotes.');
    },
    'export-screener':()=>exportScreenerCsv(),
    'run-portfolio':()=>runPortfolioCurrent(),
    'run-best-fit':()=>void runBestFitCurrent(),
    'clear-bt-dates':()=>{S.btRange={startDate:'',endDate:''};S.backtestError='';S.portfolioError='';saveSettings();
      if(S.portfolioMode&&S.bestFitMode&&bestFitAttempted)void runBestFitCurrent();
      else if(fitEverStarted)void runUniverseFitCurrent({reuseData:true});else render();},
    'export-portfolio':()=>{
      const report=activePortfolioResult();
      if(!report){notice('Run the selected portfolio and date range before downloading.');return;}
      const result=portfolioRankingCsv(report,{validatedOnly:S.bestFitMode&&S.bestFitValidatedOnly});
      exportFile(result.filename,result.csv);
    },
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
    'server-alert-ack':el=>acknowledgeServerNotification(el.dataset.alertId),
    'pine-check':()=>{parseCurrentPine();S.scriptOutput=S.scriptError?null:'Pine syntax OK — '+S.scriptParsed.mode+' script with '+S.scriptParsed.inputs.length+' inputs.';render();},
    'pine-example':el=>{const ex=PINE_EXAMPLES.find(x=>x.id===el.dataset.example);if(ex)loadPineSource(ex.code,ex.label);},
    'pine-run':()=>executeCurrentPine(),
    'pine-sweep':()=>sweepCurrentPine(true),
    'pine-save':()=>savePine(false),
    'pine-copy':()=>savePine(true),
    'pine-rename':()=>{const item=S.scriptLibrary.find(x=>x.id===S.scriptId);if(!item){notice('Load a saved script to rename it.');return;}item.name=S.scriptName;persistPineLibrary();persistPineDraft();S.scriptOutput='Renamed saved script to '+S.scriptName;render();},
    'pine-delete':()=>{const id=S.scriptId;if(!id){notice('Load a saved script to delete it.');return;}if(!window.confirm('Delete this locally saved script?'))return;S.scriptLibrary=S.scriptLibrary.filter(x=>x.id!==id);persistPineLibrary();loadPineSource(PINE_EXAMPLES[0].code,'EMA crossover');},
    'pine-remove-plot':el=>{
      S.activeIndicators=S.activeIndicators.filter(item=>item.id!==el.dataset.plotId);
      preserveChartViewport();render();
      $('[data-action="indicator-picker"]')?.focus({preventScroll:true});
    },
    'pine-clear-plots':()=>{S.activeIndicators=[];S.scriptOutput='Removed all custom indicator plots from Chart Lab.';render();},
    import:()=>$('#csv-file')?.click(),
    'mode-live':()=>{market.shown=false;market.controller?.abort();clearSavedScanView();return switchToLive({restoreSymbol:S.lastLiveSymbol,chartRefresh:S.tab==='charts'});},
    'scan-universe':()=>{if(liveScanActive)return;clearSavedScanView();return switchToLive({chartRefresh:S.tab==='charts'});},
    'server-scan':()=>runServerScreener(),
    'test-live':()=>testLiveBackend().catch(err=>notice('Backend test failed: '+err.message)),
    'view-charts':()=>{S.tab='charts';render();},
    'refresh-intraday':()=>{if(S.mode==='live')void loadLiveIntraday(S.symbol,true).catch(()=>{});
      else notice('Only Alpaca Live mode can refresh real intraday bars.');},
    'view-backtest':()=>{showWorkspace('backtest');S.lastBacktestSymbol=S.symbol;render();},
    'view-optimize':()=>{showWorkspace('optimize');render();},
    'add-rule':()=>{clearSavedScanView();S.universeFilter='all';S.rules.push({metric:'rsi',tf:'D',op:'<',value:50});S.scan={status:'idle'};render();},
    'remove-rule':el=>{clearSavedScanView();S.rules.splice(Number(el.dataset.index),1);render();},
    'watch':el=>{const sym=el.dataset.symbol;
      S.watchlists=watchlistChange(S.watchlists,S.watchlistId,sym);
      const chosen=S.watchlists.find(x=>x.id===S.watchlistId);
      S.watch=new Set(chosen?.symbols||[]);saveSettings();render();},
    'sort-order':()=>{S.ascending=!S.ascending;render();},
    'range-1m':()=>showChartMonths(1),
    'range-3m':()=>showChartMonths(3),
    'range-1y':()=>showChartMonths(12),
    'range-all':()=>showRange(0),
    'load-older-chart':()=>void loadOlderChart(true),
    'range-fit':()=>showRange(180),
    'reset-price-scale':()=>{
      if(resetPriceScale(chart))$('#chart-axis-hint').textContent='Price scale reset';
    },
    'chart-fullscreen':()=>setChartFullscreen(true),
    'chart-exit-fullscreen':()=>setChartFullscreen(false),
    'indicator-picker':()=>openIndicatorDialog(),
    'indicator-settings':el=>openIndicatorDialog(el.dataset.indicatorKey),
    'close-dialog':el=>el.closest('dialog')?.close(),
    'market-scan':scanUSMarket,
    'market-pause':()=>market.controller?.abort(),
    'market-close':()=>{chartSelection++;market.shown=false;market.controller?.abort();render();},
    'market-previous':()=>{market.page=Math.max(0,market.page-1);render();},
    'market-next':()=>{market.page++;render();},
    'screener-columns':()=>openScreenerDialog(),
    'screener-chart':el=>openScannedChart(el.dataset.symbol),
    'return-screener':returnToScreener,
    'review-step':el=>stepScanReview(Number(el.dataset.step)),
    'review-rules':showReviewRules,
    'chart-symbol-picker':()=>openChartSymbolPicker(),
    'chart-choose-symbol':el=>{
      restoreSymbolState(el.dataset.symbol);
      render();
      $('[data-action="chart-symbol-picker"]')?.focus({preventScroll:true});
    },
    'chart-settings':()=>openChartSettings(),
    'apply-chart-settings':()=>{
      const dialog=$('#chart-settings-dialog');
      const chosen=[...dialog.querySelectorAll('[data-frame-choice]:checked')].map(el=>el.dataset.frameChoice);
      if(!chosen.length){notice('Choose at least one timeframe.');return;}
      const style=dialog.querySelector('[data-option="style"]').value;
      if(chosen.includes(S.chart.tf))preserveChartViewport();else setTimeframe(chosen.includes('D')?'D':chosen[0]);
      S.chart.sliderFrames=chosen;S.chart.style=style;dialog.close();render();
      $('[data-action="chart-settings"]')?.focus({preventScroll:true});
    },
    'chart-log-toggle':()=>{
      preserveChartViewport();
      S.chart.log=!S.chart.log;
      const view=S.chartViews[S.symbol+'|'+S.chart.tf];if(view)view.price=null;
      render();$('[data-action="chart-log-toggle"]')?.focus({preventScroll:true});
    },
    'chart-timeframe':el=>{setTimeframe(el.dataset.timeframe);render();$('[data-timeframe="'+S.chart.tf+'"]')?.focus({preventScroll:true});},
    'indicator-add-average':el=>{
      const id='ma-'+crypto.randomUUID();
      applyIndicatorChange(id,addMovingAverage(S.chart,el.dataset.indicatorKey,id));
      openIndicatorDialog(id);
    },
    'indicator-add':el=>{
      const type=el.dataset.indicatorKey;
      const active=indicatorInstances().find(item=>item.type===type);
      if(active){
        const id='ind-'+crypto.randomUUID();
        const fields=isOptionProjection(type)?[type==='optionsProbability'?'optionsProbabilityRate':'optionsMedianRate']:indicatorInputs(type).map(([field])=>field);
        const settings=Object.fromEntries(fields.map(field=>[field,active.settings[field]]));
        applyIndicatorChange(id,{...S.chart,indicatorCopies:[...indicatorCopies(),{id,type,settings}]});
        openIndicatorDialog(id);
      }else if(type==='optionsMedian'){
        setMedianVisibility('shown');applyIndicatorChange(type,{...S.chart,optionsMedian:true});
      }
      else if(type==='optionsProbability')applyIndicatorChange(type,{...S.chart,optionsProbability:true});
      else applyIndicatorChange(type,updateIndicatorSetting(S.chart,type,'enabled',true));
    },
    'indicator-remove':el=>{
      const key=el.dataset.indicatorKey;
      if(key.startsWith('ma-'))applyIndicatorChange(key,editMovingAverage(S.chart,key,null));
      else if(key.startsWith('ind-')){
        const copies=indicatorCopies(),removed=copies.find(item=>item.id===key),remaining=copies.filter(item=>item.id!==key);
        if(removed?.type==='optionsMedian'&&!S.chart.optionsMedian&&!remaining.some(item=>item.type==='optionsMedian'))setMedianVisibility('hidden');
        applyIndicatorChange(key,{...S.chart,indicatorCopies:remaining});
      }
      else if(key==='optionsMedian'){
        setMedianVisibility(indicatorCopies().some(item=>item.type==='optionsMedian')?null:'hidden');
        applyIndicatorChange(key,{...S.chart,optionsMedian:false});
      }
      else if(key==='optionsProbability')applyIndicatorChange(key,{...S.chart,optionsProbability:false});
      else applyIndicatorChange(key,updateIndicatorSetting(S.chart,key,'enabled',false));
    },
    'draw-line':()=>{S.drawLine=!S.drawLine;preserveChartViewport();render();},
    'clear-lines':()=>{S.chart.lines[S.symbol]=[];preserveChartViewport();render();},
    'chart-png':()=>{if(!chart)return;try{const canvas=chart.takeScreenshot();canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='market-lens-'+S.symbol+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}catch{notice('Chart image export is unsupported in this browser.');}},
    'pin-variant-baseline':()=>{
      S.variantBaseline=structuredClone(variantSetup());S.variantComparison=null;render();
      $('[data-action="compare-variant"]').focus({preventScroll:true});
    },
    'compare-variant':compareVariant,
    'enable-backtest-pine':()=>{
      S.bt.strategy='pine-custom';S.result=null;S.sweep=null;S.backtestError='';render();
      $('#backtest-pine-source')?.focus();
    },
    'check-backtest-pine':()=>{
      try{
        if(compilePine(backtestScript().code).mode!=='strategy')throw new PineError(1,'Use strategy() with entry and exit orders to simulate trades');
        S.backtestError='';notice('Pine strategy syntax OK');
      }catch(error){S.backtestError=error.message;}
      render();
    },
    'run-backtest':async ()=>{
      if(S.portfolioMode){if(S.bestFitMode)void runBestFitCurrent();else runPortfolioCurrent();return;}
      const symbol=S.symbol,tf=S.chart.tf;
      S.lastBacktestSymbol=symbol;saveSettings();
      if(!await ensureAnalysisBars('Backtest'))return;
      if(!workspaceActive('backtest')||S.portfolioMode||symbol!==S.symbol||tf!==S.chart.tf)return;
      runBt();
      // Always show an inline, plain-language date-window error on failure.
      render();
    },

    'fit-universe':()=>void runUniverseFitCurrent(),
    'load-fit-best':()=>loadUniverseFitBest(),
    'sort-fit':el=>{const key=el.dataset.key;if(!FIT_COLUMNS.includes(key))return;
      if(S.fitSort===key)S.fitDescending=!S.fitDescending;
      else{S.fitSort=key;S.fitDescending=!['symbol','source','barDate','maxDD'].includes(key);}
      render();},
    'export-fit':()=>{
      const validatedOnly=S.fitValidatedOnly;
      const report=validatedOnly?S.fitValidatedReport:S.fitReport;
      if(!report){notice('Run Fit across universe before downloading.');return;}
      const result=fitRankingCsv(report,{validatedOnly,sort:S.fitSort,
        descending:S.fitDescending});
      exportFile(result.filename,result.csv);
    },
    'export-leaderboard':()=>{
      const report=S.leaderboard?.symbol===S.symbol?S.leaderboard:null;
      if(!report||!leaderboardRangeStatus(report,comparisonContext()).matches){
        notice('Recompute the strategy leaderboard on these dates before downloading.');return;
      }
      const result=leaderboardRankingCsv(report,{validatedOnly:S.leaderboardValidatedOnly,
        sort:S.leaderboardSort,descending:S.leaderboardDescending});
      exportFile(result.filename,result.csv);
    },
    'compare-strategies':async ()=>{
      if(S.portfolioMode){notice('Switch to Single symbol mode to compare individual strategies.');return;}
      S.lastBacktestSymbol=S.symbol;saveSettings();
      if(!await ensureAnalysisBars('Compare all strategies'))return;
      runComparison();
    },
    'load-best-strategy':()=>{const id=S.leaderboard?.bestId;if(id)loadComparisonStrategy(id);},
    'load-best-validated':()=>{
      const lb=S.leaderboard;
      const choice=bestRollingValidatedStrategy(lb?.rows)||
        sortLeaderboard(filterValidatedLeaderboard(lb?.rows,true),'sharpe',true)[0];
      if(choice)loadComparisonStrategy(choice.id);
    },
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
      const params=S.sweep[Number(el.dataset.index)].params;if(S.bt.strategy==='pine-custom'){S.scriptSettings={...S.scriptSettings,...params};if(S.activeStrategy)S.activeStrategy.settings={...S.activeStrategy.settings,...params};persistPineDraft();}else Object.assign(S.bt,params);if(runBt()){showWorkspace('backtest');render();}},
    'export-trades':()=>{if(!S.result){notice('Run a backtest before exporting.');return;}exportFile(S.symbol+'-trades.csv',csvDownload(S.result.trades.map(t=>({symbol:S.symbol,strategy:S.bt.strategy,...t}))));},
    'export-sweep':()=>{const sweep=S.portfolioMode?S.portfolioSweep:S.sweep;
      if(!sweep){notice('Run a parameter sweep first.');return;}
      exportFile((S.portfolioMode?'equal-weight-portfolio':S.symbol)+'-sweep.csv',csvDownload(sweep.map(r=>({
        params:JSON.stringify(r.params),source:S.portfolioMode?'Equal-weight daily sourced bars':S.sources.get(S.symbol),
        symbolCount:r.n??1,trainReturn:r.train.returnPct,trainDrawdown:r.train.maxDD,
        trainTrades:r.train.trades,testReturn:r.test.returnPct,testDrawdown:r.test.maxDD,
        testTrades:r.test.trades,testSharpe:r.test.sharpe,testProfitFactor:r.test.profitFactor}))));},
    'clear-imports':()=>removeImports(),
    'choose-symbol':el=>{restoreSymbolState(el.dataset.symbol);S.tab='charts';render();}
  };
  document.addEventListener('click',ev=>{
    if(ev.target.closest('[data-workspace-drag]')){ev.preventDefault();return;}
    const summary=ev.target.closest('#chart-workspaces > details > summary');
    if(summary){ev.preventDefault();setWorkspaceOpen(summary.parentElement,!summary.parentElement.open);return;}
    const btn=ev.target.closest('[data-tab],[data-action]');if(btn){
      if(btn.dataset.tab){
        if(btn.dataset.tab==='screener'&&S.tab!=='screener'&&S.scanReview){S.scanReview.embedded=false;returnToScreener();return;}
        chartSelection++;
        S.tab=btn.dataset.tab;
        render();return;
      }
      const handler=action[btn.dataset.action];
      if(handler){ev.stopPropagation();btn.closest('.chart-tools')?.removeAttribute('open');handler(btn);return;}
    }
    const row=ev.target.closest('tr[data-symbol]');if(row)openScreenerRow(row);
    if(!ev.target.closest('.mobile-more'))$('.mobile-more[open]')?.removeAttribute('open');
    if(ev.target.closest('#dropzone'))$('#csv-file')?.click();
  });
  document.addEventListener('toggle',ev=>{
    const key=ev.target.dataset?.backtestSection;
    if(key&&ev.target.isConnected&&S.backtestSections[key]!==ev.target.open){S.backtestSections[key]=ev.target.open;saveSettings();}
    const workspaceKey=ev.target.dataset?.workspaceSection;
    if(workspaceKey&&ev.target.isConnected&&S.workspaceSections[workspaceKey]!==ev.target.open){
      setWorkspaceOpen(ev.target,ev.target.open);
    }
  },true);
  document.addEventListener('submit',ev=>{
    const form=ev.target;
    if(!form.closest('#chart-indicator-dialog'))return;
    ev.preventDefault();
    const key=form.dataset.indicatorKey;
    let changes=S.chart;
    const copy=indicatorCopies().find(item=>item.id===key);
    if(copy){
      const settings=Object.fromEntries([...new FormData(form)].map(([field,value])=>[field,Number(value)]));
      applyIndicatorChange(key,{...S.chart,indicatorCopies:indicatorCopies().map(item=>item.id===key?{...item,settings}:item)});
      return;
    }
    for(const [field,value] of new FormData(form)){
      if(key.startsWith('ma-'))changes=editMovingAverage(changes,key,Number(value));
      else if(key==='optionsMedian')changes={...changes,optionsMedianRate:Number(value)};
       else if(key==='optionsProbability')changes={...changes,optionsProbabilityRate:Number(value)};
      else changes=updateIndicatorSetting(changes,key,field,value);
    }
    applyIndicatorChange(key,changes);
  });
  document.addEventListener('keydown',ev=>{
    const row=ev.target.closest('tr[data-symbol]');
    if(row&&(ev.key==='Enter'||ev.key===' ')&&!ev.target.closest('button,input,select')){
      ev.preventDefault();openScreenerRow(row);
    }
    if(ev.key==='Escape'&&$('dialog[open]'))return;
    if(ev.key==='Escape'&&$('.mobile-more[open]')){
      $('.mobile-more').open=false;$('.mobile-more summary').focus();return;
    }
    if(ev.key==='Escape'&&S.chartFullscreen&&S.tab==='charts'){
      ev.preventDefault();setChartFullscreen(false);return;
    }
    if(ev.key==='Escape'&&S.drawLine){S.drawLine=false;render();}
  });
  document.addEventListener('input',ev=>{
    const el=ev.target;
    if(el.id==='pine-editor'){S.scriptCode=el.value;S.scriptOutput=null;persistPineDraft();return;}
    if(el.hasAttribute('data-bt-pine-code')){
      S.backtestPineDraft={...backtestScript(),code:el.value,name:''};
      saveSettings();
      const detail=$('#variant-result');if(detail)detail.innerHTML=variantResultView();
      return;
    }
    if(el.id==='pine-name'){S.scriptName=el.value;persistPineDraft();return;}
    if(el.dataset.setting){S[el.dataset.setting]=el.value;saveSettings();return;}
    if(el.dataset.input==='watchlist-name'){S.watchlistDraft=el.value;return;}
    if(el.dataset.input==='scan-name'){S.scanDraft=el.value;return;}
    if(el.dataset.input==='chart-symbol-query'){
      $('.chart-symbol-choices').innerHTML=chartSymbolChoices(el.value);
      return;
    }
    if(el.dataset.input==='symbol-search'){
      S.symbolQuery=el.value;
      const dropdown=el.closest('.symbol-picker')?.querySelector('[data-option="symbol"]');
      if(dropdown){
        const options=[...S.data.keys()].filter(modeSymbol).filter(s=>s.toLowerCase().includes(el.value.trim().toLowerCase())||s===S.symbol).sort();
        dropdown.innerHTML=options.map(s=>'<option value="'+esc(s)+'"'+(s===S.symbol?' selected':'')+'>'+esc(s)+'</option>').join('');
      }
      return;
    }
    if(el.dataset.input==='search'){market.page=0;S.query=el.value;refreshScreenerResults();saveSettings();}
  });
  document.addEventListener('input',ev=>{
    const el=ev.target;
    if(!el.hasAttribute('data-chart-frame-scale'))return;
    const frame=chartFrameScale()[Number(el.value)];
    if(!frame)return;
    el.setAttribute('aria-valuetext',frame[1]);
    for(const control of el.closest('.chart-frame-scale').querySelectorAll('[data-timeframe]'))
      control.setAttribute('aria-pressed',String(control.dataset.timeframe===frame[0]));
  });
  document.addEventListener('change',async ev=>{
    const el=ev.target;
    if(el.hasAttribute('data-chart-frame-scale')){
      const frame=chartFrameScale()[Number(el.value)];
      if(frame&&frame[0]!==S.chart.tf){setTimeframe(frame[0]);render();$('[data-chart-frame-scale]')?.focus({preventScroll:true});}
      return;
    }
    if(el.closest('#chart-settings-dialog,#chart-workspace-dialog'))return;
    if(el.dataset.chartWorkspaceInput){
      const key=el.dataset.chartWorkspaceInput;
      if(key==='watchlist'){preserveChartViewport();selectWatchlist(el.value);render();}
      else if(key==='watch-symbol'&&el.value&&modeSymbol(el.value)){restoreSymbolState(el.value);render();}
      else if(key==='scan'){if(el.value)loadSavedScan(el.value,false);else{preserveChartViewport();S.scanReview=null;clearSavedScanView();render();}}
      return;
    }
    if(el.id==='csv-file'){if(el.files?.length)await importFiles(el.files);el.value='';return;}
    if(el.id==='pine-library'){const found=S.scriptLibrary.find(x=>x.id===el.value);if(found){loadPineSource(found.code,found.name,found.id);S.scriptSettings={...(found.settings||{})};persistPineDraft();render();}return;}
    if(el.dataset.pineInput){S.scriptSettings[el.dataset.pineInput]=el.type==='checkbox'?el.checked:Number(el.value);persistPineDraft();return;}
    if(el.hasAttribute('data-bt-pine-source')){
      const [source,id]=el.value.split(':');
      const script=(source==='example'?PINE_EXAMPLES:S.scriptLibrary).find(item=>item.id===id);
      if(script){
        S.backtestPineDraft={code:script.code,name:script.name||script.label,settings:{...script.settings}};
        S.backtestError='';render();
      }
      return;
    }
    if(el.dataset.btPineInput){
      const script=backtestScript();
      S.backtestPineDraft={...script,settings:{...script.settings,[el.dataset.btPineInput]:
        el.type==='checkbox'?el.checked:Number(el.value)}};
      saveSettings();
      const detail=$('#variant-result');if(detail)detail.innerHTML=variantResultView();
      return;
    }
    if(el.dataset.alertField){
      const key=el.dataset.alertField;S.alertDraft[key]=key==='threshold'?Number(el.value):el.value;return;
    }
    if(el.dataset.screenColumn){
      const index=Number(el.dataset.screenColumn);
      S.hiddenScreenColumns=S.hiddenScreenColumns.filter(i=>i!==index);
      if(!el.checked)S.hiddenScreenColumns.push(index);
      $('.screener-results').dataset.hiddenColumns=S.hiddenScreenColumns.join(' ');
      saveSettings();return;
    }
    if(el.dataset.option){
      const opt=el.dataset.option,val=el.value;
      if(opt==='signal-strategy'){S.signalSelection=val;S.signalsOnly=false;
        evaluateScreenerSignals(false);saveSettings();render();return;}
      if(opt==='signals-only'){S.signalsOnly=el.checked;saveSettings();render();return;}
      if(opt==='leaderboard-validated-only'){
        S.leaderboardValidatedOnly=el.checked;saveSettings();render();return;
      }
      if(opt==='fit-validated-only'){
        S.fitValidatedOnly=el.checked;saveSettings();render();return;
      }
      if(opt==='best-fit-validated-only'){
        S.bestFitValidatedOnly=el.checked;saveSettings();
        if(bestFitAttempted)void runBestFitCurrent();else render();
        return;
      }
      if(opt==='watchlist-select'){selectWatchlist(val);render();return;}
      if(opt==='portfolio-mode'){
        ++bestFitRunSerial;S.portfolioLoading=false;
        S.portfolioMode=val!=='single';S.bestFitMode=val==='best-fit';
        S.portfolioError='';saveSettings();render();return;
      }
      if(opt==='portfolio-scope'){S.portfolioScope=val;saveSettings();render();return;}
      if(opt==='portfolio-watchlist'){S.portfolioWatchlistId=val;saveSettings();render();return;}
      if(opt==='saved-scan-select'){if(val)loadSavedScan(val);else{clearSavedScanView();render();}return;}
      if(opt==='preset'){if(val==='custom')return;clearSavedScanView();S.rules=(preset[val]||[]).map(x=>({...x}));S.universeFilter=val==='volatility'?'volatility':'all';S.scan={status:'idle'};}
      else if(opt==='symbol'){
        restoreSymbolState(val);
        if(['backtest','optimize'].includes(S.tab)||el.closest('[data-workspace-section="backtest"],[data-workspace-section="optimize"]'))S.lastBacktestSymbol=val;
      }
      else if(opt==='tf')setTimeframe(val);
      else if(opt==='style')S.chart.style=val;
      else if(opt==='log')S.chart.log=val==='true';
      else if(opt==='matches')S.showOnlyMatches=el.checked;
      else if(opt==='watchonly')S.showWatch=el.checked;
      else if(opt==='sort')S.sort=val;
      render();return;
    }
    if(el.dataset.rule!==undefined){clearSavedScanView();const r=S.rules[Number(el.dataset.rule)];if(r){r[el.dataset.key]=el.dataset.key==='value'?Number(el.value):el.value;render();}return;}
    if(el.dataset.btRange){
      S.btRange={...S.btRange,[el.dataset.btRange]:el.value};
      S.backtestError='';S.portfolioError='';saveSettings();
      if(S.portfolioMode&&S.bestFitMode&&bestFitAttempted)void runBestFitCurrent();
      else if(fitEverStarted)void runUniverseFitCurrent({reuseData:true});else render();return;
    }
    if(el.dataset.bt){
      const key=el.dataset.bt;
      S.bt[key]=el.type==='number'?Number(el.value):el.value;S.result=null;S.sweep=null;saveSettings();
      if(key==='strategy'&&workspaceActive('backtest')){S.backtestError='';render();return;}
      const detail=$('#variant-result');if(detail)detail.innerHTML=variantResultView();
      return;
    }
  });
  document.addEventListener('dragover',ev=>{if(ev.target.closest('#dropzone')){ev.preventDefault();ev.target.closest('#dropzone').classList.add('dragging');}});
  document.addEventListener('drop',async ev=>{const drop=ev.target.closest('#dropzone');if(drop){ev.preventDefault();drop.classList.remove('dragging');await importFiles([...ev.dataTransfer.files].filter(f=>f.name.toLowerCase().endsWith('.csv')));}});
  try{
    const existing=(await databaseRead('workspace','market'))?.value;
    if(readMarketSnapshot(existing))market.shown=!!saved.marketShown;
  }catch{}
  if(S.signalSelection!=='none')evaluateScreenerSignals(false);
  render();
  await loadStored();
  workspaceReady=true;
  await switchToLive({restoreTab:S.tab,restoreSymbol:startupPrefs.selectedSymbol});
  void refreshServerNotifications(true);
  setInterval(()=>{if(document.visibilityState==='visible')void refreshServerNotifications(true);},60_000);
  if(syncEnabled){
    function refreshSharedWorkspace(){
      if(document.visibilityState==='visible')return workspace.flush();
    }
    setInterval(()=>void refreshSharedWorkspace(),8000);
    window.addEventListener('online',()=>void refreshSharedWorkspace());
    document.addEventListener('visibilitychange',()=>void refreshSharedWorkspace());
  }
}
initApp().catch(err=>{document.getElementById('app').textContent='App startup failed: '+err.message;console.error(err);});
