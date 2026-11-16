// Round 17: make every leaderboard metric and its walk-forward holdout
// refer to the exact same inclusive Backtester date window.
// No window means full history, preserving the original comparison engine.
import {windowBacktestBars} from './date-window.js';
import {barDate} from './freshness.js';
import {compareStrategies} from './leaderboard.js';
import {attachRollingValidation} from './rolling-validation.js';

export function compareStrategiesInRange({bars,range={},...config}){
  const selected=windowBacktestBars(bars,range);
  const explicit=!!(selected.range.startDate||selected.range.endDate);
  // A user-picked 33-session window should still be compared honestly.
  // Do not impose the full-history research gate on its leaderboard.
  // At least five bars are needed for a 3-bar train and 2-bar test split.
  const report=compareStrategies({...config,bars:selected.bars,minBars:explicit?5:40});
  const withRolling=attachRollingValidation(report,selected.bars,config);
  return {...withRolling,range:selected.range};
}

// Check BOTH the dates requested in the controls and the bars actually used.
// A matching end date alone is not enough: changing the start date changes
// the strategy and the 70/30 split, even when the newest bar is unchanged.
export function leaderboardRangeStatus(report,{bars,range={},symbol,timeframe,source}={}){
  let selected;
  try{selected=windowBacktestBars(bars,range);}
  catch(error){return {matches:false,reason:String(error.message||error),range:null};}
  const selectedRange=selected.range;
  if(!report)return {matches:false,reason:'No leaderboard has been calculated.',range:selectedRange};
  if(symbol&&report.symbol!==symbol)
    return {matches:false,reason:'Saved leaderboard belongs to a different symbol.',range:selectedRange};
  if(timeframe&&report.timeframe!==timeframe)
    return {matches:false,reason:'Saved leaderboard uses a different timeframe.',range:selectedRange};
  if(source&&report.source!==source)
    return {matches:false,reason:'Saved leaderboard uses a different data source.',range:selectedRange};
  if(!report.range){
    // Older reports have no range fields. Only allow them in full-range mode,
    // and only if their last observed bar is still current.
    const full=!selectedRange.startDate&&!selectedRange.endDate;
    return {matches:full&&barDate({time:report.asOf})===selectedRange.actualEnd,
      reason:full?'Saved full-history leaderboard needs recalculation against current bars.':
        'Saved full-history leaderboard — selected date range not applied.',
      range:selectedRange};
  }
  const matches=['startDate','endDate','actualStart','actualEnd','count']
    .every(key=>report.range[key]===selectedRange[key])&&
    barDate({time:report.asOf})===selectedRange.actualEnd;
  return {matches,reason:matches?null:'Saved leaderboard was calculated for different dates or bars.',
    range:selectedRange};
}

export function rangeLabel(range={}){
  // Presentation must NOT throw when the user is in the middle of editing
  // invalid/reversed dates: the warning itself must remain renderable.
  const start=String(range?.startDate||''),end=String(range?.endDate||'');
  return start||end?
    'Selected range: '+(start||'First available')+' to '+(end||'Last available'):
    'Full range';
}
