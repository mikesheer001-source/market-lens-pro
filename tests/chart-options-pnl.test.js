import assert from 'node:assert/strict';
import test from 'node:test';
import {chartOptionsPnl} from '../src/chart-options-pnl.js';

const now=Date.parse('2026-11-27T00:00:00Z');
const expiry='2026-12-18';
const quote=(bid,ask,time=now)=>({bid,ask,time:new Date(time).toISOString()});
const position=()=>({symbol:'SPY',feed:'opra',fee:0,packagePremium:null,legs:[
  {symbol:'SPY-C100',side:'buy',type:'call',strike:100,expiry,quantity:1,entry:2.5,multiplier:100,root:'SPY',quote:quote(2,3)},
  {symbol:'SPY-C105',side:'sell',type:'call',strike:105,expiry,quantity:1,entry:1.5,multiplier:100,root:'SPY',quote:quote(1,2)}
]});
const bars=[99,102,110].map((close,index)=>({time:'2026-11-'+String(24+index).padStart(2,'0'),close}));

test('plots exact expiration P&L, conservative live liquidation P&L and breakeven from live quotes',()=>{
  const result=chartOptionsPnl(position(),'SPY',bars,now);
  assert.equal(result.status,'ready');
  assert.deepEqual(result.points.map(point=>point.pnl),[-100,100,400]);
  assert.deepEqual(result.breakevens,[101]);
  assert.equal(result.markPnl,-100);
  assert.equal(result.feed,'opra');
});

test('premium, quantity and fees changes recalculate payoff and breakeven',()=>{
  const changed=position();
  changed.legs[0].entry=3.5;
  let result=chartOptionsPnl(changed,'SPY',bars,now);
  assert.deepEqual(result.breakevens,[102]);
  assert.deepEqual(result.points.map(point=>point.pnl),[-200,0,300]);
  changed.legs[0].quantity=2;
  result=chartOptionsPnl(changed,'SPY',bars,now);
  assert.deepEqual(result.breakevens,[102.75]);
  assert.deepEqual(result.points.map(point=>point.pnl),[-550,-150,950]);
  changed.fee=0.65;
  result=chartOptionsPnl(changed,'SPY',bars,now);
  assert.ok(Math.abs(result.breakevens[0]-102.75975)<1e-9);
});

test('net package premium is respected instead of per-leg entry premiums',()=>{
  const selected=position();
  selected.packagePremium=-50;
  const result=chartOptionsPnl(selected,'SPY',bars,now);
  assert.deepEqual(result.points.map(point=>point.pnl),[50,250,550]);
  assert.equal(result.markPnl,50);
});

test('requires fresh live bid/ask quotes for every leg and rejects stale or missing quotes',()=>{
  const selected=position();
  selected.legs[1].quote=null;
  assert.equal(chartOptionsPnl(selected,'SPY',bars,now).status,'missing-live-quotes');
  selected.legs[1].quote=quote(1,2,now-120_001);
  assert.equal(chartOptionsPnl(selected,'SPY',bars,now).status,'stale-live-quotes');
  selected.legs[1].quote=quote(1,2,now);
  selected.legs[1].quote.bid=3;
  assert.equal(chartOptionsPnl(selected,'SPY',bars,now).status,'missing-live-quotes');
});

test('mixed expirations show only the real live mark and never model an expiry curve',()=>{
  const selected=position();
  selected.legs[1].expiry='2026-12-19';
  const result=chartOptionsPnl(selected,'SPY',bars,now);
  assert.equal(result.status,'mixed-expirations');
  assert.equal(result.available,false);
  assert.equal(result.markPnl,-100);
  assert.deepEqual(result.points,[]);
  assert.deepEqual(result.breakevens,[]);
});

test('rejects wrong-symbol, empty, invalid-premium and expired positions',()=>{
  const selected=position();
  assert.equal(chartOptionsPnl(selected,'QQQ',bars,now).status,'symbol-mismatch');
  assert.equal(chartOptionsPnl({...selected,legs:[]},'SPY',bars,now).status,'no-position');
  selected.legs[0].entry=null;
  assert.equal(chartOptionsPnl(selected,'SPY',bars,now).status,'missing-premium');
  selected.packagePremium=0;
  selected.legs[0].expiry='2026-11-20';
  selected.legs[1].expiry='2026-11-20';
  assert.equal(chartOptionsPnl(selected,'SPY',bars,now).status,'expired');
});
