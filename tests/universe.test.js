import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleData, screenSymbol } from '../src/engine.js';
import { DEMO_UNIVERSE, LIVE_UNIVERSE, VOLATILITY_UNIVERSE, ALPACA_BATCH_SIZE } from '../src/universe.js';

const volatilityRules=[
  {metric:'rsi',tf:'D',op:'<',value:60},
  {metric:'drawdown',tf:'D',op:'<',value:-5},
  {metric:'emaDist',tf:'D',op:'<',value:0}
];

test('bundled live universe is unique, broad and includes the volatility products',()=>{
  assert.ok(LIVE_UNIVERSE.length>=100);
  assert.equal(new Set(LIVE_UNIVERSE).size,LIVE_UNIVERSE.length);
  for(const symbol of VOLATILITY_UNIVERSE.filter(x=>x!=='DEMO-VXX'))assert.ok(LIVE_UNIVERSE.includes(symbol),symbol+' must be scanned live');
  assert.ok(LIVE_UNIVERSE.includes('VXX'));
  assert.ok(LIVE_UNIVERSE.includes('UVXY'));
  assert.ok(LIVE_UNIVERSE.includes('SVXY'));
  assert.ok(ALPACA_BATCH_SIZE>0&&ALPACA_BATCH_SIZE<=15);
});

test('Demo volatility preset scans the synthetic VXX proxy and produces a real rule match',()=>{
  const data=sampleData();
  assert.deepEqual(DEMO_UNIVERSE,Object.keys(data));
  const visible=DEMO_UNIVERSE.filter(symbol=>VOLATILITY_UNIVERSE.includes(symbol));
  const matches=visible.filter(symbol=>screenSymbol(data[symbol],volatilityRules).pass);
  assert.deepEqual(visible,['DEMO-VXX']);
  assert.deepEqual(matches,['DEMO-VXX']);
});
