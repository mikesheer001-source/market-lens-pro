import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleData,backtest} from '../src/engine.js';
import {windowBacktestBars,windowPortfolioData,validateBacktestRange,
  displayBacktestRange,actualPortfolioRange} from '../src/date-window.js';
import {runPortfolio} from '../src/portfolio.js';
import {bestSharpeStrategy,runBestFitPortfolio} from '../src/best-fit-portfolio.js';
import {compilePine,executePine} from '../src/pine.js';
import {PINE_EXAMPLES} from '../src/pine-examples.js';

const data=new Map(Object.entries(sampleData()));
const options={strategy:'ema-cross',capital:10000,allocation:100,feeBps:1,
  slipBps:2,stopPct:3,targetPct:12,side:'long'};
const bars=data.get('DEMO-SPY');

test('Round 15: inclusive single-symbol date window, full default, numeric timestamps, no source mutation',()=>{
  const start=bars[110].time,end=bars[160].time;
  const input=bars.slice();
  const selection=windowBacktestBars(input,{startDate:start,endDate:end});
  assert.equal(selection.bars.length,51);
  assert.equal(selection.bars[0].time,start);
  assert.equal(selection.bars.at(-1).time,end);
  assert.deepEqual(selection.range,{startDate:start,endDate:end,
    actualStart:start,actualEnd:end,count:51});
  assert.equal(windowBacktestBars(bars).bars.length,bars.length);
  assert.deepEqual(input,bars);
  const ticks=bars.slice(110,161).map(x=>({...x,time:Date.parse(x.time+'T14:30:00Z')/1000}));
  assert.equal(windowBacktestBars(ticks,{startDate:start,endDate:end}).bars.length,51);
  assert.match(displayBacktestRange(selection.range),new RegExp('Selected range: '+start+' to '+end));
  assert.deepEqual(actualPortfolioRange([{time:start,value:100},{time:end,value:101}],
    {startDate:start,endDate:end}),{startDate:start,endDate:end,actualStart:start,actualEnd:end,count:2});
});
test('Round 15: reversed, invalid, and empty date ranges fail with a plain, useful message',()=>{
  const start=bars[100].time,end=bars[150].time;
  assert.throws(()=>validateBacktestRange({startDate:end,endDate:start}),/start date must be on or before/i);
  assert.throws(()=>validateBacktestRange({startDate:'2026-02-31'}),/valid backtest start date/);
  assert.throws(()=>windowBacktestBars(bars,{startDate:'2099-01-01'}),/No bars fall inside/);
  assert.throws(()=>windowPortfolioData(data,['DEMO-SPY','DEMO-VXX'],{endDate:'1980-01-01'}),/No bars fall inside/);
  assert.deepEqual(validateBacktestRange({}),{startDate:'',endDate:''});
});
test('Round 15: equal-weight portfolio only trades within selected aligned dates',()=>{
  const start=bars[300].time,end=bars[430].time;
  const filtered=windowPortfolioData(data,['DEMO-SPY','DEMO-VXX'],{startDate:start,endDate:end});
  assert.equal(filtered.get('DEMO-SPY').length,131);
  const run=runPortfolio(filtered,['DEMO-SPY','DEMO-VXX'],options,backtest);
  assert.ok(run.curve.every(pt=>pt.time>=start&&pt.time<=end));
  assert.equal(run.curve.at(-1).time,end);
  assert.equal(run.breakdown.length,2);
  assert.ok(run.breakdown.every(row=>row.barDate===end));
});
test('Round 15: best-Sharpe selects highest finite value, skips indicators, deterministic ties',()=>{
  const rows=[
    {id:'preset:a',strategy:'ema-cross',metrics:{sharpe:1},curve:[{time:'a',value:10}]},
    {id:'preset:c',strategy:'breakout',metrics:{sharpe:2},curve:[{time:'a',value:10}]},
    {id:'preset:b',strategy:'trend-rsi',metrics:{sharpe:2},curve:[{time:'a',value:10}]},
    {id:'example:indicator',strategy:null,metrics:{sharpe:99},curve:[]},
    {id:'preset:d',strategy:'rsi-revert',metrics:{sharpe:NaN},curve:[{time:'a',value:10}]}
  ];
  assert.equal(bestSharpeStrategy(rows).id,'preset:b');
  assert.equal(bestSharpeStrategy([{id:'X',strategy:'ema-cross',metrics:{sharpe:null},curve:[]}]),null);
});
test('Round 15: per-symbol overrides preserve equal weights and independent fills',()=>{
  const selected=['DEMO-SPY','DEMO-VXX'],window=windowPortfolioData(data,selected,{
    startDate:bars[200].time,endDate:bars[500].time
  });
  const perSymbol=new Map([['DEMO-SPY','ema-cross'],['DEMO-VXX','rsi-revert']]);
  const call=[];
  const run=runPortfolio(window,selected,options,(b,o)=>{call.push(o);return backtest(b,o);},
    null,{sources:new Map(selected.map(x=>[x,'SIMULATED'])),
      strategyForSymbol:s=>({strategy:perSymbol.get(s),strategyName:perSymbol.get(s),fitSharpe:1.5})});
  assert.deepEqual(call.map(x=>x.strategy),['ema-cross','rsi-revert']);
  assert.ok(call.every(x=>x.capital===5000&&x.feeBps===1&&x.slipBps===2));
  assert.deepEqual(run.breakdown.map(x=>x.strategyName),['ema-cross','rsi-revert']);
  assert.ok(run.breakdown.every(x=>x.source==='SIMULATED'&&x.barDate));
  assert.equal(run.weights['DEMO-SPY'],.5);
  assert.equal(run.weights['DEMO-VXX'],.5);
});
test('Round 15: best-fit ranks each symbol independently, combines real curves, labels source/date/window',()=>{
  const selected=['DEMO-SPY','DEMO-VXX'],start=bars[250].time,end=bars[750].time;
  const report=runBestFitPortfolio({data,symbols:selected,range:{startDate:start,endDate:end},
    options,backtest,compilePine,executePine,savedScripts:[],builtInExamples:PINE_EXAMPLES,
    sources:new Map(selected.map(x=>[x,'SIMULATED']))});
  assert.equal(report.mode,'best-fit');
  assert.deepEqual(report.symbols,selected);
  assert.equal(report.selections.length,2);
  assert.equal(report.breakdown.length,2);
  assert.ok(report.selections.every(x=>Number.isFinite(x.fitSharpe)&&x.strategyName&&x.source==='SIMULATED'&&x.barDate===end));
  assert.ok(report.breakdown.every(x=>x.strategyName&&Number.isFinite(x.fitSharpe)&&x.source==='SIMULATED'&&x.barDate===end));
  assert.equal(report.range.startDate,start);
  assert.equal(report.range.endDate,end);
  assert.equal(report.range.actualEnd,end);
  assert.ok(report.curve.every(pt=>pt.time>=start&&pt.time<=end));
  assert.ok(Number.isFinite(report.metrics.returnPct));
  assert.ok(Number.isFinite(report.metrics.maxDD));
  assert.ok(Number.isFinite(report.metrics.sharpe));
  assert.ok(Number.isFinite(report.metrics.cagrPct));
  assert.equal(report.weights['DEMO-SPY'],.5);
  assert.equal(report.weights['DEMO-VXX'],.5);
  const customTotal=report.breakdown.reduce((n,x)=>n+x.trades,0);
  assert.equal(report.metrics.trades,customTotal);
  assert.match(report.methodology,/selection bias/);
});
