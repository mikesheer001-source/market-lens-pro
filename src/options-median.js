const dayMs = 86_400_000;
export const medianHorizons = [{months:6,label:'6M',color:'#7bdac6'}, {months:12,label:'1Y',color:'#f0bd77'}];

function nearbyExpirations(expirations, months, now) {
  const target = new Date(now);
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth()+months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  target.setUTCDate(Math.min(day,lastDay));
  const candidates = expirations.map(expiry => ({expiry,gap:Math.abs(Date.parse(expiry+'T20:00:00Z')-target.getTime())}))
    .filter(({expiry,gap}) => Date.parse(expiry+'T20:00:00Z') > now && gap <= 45*dayMs);
  return candidates.sort((a,b)=>a.gap-b.gap).map(({expiry})=>expiry);
}
export function nearestMedianExpiry(expirations,months,now=Date.now()) {
  return nearbyExpirations(expirations,months,now)[0];
}

function eligibleQuotes(contracts, now) {
  const quotes = contracts.filter(({strike,type,quote}) => {
    const age = now-Date.parse(quote?.time);
    return Number.isFinite(strike) && strike>0 && ['call','put'].includes(type) &&
      Number.isFinite(age) && age >= -60_000 && age <= 7*dayMs && Number.isFinite(quote.bid) &&
      Number.isFinite(quote.ask) && quote.bid>0 && quote.ask>=quote.bid && quote.ask-quote.bid <= .3*(quote.ask+quote.bid)/2;
  });
  const latest = Math.max(...quotes.map(({quote})=>Date.parse(quote.time)));
  return quotes.filter(({quote}) => latest-Date.parse(quote.time)<=dayMs);
}

// European vertical slopes approximate discounted digital prices. Pool reversals
// so a noisy chain still yields a monotone estimate of the terminal CDF.
function monotone(samples) {
  const blocks=[];
  for (const sample of samples) {
    blocks.push({points:[sample],weight:sample.weight,sum:sample.probability*sample.weight});
    while (blocks.length>1) {
      const upper=blocks.at(-1), lower=blocks.at(-2);
      if (lower.sum/lower.weight <= upper.sum/upper.weight) break;
      blocks.pop();
      lower.points.push(...upper.points);
      lower.weight+=upper.weight;
      lower.sum+=upper.sum;
    }
  }
  return blocks.flatMap(block=>block.points.map(point=>({...point,probability:block.sum/block.weight})));
}

export function estimateOptionsMedian(contracts, {spot,expiry,rate=.04,now=Date.now()}) {
  const years=(Date.parse(expiry+'T20:00:00Z')-now)/(365*dayMs);
  if (!(spot>0 && years>0 && Number.isFinite(rate))) return null;
  const eligible=eligibleQuotes(contracts,now);
  // Compare only one contract root so different settlement conventions never mix.
  const byRoot=new Map();
  for (const row of eligible) {
    if (!byRoot.has(row.root)) byRoot.set(row.root,[]);
    byRoot.get(row.root).push(row);
  }
  const rows=[...byRoot.values()].sort((a,b)=>b.length-a.length)[0] ?? [];
  const strikes=[...new Set(rows.map(row=>row.strike))].sort((a,b)=>a-b);
  const byStrike=new Map(rows.map(row=>[row.type+':'+row.strike,row.quote]));
  const discount=Math.exp(-rate*years);
  // Wider verticals reduce the effect of wide bid/ask quotes, at the cost of a
  // coarser local estimate. Use the narrowest strike interval that brackets 50%.
  for (const width of [.018,.035,.05,.065,.08]) {
    const result=estimateAtWidth(strikes,byStrike,discount,spot,width);
    if (result) return {...result,expiry};
  }
  return null;
}

function estimateAtWidth(strikes,byStrike,discount,spot,width) {
  const samples=[];
  const mid=q=>(q.bid+q.ask)/2;
  let right=1;
  for (const low of strikes) {
    while (right<strikes.length && strikes[right]-low<spot*width) right++;
    const high=strikes[right];
    if (high===undefined) break;
    if (high-low>spot*(width+.025)) continue;
    const distance=(high-low)*discount;
    const estimates=[];
    for (const type of ['call','put']) {
      const a=byStrike.get(type+':'+low), b=byStrike.get(type+':'+high);
      if (!a || !b) continue;
      const uncertainty=(a.ask-a.bid+b.ask-b.bid)/(2*distance);
      if (uncertainty>.20) continue;
      const change=(mid(b)-mid(a))/distance;
      const probability=(type==='call'?1:0)+change;
      if (probability<-.05 || probability>1.05) continue;
      estimates.push({probability:Math.max(0,Math.min(1,probability)),weight:1/Math.max(.025,uncertainty)**2,
        time:Math.min(Date.parse(a.time),Date.parse(b.time))});
    }
    if (!estimates.length) continue;
    const weight=estimates.reduce((total,x)=>total+x.weight,0);
    samples.push({strike:(low+high)/2,weight,time:Math.min(...estimates.map(x=>x.time)),
      probability:estimates.reduce((total,x)=>total+x.probability*x.weight,0)/weight});
  }
  if (samples.length<4) return null;
  const fitted=monotone(samples);
  const below=fitted.findLast(point=>point.probability<.5), above=fitted.find(point=>point.probability>.5);
  if (!below || !above || above.strike-below.strike>spot*.12 || above.probability-below.probability<.015) return null;
  const ties=fitted.filter(point=>Math.abs(point.probability-.5)<1e-10);
  const price=ties.length ? (ties[0].strike+ties.at(-1).strike)/2 :
    below.strike+(.5-below.probability)*(above.strike-below.strike)/(above.probability-below.probability);
  const quoteTime=Math.min(below.time,above.time,...ties.map(point=>point.time));
  return {price,quoteTime,spreadCount:samples.length,width};
}

export async function loadOptionsMedians({request,symbol,rate,signal}) {
  const listing=await request('expirations',{symbol},signal);
  const spot=listing.underlying?.value;
  if (!(spot>0)) return {levels:[],message:'No Alpaca underlying quote is available.'};
  const now=Date.now();
  const results=await Promise.all(medianHorizons.map(async horizon=>{
    const candidates=nearbyExpirations(listing.expirations??[],horizon.months,now).slice(0,3);
    if (!candidates.length) return {...horizon,error:'No listed expiration near this horizon'};
    for (const expiry of candidates) {
      try {
        const data=await request('chain',{symbol,expiry,center:spot,width:.30},signal);
        const result=estimateOptionsMedian(data.contracts??[],{spot,expiry,rate,now});
        if (result) return {...horizon,...result};
      } catch(error) {
        if (signal.aborted) throw error;
        return {...horizon,expiry,error:error.message,retryAfter:error.status===429?error.retryAfter:undefined};
      }
    }
    return {...horizon,expiry:candidates[0],error:'Nearby expirations lack a reliable 50/50 level'};
  }));
  return {levels:results,spot};
}
