import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleData,backtest} from '../src/engine.js';
import {compareStrategiesInRange} from '../src/leaderboard-range.js';
import {compilePine,executePine} from '../src/pine.js';
import {PINE_EXAMPLES} from '../src/pine-examples.js';
import {VALIDATION_RULE,singleSplitValidated,rollingValidated,validationReasons,
  isValidatedStrategy,filterValidatedLeaderboard,bestRollingValidatedStrategy,
  bestFullPeriodStrategy,briefingStrategyLeaders} from '../src/validated-strategies.js';
import {compileDailyBriefing,briefingLeaderLines,briefingToText} from '../src/briefing.js';

const row=(id,{splitSharpe=null,testBars=42,positive=0,assessable=5,
  mean=null,full=0,kind='preset'}={})=>({
  id,name:id,kind,strategy:kind==='example-indicator'?null:'ema-cross',
  validation:{enoughTestBars:testBars>=30,testBars,validated:testBars>=30&&splitSharpe>0},
  testMetrics:{sharpe:splitSharpe},
  rolling:{totalWindows:5,positiveCount:positive,assessableCount:assessable,
    meanSharpe:mean,medianSharpe:mean},
  metrics:{sharpe:full}
});
const sample=[
  row('A — single only',{splitSharpe:1.1,positive:1,mean:0.2,full:0.4}),
  row('B — rolling only',{splitSharpe:-0.2,positive:3,mean:0.8,full:0.6}),
  row('C — stronger training, no validation',{splitSharpe:-0.4,positive:2,mean:1.8,full:3.5}),
  row('D — too few single holdout bars',{splitSharpe:3,testBars:29,positive:0,mean:null,full:2}),
  row('E — inconsistent rolling counts',{splitSharpe:-1,positive:3,assessable:2,mean:2.2,full:1.1}),
  row('F — no executable indicator',{kind:'example-indicator'})
];

test('Round 22: validation accepts positive 70/30 with 30+ bars OR at least three actual rolling positives',()=>{
  assert.match(VALIDATION_RULE,/single 70\/30/);
  assert.match(VALIDATION_RULE,/3 of 5 rolling/);
  assert.equal(singleSplitValidated(sample[0]),true);
  assert.equal(rollingValidated(sample[0]),false);
  assert.equal(singleSplitValidated(sample[1]),false);
  assert.equal(rollingValidated(sample[1]),true);
  assert.deepEqual(validationReasons(sample[0]),['single 70/30']);
  assert.deepEqual(validationReasons(sample[1]),['rolling 3/5']);
  assert.deepEqual(validationReasons(sample[2]),[]);
  assert.equal(singleSplitValidated(sample[3]),false);
  assert.equal(rollingValidated(sample[4]),false,'3 positives cannot come from 2 assessable windows');
  assert.equal(isValidatedStrategy(sample[5]),false,'indicator example cannot pass');
  assert.deepEqual(filterValidatedLeaderboard(sample,true).map(x=>x.id),
    ['A — single only','B — rolling only']);
  assert.equal(filterValidatedLeaderboard(sample,false).length,sample.length);
  assert.equal(sample.length,6,'filter does not mutate source results');
  assert.equal(bestRollingValidatedStrategy(sample)?.id,'B — rolling only');
  assert.equal(bestFullPeriodStrategy(sample)?.id,'C — stronger training, no validation');
});

test('Round 22: no qualifying strategies produces an empty validated-only set without inventing a winner',()=>{
  const negative=[sample[2],sample[3],sample[4],sample[5]];
  assert.deepEqual(filterValidatedLeaderboard(negative,true),[]);
  assert.equal(bestRollingValidatedStrategy(negative),null);
  const leaders=briefingStrategyLeaders({symbol:'SPY',timeframe:'D',source:'ALPACA IEX',
    rows:negative});
  assert.equal(leaders.validated,0);
  assert.equal(leaders.rolling,null);
  assert.equal(leaders.fullPeriod.name,'C — stronger training, no validation');
});

test('Round 22: real short selected date window has no qualifying validation; full window uses its own results',()=>{
  const bars=sampleData()['DEMO-SPY'];
  const common={symbol:'DEMO-SPY',timeframe:'D',source:'SIMULATED',
    options:{strategy:'ema-cross',capital:10000,allocation:100,feeBps:1,
      slipBps:2,stopPct:0,targetPct:0,side:'long',fast:20,slow:100},
    builtInExamples:PINE_EXAMPLES,backtest,compilePine,executePine};
  const short=compareStrategiesInRange({...common,bars,
    range:{startDate:bars[90].time,endDate:bars[149].time}});
  assert.equal(short.range.bars,undefined);
  assert.ok(short.rows.filter(x=>x.strategy).length>=5);
  assert.equal(filterValidatedLeaderboard(short.rows,true).length,0);
  assert.ok(short.rows.every(x=>!x.strategy||!x.validation.enoughTestBars));
  const full=compareStrategiesInRange({...common,bars,range:{}});
  const expected=full.rows.filter(r=>r.strategy&&(
    (r.validation?.testBars>=30&&r.testMetrics?.sharpe>0)||
    (r.rolling?.totalWindows===5&&r.rolling?.assessableCount>=3&&
      r.rolling?.positiveCount>=3)));
  assert.deepEqual(filterValidatedLeaderboard(full.rows,true).map(r=>r.id),
    expected.map(r=>r.id));
  assert.ok(full.rows.length>short.rows.length-1);
});

test('Round 22: briefing highlights highest rolling mean OOS winner and separately labels true full-period best',()=>{
  const leaders=briefingStrategyLeaders({symbol:'SPY',timeframe:'D',
    source:'Alpaca IEX OHLCV',range:{startDate:'2025-01-01',endDate:'2026-11-16'},
    rows:sample});
  assert.equal(leaders.rolling.name,'B — rolling only');
  assert.equal(leaders.rolling.meanSharpe,0.8);
  assert.equal(leaders.rolling.positiveWindows,3);
  assert.equal(leaders.rolling.totalWindows,5);
  assert.equal(leaders.fullPeriod.name,'C — stronger training, no validation');
  assert.equal(leaders.fullPeriod.sharpe,3.5);
  const bars=sampleData()['DEMO-SPY'].slice(-300);
  const scan={status:'complete',source:'ALPACA',returned:1,requested:133};
  const briefing=compileDailyBriefing({
    generatedAt:'2026-11-17T04:00:00Z',scan,
    data:new Map([['SPY',bars]]),sources:new Map([['SPY','ALPACA']]),
    symbols:['SPY'],strategyLeaders:leaders
  });
  const display=briefingLeaderLines(briefing),text=briefingToText(briefing);
  assert.match(display.validated,/B — rolling only/);
  assert.match(display.validated,/rolling mean OOS Sharpe 0\.800/);
  assert.match(display.validated,/3\/5 windows positive/);
  assert.match(display.validated,/2025-01-01 to 2026-11-16/);
  assert.match(display.fullPeriod,/Full-period best \(full-period Sharpe\): C — stronger training/);
  assert.match(text,/Top validated strategy \(rolling OOS\): B — rolling only/);
  assert.match(text,/Full-period best \(full-period Sharpe\): C — stronger training/);
  assert.ok(text.indexOf('Top validated strategy')<text.indexOf('Full-period best'));
  assert.equal(briefing.strategy.name,null,'signal strategy remains independent');
  assert.equal(briefing.strategyLeaders.rolling.id,'B — rolling only');
});

test('Round 22: briefing says none validated when rolling mean is missing or all strategies fail',()=>{
  const leaders=briefingStrategyLeaders({symbol:'ABBV',timeframe:'D',
    source:'Alpaca IEX OHLCV',rows:sample.slice(2)});
  const b={strategyLeaders:leaders};
  assert.match(briefingLeaderLines(b).validated,
    /No validated strategy with a numeric rolling mean on this window/);
  assert.match(briefingLeaderLines(b).fullPeriod,/C — stronger training/);
  assert.match(briefingLeaderLines({strategyLeaders:null,
    strategyLeadersError:'No live history'}).validated,/No live history/);
});
