import test from 'node:test';
import assert from 'node:assert/strict';
import {isNyseSessionDay,expectedNyseBarDate,nyDateAndClock,nyseHolidayDates,
  barDate,modalLatestBarDate,scanFreshness,freshnessWithUniverse,explainStaleSymbol,
  staleReasonForSymbol} from '../src/freshness.js';

test('expected US trading date follows New York local session, weekends and holidays',()=>{
  assert.equal(expectedNyseBarDate('2026-11-16T13:00:00Z'),'2026-11-13'); // before NY open
  assert.equal(expectedNyseBarDate('2026-11-16T20:00:00Z'),'2026-11-13'); // Monday, unfinished daily bar
  assert.equal(expectedNyseBarDate('2026-11-16T22:00:00Z'),'2026-11-16'); // after daily close
  assert.equal(expectedNyseBarDate('2026-11-21T17:00:00Z'),'2026-11-20'); // Saturday
  assert.equal(expectedNyseBarDate('2026-11-26T20:00:00Z'),'2026-11-25'); // Thanksgiving
  assert.equal(expectedNyseBarDate('2026-11-27T22:00:00Z'),'2026-11-27'); // Friday after Thanksgiving
  assert.equal(expectedNyseBarDate('2026-12-25T18:00:00Z'),'2026-12-24');
  assert.equal(nyDateAndClock('2026-11-16T20:00:00Z').minute,900);
  assert.equal(isNyseSessionDay('2026-04-03'),false); // Good Friday
  assert.equal(isNyseSessionDay('2026-06-19'),false); // Juneteenth
  assert.equal(isNyseSessionDay('2026-11-16'),true);
  assert.ok(nyseHolidayDates(2026).has('2026-11-26'));
});

test('freshness green only when every loaded symbol has latest expected trading-day bar or newer',()=>{
  const data={VXX:[{t:'2026-11-13T21:00:00Z'},{t:'2026-11-16T21:00:00Z'}],
    VXZ:[{t:'2026-11-13T21:00:00Z'}],
    SVXY:[{t:'2026-11-16T21:00:00Z'}]};
  const stale=scanFreshness(data,'2026-11-16');
  assert.equal(stale.allFresh,false);
  assert.equal(stale.checked,3);
  assert.deepEqual(stale.stale,[{symbol:'VXZ',latest:'2026-11-13'}]);
  assert.equal(stale.dates.VXZ,'2026-11-13');
  data.VXZ.push({t:'2026-11-16T21:00:00Z'});
  assert.equal(scanFreshness(data,'2026-11-16').allFresh,true);
});

test('missing symbols and missing bars count as stale; numeric timestamps and date strings both work',()=>{
  assert.equal(barDate({time:Date.UTC(2026,10,16,15)/1000}),'2026-11-16');
  assert.equal(barDate({time:'2026-11-16'}),'2026-11-16');
  assert.equal(barDate({t:'2026-11-16T20:59:00Z'}),'2026-11-16');
  const state=freshnessWithUniverse({VXX:[{t:'2026-11-16T21:00:00Z'}]},['VXX','VXZ'],'2026-11-16');
  assert.equal(state.allFresh,false);
  assert.deepEqual(state.stale,[{symbol:'VXZ',latest:null}]);
});

test('stale asset reasoning separates missing, inactive and no-new-bar from unavailable checks',()=>{
  const entry={symbol:'VXZ',latest:'2026-11-13'};
  assert.match(explainStaleSymbol(entry,{asset:{found:true,status:'active',tradable:true},barsAfterLatest:false}),/no bars after Nov 13, 2026 [(]2026-11-13[)]/);
  assert.match(explainStaleSymbol(entry,{asset:{found:true,status:'active',tradable:true},barsAfterLatest:false}),/no bars after Nov 13, 2026 [(]2026-11-13[)]/);
  assert.match(explainStaleSymbol(entry,{asset:{found:true,status:'active',tradable:true},barsAfterLatest:false}),/no bars after Nov 13, 2026 [(]2026-11-13[)]/);
  assert.match(explainStaleSymbol(entry,{asset:{found:true,status:'active',tradable:true},barsAfterLatest:false}),/no bars after Nov 13, 2026 [(]2026-11-13[)]/);
  assert.doesNotMatch(explainStaleSymbol(entry,{asset:{error:'HTTP 401'}}),/delisting/);
});

test('Round 14: 132 symbols have Nov 16 bars while one has Nov 13, even when clock expects Nov 13',()=>{
  const all=Object.fromEntries(Array.from({length:132},(_,i)=>['STOCK'+i,[{
    t:'2026-11-16T21:00:00Z'
  }]]));
  all.VXZ=[{t:'2026-11-13T21:00:00Z'}];
  const result=scanFreshness(all,'2026-11-13');
  assert.equal(result.expected,'2026-11-16');
  assert.equal(result.referenceMethod,'modal latest-bar date');
  assert.equal(result.checked,133);
  assert.equal(result.allFresh,false);
  assert.deepEqual(result.stale,[{symbol:'VXZ',latest:'2026-11-13'}]);
  assert.equal(result.checked-result.stale.length,132);
  assert.equal(result.dates.VXZ,'2026-11-13');
  assert.equal(modalLatestBarDate({A:'2026-11-13',B:'2026-11-16'},'2026-11-12'),'2026-11-16',
    'tie-breaker prefers newer date');
});

test('Round 14: stale reason is from Alpaca retry evidence and actual dated bar, not guessed from ticker',()=>{
  const freshness=scanFreshness({
    VXZ:[{t:'2026-11-13T21:00:00Z'}],
    VXX:[{t:'2026-11-16T21:00:00Z'}],
    MRSH:[{t:'2026-11-16T21:00:00Z'}]
  },'2026-11-13');
  const diagnostics={VXZ:{asset:{found:true,status:'active',tradable:true},barsAfterLatest:false}};
  assert.equal(staleReasonForSymbol('VXZ',freshness,diagnostics),
    'Alpaca returns no bars after Nov 13, 2026 (2026-11-13) on this feed');
  assert.equal(staleReasonForSymbol('VXX',freshness,diagnostics),null);
  assert.equal(staleReasonForSymbol('VXZ',freshness,{}),
    'No Alpaca diagnosis available; latest bar 2026-11-13');
  assert.doesNotMatch(staleReasonForSymbol('VXZ',freshness,{}),/Alpaca returns no bars after/);
  assert.equal(staleReasonForSymbol('VXZ',freshness,{VXZ:{retryFailed:true}}),
    'Alpaca retry failed; newer bars not verified');
});

test('Round 14: no observed bars fall back to clock, missing symbols stay stale',()=>{
  const empty=scanFreshness({VXX:[],VXZ:[]},'2026-11-13');
  assert.equal(empty.expected,'2026-11-13');
  assert.equal(empty.referenceMethod,'clock fallback (no bars)');
  assert.equal(empty.stale.length,2);
  assert.equal(empty.allFresh,false);
});
