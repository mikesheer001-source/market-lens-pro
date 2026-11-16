import test from 'node:test';
import assert from 'node:assert/strict';
import {
  leaderboardDisplayRows,fitDisplayRows,portfolioDisplayRows,writeRankingCsv,
  leaderboardRankingCsv,fitRankingCsv,portfolioRankingCsv,rankingFilename,
  LEADERBOARD_CSV_COLUMNS,FIT_CSV_COLUMNS,PORTFOLIO_CSV_COLUMNS,
  PORTFOLIO_SUMMARY_COLUMNS
} from '../src/ranking-export.js';

const range={startDate:'2026-10-01',endDate:'2026-11-16'};
function lines(csv){return csv.trimEnd().split(/\r?\n/);}
const metric=(sharpe)=>({returnPct:12.5+sharpe,cagrPct:8.25+sharpe,maxDD:17.5,winPct:55.5,
  trades:12,sharpe,profitFactor:1.5});
const strategy=(id,{validated=false,train=1,mean=.3,positive=1}={})=>({
 id,name:id,kind:'preset',strategy:'ema-cross',trainMetrics:{sharpe:train,returnPct:3.125},
 testMetrics:{sharpe:validated?1.5:-.5,returnPct:2.5},
 validation:{enoughTestBars:true,testBars:60,validated},
 rolling:{meanSharpe:mean,medianSharpe:mean-.1,positiveCount:positive,
   assessableCount:5,totalWindows:5},
 metrics:metric(train)
});
const failed=strategy('failed',{train:15});
const accepted=strategy('accepted',{validated:true,train:2,mean:1,positive:4});
const notRankable={id:'indicator',name:'Indicator only',strategy:null,metrics:metric(0)};
const leaderboard={rows:[failed,accepted,notRankable],range,
  bestId:'failed',symbol:'SPY'};
const fitRow=(symbol,train)=>({
 symbol,trainMetrics:{returnPct:2.25,sharpe:train},
 testMetrics:{returnPct:1.5,sharpe:.25},validation:{enoughTestBars:true,validated:train>2},
 metrics:{returnPct:10.2,cagrPct:7.2,maxDD:15,winPct:50,trades:6},
 source:'ALPACA IEX',barDate:'2026-11-16'
});
const fit={settings:{strategy:'ema-cross'},rows:[fitRow('BBB',1),fitRow('AAA',3)],
 dateRange:range};
const validatedFit={rows:[
  {...fitRow('ZZZ',8),validatingStrategy:{name:'RSI mean reversion'},
    rollingMeanSharpe:1.25,rollingMedianSharpe:1.1,positiveWindows:4,
    totalWindows:5,validationReasons:['rolling 3/5']},
  {...fitRow('AAA',4),validatingStrategy:{name:'EMA crossover'},
    rollingMeanSharpe:.45,rollingMedianSharpe:.35,positiveWindows:2,
    totalWindows:5,validationReasons:['single 70/30']}
],dateRange:range};

test('Round 25: leaderboard CSV matches exact visible sort, filtered count and requested columns',()=>{
 const ui={validatedOnly:false,sort:'sharpe',descending:true};
 const shown=leaderboardDisplayRows(leaderboard,ui);
 const result=leaderboardRankingCsv(leaderboard,ui);
 const text=lines(result.csv);
 assert.deepEqual(shown.map(r=>r.id),['failed','accepted','indicator']);
 assert.equal(result.rows.length,shown.length);
 assert.equal(text.length,shown.length+1);
 assert.equal(text[0],LEADERBOARD_CSV_COLUMNS.join(','));
 assert.deepEqual(text.slice(1).map(x=>x.split(',')[0]),shown.map(r=>r.name));
 assert.equal(result.filename,'leaderboard-in-sample-2026-10-01-to-2026-11-16.csv');
 assert.equal(text[1].split(',')[2],'15','unformatted numeric train Sharpe');
 assert.equal(text[1].split(',')[11],'-17.5','full drawdown signed like display');
 assert.ok(!text.slice(1).some(x=>x.includes('%')||x.includes('1,000')));
});
test('Round 25: leaderboard validated-only has only visible validated rows, current dates, raw OOS numbers',()=>{
 const ui={validatedOnly:true,sort:'name',descending:false};
 const shown=leaderboardDisplayRows(leaderboard,ui);
 const result=leaderboardRankingCsv(leaderboard,ui);
 assert.deepEqual(shown.map(r=>r.id),['accepted']);
 assert.deepEqual(result.rows.map(r=>r.id),shown.map(r=>r.id));
 assert.equal(result.filename,'leaderboard-validated-only-2026-10-01-to-2026-11-16.csv');
 assert.equal(lines(result.csv).length,2);
 const cols=lines(result.csv)[1].split(',');
 assert.equal(cols[0],'accepted');
 assert.equal(cols[4],'1.5');
 assert.equal(cols[5],'1');
 assert.equal(cols[6],'0.9');
 assert.equal(cols[7],'4');
 assert.equal(cols[8],'Validated');
 const none=leaderboardRankingCsv({...leaderboard,rows:[failed]},ui);
 assert.equal(lines(none.csv).length,1,'empty filter downloads only header, no extra data');
});
test('Round 25: Fit in-sample CSV preserves user-selected ranking order and strategy',()=>{
 const ui={validatedOnly:false,sort:'symbol',descending:false};
 const shown=fitDisplayRows(fit,ui),out=fitRankingCsv(fit,ui),records=lines(out.csv);
 assert.deepEqual(shown.map(r=>r.symbol),['AAA','BBB']);
 assert.deepEqual(out.rows.map(r=>r.symbol),shown.map(r=>r.symbol));
 assert.equal(records[0],FIT_CSV_COLUMNS.join(','));
 assert.equal(records.length,3);
 assert.deepEqual(records.slice(1).map(x=>x.split(',')[0]),['AAA','BBB']);
 assert.equal(records[1].split(',')[1],'EMA crossover');
 assert.equal(records[1].split(',')[7],'3');
 assert.equal(out.filename,'fit-across-universe-in-sample-2026-10-01-to-2026-11-16.csv');
});
test('Round 25: Fit validated CSV includes winner, OOS rolling and its OWN training figures',()=>{
 const ui={validatedOnly:true,sort:'symbol',descending:false};
 const shown=fitDisplayRows(validatedFit,ui),out=fitRankingCsv(validatedFit,ui);
 assert.deepEqual(out.rows.map(r=>r.symbol),shown.map(r=>r.symbol));
 assert.deepEqual(out.rows.map(r=>r.symbol),['ZZZ','AAA'],
   'validated view retains ranked order regardless of inactive in-sample sort');
 const records=lines(out.csv);
 assert.equal(records[0],FIT_CSV_COLUMNS.join(','));
 assert.equal(records.length,3);
 assert.equal(records[1].split(',')[1],'RSI mean reversion');
 assert.equal(records[1].split(',')[2],'1.25');
 assert.equal(records[1].split(',')[3],'1.1');
 assert.equal(records[1].split(',')[4],'4');
 assert.equal(records[1].split(',')[5],'rolling 3/5');
 assert.equal(records[1].split(',')[7],'8','selected strategy training Sharpe');
 assert.equal(out.filename,'fit-across-universe-validated-only-2026-10-01-to-2026-11-16.csv');
 const empty=fitRankingCsv({rows:[],dateRange:range},ui);
 assert.equal(lines(empty.csv).length,1);
});
test('Round 25: best-fit CSV matches exact displayed symbol rows, weights, headline metrics as preamble',()=>{
 const breakdown=[
 {symbol:'SPY',strategyName:'EMA crossover',returnPct:11.123,trades:4,winPct:75,
  maxDD:6.5,sharpe:1.3,source:'ALPACA IEX',barDate:'2026-11-16',
  rollingMeanSharpe:.8,rollingPositiveCount:4,validationReasons:['rolling 3/5']},
 {symbol:'VXX',strategyName:'RSI mean reversion',returnPct:-2.1,trades:12,winPct:33.33,
  maxDD:18,sharpe:-.2,source:'ALPACA IEX',barDate:'2026-11-16',
  rollingMeanSharpe:.2,rollingPositiveCount:3,validationReasons:['single 70/30']}
 ];
 const portfolio={mode:'best-fit',fitMode:'validated',range,breakdown,
 weights:{SPY:.5,VXX:.5},metrics:{returnPct:4.5,cagrPct:3.125,sharpe:1.1,maxDD:7.75}};
 const ui={validatedOnly:true};
 const out=portfolioRankingCsv(portfolio,ui),expected=portfolioDisplayRows(portfolio),records=lines(out.csv);
 assert.deepEqual(out.rows,expected);
 assert.equal(out.filename,'best-fit-portfolio-validated-only-2026-10-01-to-2026-11-16.csv');
 assert.deepEqual(records.slice(0,4).map(x=>x.split(',')),[
  ['Portfolio total return (%)','4.5'],['Portfolio CAGR (%)','3.125'],
  ['Portfolio Sharpe','1.1'],['Portfolio max drawdown (%)','-7.75']
 ]);
 assert.deepEqual(PORTFOLIO_SUMMARY_COLUMNS,records.slice(0,4).map(x=>x.split(',')[0]));
 assert.equal(records[4],'');
 assert.equal(records[5],PORTFOLIO_CSV_COLUMNS.join(','));
 assert.deepEqual(records.slice(6).map(x=>x.split(',')[0]),['SPY','VXX']);
 assert.equal(records[6].split(',')[7],'0.5');
 assert.equal(records[6].split(',')[5],'-6.5');
 assert.ok(!records.slice(6).some(x=>x.includes('%')));
 const standard=portfolioRankingCsv({...portfolio,fitMode:'training'},{validatedOnly:false});
 assert.match(standard.filename,/best-fit-portfolio-in-sample-/);
});
test('Round 25: no validated portfolio produces only headline and column headers, never invented rows',()=>{
 const empty={mode:'best-fit',fitMode:'validated',noValidated:true,
 range,breakdown:[],weights:{},metrics:null};
 const out=portfolioRankingCsv(empty,{validatedOnly:true});
 assert.equal(lines(out.csv).length,6);
 assert.equal(out.rows.length,0);
 assert.equal(lines(out.csv)[5],PORTFOLIO_CSV_COLUMNS.join(','));
 assert.equal(out.csv.includes('undefined'),false);
});
test('Round 25: filenames use real available bounds; CSV escapes injection and leaves numerics unformatted',()=>{
 assert.equal(rankingFilename('Leaderboard',false,{actualStart:'2025-01-02',actualEnd:'2026-11-16'}),
   'leaderboard-in-sample-2025-01-02-to-2026-11-16.csv');
 const out=writeRankingCsv(['Label','Negative number','Positive number','Empty'],
   [['=SUM(A1:A2)',-34.124,1000000,null]]);
 const parts=lines(out);
 assert.equal(parts[1],"'=SUM(A1:A2),-34.124,1000000,");
});
