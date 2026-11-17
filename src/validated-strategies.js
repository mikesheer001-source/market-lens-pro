// Round 22 — unified, strictly out-of-sample validation for the
// leaderboard filter and Daily Briefing. No full-period metric can validate.
export const VALIDATION_RULE =
  'Positive OOS Sharpe on the single 70/30 split with at least 30 test bars OR positive Sharpe in at least 3 of 5 rolling OOS windows';

export function singleSplitValidated(row){
  return !!(row?.strategy && row.validation?.enoughTestBars &&
    Number(row.validation?.testBars)>=30 &&
    Number.isFinite(row.testMetrics?.sharpe) && row.testMetrics.sharpe>0);
}

export function rollingValidated(row){
  const rolling=row?.rolling;
  return !!(row?.strategy && rolling?.totalWindows===5 &&
    Number.isInteger(rolling.assessableCount) && rolling.assessableCount>=3 &&
    Number.isInteger(rolling.positiveCount) && rolling.positiveCount>=3 &&
    rolling.positiveCount<=rolling.assessableCount);
}

export function validationReasons(row){
  if(!row?.strategy || row.kind==='example-indicator')return [];
  const reasons=[];
  if(singleSplitValidated(row))reasons.push('single 70/30');
  if(rollingValidated(row))reasons.push('rolling 3/5');
  return reasons;
}

export function isValidatedStrategy(row){
  return validationReasons(row).length>0;
}

// One interpretation of the validation criteria for every table and CSV.
// Portfolio and universe-fit rows project the winning strategy's OOS evidence;
// old saved breakdowns may instead carry the already-computed reason list.
export function validationStatus(row){
  const strategy=row?.strategy??row?.validatingStrategy?.strategy??
    ((row?.strategyName||row?.validatingStrategy?.name)?'saved-strategy':undefined);
  if(row?.kind==='example-indicator'||(row?.strategy===null&&!row?.validatingStrategy))
    return {validated:false,reasons:[],label:'Indicator · N/A'};
  let reasons=validationReasons({...row,strategy});
  if(!reasons.length && !row?.rolling && Array.isArray(row?.validationReasons) && strategy){
    const known=['single 70/30','rolling 3/5'];
    reasons=known.filter(reason=>row.validationReasons.includes(reason));
  }
  return {validated:reasons.length>0,reasons,
    label:reasons.length?'Validated ('+reasons.join(' OR ')+')':'Not validated'};
}

export function filterValidatedLeaderboard(rows,enabled=false){
  const all=Array.isArray(rows)?rows:[];
  return enabled?all.filter(isValidatedStrategy):all.slice();
}

export function bestRollingValidatedStrategy(rows){
  // Require a real numeric rolling OOS mean; a single-split validation alone
  // must not manufacture a rolling measurement. Among eligible strategies,
  // choose highest *rolling* mean, never training/full Sharpe.
  return filterValidatedLeaderboard(rows,true)
    .filter(r=>Number.isFinite(r.rolling?.meanSharpe) &&
      Number.isFinite(r.rolling?.medianSharpe) && r.rolling.assessableCount>0)
    .sort((a,b)=>b.rolling.meanSharpe-a.rolling.meanSharpe||
      String(a.id).localeCompare(String(b.id)))[0]||null;
}

export function bestFullPeriodStrategy(rows){
  return (Array.isArray(rows)?rows:[]).filter(r=>r?.strategy &&
    Number.isFinite(r.metrics?.sharpe))
    .sort((a,b)=>b.metrics.sharpe-a.metrics.sharpe||
      String(a.id).localeCompare(String(b.id)))[0]||null;
}

export function briefingStrategyLeaders(report){
  const rows=report?.rows||[];
  const rolling=bestRollingValidatedStrategy(rows);
  const fullPeriod=bestFullPeriodStrategy(rows);
  const pick=row=>row?{id:row.id,name:row.name}:null;
  return {
    symbol:report?.symbol||null,
    timeframe:report?.timeframe||null,
    source:report?.source||null,
    dateRange:report?.range||null,
    compared:rows.filter(r=>r?.strategy).length,
    validated:rows.filter(isValidatedStrategy).length,
    rule:VALIDATION_RULE,
    rolling:rolling?{...pick(rolling),
      meanSharpe:rolling.rolling.meanSharpe,
      positiveWindows:rolling.rolling.positiveCount,
      assessableWindows:rolling.rolling.assessableCount,
      totalWindows:rolling.rolling.totalWindows,
      reasons:validationReasons(rolling)}:null,
    fullPeriod:fullPeriod?{...pick(fullPeriod),
      sharpe:fullPeriod.metrics.sharpe}:null
  };
}
