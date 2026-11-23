import {appendFile} from 'node:fs/promises';
import {optionsRequest} from './options.js';

const env = process.env;
const lines = [];
const base = new URL('https://localhost/api/options/expirations?symbol=SPY&feed=indicative');
try {
  const {expirations,underlying} = await optionsRequest(base,env);
  if (!underlying?.value || !expirations.length) throw new Error('SPY reference price or expiration unavailable');
  // Skip 0DTE so the probe also works after the exchange closes.
  const expiry = expirations.find(date => date > new Date().toISOString().slice(0,10)) ?? expirations[0];
  for (const feed of ['opra','indicative']) {
    const url = new URL('https://localhost/api/options/chain');
    url.search = new URLSearchParams({symbol:'SPY',feed,expiry,center:underlying.value,width:0.02});
    try {
      const {contracts} = await optionsRequest(url,env);
      const quoted = contracts.filter(({quote:q}) => q?.ask > 0 && q.bid != null && q.bid >= 0 && Number.isFinite(Date.parse(q.time)));
      const sample = quoted[0];
      const snapshot = sample && await optionsRequest(new URL('https://localhost/api/options/snapshots?'+
        new URLSearchParams({feed,symbols:sample.symbol})),env);
      const singleVerified = Boolean(sample && Number.isFinite(Date.parse(snapshot.quotes[sample.symbol]?.time)));
      lines.push(feed.toUpperCase()+' '+(sample ? 'available' : 'returned no timestamped quotes')+
        ' ('+quoted.length+' of '+contracts.length+' chain contracts quoted; '+
        quoted.filter(({quote}) => quote.iv != null && quote.greeks.delta != null).length+' with IV and delta; single-contract snapshot '+(singleVerified?'verified':'unverified')+').');
    } catch (error) {
      lines.push(feed.toUpperCase()+' '+(error.status === 403 ? 'denied by Alpaca (HTTP 403).' :
        'could not be verified'+(error.status ? ' (HTTP '+error.status+').' : '.')));
    }
  }
} catch (error) {
  lines.push('Options entitlement could not be verified: '+error.message+'.');
}
const report = lines.join('\n');
console.log(report);
if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY,'### Alpaca options entitlement\n\n'+lines.map(line=>'- '+line).join('\n')+'\n');
