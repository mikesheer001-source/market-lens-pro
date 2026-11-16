import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleData,statsFor,aggregate} from '../src/engine.js';
import {compileDailyBriefing,briefingToText,briefingMarketDate,
  saveBriefingHistory,pruneBriefingHistory} from '../src/briefing.js';

const prices=sampleData()['DEMO-SPY'].slice(-280);
const symbols=['AAPL','VXX','VXZ','SVXY'];
const make=({selected=true,baseline=true}={})=>{
  const data=new Map(symbols.map(s=>[s,prices]));
  const sources=new Map(symbols.map(s=>[s,'ALPACA']));
  const signals=new Map([['AAPL',{status:'LONG',barDate:prices.at(-1).time,source:'ALPACA IEX 1Day'}],
    ['VXX',{status:'FLAT',barDate:prices.at(-1).time,source:'ALPACA IEX 1Day'}]]);
  const scan={status:'complete',source:'ALPACA',returned:4,requested:133,at:'2026-11-16T21:03:00Z'};
  return compileDailyBriefing({generatedAt:'2026-11-16T21:03:46Z',scan,data,sources,
    symbols,rules:[{tf:'D',metric:'price',op:'>',value:0}],feed:'iex',
    signalSelection:selected?'preset:ema-cross':'none',
    strategyName:selected?'EMA crossover':null,signals,
    hasFlipBaseline:baseline,
    flips:[{symbol:'AAPL',strategyId:'preset:ema-cross',from:'FLAT',to:'LONG',
      barDate:prices.at(-1).time,source:'ALPACA IEX 1Day'},
      {symbol:'VXX',strategyId:'preset:rsi-revert',from:'LONG',to:'FLAT'}],
    alerts:[{id:'a',symbol:'VXX',metric:'price',op:'>',threshold:50,lastValue:123,
      lastHitBarDate:prices.at(-1).time,active:true},
      {id:'b',symbol:'AAPL',metric:'price',op:'<',threshold:1,unread:false,active:false}],
    freshness:{expected:'2026-11-16',stale:[{symbol:'VXZ',latest:'2026-11-13'}]},
    diagnostics:{VXZ:{asset:{found:true,status:'active',tradable:true},barsAfterLatest:false}}
  });
};

test('Daily Briefing uses real engine metrics, matched set, signal flips, proxy and source/bar dates',()=>{
  const briefing=make(),reference=statsFor(aggregate(prices,'D'));
  assert.equal(briefing.version,1);
  assert.equal(briefing.date,'2026-11-16');
  assert.equal(briefing.scan.loaded,4);
  assert.equal(briefing.scan.requested,133);
  assert.equal(briefing.scan.matched,4);
  assert.equal(briefing.matches.length,4);
  assert.ok(briefing.matches.every(x=>x.source==='ALPACA IEX 1Day'&&x.barDate));
  assert.equal(briefing.matches[0].rsi5,reference.rsi5);
  assert.equal(briefing.matches[0].price,reference.price);
  assert.deepEqual(briefing.strategy.long.map(x=>x.symbol),['AAPL']);
  assert.deepEqual(briefing.strategy.flips.map(x=>x.symbol),['AAPL']);
  assert.match(briefing.regime.name,/price proxy/i);
  assert.ok(briefing.regime.barDate);
  assert.equal(briefing.regime.source,'ALPACA IEX 1Day');
  assert.equal(briefing.vxx.close,prices.at(-1).close);
  assert.equal(briefing.vxx.source,'ALPACA IEX 1Day');
  assert.ok(Number.isFinite(briefing.vxx.return20));
  assert.equal(briefing.alerts.items.length,1);
  assert.equal(briefing.alerts.items[0].symbol,'VXX');
  assert.equal(briefing.stale.items.length,1);
  assert.match(briefing.stale.items[0].reason,/no bars after 2026-11-13/);
});

test('plain-text export contains date, matched prices/RSI 5D, LONGs, regime, VXX 20D, alerts and stale',()=>{
  const briefing=make();
  const output=briefingToText(briefing);
  assert.match(output,/US market date: 2026-11-16/);
  assert.match(output,/Scan: 4\/133 symbols loaded; 4 matches/);
  assert.match(output,/AAPL \$[\d.]+ RSI 5D [\d.]+/);
  assert.match(output,/LONG \(1\): AAPL/);
  assert.match(output,/AAPL FLAT → LONG/);
  assert.match(output,/PRICE-BASED PROXY; NOT VIX FUTURES CONTANGO/);
  assert.match(output,/VXX: \$[\d.]+ close \| 20D return/);
  assert.match(output,/Stale\/missing bars \(1\): VXZ 2026-11-13/);
  assert.match(output,/Active\/triggered alerts \(1\)/);
  assert.ok(!output.includes('DEMO'));
  assert.throws(()=>briefingToText(null),/Generate a live/);
});

test('unselected strategy and no prior scan are explicit, never presented as zero observed flips',()=>{
  const first=make({selected:true,baseline:false});
  const noStrategy=make({selected:false});
  assert.equal(first.strategy.flips.length,0);
  assert.equal(first.strategy.baselineAvailable,false);
  assert.match(briefingToText(first),/No prior comparable scan/);
  assert.equal(noStrategy.strategy.name,null);
  assert.equal(noStrategy.strategy.long.length,0);
  assert.match(briefingToText(noStrategy),/Unavailable — select a strategy/);
});
test('demo or historical scan cannot be passed off as a live briefing',()=>{
  const data=new Map(),sources=new Map();
  assert.throws(()=>compileDailyBriefing({scan:{status:'complete',source:'DEMO'},data,sources,symbols:[]}),/live Alpaca/);
  assert.throws(()=>compileDailyBriefing({scan:{status:'loading',source:'ALPACA'},data,sources,symbols:[]}),/completed live/);
});
test('seven NY market-calendar days retain one latest snapshot per day, purge older and future data',()=>{
  const first=make(),at='2026-11-17T21:00:00Z';
  assert.equal(briefingMarketDate('2026-11-17T01:00:00Z'),'2026-11-16');
  assert.equal(briefingMarketDate(at),'2026-11-17');
  const days=[10,11,12,13,14,15,16,17,18].map(day=>({
    ...first,date:'2026-11-'+String(day).padStart(2,'0'),
    generatedAt:'2026-11-'+String(day).padStart(2,'0')+'T21:00:00Z'
  }));
  const history=pruneBriefingHistory(days,at);
  assert.deepEqual(history.map(x=>x.date),['2026-11-17','2026-11-16','2026-11-15',
    '2026-11-14','2026-11-13','2026-11-12','2026-11-11']);
  const replacement={...days[7],generatedAt:'2026-11-17T22:00:00Z',scan:{...first.scan,matched:9}};
  const saved=saveBriefingHistory(history,replacement,at);
  assert.equal(saved.length,7);
  assert.equal(saved[0].scan.matched,9);
  assert.equal(saved[0].generatedAt,replacement.generatedAt);
});
