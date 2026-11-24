export function strikeDomain(spot, strikes, chain) {
  const center = spot > 0 && spot <= 1e6 ? spot :
    strikes.length ? strikes.reduce((total,strike) => total+strike,0)/strikes.length : null;
  if (!center) return null;
  const padding = center * (chain.length ? 0.06 : 0.15);
  const values = [...strikes, ...chain.map(row => row.strike)];
  const low = Math.max(0.01, Math.min(center - padding, ...values));
  const high = Math.max(center + padding, ...values);
  return {low, high};
}

export function strikeTargets(leg, contracts, {low, high}) {
  if (leg.symbol) {
    return contracts.filter(row => row.root === leg.root && row.type === leg.type && row.expiry === leg.expiry)
      .sort((a,b) => a.strike - b.strike);
  }
  const approximate = (high - low) / 60;
  const magnitude = 10 ** Math.floor(Math.log10(approximate));
  const step = Math.max(0.01, magnitude * ([1,2,5,10].find(n => n * magnitude >= approximate) ?? 10));
  const first = Math.ceil(low / step);
  const last = Math.floor(high / step);
  return Array.from({length:Math.max(0,last-first+1)}, (_,i) => ({
    strike:Number(((first+i)*step).toFixed(2))
  }));
}

export function nearestStrike(targets, price) {
  return targets.reduce((best, row) => !best || Math.abs(row.strike-price) < Math.abs(best.strike-price) ? row : best, null);
}

// A group move is atomic: every listed leg must have the same strike delta
// available in its own expiry/type/root. Never independently round spread legs.
export function groupStrikeTargets(legs, contractsFor, domain, anchor) {
  if (!legs.length || !Number.isFinite(anchor) || legs.some(leg=>!(Number(leg.strike)>0))) return [];
  const cents = n=>Math.round(n*100);
  const listed = legs.findIndex(leg=>leg.symbol);
  const reference = listed>=0?listed:0;
  const choices = strikeTargets(legs[reference],contractsFor(legs[reference]),domain);
  const shifts = [...new Set([0,...choices.map(row=>cents(row.strike)-cents(legs[reference].strike))])];
  const targets=[];
  for(const delta of shifts){
    const strike= (cents(anchor)+delta)/100;
    if(strike<domain.low || strike>domain.high)continue;
    const rows=legs.map(leg=>{
      const value=(cents(leg.strike)+delta)/100;
      if(value<0.01||value>1e6)return null;
      if(!delta)return {strike:Number(leg.strike)};
      return leg.symbol?contractsFor(leg).find(row=>row.root===leg.root&&row.type===leg.type&&row.expiry===leg.expiry&&cents(row.strike)===cents(value))||null:{strike:value};
    });
    if(rows.every(Boolean))targets.push({strike,delta:delta/100,rows});
  }
  return targets.sort((a,b)=>a.strike-b.strike);
}
