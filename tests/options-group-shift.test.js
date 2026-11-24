import test from 'node:test';
import assert from 'node:assert/strict';
import {groupStrikeTargets} from '../src/options-strike-ruler.js';
test('group translation keeps exact widths and rejects missing listed strikes',()=>{
 const expiry='2027-01-15',base={root:'SPY',expiry,symbol:'listed'};
 const legs=[{...base,type:'call',strike:100},{...base,type:'put',strike:105},{type:'call',strike:110}];
 const contracts=[{...base,type:'call',strike:105},{...base,type:'call',strike:110},{...base,type:'put',strike:110}];
 const targets=groupStrikeTargets(legs,()=>contracts,{low:90,high:130},100);
 assert.deepEqual(targets.map(x=>x.delta),[0,5]);assert.deepEqual(targets[1].rows.map(r=>r.strike),[105,110,115]);
});
test('manual legs shift by identical increments',()=>{
 const targets=groupStrikeTargets([{strike:100},{strike:105}],()=>[],{low:85,high:115},100);
 assert.ok(targets.some(t=>t.delta>0));for(const t of targets)assert.equal(t.rows[1].strike-t.rows[0].strike,5);
});
