import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleData, screenSymbol } from '../src/engine.js';
import {
  DEMO_UNIVERSE, LIVE_UNIVERSE, VOLATILITY_UNIVERSE,
  LIVE_EQUITY_COUNT, LIVE_ETF_COUNT, LIVE_VOLATILITY_COUNT, ALPACA_BATCH_SIZE
} from '../src/universe.js';

const oversoldRules=[{metric:'rsi',tf:'D',op:'<',value:35}];
const volatilityRules=[
  {metric:'rsi',tf:'D',op:'<',value:60},
  {metric:'drawdown',tf:'D',op:'<',value:-5},
  {metric:'emaDist',tf:'D',op:'<',value:0}
];

test('bundled live universe has the exact documented composition',()=>{
  assert.equal(LIVE_EQUITY_COUNT,105);
  assert.equal(LIVE_ETF_COUNT,18);
  assert.equal(LIVE_VOLATILITY_COUNT,10);
  assert.equal(LIVE_UNIVERSE.length,133);
  assert.equal(new Set(LIVE_UNIVERSE).size,133);
  assert.equal(VOLATILITY_UNIVERSE.length,11);
  assert.equal(DEMO_UNIVERSE.length,4);
  assert.equal(ALPACA_BATCH_SIZE,15);
  assert.equal(Math.ceil(LIVE_UNIVERSE.length/ALPACA_BATCH_SIZE),9);
  for(const symbol of VOLATILITY_UNIVERSE.filter(x=>x!=='DEMO-VXX'))assert.ok(LIVE_UNIVERSE.includes(symbol),symbol+' must be scanned live');
  assert.ok(LIVE_UNIVERSE.includes('VXX'));
  assert.ok(LIVE_UNIVERSE.includes('UVXY'));
  assert.ok(LIVE_UNIVERSE.includes('SVXY'));
});

test('the four bundled demo symbols match the documented demo universe',()=>{
  const data=sampleData();
  assert.deepEqual(Object.keys(data),DEMO_UNIVERSE);
});

test('Demo Oversold preset returns exactly one match: DEMO-COIN',()=>{
  const data=sampleData();
  const matches=DEMO_UNIVERSE.filter(symbol=>screenSymbol(data[symbol],oversoldRules).pass);
  assert.deepEqual(matches,['DEMO-COIN']);
});

test('Demo VXX / Volatility preset returns its synthetic DEMO-VXX proxy match',()=>{
  const data=sampleData();
  const visible=DEMO_UNIVERSE.filter(symbol=>VOLATILITY_UNIVERSE.includes(symbol));
  const matches=visible.filter(symbol=>screenSymbol(data[symbol],volatilityRules).pass);
  assert.deepEqual(visible,['DEMO-VXX']);
  assert.deepEqual(matches,['DEMO-VXX']);
});
