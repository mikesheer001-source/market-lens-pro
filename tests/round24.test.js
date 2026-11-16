import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleData,backtest} from '../src/engine.js';
import {runBestFitPortfolio} from '../src/best-fit-portfolio.js';
import {compilePine,executePine} from '../src/pine.js';
import {PINE_EXAMPLES} from '../src/pine-examples.js';
import {chooseValidatedUniverseStrategy,NO_VALIDATED_FIT} from '../src/fit-validated.js';

const data=new Map(Object.entries(sampleData()));
const all=data.get('DEMO-SPY');
const options={strategy:'ema-cross',capital:12000,allocation:100,feeBps:1,
  slipBps:2,stopPct:3,targetPct:12,side:'long'};
const dates={startDate:all[260].time,endDate:all[660].time};
const selection=['DEMO-SPY','DEMO-VXX','DEMO-NVDA'];

function strategy(id,{kind='ema-cross',split=-1,testBars=60,positive=1,
  mean=null,median=mean,training=1,assessable=5}={}){
  return {id,name:id,strategy:kind,kind:'preset',
    metrics:{sharpe:training},trainMetrics:{sharpe:training,returnPct:1},
    testMetrics:{sharpe:split,returnPct:2},
    validation:{testBars,enoughTestBars:testBars>=30,validated:testBars>=30&&split>0},
    rolling:{totalWindows:5,positiveCount:positive,assessableCount:assessable,
      meanSharpe:mean,medianSharpe:median}};
}
const winningRows={
  'DEMO-SPY':[
    strategy('training-favorite',{kind:'breakout',training:99,mean:9,positive:1,split:-2}),
    strategy('OOS-winner',{kind:'rsi-revert',training:0.2,mean:1.25,median:1.1,positive:4,split:-.2}),
    strategy('split-pass',{kind:'ema-cross',training:11,mean:0.6,positive:2,split:1})],
  'DEMO-VXX':[strategy('unvalidated',{training:120,mean:12,positive:2,split:-2})],
  'DEMO-NVDA':[strategy('split-only',{kind:'trend-rsi',mean:null,median:null,
    assessable:0,positive:0,split:1.1})]
};
function fixture(symbols=selection,compareValidated=(ctx)=>({rows:winningRows[ctx.symbol]}),
 extra={}){
  const observed=[],calls=[];
  const result=runBestFitPortfolio({
    data,symbols,range:dates,options,validatedOnly:true,
    sources:new Map(symbols.map(x=>[x,'SIMULATED'])),
    compilePine,executePine,savedScripts:[],builtInExamples:PINE_EXAMPLES,
    backtest:(bars,cfg)=>{calls.push({strategy:cfg.strategy,capital:cfg.capital,
      feeBps:cfg.feeBps,slipBps:cfg.slipBps,barStart:bars[0].time,
      barEnd:bars.at(-1).time});return backtest(bars,cfg);},
    compareValidated:ctx=>{observed.push(ctx);
      return compareValidated(ctx);},...extra
  });
  return {result,observed,calls};
}
test('Round 24: portfolio only chooses a validated OOS winner even when another has far better training Sharpe',()=>{
  const selected=chooseValidatedUniverseStrategy(winningRows['DEMO-SPY']);
  assert.equal(selected.name,'OOS-winner');
  const {result,observed,calls}=fixture();
  assert.equal(result.mode,'best-fit');
  assert.equal(result.fitMode,'validated');
  assert.equal(result.noValidated,false);
  assert.equal(result.selectedCount,3);
  assert.equal(result.ranked,2);
  assert.deepEqual(result.symbols,['DEMO-SPY','DEMO-NVDA']);
  assert.deepEqual(result.selections.map(x=>x.strategyName),['OOS-winner','split-only']);
  assert.equal(result.selections[0].rollingMeanSharpe,1.25);
  assert.equal(result.selections[0].rollingPositiveCount,4);
  assert.equal(result.selections[0].rollingWindowCount,5);
  assert.deepEqual(result.selections[0].validationReasons,['rolling 3/5']);
  assert.deepEqual(result.selections[1].validationReasons,['single 70/30']);
  assert.equal(result.selections[1].rollingMeanSharpe,null);
  assert.equal(result.breakdown[0].strategyName,'OOS-winner');
  assert.equal(result.breakdown[0].rollingMeanSharpe,1.25);
  assert.equal(result.breakdown[0].rollingPositiveCount,4);
  assert.equal(result.breakdown[1].strategyName,'split-only');
  assert.deepEqual(result.omitted,['DEMO-VXX']);
  assert.deepEqual(Object.values(result.weights),[.5,.5]);
  assert.equal(calls.length,2,'only surviving strategies enter combined portfolio');
  assert.deepEqual(calls.map(x=>x.strategy),['rsi-revert','trend-rsi']);
  assert.ok(calls.every(x=>x.capital===6000&&x.feeBps===1&&x.slipBps===2));
  assert.ok(calls.every(x=>x.barStart===dates.startDate&&x.barEnd===dates.endDate));
  assert.ok(observed.every(x=>x.range&&Object.keys(x.range).length===0));
  assert.ok(observed.every(x=>x.bars[0].time===dates.startDate&&
    x.bars.at(-1).time===dates.endDate));
  assert.equal(result.range.actualEnd,dates.endDate);
  assert.match(result.methodology,/selection bias/);
  assert.match(result.methodology,/NOT an independent out-of-sample/);
});

test('Round 24: symbols with zero validated strategies are excluded despite extreme in-sample Sharpe',()=>{
  const {result}=fixture(selection,(ctx)=>({rows:
    ctx.symbol==='DEMO-NVDA'?[strategy('positive split',{split:.4,mean:-.3,positive:2})]:
    [strategy('training winner',{training:100,mean:5,positive:2,split:-1})]}));
  assert.deepEqual(result.symbols,['DEMO-NVDA']);
  assert.equal(result.ranked,1);
  assert.equal(result.requestedCount,3);
  assert.equal(result.breakdown[0].rollingMeanSharpe,-.3,
    'negative rolling mean can qualify on independent positive 70/30');
  assert.equal(result.weights['DEMO-NVDA'],1);
  assert.deepEqual(result.omitted,['DEMO-SPY','DEMO-VXX']);
});

test('Round 24: no validated symbols creates explicit empty result without fabricating portfolio',()=>{
  const {result,calls}=fixture(selection,()=>({rows:[
    strategy('failed',{training:500,split:-1,positive:2,mean:4}),
    strategy('short test',{split:10,testBars:29,positive:2,mean:3})]}));
  assert.equal(result.noValidated,true);
  assert.equal(result.notice,NO_VALIDATED_FIT);
  assert.equal(result.selectedCount,3);
  assert.equal(result.ranked,0);
  assert.deepEqual(result.symbols,[]);
  assert.deepEqual(result.breakdown,[]);
  assert.deepEqual(result.weights,{});
  assert.deepEqual(result.curve,[]);
  assert.equal(result.metrics,null);
  assert.equal(calls.length,0,'never backtest fabricated combined allocations');
  assert.equal(result.omitted.length,3);
});

test('Round 24: changing to a short 60-session window recomputes eligibility and returns no validated symbols',()=>{
  const start=all[300].time,end=all[359].time;
  const result=runBestFitPortfolio({
    data,symbols:['DEMO-SPY','DEMO-VXX'],
    range:{startDate:start,endDate:end},
    options,validatedOnly:true,backtest,compilePine,executePine,
    builtInExamples:PINE_EXAMPLES
  });
  assert.equal(result.noValidated,true);
  assert.equal(result.notice,NO_VALIDATED_FIT);
  assert.equal(result.selectedCount,2);
  assert.equal(result.range.startDate,start);
  assert.equal(result.range.endDate,end);
});

test('Round 24: history too short for 40-bar alignment is a plain no-validation result',()=>{
  const result=runBestFitPortfolio({
    data,symbols:['DEMO-SPY','DEMO-VXX'],
    range:{startDate:all[300].time,endDate:all[318].time},
    options,validatedOnly:true,backtest,compilePine,executePine
  });
  assert.equal(result.noValidated,true);
  assert.deepEqual(result.symbols,[]);
  assert.equal(result.selectedCount,2);
});
