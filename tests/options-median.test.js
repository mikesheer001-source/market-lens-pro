import assert from 'node:assert/strict';
import test from 'node:test';
import {estimateOptionsMedian,estimateOptionsMedianRelaxed,loadOptionsMedians,nearestMedianExpiry,estimateOptionsProbabilityLevels,loadOptionsProbability} from '../src/options-median.js';

const now=Date.parse('2026-01-15T20:00:00Z');
const expiry='2026-07-15';
function uniformChain({median=103,rate=.04,quoteAge=0,spread=.02}={}) {
  const time=new Date(now-quoteAge).toISOString();
  const years=(Date.parse(expiry+'T20:00:00Z')-now)/(365*86_400_000);
  const df=Math.exp(-rate*years);
  const low=median-20, high=median+20;
  return Array.from({length:17},(_,i)=>84+i*2).flatMap(strike=>['call','put'].map(type=>{
    const mid=df*(type==='call'?(high-strike)**2:(strike-low)**2)/80;
    return {root:'SPY',strike,type,quote:{bid:mid-spread/2,ask:mid+spread/2,time}};
  }));
}

test('uses the nearest listed expiry around each calendar horizon',()=>{
  const expirations=['2026-06-26','2026-07-17','2027-01-22'];
  assert.equal(nearestMedianExpiry(expirations,6,now),'2026-07-17');
  assert.equal(nearestMedianExpiry(expirations,12,now),'2027-01-22');
  assert.equal(nearestMedianExpiry(['2026-04-17'],6,now),undefined);
  assert.equal(nearestMedianExpiry(['2026-02-27','2026-02-28','2026-03-01'],6,
    Date.parse('2025-08-31T20:00:00Z')),'2026-02-28');
});

test('estimates the terminal median from discounted vertical quotes',()=>{
  for(const type of ['call','put']){
    const result=estimateOptionsMedian(uniformChain().filter(row=>row.type===type),{spot:100,expiry,now});
    assert.ok(result.spreadCount>=4);
    assert.ok(Math.abs(result.price-103)<.01);
    assert.equal(result.quoteTime,now);
  }
});

test('omits levels for stale, wide, sparse, or unbracketed quotes',()=>{
  const params={spot:100,expiry,now};
  assert.equal(estimateOptionsMedian(uniformChain({quoteAge:8*86_400_000}),params),null);
  assert.equal(estimateOptionsMedian(uniformChain({spread:10}),params),null);
  assert.equal(estimateOptionsMedian(uniformChain().slice(0,4),params),null);
  assert.equal(estimateOptionsMedian(uniformChain().filter(row=>row.strike<102),params),null);
});

test('lower-confidence mode still rejects stale, extreme or unbracketed chains',()=>{
  const params={spot:100,expiry,now};
  for(const chain of [uniformChain({quoteAge:8*86_400_000}),uniformChain({spread:10}),
    uniformChain().slice(0,4),uniformChain().filter(row=>row.strike<102)])
    assert.equal(estimateOptionsMedianRelaxed(chain,params),null);
});

test('expands the chain search to 80% when 30% cannot bracket the median',async()=>{
  const calls=[];
  const result=await loadOptionsMedians({symbol:'VXX',rate:.04,now,signal:new AbortController().signal,
    request:async (path,params)=>{
      if(path==='expirations')return {underlying:{value:100},expirations:[expiry]};
      calls.push(params.width);
      return {contracts:params.width===.30?uniformChain().filter(row=>row.strike<102):uniformChain()};
    }});
  assert.deepEqual(calls,[.30,.80]);
  assert.equal(result.levels[0].confidence,'standard');
  assert.equal(result.levels[0].range,.80);
  assert.ok(Math.abs(result.levels[0].price-103)<.01);
  assert.match(result.levels[1].error,/No listed expiration/);
});

test('reports why chains with no usable quotes are unavailable',async()=>{
  const result=await loadOptionsMedians({symbol:'VXX',rate:.04,now,signal:new AbortController().signal,
    request:async path=>path==='expirations'?{underlying:{value:100},expirations:[expiry]}:{contracts:uniformChain({quoteAge:8*86_400_000})}});
  assert.match(result.levels[0].error,/No fresh, valid two-sided quotes/);
  assert.equal(result.levels[0].price,undefined);
});

test('returns a labeled lower-confidence estimate for a defensible wider chain',()=>{
  const params={spot:100,expiry,now};
  const chain=uniformChain({spread:2});
  assert.equal(estimateOptionsMedian(chain,params),null);
  const result=estimateOptionsMedianRelaxed(chain,params);
  assert.equal(result.confidence,'lower');
  assert.ok(Math.abs(result.price-103)<1);
  assert.ok(result.sensitivity[0]<result.price && result.sensitivity[1]>result.price);
});

test('25/50/75 survival levels use actual strikes and are ordered',()=>{
  const rows=estimateOptionsProbabilityLevels(uniformChain(),{spot:100,expiry,now});
  for(const [i,expected] of [113,103,93].entries()){
    assert.ok(Math.abs(rows[i].price-expected)<.1,JSON.stringify(rows[i]));
  }
});
test('forecast uses listed expirations and preserves unavailable horizons',async()=>{
  const r=await loadOptionsProbability({symbol:'VXX',rate:.04,now,request:async path=>path==='expirations'?{underlying:{value:100},expirations:[expiry]}:{contracts:uniformChain()}});
  assert.equal(r.levels.length,9);
  assert.equal(r.levels.filter(x=>Number.isFinite(x.price)).length,3);
  assert.ok(r.levels.filter(x=>Number.isFinite(x.price)).every(x=>x.expiry===expiry));
});
