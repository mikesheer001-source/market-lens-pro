import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,ema,rsi,aggregate,backtest,parameterSweep,sampleData,screenSymbol} from '../src/engine.js';

const day = i => new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10);
const bar = (i,open=100,high=101,low=99,close=100) => ({time:day(i),open,high,low,close,volume:100});

test('CSV handles quoted symbol, mixed records and invalid rows',()=>{
 const text='Date,Symbol,Open,High,Low,Close,Volume\n2024-01-01,"TEST",100,105,99,103,200\n2024-01-02,TEST,103,105,101,104,220\n2024-01-03,TEST,103,99,101,104,220\n';
 const data=parseCsv(text);
 assert.equal(data.groups.TEST.length,2);assert.equal(data.skipped,1);
});
test('close-only CSV is marked approximate',()=>{
 const data=parseCsv('Date,Close\n2024-01-01,101\n2024-01-02,102\n','DEMO');
 assert.equal(data.groups.DEMO[0].approximateOhlc,true);
});
test('EMA has simple-average seed; Wilder RSI has bounded values',()=>{
 assert.deepEqual(ema([1,2,3,4,5],3),[null,null,2,3,4]);
 const r=rsi(Array.from({length:60},(_,i)=>i+1),14);
 assert.equal(r[13],null);assert.equal(r[14],100);assert.equal(r[59],100);
});
test('weekly aggregation joins bars consistently',()=>{
 const a=[bar(0),bar(1),bar(2),bar(3),bar(4),bar(7)];
 const weekly=aggregate(a,'W');assert.equal(weekly.length,2);assert.equal(weekly[0].time,'2024-01-01');
 assert.equal(weekly[0].volume,500);
});
test('original RSI + weekly EMA screen refuses missing lookback data',()=>{
 const b=Array.from({length:50},(_,i)=>bar(i));
 const check=screenSymbol(b,[{tf:'W',metric:'emaDist',op:'>',value:0}]);
 assert.equal(check.pass,false);assert.match(check.fails[0],/Insufficient/);
});
test('backtest uses next bar OPEN, not signal bar close',()=>{
 const b=Array.from({length:45},(_,i)=>bar(i));
 b[25]=bar(25,100,113,99,112);b[26]=bar(26,120,122,119,121);
 const r=backtest(b,{strategy:'breakout',period:20,capital:10000,allocation:100,feeBps:0,slipBps:0});
 assert.ok(r.trades.length>=1);
 assert.equal(r.trades[0].entry,day(26));assert.equal(r.trades[0].buy,120);
});
test('a stop and target in one candle resolve to stop conservatively',()=>{
 const b=Array.from({length:45},(_,i)=>bar(i));
 b[25]=bar(25,100,113,99,112);b[26]=bar(26,110,120,80,111);
 const r=backtest(b,{strategy:'breakout',period:20,stopPct:5,targetPct:5,feeBps:0,slipBps:0});
 assert.equal(r.trades[0].reason,'Stop');assert.equal(r.trades[0].sell,104.5);
});
test('transaction costs reduce flat-market equity',()=>{
 const b=Array.from({length:45},(_,i)=>bar(i));
 b[25]=bar(25,100,113,99,112);b[26]=bar(26,110,111,109,110);
 const clean=backtest(b,{strategy:'breakout',period:20,feeBps:0,slipBps:0});
 const costly=backtest(b,{strategy:'breakout',period:20,feeBps:10,slipBps:10});
 assert.ok(costly.metrics.endEquity<clean.metrics.endEquity);
});
test('sweep returns nine parameter comparisons with train and holdout metrics',()=>{
 const data=sampleData()['DEMO-SPY'];
 const rows=parameterSweep(data,{strategy:'ema-cross'});
 assert.equal(rows.length,9);
 for(const row of rows){assert.ok(Number.isFinite(row.train.returnPct));assert.ok(Number.isFinite(row.test.returnPct));}
});
test('sample observations are deterministic',()=>{
 const a=sampleData(),b=sampleData();
 assert.equal(a['DEMO-VXX'][120].close,b['DEMO-VXX'][120].close);
});
