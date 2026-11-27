import {expirationTime,expiryStats,initialDebit} from './options-payoff.js';
const numeric=value=>value===''||value==null?null:Number(value);
const invalid=reason=>({valid:false,reason});
function freshQuote(quote,now,maxAgeMs){
  const bid=numeric(quote?.bid),ask=numeric(quote?.ask);
  const time=typeof quote?.time==='number'?quote.time:Date.parse(quote?.time);
  return Number.isFinite(bid)&&bid>=0&&Number.isFinite(ask)&&ask>0&&ask>=bid&&
    Number.isFinite(time)&&time<=now+60_000&&now-time<=maxAgeMs;
}
/** Exact two-leg expiration risk for a same-expiry, same-type, 1:1 vertical spread. */
export function verticalSpreadMetrics(legs,fee=0,now=Date.now(),maxQuoteAgeMs=120_000){
  if(!Array.isArray(legs)||legs.length!==2)return invalid('A vertical spread needs exactly two option legs.');
  const normalized=legs.map(leg=>({...leg,strike:numeric(leg.strike),quantity:numeric(leg.quantity),
    entry:numeric(leg.entry),multiplier:numeric(leg.multiplier)??100}));
  const [first,second]=normalized;
  if(!['call','put'].includes(first.type)||first.type!==second.type)
    return invalid('Both legs must be the same option type: calls or puts.');
  if(!['buy','sell'].includes(first.side)||!['buy','sell'].includes(second.side)||first.side===second.side)
    return invalid('Choose one buy leg and one sell leg.');
  if(!(first.strike>0&&second.strike>0)||first.strike===second.strike)
    return invalid('Choose two different listed strikes.');
  if(first.expiry!==second.expiry||!Number.isFinite(expirationTime(first))||
    expirationTime(first)!==expirationTime(second))
    return invalid('Both legs must share one valid expiration.');
  if(!first.root||first.root!==second.root||!(first.multiplier>0)||first.multiplier!==second.multiplier)
    return invalid('Both legs must use the same contract root and multiplier.');
  if(!Number.isInteger(first.quantity)||first.quantity<1||first.quantity>10000||first.quantity!==second.quantity)
    return invalid('Both legs must have the same valid whole-number contract quantity.');
  if(normalized.some(leg=>!Number.isFinite(leg.entry)||leg.entry<0||leg.entry>1e6))
    return invalid('Enter a valid non-negative premium for each leg.');
  if(normalized.some(leg=>!leg.symbol||!freshQuote(leg.quote,now,maxQuoteAgeMs)))
    return invalid('Fresh live bid/ask quotes are required for both listed contracts.');
  if(!Number.isFinite(fee)||fee<0||fee>10000)return invalid('Enter a valid fee per contract.');
  const netEntry=initialDebit(normalized,fee),stats=expiryStats(normalized,netEntry);
  const maxProfit=stats.high,maxLoss=Math.max(0,-stats.low);
  if(!Number.isFinite(netEntry)||!Number.isFinite(maxProfit)||!Number.isFinite(maxLoss))
    return invalid('This combination does not have defined, limited vertical-spread risk.');
  const breakevens=[...stats.roots,...stats.flat.flatMap(([low,high])=>
    Number.isFinite(high)?[low,high]:[low])]
    .filter(value=>Number.isFinite(value)&&value>=0).sort((a,b)=>a-b)
    .filter((value,index,array)=>!index||Math.abs(value-array[index-1])>1e-7);
  const quoteTimes=normalized.map(leg=>typeof leg.quote.time==='number'?leg.quote.time:Date.parse(leg.quote.time));
  return {valid:true,type:first.type,expiry:first.expiry,quantity:first.quantity,netEntry,
    entryType:netEntry>1e-8?'debit':netEntry< -1e-8?'credit':'flat',maxProfit,maxLoss,breakevens,
    riskReward:maxProfit>0?maxLoss/maxProfit:null,quoteTime:Math.min(...quoteTimes),feed:'live'};
}
