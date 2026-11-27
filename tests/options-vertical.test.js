import assert from 'node:assert/strict';
import test from 'node:test';
import {verticalSpreadMetrics} from '../src/options-vertical.js';
const now=Date.parse('2026-11-27T00:00:00Z'),expiry='2026-12-18';
const quote=(bid,ask)=>({bid,ask,time:new Date(now).toISOString()});
const callDebit=()=>[
 {symbol:'SPY-C100',root:'SPY',type:'call',side:'buy',strike:100,expiry,quantity:1,multiplier:100,entry:2,quote:quote(1.9,2.1)},
 {symbol:'SPY-C105',root:'SPY',type:'call',side:'sell',strike:105,expiry,quantity:1,multiplier:100,entry:1,quote:quote(.9,1.1)}
];
const putDebit=()=>[
 {symbol:'SPY-P105',root:'SPY',type:'put',side:'buy',strike:105,expiry,quantity:1,multiplier:100,entry:3,quote:quote(2.9,3.1)},
 {symbol:'SPY-P100',root:'SPY',type:'put',side:'sell',strike:100,expiry,quantity:1,multiplier:100,entry:1,quote:quote(.9,1.1)}
];
test('call debit spread calculates exact expiration risk and reward',()=>{
 const r=verticalSpreadMetrics(callDebit(),0,now);
 assert.equal(r.valid,true);assert.equal(r.netEntry,100);assert.equal(r.entryType,'debit');
 assert.equal(r.maxProfit,400);assert.equal(r.maxLoss,100);assert.deepEqual(r.breakevens,[101]);assert.equal(r.riskReward,.25);
});
test('call credit spread calculates bounded max loss and breakeven',()=>{
 const r=verticalSpreadMetrics(callDebit().map(x=>({...x,side:x.side==='buy'?'sell':'buy'})),0,now);
 assert.equal(r.netEntry,-100);assert.equal(r.entryType,'credit');assert.equal(r.maxProfit,100);
 assert.equal(r.maxLoss,400);assert.deepEqual(r.breakevens,[101]);assert.equal(r.riskReward,4);
});
test('put debit and credit spreads calculate correct expiration risk',()=>{
 const debit=verticalSpreadMetrics(putDebit(),0,now);
 assert.equal(debit.netEntry,200);assert.equal(debit.maxProfit,300);assert.equal(debit.maxLoss,200);
 assert.deepEqual(debit.breakevens,[103]);
 const credit=verticalSpreadMetrics(putDebit().map(x=>({...x,side:x.side==='buy'?'sell':'buy'})),0,now);
 assert.equal(credit.netEntry,-200);assert.equal(credit.maxProfit,200);assert.equal(credit.maxLoss,300);
 assert.deepEqual(credit.breakevens,[103]);
});
test('fees and contract quantity are included in exact spread risk',()=>{
 const r=verticalSpreadMetrics(callDebit().map(x=>({...x,quantity:3})),.65,now);
 assert.ok(Math.abs(r.netEntry-303.9)<1e-9);assert.ok(Math.abs(r.maxProfit-1196.1)<1e-9);
 assert.ok(Math.abs(r.maxLoss-303.9)<1e-9);assert.ok(Math.abs(r.breakevens[0]-101.013)<1e-9);
});
test('rejects mismatched, naked, stale or unquoted vertical legs',()=>{
 const legs=callDebit();
 assert.match(verticalSpreadMetrics([legs[0]],0,now).reason,/exactly two/);
 assert.match(verticalSpreadMetrics(legs.map(x=>({...x,side:'buy'})),0,now).reason,/one buy/);
 assert.match(verticalSpreadMetrics(legs.map((x,i)=>({...x,expiry:i?'2026-12-19':expiry})),0,now).reason,/expiration/);
 assert.match(verticalSpreadMetrics(legs.map((x,i)=>({...x,type:i?'put':'call'})),0,now).reason,/same option type/);
 assert.match(verticalSpreadMetrics(legs.map((x,i)=>({...x,quantity:i?2:1})),0,now).reason,/same valid whole-number/);
 assert.match(verticalSpreadMetrics(legs.map(x=>({...x,quote:null})),0,now).reason,/Fresh live bid/);
 assert.match(verticalSpreadMetrics(legs.map(x=>({...x,quote:quote(1,2)})),0,now+120_001).reason,/Fresh live bid/);
 assert.match(verticalSpreadMetrics(legs,-1,now).reason,/valid fee/);
});
test('accepts live midpoint premiums and rejects invalid entry assumptions',()=>{
 const legs=callDebit();legs[0].entry=(legs[0].quote.bid+legs[0].quote.ask)/2;
 assert.equal(verticalSpreadMetrics(legs,0,now).valid,true);
 legs[0].entry=-.01;assert.match(verticalSpreadMetrics(legs,0,now).reason,/non-negative premium/);
});
