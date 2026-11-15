function parseCsv(text, fallback='IMPORT') {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell.trim());cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;}
  row.push(cell.trim());if(row.some(Boolean))rows.push(row);
  if(rows.length<2)throw Error('CSV must have a header and at least one price row');
  const keys=rows[0].map(s=>s.toLowerCase().replace(/[^a-z0-9]/g,''));
  const col=(...names)=>names.map(n=>keys.indexOf(n)).find(i=>i>=0)??-1;
  const ix={date:col('date','datetime','timestamp','time'),symbol:col('symbol','ticker'),open:col('open','o'),high:col('high','h'),low:col('low','l'),close:col('close','c','adjclose'),volume:col('volume','vol','v')};
  if(ix.date<0||ix.close<0)throw Error('CSV requires Date (or Time) and Close columns');
  const groups={};let skipped=0;let synthetic=0;
  for(const values of rows.slice(1)){
    const raw=values[ix.date]||'',dateOnly=/^\d{4}-\d\d-\d\d$/.test(raw);
    const date=new Date(dateOnly?raw+'T00:00:00Z':raw);
    if(!Number.isFinite(date.valueOf())){skipped++;continue;}
    const time=dateOnly?raw:Math.floor(date.valueOf()/1000);
    const close=Number(values[ix.close]);if(!Number.isFinite(close)||close<=0){skipped++;continue;}
    const present=ix.open>=0&&ix.high>=0&&ix.low>=0;
    const open=present?Number(values[ix.open]):close,high=present?Number(values[ix.high]):close,low=present?Number(values[ix.low]):close;
    if(![open,high,low].every(Number.isFinite)||low<=0||high<Math.max(open,close)||low>Math.min(open,close)){skipped++;continue;}
    const symbol=String(ix.symbol>=0?values[ix.symbol]:fallback).trim().toUpperCase().replace(/[^A-Z0-9.^_-]/g,'').slice(0,20);
    if(!symbol){skipped++;continue;}
    if(!present)synthetic++;
    (groups[symbol]??=[]).push({time,open,high,low,close,volume:Math.max(0,Number(ix.volume>=0?values[ix.volume]:0)||0),approximateOhlc:!present});
  }
  for(const [symbol,bars] of Object.entries(groups)) groups[symbol]=normalizeBars(bars);
  return {groups,skipped,synthetic,rows:rows.length-1};
}

function stamp(t){return typeof t==='number'?t:Math.floor(Date.parse(t+'T00:00:00Z')/1000);}

function normalizeBars(bars){
  const map=new Map();for(const b of bars){if(!b||!Number.isFinite(b.close)||b.close<=0||!Number.isFinite(stamp(b.time)))continue;map.set(stamp(b.time),b);}
  return [...map.values()].sort((a,b)=>stamp(a.time)-stamp(b.time));
}

function nyParts(t) {
  const d=new Date(stamp(t)*1000);
  const f=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const p=Object.fromEntries(f.formatToParts(d).map(x=>[x.type,x.value]));
  return {day:p.year+'-'+p.month+'-'+p.day,minute:Number(p.hour)*60+Number(p.minute)};
}

function aggregate(bars,tf) {
  if(tf==='RAW')return bars;
  const periods=new Map();
  for(const b of bars){
    const intraday=typeof b.time==='number'&&!Number.isInteger(b.time/86400);
    const day=intraday?nyParts(b.time).day:String(b.time).slice(0,10);
    let k=day, t=day;
    if(tf==='2H'){
      if(typeof b.time!=='number')continue;
      const n=nyParts(b.time);if(n.minute<570||n.minute>=960)continue;
      const bucket=Math.floor((n.minute-570)/120);
      k=n.day+'-'+bucket;t=b.time;
    }else if(tf==='W'){
      const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);k=t=d.toISOString().slice(0,10);
    }else if(tf==='M')k=t=day.slice(0,7)+'-01';
    const old=periods.get(k);
    if(!old)periods.set(k,{time:t,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume||0,approximateOhlc:!!b.approximateOhlc});
    else {old.high=Math.max(old.high,b.high);old.low=Math.min(old.low,b.low);old.close=b.close;old.volume+=(b.volume||0);old.approximateOhlc=old.approximateOhlc||!!b.approximateOhlc;}
  }
  return normalizeBars([...periods.values()]);
}

function sma(a,n){
  n=Math.max(2,Math.floor(n));let sum=0;let valid=0;const o=[];
  for(let i=0;i<a.length;i++){const v=a[i];if(Number.isFinite(v)){sum+=v;valid++;}if(i>=n&&Number.isFinite(a[i-n])){sum-=a[i-n];valid--;}o.push(i>=n-1&&valid===n?sum/n:null);}
  return o;
}

function ema(a,n){
  n=Math.max(2,Math.floor(n));const out=[];let seed=[],last=null;
  for(const v of a){if(!Number.isFinite(v)){out.push(null);seed=[];last=null;continue;}if(last===null){seed.push(v);if(seed.length===n){last=seed.reduce((x,y)=>x+y,0)/n;out.push(last);}else out.push(null);}else{last=(v-last)*(2/(n+1))+last;out.push(last);}}
  return out;
}

function rsi(a,n=14){
  n=Math.max(2,Math.floor(n));const o=Array(a.length).fill(null);if(a.length<=n)return o;
  let up=0,down=0;for(let i=1;i<=n;i++){const d=a[i]-a[i-1];up+=Math.max(0,d);down+=Math.max(0,-d);}
  up/=n;down/=n;const value=()=>down===0?(up===0?50:100):100-100/(1+up/down);o[n]=value();
  for(let i=n+1;i<a.length;i++){const d=a[i]-a[i-1];up=(up*(n-1)+Math.max(0,d))/n;down=(down*(n-1)+Math.max(0,-d))/n;o[i]=value();}return o;
}

function atr(bars,n=14){
  n=Math.max(2,Math.floor(n));const tr=bars.map((b,i)=>Math.max(b.high-b.low,i?Math.abs(b.high-bars[i-1].close):0,i?Math.abs(b.low-bars[i-1].close):0));
  const o=Array(bars.length).fill(null);if(tr.length<n)return o;
  let current=tr.slice(0,n).reduce((x,y)=>x+y,0)/n;o[n-1]=current;
  for(let i=n;i<tr.length;i++){current=(current*(n-1)+tr[i])/n;o[i]=current;}return o;
}

function indicators(bars,params={}){
  const c=bars.map(b=>b.close),period=Number(params.period||20);
  const fast=ema(c,Number(params.fast||20)),slow=ema(c,Number(params.slow||100));
  const m12=ema(c,12),m26=ema(c,26),macd=m12.map((v,i)=>v!=null&&m26[i]!=null?v-m26[i]:null),signal=ema(macd,9);
  return {c,ema20:ema(c,20),ema50:ema(c,50),ema200:ema(c,200),sma20:sma(c,20),rsi:rsi(c,Number(params.rsiPeriod||14)),atr:atr(bars),fast,slow,basis:sma(c,period),macd,signal};
}

function statsFor(bars) {
  if(!bars?.length)return {price:null,ema200:null,rsi:null,ret20:null,drawdown:null,atrPct:null,volume:null,bars:0};
  const c=bars.map(b=>b.close),i=c.length-1,last=c[i],e=ema(c,200)[i],rs=rsi(c,14)[i],a=atr(bars,14)[i];
  const peak=Math.max(...c.slice(Math.max(0,c.length-252))),prev=c[i-20];
  return {price:last,ema200:e,rsi:rs,ret20:prev?100*(last/prev-1):null,drawdown:100*(last/peak-1),atrPct:a?100*a/last:null,volume:bars[i].volume||0,bars:bars.length};
}

function valueFor(stats,metric) {
  if(metric==='price')return stats.price;
  if(metric==='rsi')return stats.rsi;
  if(metric==='emaDist')return stats.ema200!=null&&stats.price!=null?100*(stats.price/stats.ema200-1):null;
  if(metric==='ret20')return stats.ret20;
  if(metric==='drawdown')return stats.drawdown;
  if(metric==='atrPct')return stats.atrPct;
  if(metric==='volume')return stats.volume;
  return null;
}

function screenSymbol(allBars,rules) {
  const cache={};const get=tf=>cache[tf]??=statsFor(aggregate(allBars,tf));
  const fails=[];
  for(const rule of rules){
    if(rule.enabled===false)continue;
    const value=valueFor(get(rule.tf||'D'),rule.metric),threshold=Number(rule.value);
    const ok=value!==null&&Number.isFinite(value)&&Number.isFinite(threshold)&&({'>':value>threshold,'>=':value>=threshold,'<':value<threshold,'<=':value<=threshold,'=':value===threshold}[rule.op]??false);
    if(!ok)fails.push(value==null?'Insufficient '+(rule.tf||'D')+' data for '+rule.metric:rule.metric+' '+rule.op+' '+rule.value+' not met');
  }
  return {pass:fails.length===0,fails,stats:get('D')};
}

function signalSets(bars,o={}){
  const n=bars.length,buy=Array(n).fill(false),sell=Array(n).fill(false),c=bars.map(b=>b.close),name=o.strategy||'ema-cross';
  const fast=Math.max(2,Math.floor(Number(o.fast||20))),slow=Math.max(fast+1,Math.floor(Number(o.slow||100)));
  const f=ema(c,fast),s=ema(c,slow),r=rsi(c,Number(o.rsiPeriod||14));
  const low=Number(o.buyLevel??30),high=Number(o.sellLevel??65),period=Math.max(2,Math.floor(Number(o.period||20))),mult=Number(o.multiplier||2);
  const basis=sma(c,period);
  for(let i=1;i<n;i++){
    if(name==='ema-cross'&&f[i-1]!=null&&s[i-1]!=null&&f[i]!=null&&s[i]!=null){
      buy[i]=f[i-1]<=s[i-1]&&f[i]>s[i];sell[i]=f[i-1]>=s[i-1]&&f[i]<s[i];
    }else if(name==='rsi-revert'&&r[i]!=null&&r[i-1]!=null){
      buy[i]=r[i-1]>=low&&r[i]<low;sell[i]=r[i-1]<=high&&r[i]>high;
    }else if(name==='trend-rsi'&&r[i]!=null&&r[i-1]!=null&&s[i]!=null){
      buy[i]=c[i]>s[i]&&r[i-1]<low&&r[i]>=low;sell[i]=r[i-1]<=high&&r[i]>high||c[i]<s[i];
    }else if(name==='bollinger'&&i>=period&&basis[i]!=null){
      const window=c.slice(i-period+1,i+1),stdev=Math.sqrt(window.reduce((v,x)=>v+(x-basis[i])**2,0)/period);
      buy[i]=c[i]<basis[i]-mult*stdev;sell[i]=c[i]>basis[i];
    }else if(name==='breakout'&&i>=period){
      const prior=bars.slice(i-period,i);buy[i]=c[i]>Math.max(...prior.map(b=>b.high));sell[i]=c[i]<Math.min(...prior.map(b=>b.low));
    }
  }
  return {buy,sell};
}

function backtest(bars,opts={}){
  const valid=normalizeBars(bars||[]),start=Math.max(1,Math.floor(opts.startIndex||1)),end=Math.min(valid.length-1,opts.endIndex===undefined?valid.length-1:Math.floor(opts.endIndex));
  const initial=Math.max(1,Number(opts.capital||10000)),allocation=Math.max(.01,Math.min(100,Number(opts.allocation??100)))/100;
  const fee=Math.max(0,Number(opts.feeBps??1))/10000,slip=Math.max(0,Number(opts.slipBps??2))/10000,stop=Math.max(0,Number(opts.stopPct||0))/100,target=Math.max(0,Number(opts.targetPct||0))/100;
  const side=opts.side==='short'?'short':'long',annualPeriods=opts.timeframe==='W'?52:opts.timeframe==='M'?12:252,borrowRate=side==='short'?Math.max(0,Number(opts.borrowAnnualPct||0))/100/annualPeriods:0;
  if(valid.length<3||start>end)return {metrics:{trades:0,returnPct:0,maxDD:0,profitFactor:null,sharpe:null,winPct:null},curve:[],trades:[],notice:'Not enough price bars'};
  const signals=signalSets(valid,opts);let cash=initial,pos=null,peak=initial,maxDD=0,exposed=0;const curve=[],trades=[];
  function close(i,raw,reason){
    if(!pos)return;
    const price=raw*(side==='short'?1+slip:1-slip);
    const exitFee=pos.qty*price*fee;
    const pnl=side==='long'?pos.qty*price-exitFee-pos.cost:pos.qty*(pos.price-price)-pos.entryFee-exitFee-pos.borrow;
    if(side==='long')cash+=pos.qty*price-exitFee;
    else cash+=pos.reserved+pos.qty*(pos.price-price)-exitFee;
    trades.push({entry:valid[pos.index].time,exit:valid[i].time,buy:pos.price,sell:price,qty:pos.qty,pnl,pnlPct:100*pnl/pos.cost,reason,barsHeld:i-pos.index,side});
    pos=null;
  }
  for(let i=start;i<=end;i++){
    const b=valid[i];
    const shouldExit=side==='long'?signals.sell[i-1]:signals.buy[i-1];
    const shouldEnter=side==='long'?signals.buy[i-1]:signals.sell[i-1];
    if(pos&&shouldExit)close(i,b.open,'Signal');
    if(!pos&&shouldEnter&&cash>0){
      const price=b.open*(side==='short'?1-slip:1+slip),budget=cash*allocation;
      const qty=Math.min(budget,cash)/(price*(1+fee));
      if(qty>0){const entryFee=qty*price*fee,reserved=qty*price,cost=reserved+entryFee;cash-=cost;pos={qty,price,cost,index:i,reserved,entryFee,borrow:0};}
    }
    if(pos&&(stop||target)){
      const stopLevel=side==='short'?pos.price*(1+stop):pos.price*(1-stop);
      const targetLevel=side==='short'?pos.price*(1-target):pos.price*(1+target);
      // If both intrabar stop and target trigger, assume stop hits first.
      if(stop&&(side==='short'?b.high>=stopLevel:b.low<=stopLevel))close(i,side==='short'?Math.max(b.open,stopLevel):Math.min(b.open,stopLevel),'Stop');
      else if(target&&(side==='short'?b.low<=targetLevel:b.high>=targetLevel))close(i,side==='short'?Math.min(b.open,targetLevel):Math.max(b.open,targetLevel),'Target');
    }
    if(pos&&borrowRate){const interest=pos.qty*b.close*borrowRate;cash-=interest;pos.borrow+=interest;}
    if(pos)exposed++;
    let equity=cash+(pos?(side==='short'?pos.reserved+pos.qty*(pos.price-b.close):pos.qty*b.close):0);
    if(i===end&&pos){close(i,b.close,'End of data');equity=cash;}
    peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak?100*(peak-equity)/peak:0);
    curve.push({time:b.time,value:equity});
  }
  const gain=trades.filter(t=>t.pnl>0).reduce((x,t)=>x+t.pnl,0),loss=-trades.filter(t=>t.pnl<0).reduce((x,t)=>x+t.pnl,0);
  const returns=curve.slice(1).map((p,i)=>curve[i].value>0?p.value/curve[i].value-1:0);
  const mean=returns.reduce((a,b)=>a+b,0)/Math.max(1,returns.length),variance=returns.reduce((v,x)=>v+(x-mean)**2,0)/Math.max(1,returns.length-1);
  const sharpe=variance>0?mean/Math.sqrt(variance)*Math.sqrt(annualPeriods):null;
  const years=(stamp(valid[end].time)-stamp(valid[start].time))/(86400*365.25),final=curve.at(-1).value,total=final/initial-1;
  return {metrics:{startEquity:initial,endEquity:final,returnPct:total*100,cagrPct:years>0&&final>0?((final/initial)**(1/years)-1)*100:null,maxDD,trades:trades.length,winPct:trades.length?100*trades.filter(t=>t.pnl>0).length/trades.length:null,profitFactor:loss>0?gain/loss:null,sharpe,exposurePct:100*exposed/curve.length,buyHoldPct:100*(valid[end].close/valid[start].open-1)},curve,trades,notice:valid.some(b=>b.approximateOhlc)?'Close-only input: OHLC values were approximated; stop/target fills are not realistic.':null};
}
function parameterSweep(bars,options={}){
  const strategy=options.strategy||'ema-cross',sets=[];
  if(strategy==='ema-cross'){for(const fast of [8,15,25])for(const slow of [50,100,200])if(fast<slow)sets.push({fast,slow});}
  else if(strategy==='rsi-revert'||strategy==='trend-rsi'){for(const buyLevel of [20,30,40])for(const sellLevel of [50,60,70])sets.push({buyLevel,sellLevel});}
  else if(strategy==='bollinger'){for(const period of [10,20,30])for(const multiplier of [1.5,2,2.5])sets.push({period,multiplier});}
  else for(const period of [10,20,30,55,100])sets.push({period});
  const holdout=Math.max(2,Math.floor(bars.length*.7));
  return sets.map(param=>{const cfg={...options,...param};const train=backtest(bars,{...cfg,endIndex:holdout-1}),test=backtest(bars,{...cfg,startIndex:holdout});return {params:param,train:train.metrics,test:test.metrics};}).sort((a,b)=>(b.test.returnPct||0)-(a.test.returnPct||0));
}

function sampleData(){
  const labels=[['DEMO-SPY',0.00036,0.011,101],['DEMO-NVDA',0.00085,0.025,121],['DEMO-VXX',-0.0008,0.041,131],['DEMO-COIN',0.00065,0.033,141]],groups={};
  for(const [symbol,drift,vol,seed] of labels){
    let state=seed,close=100,day=new Date('2020-01-01T00:00:00Z'),bars=[];
    const rand=()=>{state=(state*16807)%2147483647;return state/2147483647;};
    for(let i=0;i<1800;){const wd=day.getUTCDay();if(wd>0&&wd<6){
      const move=drift+(rand()+rand()+rand()+rand()-2)*vol,open=Math.max(.5,close*(1+(rand()-.5)*vol*.5));
      close=Math.max(.5,open*(1+move));const high=Math.max(open,close)*(1+rand()*vol*.55),low=Math.min(open,close)*(1-rand()*vol*.55);
      bars.push({time:day.toISOString().slice(0,10),open,high,low,close,volume:Math.round(1e6*(.5+rand()))});i++;
    }day.setUTCDate(day.getUTCDate()+1);}
    groups[symbol]=bars;
  }
  return groups;
}

function csvDownload(rows){
  if(!rows.length)return '';const cols=Object.keys(rows[0]),q=v=>{let s=v==null?'':String(v);if(/^[=@+]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return [cols.join(','),...rows.map(row=>cols.map(k=>q(row[k])).join(','))].join('\r\n');
}

export { parseCsv, stamp, normalizeBars, nyParts, aggregate, sma, ema, rsi, atr, indicators, statsFor, valueFor, screenSymbol, signalSets, backtest, parameterSweep, sampleData, csvDownload };
