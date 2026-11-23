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
