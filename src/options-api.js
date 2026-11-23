import {DEFAULT_ALPACA_WORKER} from './live-history.js';

export const OPTIONS_DEVICE_KEY = 'market-lens-options-device-v1';
export function getOptionsDevice(key=OPTIONS_DEVICE_KEY) {
  try {
    const value=localStorage.getItem(key);
    return /^[a-f0-9]{64}$/.test(value??'') ? value : '';
  } catch { return ''; }
}

export function optionsApiUrl(path,worker) {
  const base=['localhost','127.0.0.1'].includes(location.hostname) ? worker : DEFAULT_ALPACA_WORKER;
  return new URL('/api/options/'+path,base||DEFAULT_ALPACA_WORKER);
}

export async function requestOptions(path,params,signal,{worker,token,feed='indicative'}) {
  const url=optionsApiUrl(path,worker);
  url.search=new URLSearchParams({feed,...params}).toString();
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal,cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if (!response.ok) throw Object.assign(new Error(data.error||'Quote request failed (HTTP '+response.status+').'),{
    status:response.status,retryAfter:Number(response.headers.get('Retry-After'))||60
  });
  if (data.feed!==feed) throw new Error('The quote source changed. Reconnect to refresh.');
  return data;
}
