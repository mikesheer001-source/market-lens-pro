import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleData,backtest} from '../src/engine.js';
import {runPortfolio,runPortfolioSweep,portfolioUniverse,portfolioSweepVariants} from '../src/portfolio.js';
import {compilePine,executePine} from '../src/pine.js';
import {PINE_EXAMPLES} from '../src/pine-examples.js';

const data=new Map(Object.entries(sampleData()));
const opts={strategy:'ema-cross',capital:10000,feeBps:1,slipBps:2,stopPct:3,targetPct:10,allocation:100};
test('portfolio uses equal starting capital per symbol and combines matched-date equity exactly',()=>{
  const symbols=['DEMO-SPY','DEMO-VXX'];
  const p=runPortfolio(data,symbols,opts,backtest,null,{sources:new Map([['DEMO-SPY','SIMULATED'],['DEMO-VXX','SIMULATED']])});
  assert.deepEqual(p.symbols,symbols);
  assert.equal(p.weights['DEMO-SPY'],.5);
  assert.equal(p.weights['DEMO-VXX'],.5);
  assert.equal(p.breakdown.length,2);
  assert.equal(p.curve.length,p.series.get('DEMO-SPY').length-1);
  const runs=symbols.map(symbol=>backtest(data.get(symbol),{...opts,capital:5000,timeframe:'D'}));
  for(const i of [0,1,30,p.curve.length-1])
    assert.ok(Math.abs(p.curve[i].value-(runs[0].curve[i].value+runs[1].curve[i].value))<.000001);
  const result=100*(p.curve.at(-1).value/opts.capital-1);
  assert.ok(Math.abs(result-p.metrics.returnPct)<1e-10);
  assert.equal(p.metrics.trades,p.breakdown.reduce((n,r)=>n+r.trades,0));
  assert.ok(p.benchmarkCurve.every(x=>Number.isFinite(x.value)));
  assert.equal(p.breakdown[0].source,'SIMULATED');
});

test('portfolio alignment trims unmatched early dates without pretending they trade together',()=>{
  const altered=new Map(data);
  altered.set('DEMO-VXX',data.get('DEMO-VXX').slice(60));
  const aligned=portfolioUniverse(altered,['DEMO-SPY','DEMO-VXX']);
  assert.equal(aligned.dates.length,1740);
  const p=runPortfolio(altered,['DEMO-SPY','DEMO-VXX'],opts,backtest);
  assert.equal(p.curve.length,1739);
  assert.equal(p.curve[0].time,data.get('DEMO-VXX')[61].time);
  const dropped=runPortfolio(data,['DEMO-SPY','NO_SUCH_SYMBOL'],opts,backtest);
  assert.deepEqual(dropped.omitted,['NO_SUCH_SYMBOL']);
  assert.equal(dropped.weights['DEMO-SPY'],1);
});

test('portfolio Sharpe, CAGR, max drawdown and equal-capital benchmark are finite and sourced',()=>{
  const p=runPortfolio(data,['DEMO-SPY','DEMO-NVDA','DEMO-COIN'],opts,backtest);
  for(const metric of ['returnPct','cagrPct','maxDD','sharpe','endEquity','buyHoldPct'])
    assert.ok(Number.isFinite(p.metrics[metric]),metric);
  assert.ok(p.metrics.maxDD>=0);
  assert.equal(p.breakdown.length,3);
  assert.ok(p.metrics.winPct==null||p.metrics.winPct>=0&&p.metrics.winPct<=100);
});

test('portfolio 70/30 training and holdout sweep uses identical universe and nine preset variants',()=>{
  const rows=runPortfolioSweep(data,['DEMO-SPY','DEMO-NVDA'],opts,backtest);
  assert.equal(rows.length,9);
  assert.ok(rows.every(row=>row.n===2&&Number.isFinite(row.train.returnPct)&&Number.isFinite(row.test.returnPct)));
  assert.ok(rows.every(row=>row.train.endEquity>0&&row.test.endEquity>0));
});

test('portfolio Pine strategy uses independent per-symbol signals and sweeps numeric Pine inputs',()=>{
  const program=compilePine(PINE_EXAMPLES.find(x=>x.id==='ema-cross').code);
  const input={...opts,strategy:'pine-custom',pineParams:{fastLength:20,slowLength:50}};
  const getSignals=(symbol,bars,overrides)=>executePine(program,bars,{...input.pineParams,...overrides}).signals;
  const result=runPortfolio(data,['DEMO-SPY','DEMO-COIN'],input,backtest,getSignals);
  assert.equal(result.breakdown.length,2);
  assert.ok(result.metrics.trades>0);
  const variants=portfolioSweepVariants(input,program.inputs);
  assert.equal(variants.length,9);
  const rows=runPortfolioSweep(data,['DEMO-SPY','DEMO-COIN'],input,backtest,getSignals,{pineInputs:program.inputs});
  assert.equal(rows.length,9);
  assert.ok(rows.every(r=>r.n===2));
});
