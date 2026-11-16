import test from 'node:test';
import assert from 'node:assert/strict';
import {backtest,sampleData} from '../src/engine.js';
import {compilePine,executePine} from '../src/pine.js';
import {PINE_EXAMPLES} from '../src/pine-examples.js';
import {compareStrategies} from '../src/leaderboard.js';
import {holdoutSummary,splitValidationBars} from '../src/validation.js';
import {compareStrategiesInRange,leaderboardRangeStatus,rangeLabel} from '../src/leaderboard-range.js';

const history=sampleData()['DEMO-SPY'];
const options={strategy:'ema-cross',timeframe:'D',capital:10000,allocation:100,
  feeBps:1,slipBps:2,stopPct:0,targetPct:0,side:'long',fast:20,slow:100};
const common={symbol:'DEMO-SPY',source:'SIMULATED Demo OHLCV',options,
  backtest,compilePine,executePine,builtInExamples:PINE_EXAMPLES};
const run=range=>compareStrategiesInRange({...common,bars:history,range});
const check=(report,range)=>leaderboardRangeStatus(report,{bars:history,range,
  symbol:'DEMO-SPY',timeframe:'D',source:'SIMULATED Demo OHLCV'});

test('Round 17: an explicitly selected window is used for EVERY leaderboard strategy and its chart',()=>{
  const startIndex=1100,endIndex=1400;
  const range={startDate:history[startIndex].time,endDate:history[endIndex].time};
  const result=run(range),selected=history.slice(startIndex,endIndex+1);
  assert.deepEqual(result.range,{...range,actualStart:range.startDate,
    actualEnd:range.endDate,count:301});
  assert.equal(result.rows.length,12);
  assert.equal(result.asOf,range.endDate);
  assert.equal(result.overlay.benchmark.length,result.rows[0].curve.length);
  for(const preset of ['ema-cross','rsi-revert','trend-rsi','bollinger','breakout']){
    const row=result.rows.find(x=>x.id==='preset:'+preset);
    assert.ok(row,'must include '+preset);
    const direct=backtest(selected,{...options,strategy:preset});
    assert.equal(row.metrics.returnPct,direct.metrics.returnPct);
    assert.equal(row.metrics.sharpe,direct.metrics.sharpe);
    assert.deepEqual(row.curve,direct.curve);
    assert.equal(row.validation.trainBars,210);
    assert.equal(row.validation.testBars,91);
  }
  assert.equal(check(result,range).matches,true);
});
test('Round 17: the walk-forward summary splits ONLY the selected window (70/30)',()=>{
  const startIndex=950,endIndex=1249,range={startDate:history[startIndex].time,
    endDate:history[endIndex].time};
  const report=run(range),bars=history.slice(startIndex,endIndex+1);
  const split=splitValidationBars(bars),score=holdoutSummary(report.rows);
  assert.equal(split.trainBars,210);
  assert.equal(split.testBars,90);
  const testStart=history[startIndex+210].time;
  assert.equal(split.testStart,testStart);
  for(const row of report.rows.filter(x=>x.strategy)){
    assert.equal(row.validation.trainStart,range.startDate);
    assert.equal(row.validation.trainEnd,history[startIndex+209].time);
    assert.equal(row.validation.testStart,testStart);
    assert.equal(row.validation.testEnd,range.endDate);
    const oos=backtest(bars,{...options,strategy:row.strategy,
      startIndex:split.testStartIndex});
    if(row.kind==='preset'){
      assert.equal(row.testMetrics.returnPct,oos.metrics.returnPct);
      assert.equal(row.testMetrics.sharpe,oos.metrics.sharpe);
    }
  }
  const eligible=report.rows.filter(x=>x.strategy&&x.validation.enoughTestBars&&Number.isFinite(x.testMetrics?.sharpe));
  assert.equal(score.assessable,eligible.length);
  assert.equal(score.positive,eligible.filter(x=>x.testMetrics.sharpe>0).length);
  assert.equal(score.best?.id,eligible.sort((a,b)=>b.testMetrics.sharpe-a.testMetrics.sharpe||
    String(a.id).localeCompare(String(b.id)))[0]?.id);
});
test('Round 17: changing only start date with SAME last bar must invalidate saved leaderboard',()=>{
  const first={startDate:history[1000].time,endDate:history[1399].time};
  const second={startDate:history[1100].time,endDate:history[1399].time};
  const original=run(first);
  assert.equal(check(original,first).matches,true);
  assert.equal(check(original,second).matches,false);
  const updated=run(second);
  assert.equal(check(updated,second).matches,true);
  assert.notEqual(original.range.count,updated.range.count);
  assert.notEqual(original.rows.find(x=>x.id==='preset:ema-cross').metrics.returnPct,
    updated.rows.find(x=>x.id==='preset:ema-cross').metrics.returnPct);
  assert.notEqual(original.rows.find(x=>x.id==='preset:ema-cross').validation.testStart,
    updated.rows.find(x=>x.id==='preset:ema-cross').validation.testStart);
  assert.equal(check(original,{}).matches,false);
  assert.equal(check(updated,first).matches,false);
  assert.equal(rangeLabel(second),'Selected range: '+second.startDate+' to '+second.endDate);
});
test('Round 17: Full range is unchanged from the Round 16 engine, including OOS and overlay',()=>{
  const report=run({});
  const original=compareStrategies({...common,bars:history});
  assert.equal(report.range.actualStart,history[0].time);
  assert.equal(report.range.actualEnd,history.at(-1).time);
  assert.equal(report.range.count,history.length);
  assert.equal(rangeLabel({}),'Full range');
  assert.equal(check(report,{}).matches,true);
  assert.equal(report.bestId,original.bestId);
  assert.deepEqual(report.rows.map(x=>({id:x.id,metrics:x.metrics,
    trainMetrics:x.trainMetrics,testMetrics:x.testMetrics,validation:x.validation})),
    original.rows.map(x=>({id:x.id,metrics:x.metrics,
      trainMetrics:x.trainMetrics,testMetrics:x.testMetrics,validation:x.validation})));
  assert.deepEqual(report.overlay,original.overlay);
  assert.deepEqual(holdoutSummary(report.rows).positive,holdoutSummary(original.rows).positive);
  const legacy={...original,range:undefined};
  assert.equal(check(legacy,{}).matches,true,'older Full-range saves should still work');
  assert.equal(check(legacy,{startDate:history[1100].time}).matches,false,
    'older full saves must not be misrepresented as a narrowed run');
});
test('Round 17: 33-bar user-selected windows run honestly; small OOS is flagged, not validated',()=>{
  const range={startDate:history[1500].time,endDate:history[1532].time};
  const report=run(range);
  assert.equal(report.range.count,33);
  assert.equal(report.rows.length,12);
  const split=splitValidationBars(history.slice(1500,1533));
  assert.equal(split.trainBars,23);
  assert.equal(split.testBars,10);
  for(const row of report.rows.filter(x=>x.strategy)){
    assert.equal(row.validation.testBars,10);
    assert.equal(row.validation.enoughTestBars,false);
    assert.equal(row.validation.validated,false);
    assert.match(row.validation.note,/need at least 30/);
  }
  assert.equal(holdoutSummary(report.rows).assessable,0);
  assert.throws(()=>compareStrategies({...common,bars:history.slice(1500,1533)}),
    /At least 40/,'original Full range minimum remains 40');
  assert.throws(()=>run({startDate:history[1600].time,endDate:history[1602].time}),
    /At least 5/);
  assert.throws(()=>run({startDate:'2099-01-01'}),/No bars fall inside/);
});
test('Round 17: mismatched symbol, timeframe or source cannot display outdated numbers',()=>{
  const range={startDate:history[1000].time,endDate:history[1300].time},report=run(range);
  assert.equal(leaderboardRangeStatus(report,{bars:history,range,symbol:'DEMO-VXX',timeframe:'D'}).matches,false);
  assert.equal(leaderboardRangeStatus(report,{bars:history,range,symbol:'DEMO-SPY',timeframe:'W'}).matches,false);
  assert.equal(leaderboardRangeStatus(report,{bars:history,range,symbol:'DEMO-SPY',timeframe:'D',source:'ALPACA'}).matches,false);
  assert.equal(check(report,{startDate:history[1100].time,endDate:history[1000].time}).matches,false);
});
