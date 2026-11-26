import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,stamp,ema,rsi,aggregate,backtest,parameterSweep,sampleData,screenSymbol,statsFor,alpacaBars} from '../src/engine.js';

const day = i => new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10);
const bar = (i,open=100,high=101,low=99,close=100) => ({time:day(i),open,high,low,close,volume:100});

test('Lightweight Charts BusinessDay crosshair times normalize to daily bar keys',()=>{
 assert.equal(stamp({year:2026,month:11,day:25}),stamp('2026-11-25'));
 assert.equal(stamp({year:2026,month:11,day:20}),stamp('2026-11-20'));
});

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


test('short-selling enters on bearish breakout and covers after target',()=>{
 const b=Array.from({length:45},(_,i)=>bar(i));
 b[25]=bar(25,100,101,83,85);
 b[26]=bar(26,80,85,68,74);
 const run=backtest(b,{strategy:'breakout',side:'short',period:20,targetPct:10,feeBps:0,slipBps:0});
 assert.ok(run.trades.length>=1);assert.equal(run.trades[0].entry,day(26));
 assert.equal(run.trades[0].buy,80);assert.equal(run.trades[0].sell,72);
 assert.equal(run.trades[0].reason,'Target');assert.ok(run.trades[0].pnl>0);
});
test('borrow fees reduce short strategy equity',()=>{
 const b=Array.from({length:55},(_,i)=>bar(i));
 b[25]=bar(25,100,101,83,85);
 for(let i=26;i<55;i++)b[i]=bar(i,80,83,79,81);
 const base={strategy:'breakout',side:'short',period:20,feeBps:0,slipBps:0};
 const free=backtest(b,{...base,borrowAnnualPct:0}),charged=backtest(b,{...base,borrowAnnualPct:50});
 assert.ok(charged.metrics.endEquity<free.metrics.endEquity);
});


test('Alpaca daily timestamps stay daily and cannot be misread as two-hour bars',()=>{
 const raw=Array.from({length:10},(_,i)=>({t:new Date(Date.UTC(2026,0,i+1,14,30)).toISOString(),o:100+i,h:102+i,l:99+i,c:101+i,v:1000}));
 const daily=alpacaBars(raw,'1Day');
 assert.equal(daily[0].time,'2026-01-01');
 assert.equal(aggregate(daily,'2H').length,0);
 assert.ok(Number.isFinite(statsFor(daily).rsi5));
 const intraday=alpacaBars([{t:'2026-01-05T14:30:00Z',o:100,h:101,l:99,c:100,v:100},{t:'2026-01-05T15:30:00Z',o:100,h:102,l:99,c:101,v:100}],'1Hour');
 assert.equal(typeof intraday[0].time,'number');
 assert.equal(aggregate(intraday,'2H').length,1);
});

test('daily-only datasets provide a real five-day RSI instead of blank 2-hour RSI',()=>{
 const daily=sampleData()['DEMO-SPY'];
 assert.equal(aggregate(daily,'2H').length,0,'daily OHLC cannot be expanded into genuine intraday bars');
 const stats=statsFor(aggregate(daily,'D'));
 assert.ok(Number.isFinite(stats.rsi5),'five-day RSI must be calculated from daily closes');
 assert.ok(stats.rsi5>=0&&stats.rsi5<=100);
 const imported=parseCsv('Date,Symbol,Open,High,Low,Close,Volume\n2026-01-01,TEST,100,102,99,101,100\n2026-01-02,TEST,101,103,100,102,100\n2026-01-03,TEST,102,104,101,103,100\n2026-01-04,TEST,103,105,102,104,100\n2026-01-05,TEST,104,106,103,105,100\n2026-01-06,TEST,105,107,104,106,100\n');
 assert.ok(Number.isFinite(statsFor(imported.groups.TEST).rsi5),'imported daily OHLC should also calculate the five-day RSI');
});
