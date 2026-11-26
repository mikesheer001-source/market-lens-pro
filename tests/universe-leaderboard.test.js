import test from 'node:test';
import assert from 'node:assert/strict';
import {createUniverseLeaderboardAccumulator} from '../src/universe-leaderboard.js';

test('universe leaderboard aggregates comparable strategy metrics across symbols and ranks by training Sharpe',()=>{
 const accumulator=createUniverseLeaderboardAccumulator();
 accumulator.add('AAA',{rows:[
  {id:'preset:ema-cross',name:'EMA crossover',strategy:'ema-cross',metrics:{returnPct:8,maxDD:12,trades:4},
   trainMetrics:{sharpe:1.2},testMetrics:{sharpe:.8},validation:{enoughTestBars:true,validated:true}},
  {id:'preset:breakout',name:'Breakout',strategy:'breakout',metrics:{returnPct:4,maxDD:8,trades:2},
   trainMetrics:{sharpe:.9},testMetrics:{sharpe:-.2},validation:{enoughTestBars:true}}
 ]});
 accumulator.add('BBB',{rows:[
  {id:'preset:ema-cross',name:'EMA crossover',strategy:'ema-cross',metrics:{returnPct:6,maxDD:10,trades:3},
   trainMetrics:{sharpe:1.4},testMetrics:{sharpe:.4},validation:{enoughTestBars:true}},
  {id:'preset:breakout',name:'Breakout',strategy:'breakout',metrics:{returnPct:2,maxDD:6,trades:1},
   trainMetrics:{sharpe:1.1},testMetrics:{sharpe:.2},validation:{enoughTestBars:true}}
 ]});
 accumulator.add('CCC',{rows:[
  {id:'indicator:rsi',name:'RSI plot',strategy:null,kind:'example-indicator',metrics:{}}
 ]});
 const report=accumulator.finalize({requested:3,feed:'iex'});
 assert.equal(report.symbolsAnalyzed,3);
 assert.equal(report.requested,3);
 assert.deepEqual(report.rows.map(row=>row.id),['preset:ema-cross','preset:breakout']);
 assert.equal(report.rows[0].symbols,2);
 assert.ok(Math.abs(report.rows[0].medianTrainSharpe-1.3)<1e-12);
 assert.ok(Math.abs(report.rows[0].medianOosSharpe-.6)<1e-12);
 assert.equal(report.rows[0].positiveOos,2);
 assert.equal(report.rows[0].validatedSymbols,1);
 assert.ok(Math.abs(report.rows[1].medianTrainSharpe-1)<1e-12);
});
