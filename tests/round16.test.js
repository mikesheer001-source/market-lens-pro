import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleData,backtest} from '../src/engine.js';
import {PINE_EXAMPLES} from '../src/pine-examples.js';
import {compilePine,executePine} from '../src/pine.js';
import {assessHoldout,splitValidationBars,validatedHoldout,holdoutSummary,
  MIN_HOLDOUT_BARS} from '../src/validation.js';
import {compareStrategies,sortLeaderboard,leaderboardBest} from '../src/leaderboard.js';
import {fitAcrossUniverse,sortUniverseFit,bestUniverseFit} from '../src/fit.js';
import {bestSharpeStrategy,runBestFitPortfolio} from '../src/best-fit-portfolio.js';

const demo=sampleData(),options={strategy:'ema-cross',capital:10000,allocation:100,
  feeBps:1,slipBps:2,stopPct:3,targetPct:12,side:'long'};

test('Round 16 chronological 70/30 split uses exact disjoint indices/dates',()=>{
  const bars=demo['DEMO-SPY'].slice(0,100);
  const split=splitValidationBars(bars);
  assert.equal(split.trainBars,70);
  assert.equal(split.testBars,30);
  assert.equal(split.trainEndIndex,69);
  assert.equal(split.testStartIndex,70);
  assert.equal(split.trainEnd,bars[69].time);
  assert.equal(split.testStart,bars[70].time);
  assert.equal(split.testEnd,bars[99].time);
  assert.notEqual(split.trainEnd,split.testStart);
  assert.equal(split.trainBars+split.testBars,bars.length);
  assert.equal(MIN_HOLDOUT_BARS,30);
});

test('Round 16 held-out metrics reuse the backtest engine, reset capital, and never leak OOS into train',()=>{
  const bars=demo['DEMO-SPY'].slice(0,600);
  const captured=[];
  const proxy=(history,cfg)=>{
    captured.push({startIndex:cfg.startIndex,endIndex:cfg.endIndex});
    return backtest(history,cfg);
  };
  const assessment=assessHoldout(bars,options,proxy);
  assert.deepEqual(captured,[{startIndex:1,endIndex:419},{startIndex:420,endIndex:undefined}]);
  assert.equal(assessment.validation.trainBars,420);
  assert.equal(assessment.validation.testBars,180);
  const manualTrain=backtest(bars,{...options,startIndex:1,endIndex:419});
  const manualTest=backtest(bars,{...options,startIndex:420});
  assert.equal(assessment.trainMetrics.returnPct,manualTrain.metrics.returnPct);
  assert.equal(assessment.trainMetrics.sharpe,manualTrain.metrics.sharpe);
  assert.equal(assessment.testMetrics.returnPct,manualTest.metrics.returnPct);
  assert.equal(assessment.testMetrics.sharpe,manualTest.metrics.sharpe);
  assert.equal(assessment.validation.validated,validatedHoldout(manualTest.metrics,assessment.validation));
  assert.equal(assessment.validation.testStart,bars[420].time);
});

test('Round 16 validation badge requires positive finite OOS Sharpe and sufficient held-out bars',()=>{
  const split={testBars:40};
  assert.equal(validatedHoldout({sharpe:1.25},split),true);
  assert.equal(validatedHoldout({sharpe:0},split),false);
  assert.equal(validatedHoldout({sharpe:-.01},split),false);
  assert.equal(validatedHoldout({sharpe:null},split),false);
  assert.equal(validatedHoldout({sharpe:NaN},split),false);
  assert.equal(validatedHoldout({sharpe:3},{testBars:29}),false);
  const short=assessHoldout(demo['DEMO-SPY'].slice(0,50),options,backtest);
  assert.equal(short.validation.testBars,15);
  assert.equal(short.validation.validated,false);
  assert.equal(short.validation.enoughTestBars,false);
  assert.match(short.validation.note,/only 15 bars; need at least 30/);
  assert.ok(Number.isFinite(short.testMetrics.returnPct));
});

test('Round 16 leaderboard reports train + OOS while preserving full curves and sorts by TRAIN Sharpe',()=>{
  const bars=demo['DEMO-SPY'].slice(-500);
  const report=compareStrategies({symbol:'DEMO-SPY',bars,options,source:'SIMULATED demo OHLCV',
    backtest,compilePine,executePine,builtInExamples:PINE_EXAMPLES});
  const live=report.rows.filter(r=>r.strategy);
  assert.equal(report.rows.length,12);
  assert.equal(live.length,10);
  assert.ok(live.every(r=>r.validation.trainBars===350&&r.validation.testBars===150));
  assert.ok(live.every(r=>Number.isFinite(r.trainMetrics.returnPct)&&Number.isFinite(r.testMetrics.returnPct)));
  assert.ok(live.every(r=>r.curve.length>400),'keep full equity charts');
  assert.ok(report.rows.some(r=>r.kind==='example-indicator'&&r.testMetrics===undefined));
  assert.equal(report.bestId,leaderboardBest(report.rows).id);
  const reversed=[
    {id:'a',kind:'preset',name:'A',strategy:'a',metrics:{sharpe:-9},
      trainMetrics:{sharpe:2},testMetrics:{sharpe:-1},validation:{enoughTestBars:true}},
    {id:'b',kind:'preset',name:'B',strategy:'b',metrics:{sharpe:10},
      trainMetrics:{sharpe:1},testMetrics:{sharpe:5},validation:{enoughTestBars:true}}
  ];
  assert.equal(leaderboardBest(reversed).id,'a','test and full metrics never decide the default rank');
  const summary=holdoutSummary(reversed);
  assert.equal(summary.positive,1);
  assert.equal(summary.assessable,2);
  assert.equal(summary.best.id,'b','walk-forward summary may name a different OOS winner');
});

test('Round 16 Fit table retains training rank and scores holdout using symbol-specific bar dates',()=>{
  const a=demo['DEMO-SPY'].slice(-420),b=demo['DEMO-VXX'].slice(-420);
  const data=new Map([['DEMO-SPY',a],['DEMO-VXX',b]]);
  const result=fitAcrossUniverse({symbols:[...data.keys()],data,
    options:{...options,strategy:'ema-cross'},backtest,compilePine,executePine,
    sourceFor:s=>'SIMULATED '+s,expectedBarDate:a.at(-1).time});
  assert.equal(result.completed,2);
  assert.ok(result.rows.every(r=>r.trainMetrics&&r.testMetrics&&r.validation));
  assert.ok(result.rows.every(r=>r.validation.trainBars===294&&r.validation.testBars===126));
  assert.ok(result.rows.every(r=>r.barDate&&r.source.startsWith('SIMULATED')));
  const artificial=[
    {symbol:'AAA',metrics:{sharpe:-5},trainMetrics:{sharpe:2},testMetrics:{sharpe:-3}},
    {symbol:'BBB',metrics:{sharpe:8},trainMetrics:{sharpe:1},testMetrics:{sharpe:8}}
  ];
  assert.equal(bestUniverseFit(artificial).symbol,'AAA');
  assert.equal(sortUniverseFit(artificial,'sharpe')[0].symbol,'AAA');
});

test('Round 16 best-fit freezes training winner and reports actual untouched holdout metrics',()=>{
  const a=demo['DEMO-SPY'].slice(-580),b=demo['DEMO-VXX'].slice(-580);
  const data=new Map([['DEMO-SPY',a],['DEMO-VXX',b]]);
  const sources=new Map([['DEMO-SPY','SIMULATED'],['DEMO-VXX','SIMULATED']]);
  const run=runBestFitPortfolio({data,symbols:[...data.keys()],options,backtest,
    compilePine,executePine,builtInExamples:PINE_EXAMPLES,sources});
  assert.equal(run.mode,'best-fit');
  assert.ok(run.selections.length>=1);
  for(const row of run.breakdown){
    assert.equal(row.validation.trainBars,406);
    assert.equal(row.validation.testBars,174);
    assert.equal(row.fitSharpe,row.trainMetrics.sharpe);
    assert.equal(row.validation.validated,validatedHoldout(row.testMetrics,row.validation));
    assert.equal(row.barDate,a.at(-1).time);
    assert.ok(Number.isFinite(row.trainMetrics.returnPct));
    assert.ok(Number.isFinite(row.testMetrics.returnPct));
  }
  assert.match(run.methodology,/first 70% training bars/);
  assert.match(run.methodology,/selection bias/);
  const unrankedBest=bestSharpeStrategy([
    {id:'a',strategy:'ema-cross',metrics:{sharpe:99},trainMetrics:{sharpe:1},curve:[1]},
    {id:'b',strategy:'breakout',metrics:{sharpe:-1},trainMetrics:{sharpe:2},curve:[1]}
  ]);
  assert.equal(unrankedBest.id,'b');
});

test('Round 16 train-null candidates cannot win by leaking excellent full-period or test Sharpe',()=>{
  const leaderboard=[
    {id:'leaky',name:'leaky',strategy:'ema-cross',kind:'preset',
      metrics:{sharpe:99},trainMetrics:{sharpe:null},testMetrics:{sharpe:20},curve:[1]},
    {id:'valid',name:'valid',strategy:'breakout',kind:'preset',
      metrics:{sharpe:-4},trainMetrics:{sharpe:0.5},testMetrics:{sharpe:-2},curve:[1]}
  ];
  assert.equal(leaderboardBest(leaderboard).id,'valid');
  assert.equal(bestSharpeStrategy(leaderboard).id,'valid');
  assert.equal(bestUniverseFit(leaderboard.map((x,i)=>({...x,symbol:'S'+i}))).symbol,'S1');
  assert.equal(sortUniverseFit(leaderboard.map((x,i)=>({...x,symbol:'S'+i})),'sharpe')[0].symbol,'S1');
  assert.equal(bestSharpeStrategy([leaderboard[0]]),null);
});
