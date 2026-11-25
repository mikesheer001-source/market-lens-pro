import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../src/engine.js';
import {createHistoryCache,frameLatest} from '../src/history-cache.js';

test('history cache reuses exact immutable snapshots, recalculates changed histories and evaluates edited rules',()=>{
  const calls={aggregate:0,stats:0};
  const cache=createHistoryCache({...engine,
    aggregate(...args){calls.aggregate++;return engine.aggregate(...args);},
    statsFor(...args){calls.stats++;return engine.statsFor(...args);}
  });
  const bars=engine.sampleData()['DEMO-SPY'].slice(-500);
  const rules=[{tf:'W',metric:'price',op:'>',value:1},{tf:'D',metric:'rsi',op:'<',value:101}];
  assert.deepEqual(cache.screenSymbol(bars,rules),engine.screenSymbol(bars,rules));
  assert.deepEqual(calls,{aggregate:2,stats:2});
  assert.equal(cache.aggregate(bars,'W'),cache.aggregate(bars,'W'));
  rules[0].value=1e9;
  assert.equal(cache.screenSymbol(bars,rules).pass,false);
  assert.deepEqual(calls,{aggregate:2,stats:2});
  const changed=bars.map((b,i)=>i===bars.length-1?{...b,close:b.close+10}:b);
  assert.deepEqual(cache.screenSymbol(changed,rules),engine.screenSymbol(changed,rules));
  assert.deepEqual(calls,{aggregate:4,stats:4});
});

test('frameLatest coalesces bursts to one update, flushes final position and cancels stale events',()=>{
  let sequence=0;
  const queue=new Map(),seen=[];
  const schedule=frameLatest((...args)=>seen.push(args),{
    request:fn=>{queue.set(++sequence,fn);return sequence;},
    cancel:id=>queue.delete(id)
  });
  for(let i=0;i<100;i++)schedule(i);
  assert.equal(queue.size,1);assert.deepEqual(seen,[]);
  const [id,fn]=[...queue][0];queue.delete(id);fn();
  assert.deepEqual(seen,[[99]]);
  schedule(100);schedule(101);schedule.flush();
  assert.equal(queue.size,0);assert.deepEqual(seen,[[99],[101]]);
  schedule(102);schedule.cancel();
  assert.equal(queue.size,0);assert.deepEqual(seen,[[99],[101]]);
});

test('intraday aggregation preserves New York session boundaries across daylight saving',()=>{
  const stamp=s=>Date.parse(s)/1000;
  const bar=(t,c)=>({time:stamp(t),open:c,high:c+1,low:c-1,close:c,volume:10});
  const bars=[bar('2026-03-06T14:29Z',98),bar('2026-03-06T14:30Z',100),
    bar('2026-03-06T14:34Z',101),bar('2026-03-06T14:35Z',102),
    bar('2026-03-06T21:00Z',99),bar('2026-03-09T13:29Z',98),
    bar('2026-03-09T13:30Z',103),bar('2026-03-09T13:34Z',104),bar('2026-03-09T20:00Z',99)];
  const actual=engine.aggregate(bars,'5m');
  assert.deepEqual(actual.map(b=>[b.time,b.open,b.close,b.volume]),[
    [stamp('2026-03-06T14:30Z'),100,101,20],[stamp('2026-03-06T14:35Z'),102,102,10],
    [stamp('2026-03-09T13:30Z'),103,104,20]]);
  assert.equal(engine.aggregate(bars,'D').length,2);
});

test('normalization retains last duplicate and chronological order',()=>{
  const first={time:'2026-01-02',close:1},last={time:Date.parse('2026-01-02T00:00Z')/1000,close:2};
  const prior={time:'2026-01-01',close:3};
  assert.deepEqual(engine.normalizeBars([first,{time:'bad',close:1},last,prior,{time:'2026-01-03',close:0}]),[prior,last]);
});
