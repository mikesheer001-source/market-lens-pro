export const MAX_LEGS = 8;
const DAY = 86_400_000;
const YEAR = 365 * DAY;
const normal = x => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x < 0 ? tail : 1 - tail;
};

export const PRESETS = {
  'Long call': [['buy','call',0]],
  'Long put': [['buy','put',0]],
  'Bull call debit spread': [['buy','call',0],['sell','call',1]],
  'Bear put debit spread': [['buy','put',0],['sell','put',-1]],
  'Bull put credit spread': [['sell','put',0],['buy','put',-1]],
  'Bear call credit spread': [['sell','call',0],['buy','call',1]],
  'Long straddle': [['buy','call',0],['buy','put',0]],
  'Long strangle': [['buy','call',1],['buy','put',-1]],
  'Long call butterfly': [['buy','call',-1],['sell','call',0,2],['buy','call',1]],
  'Iron condor': [['buy','put',-2],['sell','put',-1],['sell','call',1],['buy','call',2]],
  'Long call calendar': [['sell','call',0],['buy','call',0,1,1]],
  'Long call diagonal': [['sell','call',1],['buy','call',0,1,1]],
  'Long box': [['buy','call',-1],['sell','call',1],['buy','put',1],['sell','put',-1]],
  'Short box': [['sell','call',-1],['buy','call',1],['sell','put',1],['buy','put',-1]]
};

export const intrinsic = (leg, spot) => Math.max(0, (spot - leg.strike) * (leg.type === 'call' ? 1 : -1));
const units = leg => (leg.side === 'buy' ? 1 : -1) * leg.quantity * (leg.multiplier ?? 100);
export const initialDebit = (legs, fee = 0) => legs.reduce((total, leg) =>
  total + units(leg) * leg.entry + fee * leg.quantity, 0);
export const expiryPnl = (legs, spot, debit) => legs.reduce((pnl, leg) =>
  pnl + units(leg) * intrinsic(leg, spot), -debit);

export function expirationTime(leg) {
  // All supported contracts use New York time. Standard SPX is AM settled.
  const utc = Date.parse(leg.expiry + 'T12:00:00Z');
  if (!Number.isFinite(utc)) return NaN;
  const hours = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone:'America/New_York', hour:'2-digit', hourCycle:'h23'
  }).format(utc));
  return utc + ((leg.root === 'SPX' ? 9.5 : 16) - hours) * 3_600_000;
}

export function modelPrice(leg, spot, years, iv, rate, dividend) {
  if (years <= 0) return intrinsic(leg, spot);
  const discountedStrike = leg.strike * Math.exp(-rate * years);
  const discountedSpot = spot * Math.exp(-dividend * years);
  if (spot <= 0) return leg.type === 'put' ? discountedStrike : 0;
  const vol = iv * Math.sqrt(years);
  if (vol <= 0) return intrinsic({...leg, strike:discountedStrike}, discountedSpot);
  const d1 = (Math.log(spot / leg.strike) + (rate - dividend + iv * iv / 2) * years) / vol;
  const d2 = d1 - vol;
  return leg.type === 'call' ? discountedSpot * normal(d1) - discountedStrike * normal(d2) :
    discountedStrike * normal(-d2) - discountedSpot * normal(-d1);
}

export function scenarioPnl(legs, spot, at, debit, {iv, shift, rate, dividend}) {
  return legs.reduce((pnl, leg) => pnl + units(leg) * modelPrice(leg, spot,
    (leg.expiresAt - at) / YEAR, Math.max(0.0001, (leg.quote?.iv ?? iv) + shift), rate, dividend), -debit);
}

export function expiryStats(legs, debit) {
  const strikes = [0, ...new Set(legs.map(leg => leg.strike))].sort((a,b) => a-b);
  const values = strikes.map(spot => expiryPnl(legs, spot, debit));
  const tail = legs.reduce((slope,leg) => slope + (leg.type === 'call' ? units(leg) : 0), 0);
  const roots = [];
  const flat = [];
  const zero = value => Math.abs(value) < 1e-7;
  for (let i = 0; i < strikes.length - 1; i++) {
    const [left,right] = [values[i],values[i+1]];
    if (zero(left) && zero(right)) flat.push([strikes[i],strikes[i+1]]);
    else if (!zero(left) && !zero(right) && Math.sign(left) !== Math.sign(right))
      roots.push(strikes[i] + (strikes[i+1] - strikes[i]) * -left / (right - left));
  }
  const final = values.at(-1);
  if (tail && !zero(final) && -final / tail > 0) roots.push(strikes.at(-1) - final / tail);
  if (!tail && zero(final)) flat.push([strikes.at(-1), Infinity]);
  strikes.forEach((strike,i) => {
    if (zero(values[i]) && !flat.some(([a,b]) => strike >= a && strike <= b)) roots.push(strike);
  });
  return {high:tail > 0 ? Infinity : Math.max(...values), low:tail < 0 ? -Infinity : Math.min(...values),
    roots:roots.sort((a,b) => a-b), flat};
}

export function quoteEstimates(legs, fee) {
  if (!legs.length || legs.some(({quote:q}) => !q || !(q.ask > 0) ||
    q.bid == null || q.bid < 0 || q.ask < q.bid)) return null;
  return {
    mid:initialDebit(legs.map(leg => ({...leg,entry:(leg.quote.bid + leg.quote.ask)/2})),fee),
    natural:initialDebit(legs.map(leg => ({...leg,entry:leg.side === 'buy' ? leg.quote.ask : leg.quote.bid})),fee)
  };
}

export function boxRate(legs, debit, now, expiry) {
  if (legs.length !== 4 || !legs.every(leg => ['SPX','SPXW','XSP'].includes(leg.root) &&
    leg.root === legs[0].root && leg.expiresAt === expiry)) return null;
  const sorted = [...new Set(legs.map(leg => leg.strike))].sort((a,b) => a-b);
  const quantity = legs[0].quantity;
  if (sorted.length !== 2 || !legs.every(leg => leg.quantity === quantity && leg.multiplier === 100)) return null;
  const keys = legs.map(leg => leg.side + leg.type + sorted.indexOf(leg.strike)).sort().join('|');
  const payoutSign = keys === 'buycall0|buyput1|sellcall1|sellput0' ? 1 :
    keys === 'buycall1|buyput0|sellcall0|sellput1' ? -1 : 0;
  const payout = payoutSign * (sorted[1] - sorted[0]) * quantity * 100;
  const days = (expiry - now) / DAY;
  if (!payout) return null;
  const ratio = payout / debit;
  return {payout, days, annualized:days > 0 && ratio > 0 ? (ratio - 1) * 365 / days : null};
}
