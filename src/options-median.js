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

function eligibleQuotes(contracts, now, maxSpread) {
  const quotes = contracts.filter(({strike,type,quote}) => {
    const age = now-Date.parse(quote?.time);
    return Number.isFinite(strike) && strike>0 && ['call','put'].includes(type) &&
      Number.isFinite(age) && age >= -60_000 && age <= 7*dayMs && Number.isFinite(quote.bid) &&
      Number.isFinite(quote.ask) && quote.bid>0 && quote.ask>=quote.bid && quote.ask-quote.bid <= maxSpread*(quote.ask+quote.bid)/2;
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

// First retain the original strict filters; then widen verticals and allow
// less liquid quotes only if their bid/ask sensitivity still bounds a crossing.
const strict={confidence:'standard',maxSpread:.30,maxUncertainty:.20,widths:[.018,.035,.05,.065,.08],maxGap:.12};
const relaxed={confidence:'lower',maxSpread:.65,maxUncertainty:.30,widths:[.035,.05,.065,.08,.10,.12,.16,.20],maxGap:.20};

function evaluateMedian(contracts, {spot,expiry,rate=.04,now=Date.now()}, policy) {
  const years=(Date.parse(expiry+'T20:00:00Z')-now)/(365*dayMs);
  if (!(spot>0 && years>0 && Number.isFinite(rate))) return {error:'Invalid underlying price, expiry or rate'};
  if (!contracts.length) return {error:'No contracts returned for this strike range'};
  const valid=eligibleQuotes(contracts,now,Infinity);
  if (!valid.length) return {error:'No fresh, valid two-sided quotes with a positive bid (maximum age 7 days)'};
  const eligible=eligibleQuotes(contracts,now,policy.maxSpread);
  if (!eligible.length) return {error:'No quotes pass the spread and timestamp filters'};
  const byRoot=new Map();
  for (const row of eligible) {
    if (!byRoot.has(row.root)) byRoot.set(row.root,[]);
    byRoot.get(row.root).push(row);
  }
  const discount=Math.exp(-rate*years);
  let maxSamples=0;
  for (const rows of [...byRoot.values()].sort((a,b)=>b.length-a.length)) {
    const strikes=[...new Set(rows.map(row=>row.strike))].sort((a,b)=>a-b);
    const byStrike=new Map(rows.map(row=>[row.type+':'+row.strike,row.quote]));
    for (const width of policy.widths) {
      const result=estimateAtWidth(strikes,byStrike,discount,spot,width,policy);
      maxSamples=Math.max(maxSamples,result.sampleCount);
      if (result.price!=null) return {...result,expiry,confidence:policy.confidence};
    }
  }
  return {error:maxSamples<4
    ? 'Only '+maxSamples+' usable vertical spreads; at least 4 required ('+eligible.length+' eligible quotes of '+contracts.length+' contracts)'
    : policy.confidence==='lower'
      ? 'Quotes do not bound a reliable 50% crossing within the allowed strike and bid/ask sensitivity limits'
      : 'Usable quotes do not bracket a reliable 50% crossing'};
}

export function estimateOptionsMedian(contracts, params) {
  const result=evaluateMedian(contracts,params,strict);
  return result.price!=null ? result : null;
}

export function estimateOptionsMedianRelaxed(contracts, params) {
  const result=evaluateMedian(contracts,params,relaxed);
  return result.price!=null ? result : null;
}

function estimateAtWidth(strikes,byStrike,discount,spot,width,policy) {
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
      if (uncertainty>policy.maxUncertainty) continue;
      const change=(mid(b)-mid(a))/distance;
      const probability=(type==='call'?1:0)+change;
      if (probability<-.05 || probability>1.05) continue;
      estimates.push({probability:Math.max(0,Math.min(1,probability)),weight:1/Math.max(.025,uncertainty)**2,uncertainty,
        time:Math.min(Date.parse(a.time),Date.parse(b.time))});
    }
    if (!estimates.length) continue;
    const weight=estimates.reduce((total,x)=>total+x.weight,0);
    samples.push({strike:(low+high)/2,weight,time:Math.min(...estimates.map(x=>x.time)),
      uncertainty:Math.max(...estimates.map(x=>x.uncertainty)),
      probability:estimates.reduce((total,x)=>total+x.probability*x.weight,0)/weight});
  }
  if (samples.length<4) return {sampleCount:samples.length};
  const fitted=monotone(samples);
  const below=fitted.findLast(point=>point.probability<.5), above=fitted.find(point=>point.probability>.5);
  if (!below || !above || above.strike-below.strike>spot*policy.maxGap || above.probability-below.probability<.015) return {sampleCount:samples.length};
  const ties=fitted.filter(point=>Math.abs(point.probability-.5)<1e-10);
  const price=ties.length ? (ties[0].strike+ties.at(-1).strike)/2 :
    below.strike+(.5-below.probability)*(above.strike-below.strike)/(above.probability-below.probability);
  const quoteTime=Math.min(below.time,above.time,...ties.map(point=>point.time));
  let sensitivity;
  if (policy.confidence==='lower') {
    // Use actual (unpooled) quote slopes, not merely the smoothed midpoint,
    // to check that the available bid/ask ranges support a bounded crossing.
    const lo=samples.findLast(p=>p.strike<price && p.probability+p.uncertainty<.5);
    const hi=samples.find(p=>p.strike>price && p.probability-p.uncertainty>.5);
    if (!lo || !hi || hi.strike-lo.strike>spot*.35) return {sampleCount:samples.length};
    sensitivity=[lo.strike,hi.strike];
  }
  return {price,quoteTime,spreadCount:samples.length,sampleCount:samples.length,width,sensitivity};
}

export async function loadOptionsMedians({request,symbol,rate,signal,now=Date.now()}) {
  const listing=await request('expirations',{symbol},signal);
  const spot=listing.underlying?.value;
  if (!(spot>0)) return {levels:[],message:'No Alpaca underlying quote is available.'};
  const results=await Promise.all(medianHorizons.map(async horizon=>{
    const candidates=nearbyExpirations(listing.expirations??[],horizon.months,now).slice(0,3);
    if (!candidates.length) return {...horizon,error:'No listed expiration within 45 days of this horizon'};
    const failures=[];
    let lower=null;
    for (const expiry of candidates) {
      let narrow=null;
      const params={spot,expiry,rate,now};
      for (const range of [.30,.80]) {
        try {
          const data=await request('chain',{symbol,expiry,center:spot,width:range},signal);
          const contracts=data.contracts??[];
          const standard=evaluateMedian(contracts,params,strict);
          if (standard.price!=null) return {...horizon,...standard,range};
          const fallback=evaluateMedian(contracts,params,relaxed);
          if (fallback.price!=null) {
            const candidate={...horizon,...fallback,range};
            if (range===.30) narrow=candidate;
            else if (!lower) lower=candidate;
          } else failures.push(expiry+' ±'+Math.round(range*100)+'%: '+fallback.error);
        } catch(error) {
          if (signal?.aborted) throw error;
          if ([401,403,429].includes(error.status))
            return {...(lower??narrow??horizon),...(!(lower??narrow)?{expiry,error:error.message}:{}),retryAfter:error.status===429?error.retryAfter:undefined};
          failures.push(expiry+' ±'+Math.round(range*100)+'%: '+error.message);
        }
      }
      if (!lower && narrow) lower=narrow;
      // A defensible estimate near the requested horizon is preferable to
      // unnecessary API requests for more distant expirations.
      if (lower) return lower;
    }
    return {...horizon,expiry:candidates[0],error:failures.join(' | ')||'Nearby expirations lack a reliable 50/50 level'};
  }));
  return {levels:results,spot};
}
