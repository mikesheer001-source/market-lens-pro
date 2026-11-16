// Single-symbol strategy comparison, equity overlay and bounded browser memory.
// No look-ahead or different fills: every strategy uses the existing backtest() engine.
export const PRESET_STRATEGIES=Object.freeze([
  {id:'ema-cross',name:'EMA crossover'},
  {id:'rsi-revert',name:'RSI mean reversion'},
  {id:'trend-rsi',name:'Trend + RSI pullback'},
  {id:'bollinger',name:'Bollinger mean reversion'},
  {id:'breakout',name:'Price breakout'}
]);
export const LEADERBOARD_METRICS=Object.freeze(['name','returnPct','cagrPct','sharpe','maxDD','winPct','trades','profitFactor']);
export const SYMBOL_MEMORY_LIMIT=10;
export const SYMBOL_MEMORY_CHARS=2900000;
const finite=Number.isFinite;
const instant=t=>typeof t==='number'?t:Date.parse(String(t).includes('T')?String(t):String(t)+'T00:00:00Z')/1000;
export function sortLeaderboard(rows,key='sharpe',descending=key!=='name'){
  if(!LEADERBOARD_METRICS.includes(key))throw Error('Unknown leaderboard column: '+key);
  return [...rows].sort((a,b)=>{
    const x=key==='name'?a.name:a.metrics?.[key],y=key==='name'?b.name:b.metrics?.[key];
    const absent=v=>v===null||v===undefined||(typeof v==='number'&&Number.isNaN(v));
    if(absent(x)!==absent(y))return absent(x)?1:-1;
    if(!absent(x)){
      const compare=key==='name'?String(x).localeCompare(String(y)):x-y;
      if(compare)return compare*(descending?-1:1);
    }
    return String(a.id).localeCompare(String(b.id));
  });
}
export function leaderboardBest(rows){
  return sortLeaderboard(rows,'sharpe',true)[0]||null;
}
export function buildEquityOverlay(leaderboard,bars){
  if(!leaderboard?.rows?.length)return {series:[],benchmark:[],labels:[]};
  const ranked=sortLeaderboard(leaderboard.rows,'sharpe',true);
  const top=ranked.filter(entry=>entry.curve?.length).slice(0,3);
  const curves=top.map((entry,index)=>({
    id:entry.id,name:entry.name,rank:index+1,
    points:entry.curve.map(p=>({time:p.time,value:p.value}))
  }));
  const sample=top[0]?.curve||[];
  if(!sample.length)return {series:curves,benchmark:[],labels:curves.map(x=>x.name)};
  const prices=new Map(bars.map(b=>[instant(b.time),b]));
  const first=prices.get(instant(sample[0].time));
  if(!first)throw Error('Cannot overlay benchmark without the original price dates.');
  const capital=Number(leaderboard.capital);
  const benchmark=sample.map(p=>{
    const observed=prices.get(instant(p.time));
    if(!observed)throw Error('Benchmark missing a bar for '+String(p.time));
    return {time:p.time,value:capital*observed.close/first.open};
  });
  return {series:curves,benchmark,labels:[...curves.map(x=>x.name),'Buy & hold']};
}
export function compareStrategies({symbol,bars,options,source,backtest,compilePine,executePine,savedScripts=[],builtInExamples=[]}){
  if(typeof symbol!=='string'||!symbol.trim())throw Error('Choose a symbol.');
  if(!Array.isArray(bars)||bars.length<40)throw Error('At least 40 real or labeled Demo price bars are required.');
  const timeframe=options.timeframe||'D',base={...options,timeframe};
  const rows=[],skipped=[],seen=new Set();
  for(const preset of PRESET_STRATEGIES){
    const result=backtest(bars,{...base,strategy:preset.id});
    rows.push({id:'preset:'+preset.id,kind:'preset',name:preset.name,
      strategy:preset.id,settings:null,script:null,metrics:result.metrics,curve:result.curve,trades:result.trades});
  }
  for(const saved of savedScripts){
    if(!saved||typeof saved.code!=='string'||typeof saved.name!=='string')continue;
    const id=String(saved.id||saved.name);
    if(seen.has(id))continue;seen.add(id);
    try{
      const program=compilePine(saved.code);
      if(program.mode!=='strategy'){skipped.push({name:saved.name,reason:'Indicator only; no strategy.entry orders.'});continue;}
      const settings={...(saved.settings||{})};
      const signals=executePine(program,bars,settings).signals;
      const result=backtest(bars,{...base,strategy:'pine-custom',customSignals:signals});
      rows.push({id:'pine:'+id,kind:'pine',name:saved.name,strategy:'pine-custom',
        settings,script:{id,name:saved.name,code:saved.code,settings},
        metrics:result.metrics,curve:result.curve,trades:result.trades});
    }catch(error){
      skipped.push({name:saved.name,reason:String(error.message||error)});
    }
  }
  for(const example of builtInExamples){
    if(!example||typeof example.id!=='string'||typeof example.code!=='string')continue;
    const name=(example.label||example.id)+' · built-in example';
    try{
      const program=compilePine(example.code);
      if(program.mode!=='strategy'){
        // Indicator examples are visible and explicitly not rankable as trading
        // strategies; do not manufacture entries or a zero-return "backtest".
        rows.push({id:'example:'+example.id,kind:'example-indicator',name,
          strategy:null,settings:null,script:null,metrics:{returnPct:null,cagrPct:null,
            sharpe:null,maxDD:null,winPct:null,trades:null,profitFactor:null},
          curve:[],trades:[],notice:'Indicator only — no entries or exits'});
        continue;
      }
      const settings={};
      const signals=executePine(program,bars,settings).signals;
      const result=backtest(bars,{...base,strategy:'pine-custom',customSignals:signals});
      rows.push({id:'example:'+example.id,kind:'example',name,strategy:'pine-custom',
        settings,script:{id:example.id,name,code:example.code,settings,origin:'built-in'},
        metrics:result.metrics,curve:result.curve,trades:result.trades});
    }catch(error){
      skipped.push({name,reason:String(error.message||error)});
      rows.push({id:'example:'+example.id,kind:'example-indicator',
        name:name+' · cannot execute',strategy:null,script:null,settings:null,
        metrics:{returnPct:null,cagrPct:null,sharpe:null,maxDD:null,winPct:null,
          trades:null,profitFactor:null},curve:[],trades:[],notice:String(error.message||error)});
    }
  }
  const sorted=sortLeaderboard(rows),best=leaderboardBest(rows);
  const run={version:1,symbol,timeframe,source:source||'UNKNOWN',
    asOf:bars.at(-1)?.time||null,runAt:new Date().toISOString(),capital:Number(base.capital||10000),
    compared:sorted.length,savedPineStrategies:sorted.filter(x=>x.kind==='pine').length,
    builtInExamples:sorted.filter(x=>x.id.startsWith('example:')).length,
    executableExamples:sorted.filter(x=>x.kind==='example').length,
    settings:{...base},rows:sorted,bestId:best?.id||null,skipped};
  run.overlay=buildEquityOverlay(run,bars);
  return run;
}
// Persist rank metrics and the overlay for every strategy. Keep the best strategy's
// full trades/curve so Load Best works offline, but do not duplicate dozens of
// unused curve histories for the other saved Pine scripts in localStorage.
export function compactLeaderboard(report){
  if(!report?.rows)return report;
  return {...report,rows:report.rows.map(row=>row.id===report.bestId?row:{
    ...row,curve:[],trades:[]
  })};
}
export function updateSymbolMemory(memory,symbol,change,now=Date.now()){
  if(!symbol||typeof symbol!=='string')throw Error('Cannot save analysis without a symbol.');
  const original=memory&&typeof memory==='object'&&!Array.isArray(memory)?memory:{};
  const existing=original[symbol]&&typeof original[symbol]==='object'?original[symbol]:{};
  const next={...original,[symbol]:{...existing,...change,lastUpdated:Number(now)}};
  return pruneSymbolMemory(next);
}
export function pruneSymbolMemory(memory,maxEntries=SYMBOL_MEMORY_LIMIT,maxChars=SYMBOL_MEMORY_CHARS){
  if(!memory||typeof memory!=='object'||Array.isArray(memory))return {};
  const ranked=Object.entries(memory).filter(([symbol,item])=>symbol&&item&&typeof item==='object')
    .sort((a,b)=>(Number(b[1].lastUpdated)||0)-(Number(a[1].lastUpdated)||0)||a[0].localeCompare(b[0]));
  const output={};
  for(const [symbol,item] of ranked.slice(0,Math.max(0,maxEntries))){
    output[symbol]=item;
    if(JSON.stringify(output).length>maxChars){delete output[symbol];continue;}
  }
  return output;
}
export function symbolMemoryItem(memory,symbol){
  const item=memory?.[symbol];
  return item&&typeof item==='object'?item:null;
}
