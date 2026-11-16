// Live-history contract. Never describe bundled lookback constants as proof
// of bars actually returned by the deployed Worker.
import {ALPACA_SCAN_LOOKBACK_DAYS} from './universe.js';

export const DEFAULT_ALPACA_WORKER='https://market-lens-pro-api.mikesheer001.workers.dev';
export const LIVE_SCAN_CACHE_REVISION='2026-11-17-round21-daily-history-v2';
export const MIN_ESTABLISHED_DAILY_BARS=900;
export const BENCHMARK_TICKERS=Object.freeze(['ABBV','SPY']);

export function inspectLiveHistory(payload,expectedDays=ALPACA_SCAN_LOOKBACK_DAYS){
  const reportedDays=Number(payload?.lookback_days);
  const hasLookback=payload?.lookback_days!==null&&payload?.lookback_days!==undefined&&
    Number.isFinite(reportedDays);
  const counters=Object.fromEntries(BENCHMARK_TICKERS.map(symbol=>[
    symbol,Array.isArray(payload?.bars?.[symbol])?payload.bars[symbol].length:null
  ]));
  // Backward compatible with offline mock payloads that omit live metadata:
  // only an explicit stale/inconsistent Worker response is rejected.
  const outdated=hasLookback&&reportedDays<expectedDays;
  const short=hasLookback&&reportedDays>=expectedDays&&BENCHMARK_TICKERS
    .filter(symbol=>counters[symbol]!==null)
    .filter(symbol=>counters[symbol]<MIN_ESTABLISHED_DAILY_BARS);
  const ok=!outdated&&!short.length;
  const message=outdated?
    'Worker reports only '+reportedDays+' daily lookback days; expected '+expectedDays+'.':
    short.length?
      'Worker reports '+reportedDays+' lookback days but returned too few actual bars: '+
        short.map(s=>s+' '+counters[s]).join(', ')+'.':
    hasLookback?'Worker reports '+reportedDays+' daily lookback days.':
      'Worker did not report a daily lookback; history cannot be verified from metadata.';
  return {ok,hasLookback,reportedDays:hasLookback?reportedDays:null,
    counts:counters,short,reason:ok?null:message,message};
}
export function canonicalWorkerBase(value){
  return String(value||'').trim().replace(/\/+$/,'');
}
export function shouldTryDefaultWorker(candidate,status){
  return !status.ok&&canonicalWorkerBase(candidate)!==DEFAULT_ALPACA_WORKER;
}
export function liveScanUrl(base,feed){
  const url=new URL(canonicalWorkerBase(base)+'/api/stocks/scan');
  url.searchParams.set('feed',feed||'iex');
  // Separate HTTP-browser/CDN response URLs as well as the Worker's own
  // edge-cache key. Stable across ordinary refreshes: preserve 15m caching.
  url.searchParams.set('history_revision',LIVE_SCAN_CACHE_REVISION);
  return url.toString();
}
