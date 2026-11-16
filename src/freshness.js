// US cash-equity calendar for freshness labeling. This is an expected NY trading
// session, not proof that Alpaca has published the final settlement/daily bar.
const ymd=(y,m,d)=>new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10);
const observed=(y,m,d)=>{
  const at=new Date(Date.UTC(y,m-1,d)),weekday=at.getUTCDay();
  at.setUTCDate(at.getUTCDate()+(weekday===6?-1:weekday===0?1:0));
  return at.toISOString().slice(0,10);
};
const nthWeekday=(y,m,weekday,n)=>{
  const first=new Date(Date.UTC(y,m-1,1)).getUTCDay();
  return ymd(y,m,1+((weekday-first+7)%7)+7*(n-1));
};
const lastWeekday=(y,m,weekday)=>{
  const last=new Date(Date.UTC(y,m,0));
  return ymd(y,m,last.getUTCDate()-((last.getUTCDay()-weekday+7)%7));
};
// Anonymous Gregorian Easter algorithm, then exchange Good Friday holiday.
function goodFriday(y){
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,
    f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),
    h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,
    l=(32+2*e+2*i-h-k+7)%7,m=Math.floor((a+11*h+22*l)/451),
    month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;
  const friday=new Date(Date.UTC(y,month-1,day));friday.setUTCDate(friday.getUTCDate()-2);
  return friday.toISOString().slice(0,10);
}
export function nyseHolidayDates(year){
  const dates=[
    observed(year,1,1),nthWeekday(year,1,1,3),nthWeekday(year,2,1,3),
    goodFriday(year),lastWeekday(year,5,1),observed(year,6,19),
    observed(year,7,4),nthWeekday(year,9,1,1),nthWeekday(year,11,4,4),
    observed(year,12,25)
  ];
  // Dec 31 can be the observed New Year's holiday of January 1 NEXT year.
  const nextNewYear=observed(year+1,1,1);
  if(nextNewYear.startsWith(String(year)+'-'))dates.push(nextNewYear);
  return new Set(dates);
}
export function isNyseSessionDay(date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
  const parsed=new Date(date+'T00:00:00Z');
  if(!Number.isFinite(parsed.valueOf())||parsed.toISOString().slice(0,10)!==date)return false;
  const wd=parsed.getUTCDay();if(wd===0||wd===6)return false;
  return !nyseHolidayDates(parsed.getUTCFullYear()).has(date);
}
export function nyDateAndClock(now=new Date()){
  const date=now instanceof Date?now:new Date(now);
  if(!Number.isFinite(date.valueOf()))throw Error('Invalid clock time for freshness.');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(date).map(p=>[p.type,p.value]));
  return {date:parts.year+'-'+parts.month+'-'+parts.day,
    minute:Number(parts.hour)*60+Number(parts.minute)};
}
export function expectedNyseBarDate(now=new Date()){
  const {date,minute}=nyDateAndClock(now);
  const cursor=new Date(date+'T00:00:00Z');
  // Do not demand an unfinished daily bar during the cash session: allow
  // 30 minutes after the 16:00 ET close for daily-bar publication.
  if(minute<990)cursor.setUTCDate(cursor.getUTCDate()-1);
  for(let count=0;count<15;count++){
    const candidate=cursor.toISOString().slice(0,10);
    if(isNyseSessionDay(candidate))return candidate;
    cursor.setUTCDate(cursor.getUTCDate()-1);
  }
  throw Error('Could not determine the latest NYSE trading day.');
}
export function barDate(bar){
  if(!bar)return null;
  const time=bar.time??bar.t;
  if(typeof time==='number')return new Date(time*1000).toISOString().slice(0,10);
  if(typeof time==='string'&&/^\d{4}-\d{2}-\d{2}/.test(time))return time.slice(0,10);
  return null;
}
// The reference is observed market data, not a local-clock guess. Use the most
// common latest-bar date; if counts tie choose the newer date to avoid hiding lag.
// A clock-derived date is only a fallback when not a single symbol has bars.
export function modalLatestBarDate(dates,fallback=null){
  const counts=new Map();
  for(const date of Object.values(dates||{})){
    if(!date)continue;
    counts.set(date,(counts.get(date)||0)+1);
  }
  const ordered=[...counts].sort((a,b)=>b[1]-a[1]||b[0].localeCompare(a[0]));
  return ordered[0]?.[0]||fallback;
}
export function scanFreshness(items,clockFallback=expectedNyseBarDate()){
  const pairs=items instanceof Map?[...items.entries()]:Object.entries(items||{});
  const stale=[],dates={};
  for(const [symbol,bars] of pairs)
    dates[symbol]=barDate(Array.isArray(bars)?bars.at(-1):null);
  const expected=modalLatestBarDate(dates,clockFallback);
  for(const [symbol,latest] of Object.entries(dates)){
    if(!latest||latest<expected)stale.push({symbol,latest:latest||null});
  }
  stale.sort((a,b)=>a.symbol.localeCompare(b.symbol));
  return {expected,referenceMethod:expected===clockFallback&&!Object.values(dates).some(Boolean)?
      'clock fallback (no bars)':'modal latest-bar date',
    allFresh:stale.length===0,stale,dates,checked:pairs.length};
}
export function freshnessWithUniverse(items,symbols,clockFallback=expectedNyseBarDate()){
  const all=Object.fromEntries(symbols.map(symbol=>[symbol,items?.[symbol]||[]]));
  return scanFreshness(all,clockFallback);
}

// A failed asset status request is not evidence that a symbol has delisted.
export function explainStaleSymbol(entry,diagnostic){
  const date=entry?.latest||'the requested period';
  if(!diagnostic)return 'No Alpaca diagnosis available; latest bar '+date;
  if(diagnostic.asset?.found===false)return 'Alpaca asset not found (possible rename or delisting)';
  if(diagnostic.asset?.status==='inactive')return 'Alpaca asset is inactive';
  if(diagnostic.asset?.tradable===false)return 'Alpaca marks this asset non-tradable';
  if(diagnostic.retryFailed)return 'Alpaca retry failed; newer bars not verified';
  if(diagnostic.barsAfterLatest===true)return 'Alpaca returned a newer bar but it is still older than the required session';
  if(diagnostic.barsAfterLatest===false){
    const parsed=/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)?new Date(date+'T00:00:00Z'):null;
    const human=parsed&&Number.isFinite(parsed.valueOf())?
      new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}).format(parsed):date;
    return 'Alpaca returns no bars after '+human+' ('+date+') on this feed';
  }
  return diagnostic.asset?.error?'Asset status unavailable: '+diagnostic.asset.error:'Newer bars could not be verified';
}

/** Never claim Alpaca confirmed no newer bars unless the Worker returned evidence. */
export function staleReasonForSymbol(symbol,freshness,diagnostics={}){
  const entry=freshness?.stale?.find(row=>row.symbol===symbol);
  return entry?explainStaleSymbol(entry,diagnostics?.[symbol]):null;
}
