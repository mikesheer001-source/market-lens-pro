import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeWorkspace} from '../src/workspace-sync.js';

test('workspace sync combines edits to independent chart settings', () => {
  const base = {chart:{ema20:true,rsi:true}, rules:[{tf:'D'}]};
  assert.deepEqual(
    mergeWorkspace(base,{...base,chart:{ema20:false,rsi:true}},{...base,chart:{ema20:true,rsi:false}}),
    {chart:{ema20:false,rsi:false},rules:[{tf:'D'}]}
  );
});

test('workspace sync preserves separate saved scans and propagates deletion', () => {
  const original = {id:'x',name:'Old scan'};
  const a = {id:'a',name:'Scan from phone'};
  const b = {id:'b',name:'Scan from desktop'};
  assert.deepEqual(mergeWorkspace([original],[a],[original,b]),[a,b]);
});
