import test from 'node:test';
import assert from 'node:assert/strict';
import {fitAcrossUniverse,sortUniverseFit,bestUniverseFit} from '../src/fit.js';
const prices=Array.from({length:50},(_,i)=>({time:Date.UTC(2026,8,1+i)/1000,
 open:100+i,high:101+i,low:99+i,close:100+i,volume:1000}));
test('fit sorting supports Sharpe, total return, drawdown, source/date and missing values',()=>{
 const rows=[{symbol:'BBB',metrics:{sharpe:1,returnPct:4,maxDD:20},source:'ALPACA',barDate:'2026-11-13'},
 {symbol:'AAA',metrics:{sharpe:2,returnPct:2,maxDD:5},source:'ALPACA',barDate:'2026-11-16'},
 {symbol:'CCC',metrics:{sharpe:null,returnPct:99,maxDD:0},source:'ALPACA',barDate:'2026-11-16'},
 {symbol:'DDD',metrics:null,source:'NO ALPACA DATA',barDate:null}];
 assert.deepEqual(sortUniverseFit(rows).map(x=>x.symbol),['AAA','BBB','CCC','DDD']);
 assert.deepEqual(sortUniverseFit(rows,'returnPct',true).map(x=>x.symbol),['CCC','BBB','AAA','DDD']);
 assert.deepEqual(sortUniverseFit(rows,'maxDD',false).map(x=>x.symbol),['CCC','AAA','BBB','DDD']);
 assert.deepEqual(sortUniverseFit(rows,'symbol',false).map(x=>x.symbol),['AAA','BBB','CCC','DDD']);
 assert.equal(bestUniverseFit(rows).symbol,'AAA');
 assert.equal(bestUniverseFit([{symbol:'X',metrics:{sharpe:null}}]),null);
 assert.throws(()=>sortUniverseFit(rows,'__proto__'),/Unknown/);
});
test('fit runs every requested symbol with identical capital costs and stops, missing rows visible',()=>{
 const used=[],options={strategy:'ema-cross',capital:25000,feeBps:6,slipBps:8,stopPct:4,targetPct:9,timeframe:'2H'};
 const data=new Map([['AAA',prices],['BBB',prices]]);
 const result=fitAcrossUniverse({symbols:['AAA','BBB','MISSING'],data,options,
 sourceFor:s=>data.has(s)?'ALPACA IEX 1Day':null,expectedBarDate:'2026-11-16',
 backtest:(bars,opts)=>{used.push(opts);return {metrics:{sharpe:used.length,returnPct:3,trades:2},
 curve:[{time:bars[0].time,value:25000}]};}});
 assert.equal(result.requested,3);assert.equal(result.completed,2);assert.equal(result.rows.length,3);
 assert.deepEqual(result.rows.map(x=>x.symbol),['BBB','AAA','MISSING']);
 assert.equal(result.rows.find(x=>x.symbol==='MISSING').error,'No OHLCV bars returned');
 assert.ok(result.rows[0].stale);
 assert.ok(used.every(x=>x.capital===25000&&x.feeBps===6&&x.slipBps===8&&
 x.stopPct===4&&x.targetPct===9&&x.timeframe==='D'));
 assert.equal(options.timeframe,'2H');
});
test('Pine fit compiles once, executes independently per symbol and rejects indicator mode',()=>{
 let compilation=0,executions=0;
 const result=fitAcrossUniverse({symbols:['AAA','BBB'],data:new Map([['AAA',prices],['BBB',prices]]),
 options:{strategy:'pine-custom',capital:10000},strategyScript:{code:'strategy("x")',settings:{length:21}},
 compilePine:code=>{compilation++;return {mode:'strategy',code};},
 executePine:(_program,_bars,settings)=>{executions++;assert.equal(settings.length,21);return {signals:{buy:[],sell:[]}};},
 backtest:(_bars,cfg)=>{assert.deepEqual(cfg.customSignals,{buy:[],sell:[]});
 return {metrics:{sharpe:1,trades:1},curve:[{time:prices[0].time,value:10000}]};}});
 assert.equal(compilation,1);assert.equal(executions,2);assert.equal(result.completed,2);
 assert.throws(()=>fitAcrossUniverse({symbols:['AAA'],data:new Map(),options:{strategy:'pine-custom'},
 backtest:()=>{},strategyScript:{code:'indicator("x")'},compilePine:()=>({mode:'indicator'})}),/indicator/);
});


test('validated Fit exposes each per-symbol comparison for universe leaderboard aggregation',async()=>{
 const prices=Array.from({length:80},(_,i)=>({time:Date.UTC(2026,0,1+i)/1000,
   open:100+i,high:101+i,low:99+i,close:100+i,volume:1000}));
 const seen=[];
 const {fitValidatedAcrossUniverse}=await import('../src/fit-validated.js');
 const result=await fitValidatedAcrossUniverse({
   symbols:['AAA','BBB'],data:new Map([['AAA',prices],['BBB',prices]]),
   options:{strategy:'ema-cross',capital:10000},backtest:()=>({metrics:{sharpe:1},curve:[{time:1,value:10000}]}),
   compare:({symbol})=>({rows:[{id:'preset:ema-cross',name:'EMA crossover',strategy:'ema-cross',
     metrics:{returnPct:5,maxDD:10,trades:2},trainMetrics:{sharpe:1},testMetrics:{sharpe:.5},
     validation:{enoughTestBars:true,validated:true}}]}),
   onComparison:(symbol,report)=>seen.push([symbol,report.rows.length])
 });
 assert.deepEqual(seen,[['AAA',1],['BBB',1]]);
 assert.equal(result.completed,2);
});
