import test from 'node:test';
import assert from 'node:assert/strict';
import {validationStatus,validationReasons,isValidatedStrategy,filterValidatedLeaderboard}
  from '../src/validated-strategies.js';
import {leaderboardMetric} from '../src/leaderboard.js';
import {fitMetric} from '../src/fit.js';
import {runBestFitPortfolio} from '../src/best-fit-portfolio.js';
import {validatedFitSymbolRow,fitValidatedAcrossUniverse} from '../src/fit-validated.js';
import {leaderboardRankingCsv,fitRankingCsv,portfolioRankingCsv} from '../src/ranking-export.js';
import {sampleData,backtest} from '../src/engine.js';

const bars=sampleData();
const universe=new Map(Object.entries(bars));
const selected=['DEMO-SPY','DEMO-VXX','DEMO-COIN'];
const range={startDate:bars['DEMO-SPY'][300].time,
  endDate:bars['DEMO-SPY'][900].time};
const options={strategy:'ema-cross',capital:10000,allocation:100,feeBps:0,
  slipBps:0,stopPct:0,targetPct:0,side:'long'};
const make=(name,{single=-1,positive=0,assessable=5,mean=.8,testBars=180,
  training=5}={})=>({
 id:'preset:'+name,name,kind:'preset',strategy:'ema-cross',
 trainMetrics:{sharpe:training,returnPct:3},testMetrics:{sharpe:single,returnPct:4},
 metrics:{sharpe:training,returnPct:5,cagrPct:4,maxDD:9,winPct:60,trades:10},
 validation:{enoughTestBars:testBars>=30,testBars,validated:single>0&&testBars>=30},
 rolling:{totalWindows:5,assessableCount:assessable,positiveCount:positive,
   meanSharpe:mean,medianSharpe:mean-.1}
});
const rolling=make('BAC — Bollinger mean reversion',{single:-.5,positive:4,mean:.805});
const single=make('Single holdout only',{single:1.2,positive:1,mean:-.2});
const both=make('Both paths',{single:1.1,positive:3,mean:1.5});
const failed=make('Unqualified',{single:-.2,positive:2,training:100});

test('Round 26: one unified status agrees with single, rolling and combined qualification, not a stale single-split flag',()=>{
 assert.deepEqual(validationReasons(rolling),['rolling 3/5']);
 assert.equal(rolling.validation.validated,false);
 assert.deepEqual(validationStatus(rolling),{
  validated:true,reasons:['rolling 3/5'],label:'Validated (rolling 3/5)'});
 assert.deepEqual(validationStatus(single),{
  validated:true,reasons:['single 70/30'],label:'Validated (single 70/30)'});
 assert.deepEqual(validationStatus(both),{
  validated:true,reasons:['single 70/30','rolling 3/5'],
  label:'Validated (single 70/30 OR rolling 3/5)'});
 assert.deepEqual(validationStatus(failed),{
  validated:false,reasons:[],label:'Not validated'});
 assert.equal(validationStatus({...rolling,kind:'example-indicator',strategy:null}).label,
  'Indicator · N/A');
 assert.equal(isValidatedStrategy(rolling),true);
 assert.equal(leaderboardMetric(rolling,'validation'),1);
 assert.equal(leaderboardMetric(failed,'validation'),0);
});

test('Round 26: validated best-fit count equals rows labelled Validated, including 4-of-5 rolling-only winner',()=>{
 const rows={
  'DEMO-SPY':[rolling,failed],
  'DEMO-VXX':[single,failed],
  'DEMO-COIN':[both,failed]
 };
 const result=runBestFitPortfolio({data:universe,symbols:selected,
  range,options,validatedOnly:true,backtest,
  compareValidated:ctx=>({rows:rows[ctx.symbol]})});
 assert.equal(result.selectedCount,3);
 assert.equal(result.ranked,3);
 assert.equal(result.breakdown.length,3);
 assert.equal(result.breakdown.filter(row=>validationStatus(row).validated).length,result.ranked);
 assert.equal(result.breakdown.filter(row=>validationStatus(row).label==='Not validated').length,0);
 assert.equal(result.breakdown[0].rolling.positiveCount,4);
 assert.equal(result.breakdown[0].rollingMeanSharpe,.805);
 assert.equal(result.breakdown[0].validation.validated,false);
 assert.equal(validationStatus(result.breakdown[0]).label,'Validated (rolling 3/5)');
 assert.equal(validationStatus(result.breakdown[1]).label,'Validated (single 70/30)');
 assert.equal(validationStatus(result.breakdown[2]).label,
  'Validated (single 70/30 OR rolling 3/5)');
 const exported=portfolioRankingCsv(result,{validatedOnly:true});
 const labels=exported.csv.trimEnd().split(/\r?\n/).slice(6).map(x=>x.split(',').at(-1));
 assert.deepEqual(labels,result.breakdown.map(row=>validationStatus(row).label));
 assert.ok(labels.every(label=>label.startsWith('Validated (')));
});

test('Round 26: failing symbol is excluded from headline, breakdown and portfolio CSV',()=>{
 const rows={
  'DEMO-SPY':[rolling,failed],
  'DEMO-VXX':[failed],
  'DEMO-COIN':[single]
 };
 const result=runBestFitPortfolio({data:universe,symbols:selected,
  range,options,validatedOnly:true,backtest,
  compareValidated:ctx=>({rows:rows[ctx.symbol]})});
 assert.equal(result.ranked,2);
 assert.equal(result.selectedCount,3);
 assert.deepEqual(result.symbols,['DEMO-SPY','DEMO-COIN']);
 assert.deepEqual(result.omitted,['DEMO-VXX']);
 const qualified=result.breakdown.filter(r=>validationStatus(r).validated);
 assert.equal(qualified.length,result.ranked);
 const csv=portfolioRankingCsv(result,{validatedOnly:true});
 assert.equal(csv.rows.length,result.ranked);
 assert.ok(!csv.csv.includes('DEMO-VXX'));
});

test('Round 26: Fit qualifying row shows identical status, reason and CSV text; default sort agrees',async()=>{
 const evaluated=validatedFitSymbolRow('BAC',{rows:[failed,rolling]});
 assert.ok(evaluated);
 assert.equal(evaluated.strategy,'ema-cross');
 assert.equal(validationStatus(evaluated).label,'Validated (rolling 3/5)');
 assert.equal(evaluated.rolling.positiveCount,4);
 assert.equal(fitMetric(evaluated,'validation'),1);
 const singleRow=validatedFitSymbolRow('SPY',{rows:[single]});
 assert.equal(validationStatus(singleRow).label,'Validated (single 70/30)');
 const input=universe.get('DEMO-SPY');
 const result=await fitValidatedAcrossUniverse({
  symbols:['BAC','SPY','FAIL'],data:new Map([['BAC',input],['SPY',input],['FAIL',input]]),
  options,backtest,compare:ctx=>({rows:ctx.symbol==='BAC'?[rolling]:
    ctx.symbol==='SPY'?[single]:[failed]}),dateRange:range
 });
 assert.equal(result.validated,2);
 assert.equal(result.validated,result.rows.filter(r=>validationStatus(r).validated).length);
 const csv=fitRankingCsv(result,{validatedOnly:true});
 assert.deepEqual(csv.rows.map(r=>r.symbol),['BAC','SPY']);
 const records=csv.csv.trimEnd().split(/\r?\n/).slice(1);
 assert.deepEqual(records.map(x=>x.split(',')[5]),result.rows.map(r=>validationStatus(r).label));
 assert.deepEqual(records.map(x=>x.split(',')[0]),result.rows.map(r=>r.symbol));
});

test('Round 26: leaderboard filtered headline, per-row labels, validation sort and CSV all use same OR rule',()=>{
 const report={symbol:'BAC',range,rows:[failed,rolling,single,both]};
 const eligible=filterValidatedLeaderboard(report.rows,true);
 assert.equal(eligible.length,3);
 assert.ok(eligible.every(r=>validationStatus(r).validated));
 assert.equal(eligible.filter(r=>r.validation.validated).length,2,
  'single-split count is NOT the qualified count');
 const csv=leaderboardRankingCsv(report,{validatedOnly:true,sort:'validation',descending:true});
 assert.equal(csv.rows.length,eligible.length);
 const text=csv.csv.trimEnd().split(/\r?\n/).slice(1);
 assert.deepEqual(text.map(x=>x.split(',')[8]),csv.rows.map(row=>validationStatus(row).label));
 assert.ok(text.some(line=>line.includes('Validated (rolling 3/5)')));
 assert.ok(!text.some(line=>line.includes('Not validated')));
 assert.deepEqual(leaderboardRankingCsv(report,{validatedOnly:false}).rows
  .map(x=>x.id).sort(),report.rows.map(x=>x.id).sort());
});

test('Round 26: restored Round 24 breakdown with stored reason but no rolling object still labels correctly',()=>{
 const stored={symbol:'BAC',strategy:'bollinger',strategyName:'Bollinger mean reversion',
  validation:{validated:false,enoughTestBars:true,testBars:100},
  testMetrics:{sharpe:-1},validationReasons:['rolling 3/5'],
  rollingPositiveCount:4,rollingWindowCount:5};
 assert.equal(validationStatus(stored).label,'Validated (rolling 3/5)');
 const report={range,breakdown:[stored],weights:{BAC:1},
  metrics:{returnPct:2,cagrPct:1,sharpe:.1,maxDD:5}};
 const out=portfolioRankingCsv(report,{validatedOnly:true});
 assert.match(out.csv,/Validated \(rolling 3\/5\)/);
});
