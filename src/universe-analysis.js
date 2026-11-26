import {downloadUniverseHistory} from './history-download.js';
import {alpacaBars} from './engine.js';
import {fitAcrossUniverse,sortUniverseFit} from './fit.js';
import {fitValidatedAcrossUniverse,rankValidatedUniverseFit} from './fit-validated.js';
import {evaluateStrategySignals} from './signals.js';
import {createUniverseLeaderboardAccumulator} from './universe-leaderboard.js';

const yieldToUi=()=>new Promise(resolve=>setTimeout(resolve,0));

/**
 * Stream the complete active/tradable U.S. equity directory through the shared
 * 100-symbol/10,000-point downloader. Only one 100-symbol batch is resident
 * while backtests, Fit, aggregate strategy leaderboard and signals are computed.
 */
export async function analyzeFullUniverse({
  workerUrl,feed='iex',start,end,adjustment='all',batchSize=100,requestIntervalMs=2500,
  options={},dateRange={},strategyScript=null,savedScripts=[],builtInExamples=[],
  selection=null,signalOptions=options,backtest,compilePine,executePine,
  expectedBarDate=null,signal,onProgress=()=>{},onBatch=()=>{},
  download=downloadUniverseHistory
}={}){
  if(typeof backtest!=='function')throw new Error('Backtest engine unavailable.');
  if(!start||!end||Date.parse(start)>=Date.parse(end))throw new Error('Provide a valid universe history date range.');
  const fitRows=[],validatedRows=[],validatedErrors=[],signalRows=Object.create(null),signalErrors=[];
  const leaderboard=createUniverseLeaderboardAccumulator();
  let directory=null,processed=0,fitCompleted=0,validatedCompleted=0,totalPages=0,totalBars=0;
  const result=await download({
    workerUrl,feed,timeframe:'1Day',start,end,adjustment,batchSize,requestIntervalMs,
    retainBars:false,signal,
    onProgress:event=>{
      if(event.type==='directory')directory=event.directory;
      onProgress({...event,directory,processed,totalPages,totalBars});
    },
    onBatch:async batch=>{
      if(signal?.aborted)throw signal.reason||new Error('Universe analysis cancelled.');
      const data=new Map();
      for(const symbol of batch.symbols){
        const bars=alpacaBars(batch.bars[symbol]||[],'1Day');
        if(bars.length)data.set(symbol,bars);
      }
      const sourceFor=symbol=>data.has(symbol)?'ALPACA '+String(feed).toUpperCase()+' 1Day':'NO ALPACA BARS';
      const common={symbols:batch.symbols,data,options:{...options,timeframe:'D'},
        backtest,compilePine,executePine,dateRange,expectedBarDate,sourceFor};
      const fit=fitAcrossUniverse({...common,strategyScript});
      fitRows.push(...fit.rows);
      fitCompleted+=fit.completed;
      const validated=await fitValidatedAcrossUniverse({...common,
        savedScripts,builtInExamples,
        isCancelled:()=>!!signal?.aborted,
        onComparison:(symbol,comparison)=>leaderboard.add(symbol,comparison)
      });
      validatedRows.push(...validated.rows);
      validatedErrors.push(...validated.errors);
      validatedCompleted+=validated.completed;
      if(selection){
        const evaluated=evaluateStrategySignals({data,selection,options:{...signalOptions,side:'long',timeframe:'D'},
          backtest,compilePine,executePine,sourceFor});
        Object.assign(signalRows,evaluated.signals);
        signalErrors.push(...evaluated.errors);
        for(const symbol of batch.symbols)if(!data.has(symbol)){
          signalRows[symbol]={status:'UNAVAILABLE',barDate:null,source:sourceFor(symbol),
            reason:'No OHLCV bars returned'};
          signalErrors.push({symbol,reason:'No OHLCV bars returned'});
        }
      }
      processed+=batch.symbols.length;
      totalPages=batch.totalPages;
      totalBars=batch.totalBars;
      await onBatch({batchIndex:batch.batchIndex,batchCount:batch.batchCount,
        processed,requested:batch.requestedSymbols,returned:batch.returnedSymbols,
        fitCompleted,validatedCompleted,signalCount:Object.keys(signalRows).length,
        totalPages,totalBars,leaderboardStrategies:leaderboard.symbolsAnalyzed});
      await yieldToUi();
    }
  });
  const requested=result.requested||directory?.count||processed;
  const fitReport={version:2,settings:{...options,timeframe:'D'},dateRange,
    expectedBarDate,runAt:new Date().toISOString(),requested,
    completed:fitCompleted,rows:sortUniverseFit(fitRows)};
  const fitValidatedReport={version:3,mode:'validated',settings:{...options,timeframe:'D'},
    dateRange,expectedBarDate,runAt:new Date().toISOString(),requested,
    completed:validatedCompleted,validated:validatedRows.length,
    rows:rankValidatedUniverseFit(validatedRows),errors:validatedErrors};
  const universeLeaderboard=leaderboard.finalize({
    requested,feed,timeframe:'1Day',start,end,
    directoryId:result.directory?.id||directory?.id||null,
    downloadedSymbols:result.returned,pages:result.pages,batches:result.batches,
    totalBars:result.totalBars,retries:result.retries
  });
  return {directory:result.directory||directory,download:result,fitReport,
    fitValidatedReport,universeLeaderboard,signals:selection?signalRows:null,
    signalErrors,processed,requested,fitCompleted,validatedCompleted};
}
