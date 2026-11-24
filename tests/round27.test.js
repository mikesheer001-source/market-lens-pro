import test from 'node:test';
import assert from 'node:assert/strict';
import {nyParts, normalizeBars, createScreenMemo, screenSymbol, sampleData}
  from '../src/engine.js';

// Round 27 (FINAL-SPEC items 15/P4+P3): nyParts output identical after hoisting
// the Intl.DateTimeFormat to module level, and normalizeBars sorting with
// precomputed timestamps instead of Date.parse inside the comparator.
test('Round 27: nyParts returns the same New York day/minute after the formatter hoist',()=>{
  // 2024-06-03 14:30 EDT == 18:30 UTC; 2024-01-03 14:30 EST == 19:30 UTC.
  assert.deepEqual(nyParts(Math.floor(Date.UTC(2024,5,3,18,30)/1000)),
    {day:'2024-06-03',minute:14*60+30});
  assert.deepEqual(nyParts(Math.floor(Date.UTC(2024,0,3,19,30)/1000)),
    {day:'2024-01-03',minute:14*60+30});
  // 09:30 ET open on a summer day == 13:30 UTC.
  assert.deepEqual(nyParts(Math.floor(Date.UTC(2024,5,3,13,30)/1000)),
    {day:'2024-06-03',minute:9*60+30});
});

test('Round 27: normalizeBars sorts string-date bars once and dedupes by day',()=>{
  const bars=[
    {time:'2024-01-03',open:3,high:3,low:3,close:3,volume:0},
    {time:'2024-01-01',open:1,high:1,low:1,close:1,volume:0},
    {time:'2024-01-03',open:9,high:9,low:9,close:9,volume:0},
    {time:'2024-01-02',open:2,high:2,low:2,close:2,volume:0},
  ];
  const sorted=normalizeBars(bars);
  assert.deepEqual(sorted.map(b=>b.time),['2024-01-01','2024-01-02','2024-01-03']);
  // Last bar wins the dedupe for 2024-01-03.
  assert.equal(sorted[2].close,9);
});

// Round 27 (FINAL-SPEC item 15/P3): the screen memo used by screenerView()
// and screenerRows(). Counter mechanism: bump() on ANY data mutation.
test('Round 27: screen memo calls screenSymbol once for unchanged inputs',()=>{
  let calls=0;
  const counting=(history,rules)=>{calls++;return screenSymbol(history,rules);};
  const memo=createScreenMemo(counting);
  const bars=sampleData()['DEMO-SPY'];
  const rules=[{metric:'rsi',tf:'D',op:'<',value:60}];
  const first=memo.screen('DEMO-SPY',bars,rules);
  const second=memo.screen('DEMO-SPY',bars,rules);
  assert.equal(calls,1);
  assert.equal(second,first);
  // Different rules invalidate the memo.
  memo.screen('DEMO-SPY',bars,[{metric:'rsi',tf:'D',op:'<',value:50}]);
  assert.equal(calls,2);
  // A data mutation (bump) invalidates the memo even with identical rules.
  memo.bump();
  memo.screen('DEMO-SPY',bars,rules);
  assert.equal(calls,3);
  // A different symbol is screened separately, then cached.
  memo.screen('DEMO-VXX',sampleData()['DEMO-VXX'],rules);
  memo.screen('DEMO-VXX',sampleData()['DEMO-VXX'],rules);
  assert.equal(calls,4);
});
