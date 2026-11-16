import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleData} from '../src/engine.js';
import {VOL_TICKERS,volatilityRow,realizedVolatility,contangoPriceProxies} from '../src/volatility.js';

const data=sampleData(),bars=data['DEMO-VXX'];
test('ten active volatility symbols are sourced from the same 133-symbol universe',()=>{
  assert.deepEqual(VOL_TICKERS,['VXX','UVXY','SVXY','VIXY','VIXM','VXZ','SVIX','UVIX','SVOL','ZVOL']);
});

test('20/60D realized volatility uses sample standard deviation of annualized DAILY log returns',()=>{
  for(const n of [20,60]){
    const actual=realizedVolatility(bars,n);
    const closes=bars.slice(-n-1).map(x=>x.close);
    const changes=closes.slice(1).map((c,i)=>Math.log(c/closes[i]));
    const mean=changes.reduce((sum,x)=>sum+x,0)/n;
    const expected=100*Math.sqrt(252)*Math.sqrt(changes.reduce((sum,x)=>sum+(x-mean)**2,0)/(n-1));
    assert.ok(Math.abs(actual-expected)<1e-10);
  }
  assert.equal(realizedVolatility(bars.slice(0,15),20),null);
});

test('252-session HIGH drawdown and 20D return read from actual dataset input',()=>{
  const result=volatilityRow('DEMO-VXX',bars,'SIMULATED');
  assert.equal(result.bars,bars.length);
  const highest=Math.max(...bars.slice(-252).map(x=>x.high));
  assert.ok(Math.abs(result.drawdown252-100*(bars.at(-1).close/highest-1))<1e-12);
  assert.ok(Math.abs(result.return20-100*(bars.at(-1).close/bars.at(-21).close-1))<1e-12);
  assert.ok(Number.isFinite(result.rv60));
  assert.equal(result.source,'SIMULATED');
  assert.equal(volatilityRow('NO_DATA',undefined,'NOT LOADED').rv20,null);
});

test('contango proxy is computed only on aligned price returns, not NAV level comparison',()=>{
  const fixture=new Map([
    ['VXX',data['DEMO-VXX']],
    ['VXZ',data['DEMO-SPY']],
    ['SVXY',data['DEMO-NVDA']]
  ]);
  const v=contangoPriceProxies(fixture,{sources:'SIMULATED TEST INPUT'});
  const latest=(code)=>data[code].at(-1).close/data[code].at(-21).close-1;
  const expected=100*(latest('DEMO-SPY')-latest('DEMO-VXX'));
  assert.ok(Math.abs(v.relativeReturn20-expected)<1e-10);
  assert.ok(Number.isFinite(v.svxyVxxRatioTrend20));
  assert.equal(v.sources,'SIMULATED TEST INPUT');
  assert.match(v.method,/NOT measured VIX futures/);
  assert.match(v.rule,/\+5 pp/);
});

test('price-based regime returns strict steep/flat/backwardation conditions, never invented derivatives',()=>{
  const make=(factor)=>Array.from({length:30},(_,i)=>({time:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),close:100*factor**i}));
  const frontWeak=new Map([['VXX',make(.986)],['VXZ',make(1)],['SVXY',make(1.005)]]);
  const steep=contangoPriceProxies(frontWeak);
  assert.equal(steep.regime,'Steep contango (price proxy)');
  const frontStrong=new Map([['VXX',make(1.014)],['VXZ',make(1)],['SVXY',make(.995)]]);
  assert.equal(contangoPriceProxies(frontStrong).regime,'Backwardation (price proxy)');
  const flat=new Map([['VXX',make(1.001)],['VXZ',make(1)],['SVXY',make(1.001)]]);
  assert.equal(contangoPriceProxies(flat).regime,'Flat or mixed (price proxy)');
  assert.equal(contangoPriceProxies(new Map()).regime,'Unavailable');
});
