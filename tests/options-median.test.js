import assert from 'node:assert/strict';
import test from 'node:test';
import {estimateOptionsMedian,nearestMedianExpiry} from '../src/options-median.js';

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
