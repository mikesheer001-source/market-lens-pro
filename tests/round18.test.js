import test from 'node:test';
import assert from 'node:assert/strict';
import {backtest,sampleData} from '../src/engine.js';
import {compilePine,executePine} from '../src/pine.js';
import {PINE_EXAMPLES} from '../src/pine-examples.js';
import {compareStrategies} from '../src/leaderboard.js';
import {compareStrategiesInRange} from '../src/leaderboard-range.js';
import {validatedHoldout,holdoutSummary,MIN_HOLDOUT_BARS} from '../src/validation.js';
import {ROLLING_WINDOW_COUNT,ROLLING_WINDOW_FRACTION,rollingWindows,
  summarizeRollingSharpe,rollingPositiveText,rollingWindowDates} from '../src/rolling-validation.js';

const prices=sampleData()['DEMO-SPY'];
const options={strategy:'ema-cross',capital:10000,allocation:100,feeBps:1,
  slipBps:2,stopPct:0,targetPct:0,side:'long',fast:20,slow:100,timeframe:'D'};
const common={symbol:'DEMO-SPY',source:'SIMULATED Demo OHLCV',
  options,backtest,compilePine,executePine,builtInExamples:PINE_EXAMPLES};

test('Round 18: five sliding 40% windows have strict chronological 70/30 splits and disjoint test periods',()=>{
  assert.equal(ROLLING_WINDOW_COUNT,5);
  assert.equal(ROLLING_WINDOW_FRACTION,0.4);
  const bars=prices.slice(0,1000),windows=rollingWindows(bars);
  assert.equal(windows.length,5);
  assert.deepEqual(windows.map(x=>x.startIndex),[0,150,300,450,600]);
  assert.deepEqual(windows.map(x=>x.endIndex),[399,549,699,849,999]);
  assert.ok(windows.every(w=>w.windowBars===400&&w.trainBars===280&&w.testBars===120));
  for(let i=0;i<windows.length;i++){
    const w=windows[i];
    assert.equal(w.windowStart,bars[w.startIndex].time);
    assert.equal(w.windowEnd,bars[w.endIndex].time);
    assert.equal(w.trainEnd,bars[w.startIndex+279].time);
    assert.equal(w.testStart,bars[w.startIndex+280].time);
    assert.equal(w.testEnd,bars[w.endIndex].time);
    assert.equal(w.sufficient,true);
    if(i>0)assert.ok(w.testStart>windows[i-1].testEnd,'no overlapping test intervals');
  }
  assert.match(rollingWindowDates(windows),/W1/);
  assert.match(rollingWindowDates(windows),/W5/);
  assert.equal(windows.at(-1).windowEnd,bars.at(-1).time);
});

test('Round 18: mean, median, positive-count and unavailable windows are calculated without substitution',()=>{
  const make=(n,sufficient=true,testBars=60)=>({sharpe:n,sufficient,testBars});
  const five=[make(2),make(1),make(-1),make(0),make(3)];
  const stats=summarizeRollingSharpe(five);
  assert.equal(stats.meanSharpe,1);
  assert.equal(stats.medianSharpe,1);
  assert.equal(stats.positiveCount,3);
  assert.equal(stats.assessableCount,5);
  assert.equal(stats.totalWindows,5);
  assert.equal(stats.note,null);
  assert.equal(rollingPositiveText(stats),'3/5 windows positive');
  const incomplete=summarizeRollingSharpe([
    make(3),make(-1),make(null,false,10),make(5),make(1)]);
  assert.equal(incomplete.meanSharpe,2);
  assert.equal(incomplete.medianSharpe,2);
  assert.equal(incomplete.assessableCount,4);
  assert.equal(incomplete.positiveCount,3);
  assert.equal(incomplete.insufficientBars,1);
  assert.equal(rollingPositiveText(incomplete),'3/5 windows positive (4/5 assessable)');
  assert.match(incomplete.note,/Only 4\/5/);
  const allShort=summarizeRollingSharpe(Array.from({length:5},()=>make(null,false,9)));
  assert.equal(allShort.meanSharpe,null);
  assert.equal(allShort.medianSharpe,null);
  assert.equal(allShort.assessableCount,0);
  assert.equal(rollingPositiveText(allShort),'0/5 assessable');
  assert.match(allShort.note,/5 of 5 windows have fewer than 30/);
  assert.equal(MIN_HOLDOUT_BARS,30);
});

test('Round 18: every executable preset rolling Sharpe equals an independently backtested OOS slice',()=>{
  const bars=prices.slice(-900);
  const report=compareStrategiesInRange({...common,bars});
  assert.equal(report.rollingWindowCount,5);
  assert.equal(report.rollingWindows.length,5);
  const candidateIds=['ema-cross','rsi-revert','trend-rsi','bollinger','breakout'];
  for(const preset of candidateIds){
    const row=report.rows.find(r=>r.id==='preset:'+preset);
    assert.ok(row?.rolling);
    assert.equal(row.rolling.totalWindows,5);
    assert.equal(row.rolling.windows.length,5);
    for(const window of row.rolling.windows){
      const segment=bars.slice(window.startIndex,window.endIndex+1);
      const manual=backtest(segment,{...options,strategy:preset,startIndex:window.testStartIndex});
      assert.equal(window.sharpe,manual.metrics.sharpe);
      assert.equal(window.returnPct,manual.metrics.returnPct);
      assert.equal(window.testStart,segment[window.testStartIndex].time);
      assert.equal(window.testEnd,segment.at(-1).time);
    }
    const finite=row.rolling.windows.filter(w=>w.sufficient&&Number.isFinite(w.sharpe));
    assert.equal(row.rolling.assessableCount,finite.length);
    assert.equal(row.rolling.positiveCount,finite.filter(w=>w.sharpe>0).length);
    assert.deepEqual(row.rolling,summarizeRollingSharpe(row.rolling.windows) instanceof Object?
      {...summarizeRollingSharpe(row.rolling.windows),windows:row.rolling.windows}:null);
  }
});

test('Round 18: rolling Pine strategy is re-executed separately for each window, with no future signals',()=>{
  const bars=prices.slice(-900),report=compareStrategiesInRange({...common,bars});
  const row=report.rows.find(r=>r.id==='example:ema-cross');
  assert.equal(row.strategy,'pine-custom');
  assert.equal(row.rolling.windows.length,5);
  const program=compilePine(row.script.code);
  for(const window of row.rolling.windows){
    const segment=bars.slice(window.startIndex,window.endIndex+1);
    const signals=executePine(program,segment,row.script.settings).signals;
    const manual=backtest(segment,{...options,strategy:'pine-custom',customSignals:signals,
      startIndex:window.testStartIndex});
    assert.equal(window.sharpe,manual.metrics.sharpe);
    assert.equal(window.returnPct,manual.metrics.returnPct);
  }
  const indicators=report.rows.filter(r=>r.kind==='example-indicator');
  assert.equal(indicators.length,2);
  assert.ok(indicators.every(r=>r.rolling===undefined),'indicators never manufacture trades or OOS stats');
});

test('Round 18: preserve single 70/30, training rank, best, Validated badge, source and equity',()=>{
  const bars=prices.slice(-700);
  const original=compareStrategies({...common,bars});
  const rolling=compareStrategiesInRange({...common,bars});
  assert.equal(rolling.bestId,original.bestId);
  assert.deepEqual(rolling.overlay,original.overlay);
  assert.equal(rolling.source,original.source);
  assert.equal(rolling.asOf,original.asOf);
  assert.deepEqual(holdoutSummary(rolling.rows).positive,holdoutSummary(original.rows).positive);
  for(const sourceRow of original.rows){
    const out=rolling.rows.find(r=>r.id===sourceRow.id);
    assert.deepEqual(out.metrics,sourceRow.metrics);
    assert.deepEqual(out.trainMetrics,sourceRow.trainMetrics);
    assert.deepEqual(out.testMetrics,sourceRow.testMetrics);
    assert.deepEqual(out.validation,sourceRow.validation);
    if(out.validation)assert.equal(out.validation.validated,
      validatedHoldout(out.testMetrics,out.validation));
  }
});

test('Round 18: rolling uses only selected Backtester dates, and too-short windows stay N/A',()=>{
  const start=1200,end=1399,range={startDate:prices[start].time,endDate:prices[end].time};
  const report=compareStrategiesInRange({...common,bars:prices,range});
  assert.equal(report.range.count,200);
  const windows=report.rollingWindows;
  assert.equal(windows.length,5);
  assert.equal(windows[0].windowStart,prices[start].time);
  assert.equal(windows.at(-1).windowEnd,prices[end].time);
  assert.ok(windows.every(w=>w.testBars===24&&!w.sufficient));
  for(const row of report.rows.filter(x=>x.strategy)){
    assert.equal(row.validation.testBars,60,'original single-split OOS untouched');
    assert.equal(row.rolling.meanSharpe,null);
    assert.equal(row.rolling.medianSharpe,null);
    assert.equal(row.rolling.assessableCount,0);
    assert.equal(row.rolling.positiveCount,0);
    assert.equal(row.rolling.insufficientBars,5);
    assert.match(row.rolling.note,/fewer than 30/);
  }
  const narrow=compareStrategiesInRange({...common,bars:prices,
    range:{startDate:prices[1500].time,endDate:prices[1532].time}});
  assert.equal(narrow.range.count,33);
  assert.equal(narrow.rollingWindows.length,5);
  assert.ok(narrow.rollingWindows.every(w=>w.testBars<30));
  assert.equal(narrow.rows.find(r=>r.id==='preset:ema-cross').rolling.assessableCount,0);
});
