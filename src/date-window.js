// Round 15 — shared, inclusive date-window selection for backtests.
// Never mutates source OHLCV arrays or creates synthetic bars.
import {barDate} from './freshness.js';
const validDate=value=>/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(value))&&
  Number.isFinite(Date.parse(value+'T00:00:00Z'))&&
  new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function validateBacktestRange({startDate='',endDate=''}={}){
  const start=String(startDate||''),end=String(endDate||'');
  if(start&&!validDate(start))throw Error('Enter a valid backtest start date (YYYY-MM-DD).');
  if(end&&!validDate(end))throw Error('Enter a valid backtest end date (YYYY-MM-DD).');
  if(start&&end&&start>end)throw Error('Backtest start date must be on or before the end date.');
  return {startDate:start,endDate:end};
}
export function windowBacktestBars(bars,dates={}, {allowEmpty=false}={}){
  const window=validateBacktestRange(dates);
  const source=Array.isArray(bars)?bars:[];
  const selected=source.filter(b=>{
    const date=barDate(b);
    return date&&(!window.startDate||date>=window.startDate)&&
      (!window.endDate||date<=window.endDate);
  });
  if(!selected.length&&!allowEmpty)
    throw Error('No bars fall inside the selected backtest date range. Choose a wider range.');
  return {bars:selected,range:{
    ...window,actualStart:barDate(selected[0])||null,
    actualEnd:barDate(selected.at(-1))||null,count:selected.length
  }};
}
export function windowPortfolioData(data,symbols,dates={}){
  const window=validateBacktestRange(dates),out=new Map();
  for(const symbol of symbols){
    const history=data.get(symbol);
    out.set(symbol,windowBacktestBars(history||[],window,{allowEmpty:true}).bars);
  }
  if(![...out.values()].some(bars=>bars.length))
    throw Error('No bars fall inside the selected backtest date range. Choose a wider range.');
  return out;
}
export function displayBacktestRange(range){
  if(!range)return 'Date range not recorded — rerun the backtest';
  const selection=range.startDate||range.endDate?
    (range.startDate||'First available')+' to '+(range.endDate||'Last available'):'Full available range';
  return 'Selected range: '+selection+' · actual bars: '+
    (range.actualStart||'none')+' to '+(range.actualEnd||'none')+
    ' ('+(range.count??0)+' bars)';
}
export function actualPortfolioRange(curve,dates={}){
  const window=validateBacktestRange(dates);
  return {...window,actualStart:barDate(curve?.[0])||null,
    actualEnd:barDate(curve?.at(-1))||null,
    count:Array.isArray(curve)?curve.length:0};
}
