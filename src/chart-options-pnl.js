import {expirationTime,expiryPnl,expiryStats,initialDebit} from './options-payoff.js';

const numeric=value=>value===''||value==null?null:Number(value);
const units=leg=>(leg.side==='buy'?1:-1)*leg.quantity*leg.multiplier;
const unavailable=(status,reason,extra={})=>({
  available:false,status,reason,points:[],breakevens:[],markPnl:null,...extra
});

/**
 * Exact expiration payoff plus a current, executable bid/ask liquidation mark.
 * No volatility, Black-Scholes, synthetic quote, or interpolated option price is used.
 */
export function chartOptionsPnl(snapshot,symbol,bars,now=Date.now(),maxQuoteAgeMs=120_000){
  if(!snapshot||snapshot.symbol!==symbol)
    return unavailable('symbol-mismatch','Options Builder is set to '+(snapshot?.symbol||'another symbol')+
      ', not '+symbol+'.');
  if(!Array.isArray(snapshot.legs)||!snapshot.legs.length)
    return unavailable('no-position','Add an Options Builder position for '+symbol+'.');

  const fee=numeric(snapshot.fee)??0,packagePremium=numeric(snapshot.packagePremium);
  if(!Number.isFinite(fee)||fee<0||fee>10000)
    return unavailable('invalid-fee','Enter a valid Options Builder fee per contract.');

  const legs=snapshot.legs.map(leg=>({...leg,strike:numeric(leg.strike),quantity:numeric(leg.quantity),
    multiplier:numeric(leg.multiplier)??100,entry:numeric(leg.entry)}));
  if(legs.some(leg=>!(leg.strike>0)||!Number.isInteger(leg.quantity)||leg.quantity<1||leg.quantity>10000||
    !(leg.multiplier>0)||!['buy','sell'].includes(leg.side)||!['call','put'].includes(leg.type)||
    !Number.isFinite(expirationTime(leg))))
    return unavailable('invalid-position','Every option leg needs a valid side, type, strike, quantity and expiration.');

  const quoteTimes=[];
  for(const leg of legs){
    const quote=leg.quote,bid=numeric(quote?.bid),ask=numeric(quote?.ask);
    const quoteTime=typeof quote?.time==='number'?quote.time:Date.parse(quote?.time);
    if(!leg.symbol||!Number.isFinite(bid)||!Number.isFinite(ask)||bid<0||ask<=0||ask<bid||
      !Number.isFinite(quoteTime))
      return unavailable('missing-live-quotes','Fresh live bid/ask quotes are required for every option leg.');
    if(quoteTime>now+60_000||now-quoteTime>maxQuoteAgeMs)
      return unavailable('stale-live-quotes','An option quote is older than two minutes. Refresh prices in Options Builder.');
    quoteTimes.push(quoteTime);
  }
  if(packagePremium==null&&legs.some(leg=>leg.entry==null||leg.entry<0||leg.entry>1e6))
    return unavailable('missing-premium','Enter each leg premium or a net package premium in Options Builder.');

  const fees=legs.reduce((sum,leg)=>sum+fee*leg.quantity,0);
  const debit=packagePremium==null?initialDebit(legs,fee):packagePremium+fees;
  if(!Number.isFinite(debit))
    return unavailable('invalid-premium','The selected position has an invalid entry premium.');

  // Conservative executable close marks: sell long legs at bid and buy back short legs at ask.
  const liquidation=legs.reduce((sum,leg)=>sum+
    units(leg)*(leg.side==='buy'?leg.quote.bid:leg.quote.ask),0);
  const markPnl=liquidation-debit;
  const quoteTime=Math.min(...quoteTimes);
  const expirations=legs.map(expirationTime);
  const expiry=Math.min(...expirations);
  const mark={markPnl,quoteTime,feed:snapshot.feed||'unknown',debit,legs:legs.length};

  if(!expirations.every(value=>value===expiry))
    return unavailable('mixed-expirations',
      'Live mark P&L is available, but the expiry overlay needs every leg to share one settlement time. No model prices are substituted.',
      {...mark});
  if(expiry<=now)
    return unavailable('expired','The selected option expiration has passed.',{...mark});
  if(!Array.isArray(bars)||!bars.length)
    return unavailable('no-chart-bars','No genuine chart bars are available for the selected symbol.',{...mark});

  const points=bars.filter(bar=>bar?.time!=null&&Number.isFinite(Number(bar.close??bar.value)))
    .map(bar=>({time:bar.time,price:Number(bar.close??bar.value),
      pnl:expiryPnl(legs,Number(bar.close??bar.value),debit)}));
  if(!points.length)
    return unavailable('no-chart-bars','No genuine chart closes are available for the selected symbol.',{...mark});

  const stats=expiryStats(legs,debit);
  const breakevens=[...stats.roots,...stats.flat.flatMap(([low,high])=>
    Number.isFinite(high)?[low,high]:[low])].filter(value=>Number.isFinite(value)&&value>=0)
    .sort((a,b)=>a-b).filter((value,index,array)=>!index||Math.abs(value-array[index-1])>1e-7);
  return {available:true,status:'ready',reason:'',...mark,expiry,breakevens,points};
}
