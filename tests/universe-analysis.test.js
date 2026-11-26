import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeFullUniverse} from '../src/universe-analysis.js';

const daily=(index)=>Array.from({length:80},(_,i)=>{
 const close=100+i+index*.1;
 return {t:new Date(Date.UTC(2025,0,1+i)).toISOString(),o:close,h:close+1,l:close-1,c:close,v:1000};
});

test('full-universe analysis processes streamed batches for Fit, leaderboard and signals without retaining all bars',async()=>{
 const symbols=['AAA','BBB','CCC','DDD','EEE'];
 let retained=false;
 const progress=[];
 const result=await analyzeFullUniverse({
  start:'2025-01-01',end:'2025-04-01',feed:'iex',options:{strategy:'ema-cross',capital:10000},
  selection:{id:'preset:ema-cross',name:'EMA crossover',kind:'preset',strategy:'ema-cross'},
  backtest:(bars)=>({metrics:{returnPct:bars.length,sharpe:1,maxDD:2,trades:1},
    curve:[{time:bars[0].time,value:10000}],signalState:{status:'FLAT',barDate:bars.at(-1).time,positionOpen:false}}),
  compare:({symbol})=>({rows:[{id:'preset:ema-cross',name:'EMA crossover',kind:'preset',strategy:'ema-cross',
    settings:{},metrics:{returnPct:2,maxDD:1,trades:2},trainMetrics:{returnPct:1,sharpe:1},
    testMetrics:{returnPct:1,sharpe:.5},validation:{enoughTestBars:true,validated:true},
    rolling:{meanSharpe:.4,medianSharpe:.4,positiveCount:3,assessableCount:5,totalWindows:5,validated:true}}]}),
  download:async options=>{
   options.onProgress({type:'directory',directory:{id:'dir',count:symbols.length,symbols}});
   await options.onBatch({batchIndex:1,batchCount:2,symbols:symbols.slice(0,3),
    bars:Object.fromEntries(symbols.slice(0,3).map((s,i)=>[s,daily(i)])),
    totalPages:2,totalBars:240,requestedSymbols:5,returnedSymbols:3});
   await options.onBatch({batchIndex:2,batchCount:2,symbols:symbols.slice(3),
    bars:Object.fromEntries(symbols.slice(3).map((s,i)=>[s,daily(i+3)])),
    totalPages:4,totalBars:400,requestedSymbols:5,returnedSymbols:5});
   return {requested:5,returned:5,pages:4,batches:2,totalBars:400,retries:0,
    directory:{id:'dir',count:5,symbols},missing:[],symbols};
  },
  compilePine:()=>({mode:'strategy'}),executePine:()=>({signals:{buy:[],sell:[]}}),
  onProgress:event=>progress.push(event),onBatch:()=>{retained=true;}
 });
 assert.equal(retained,true);
 assert.equal(result.requested,5);
 assert.equal(result.processed,5);
 assert.equal(result.fitReport.rows.length,5);
 assert.equal(result.fitReport.completed,5);
 assert.equal(result.fitValidatedReport.requested,5);
 assert.equal(result.universeLeaderboard.symbolsAnalyzed,5);
 assert.equal(result.signals.AAA.status==='UNAVAILABLE',false);
 assert.equal(Object.keys(result.signals).length,5);
 assert.equal(result.download.totalBars,400);
 assert.ok(progress.some(event=>event.type==='directory'));
});
