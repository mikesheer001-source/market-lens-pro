// Round 25: pure, deterministic CSV exports backed by the same ordered rows
// used by the corresponding on-screen rankings. Values are raw, not localized.
import {sortLeaderboard,PRESET_STRATEGIES} from './leaderboard.js';
import {filterValidatedLeaderboard,isValidatedStrategy,validationReasons} from './validated-strategies.js';
import {sortUniverseFit} from './fit.js';

export function leaderboardDisplayRows(report,{validatedOnly=false,sort='sharpe',descending=true}={}){
  return sortLeaderboard(filterValidatedLeaderboard(report?.rows||[],validatedOnly),sort,descending);
}
export function fitDisplayRows(report,{validatedOnly=false,sort='sharpe',descending=true}={}){
  const rows=report?.rows||[];
  return validatedOnly?[...rows]:sortUniverseFit(rows,sort,descending);
}
export function portfolioDisplayRows(report){return [...(report?.breakdown||[])];}

const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const plain=value=>number(value)??'';
const csvText=value=>{
  const s=value==null?'':String(value);
  // A downloaded report can be opened in a spreadsheet: never evaluate user labels as formulas.
  const safe=/^[=+@\t\r]/.test(s)||/^-(?=[^0-9.])/.test(s)?"'"+s:s;
  return /[,"\r\n]/.test(safe)?'"'+safe.replaceAll('"','""')+'"':safe;
};
function cell(value){
  if(typeof value==='number')return Number.isFinite(value)?String(value):'';
  return csvText(value);
}
export function writeRankingCsv(headers,rows,{summary=[]}={}){
  if(!Array.isArray(headers)||!headers.length)throw Error('CSV columns are required.');
  const lines=[];
  for(const [name,value] of summary)lines.push([cell(name),cell(value)].join(','));
  if(summary.length)lines.push('');
  lines.push(headers.map(cell).join(','));
  for(const row of rows)lines.push(headers.map((_,i)=>cell(row[i])).join(','));
  return lines.join('\r\n')+'\r\n';
}
export function rankingFilename(kind,validatedOnly=false,range={}){
  const name=String(kind).replace(/[^a-z0-9-]/gi,'-').toLowerCase();
  const mode=validatedOnly?'validated-only':'in-sample';
  const a=range.startDate||range.actualStart||'first-available';
  const b=range.endDate||range.actualEnd||'last-available';
  return [name,mode,String(a), 'to',String(b)].join('-').replace(/[^a-z0-9.-]/gi,'-')+'.csv';
}
const validationLabel=row=>{
  if(!row?.strategy)return 'Indicator - N/A';
  return isValidatedStrategy(row)?'Validated':'Not validated';
};
const sharpe30=row=>row?.validation?.enoughTestBars?plain(row.testMetrics?.sharpe):'';
const pos=row=>row?.rolling?.positiveCount==null?'':plain(row.rolling.positiveCount);
export const LEADERBOARD_CSV_COLUMNS=Object.freeze([
  'Strategy','Train return (%)','Train Sharpe','OOS return (%)','OOS Sharpe',
  'Rolling mean OOS Sharpe','Rolling median OOS Sharpe','Positive windows',
  'Validation status','Full return (%)','Full CAGR (%)',
  'Full max drawdown (%)','Full win rate (%)','Full trades'
]);
export function leaderboardRankingCsv(report,ui={}){
  const rows=leaderboardDisplayRows(report,ui);
  const csv=writeRankingCsv(LEADERBOARD_CSV_COLUMNS,rows.map(row=>[
    row.name,plain(row.trainMetrics?.returnPct),plain(row.trainMetrics?.sharpe),
    plain(row.testMetrics?.returnPct),sharpe30(row),
    plain(row.rolling?.meanSharpe),plain(row.rolling?.medianSharpe),
    pos(row),validationLabel(row),plain(row.metrics?.returnPct),
    plain(row.metrics?.cagrPct),plain(number(row.metrics?.maxDD)==null?null:-row.metrics.maxDD),
    plain(row.metrics?.winPct),plain(row.metrics?.trades)
  ]));
  return {filename:rankingFilename('leaderboard',!!ui.validatedOnly,report?.range),
    csv,rows};
}
export const FIT_CSV_COLUMNS=Object.freeze([
  'Symbol','Best / validating strategy','Rolling mean OOS Sharpe',
  'Rolling median OOS Sharpe','Positive windows','Validation rule',
  'Train return (%)','Train Sharpe','OOS return (%)','OOS Sharpe',
  'Full return (%)','Full CAGR (%)','Full max drawdown (%)',
  'Full win rate (%)','Full trades'
]);
const selectedStrategy=report=>{
  const strategy=report?.settings?.strategy;
  if(strategy==='pine-custom')return report?.script?.name||'Pine custom strategy';
  return PRESET_STRATEGIES.find(s=>s.id===strategy)?.name||strategy||'—';
};
export function fitRankingCsv(report,ui={}){
  const validated=!!ui.validatedOnly;
  const rows=fitDisplayRows(report,ui);
  const csv=writeRankingCsv(FIT_CSV_COLUMNS,rows.map(row=>[
    row.symbol,validated?row.validatingStrategy?.name||'':selectedStrategy(report),
    plain(validated?row.rollingMeanSharpe:null),
    plain(validated?row.rollingMedianSharpe:null),
    validated?plain(row.positiveWindows):'',
    validated?row.validationReasons?.join(' OR ')||'Not validated':
      row.validation?.validated?'single 70/30':'Not validated',
    plain(row.trainMetrics?.returnPct),plain(row.trainMetrics?.sharpe),
    plain(row.testMetrics?.returnPct),
    row.validation?.enoughTestBars?plain(row.testMetrics?.sharpe):'',
    plain(row.metrics?.returnPct),plain(row.metrics?.cagrPct),
    plain(row.metrics?.maxDD),plain(row.metrics?.winPct),plain(row.metrics?.trades)
  ]));
  return {filename:rankingFilename('fit-across-universe',validated,report?.dateRange),
    csv,rows};
}
export const PORTFOLIO_CSV_COLUMNS=Object.freeze([
  'Symbol','Strategy','Return (%)','Trades','Win rate (%)','Drawdown (%)',
  'Sharpe','Weight','Source','Last bar','Train return (%)','Train Sharpe',
  'OOS return (%)','OOS Sharpe','Rolling mean OOS Sharpe',
  'Rolling median OOS Sharpe','Positive windows','Validation status'
]);
export const PORTFOLIO_SUMMARY_COLUMNS=Object.freeze([
  'Portfolio total return (%)','Portfolio CAGR (%)','Portfolio Sharpe',
  'Portfolio max drawdown (%)'
]);
export function portfolioRankingCsv(report,{validatedOnly=false}={}){
  const rows=portfolioDisplayRows(report);
  const summary=[
    [PORTFOLIO_SUMMARY_COLUMNS[0],plain(report?.metrics?.returnPct)],
    [PORTFOLIO_SUMMARY_COLUMNS[1],plain(report?.metrics?.cagrPct)],
    [PORTFOLIO_SUMMARY_COLUMNS[2],plain(report?.metrics?.sharpe)],
    [PORTFOLIO_SUMMARY_COLUMNS[3],
      plain(number(report?.metrics?.maxDD)==null?null:-report.metrics.maxDD)]
  ];
  const csv=writeRankingCsv(PORTFOLIO_CSV_COLUMNS,rows.map(r=>[
    r.symbol,r.strategyName||r.strategy,plain(r.returnPct),plain(r.trades),
    plain(r.winPct),plain(number(r.maxDD)==null?null:-r.maxDD),
    plain(r.sharpe),plain(report?.weights?.[r.symbol]),r.source,r.barDate,
    plain(r.trainMetrics?.returnPct),plain(r.trainMetrics?.sharpe),
    plain(r.testMetrics?.returnPct),
    r.validation?.enoughTestBars?plain(r.testMetrics?.sharpe):'',
    plain(r.rollingMeanSharpe),plain(r.rollingMedianSharpe),
    plain(r.rollingPositiveCount),r.validationReasons?.length?
      r.validationReasons.join(' OR '):r.validation?.validated?'Validated':'Not validated'
  ]),{summary});
  return {filename:rankingFilename('best-fit-portfolio',validatedOnly,report?.range),
    csv,rows};
}
