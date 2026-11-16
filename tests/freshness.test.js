import test from 'node:test';
import assert from 'node:assert/strict';
import {isNyseSessionDay,expectedNyseBarDate,nyDateAndClock,nyseHolidayDates,
  barDate,scanFreshness,freshnessWithUniverse,explainStaleSymbol} from '../src/freshness.js';

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
  assert.match(explainStaleSymbol(entry,{asset:{found:true,status:'active',tradable:true},barsAfterLatest:false}),/no bars after 2026-11-13/);
  assert.match(explainStaleSymbol(entry,{asset:{found:false}}),/asset not found/);
  assert.match(explainStaleSymbol(entry,{asset:{status:'inactive'}}),/inactive/);
  assert.match(explainStaleSymbol(entry,{asset:{error:'HTTP 401'},retryFailed:true}),/retry failed/);
  assert.doesNotMatch(explainStaleSymbol(entry,{asset:{error:'HTTP 401'}}),/delisting/);
});
