import './styles.css';
import { LIVE_UNIVERSE, DEMO_UNIVERSE, VOLATILITY_UNIVERSE, LIVE_EQUITY_COUNT, LIVE_ETF_COUNT, LIVE_VOLATILITY_COUNT, ALPACA_BATCH_SIZE } from './universe.js';
async function initApp(){
  const {
    parseCsv,normalizeBars,alpacaBars,aggregate,ema,sma,rsi,indicators,statsFor,screenSymbol,backtest,parameterSweep,sampleData,csvDownload,stamp
  }=await import('./engine.js');
  const {
    createChart,CandlestickSeries,BarSeries,LineSeries,AreaSeries,HistogramSeries,PriceScaleMode,createSeriesMarkers
  }=await import('lightweight-charts');
  const $=(q)=>document.querySelector(q),esc=(s)=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const format=(n,d=2)=>n==null||!Number.isFinite(n)?'—':Number(n).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d});
  const pct=n=>n==null||!Number.isFinite(n)?'—':(n>0?'+':'')+format(n)+'%';
  const priceColor=n=>n==null?'muted':n>=0?'positive':'negative';
  const dateLabel=t=>typeof t==='number'?new Date(t*1000).toISOString().slice(0,16).replace('T',' '):String(t);
  const tabNames={screener:'Screener',charts:'Chart Lab',backtest:'Backtest',optimize:'Optimize',data:'Data Center'};
  const tabIcons={screener:'▦',charts:'⌁',backtest:'▥',optimize:'◇',data:'▣'};
  const preset={
    trend:[{metric:'emaDist',tf:'D',op:'>',value:0},{metric:'rsi',tf:'D',op:'<',value:60}],
    original:[{metric:'emaDist',tf:'W',op:'>',value:0},{metric:'rsi',tf:'W',op:'<',value:50},{metric:'rsi',tf:'D',op:'<',value:50},{metric:'rsi',tf:'2H',op:'<',value:50}],
    oversold:[{metric:'rsi',tf:'D',op:'<',value:35}],
    momentum:[{metric:'ret20',tf:'D',op:'>',value:10},{metric:'emaDist',tf:'D',op:'>',value:0}],
    volatility:[{metric:'rsi',tf:'D',op:'<',value:60},{metric:'drawdown',tf:'D',op:'<',value:-5},{metric:'emaDist',tf:'D',op:'<',value:0}],
    all:[]
  };
  const defaultSettings={tf:'D',style:'candles',log:false,ema20:true,ema50:false,ema200:true,sma20:false,bollinger:false,volume:true,rsi:true,macd:false,rsiPeriod:14,bollPeriod:20,ema20Len:20,ema50Len:50,ema200Len:200,sma20Len:20,lines:{}};
  const defaultBacktest={strategy:'ema-cross',side:'long',borrowAnnualPct:0,fast:20,slow:100,rsiPeriod:14,buyLevel:30,sellLevel:65,period:20,multiplier:2,capital:10000,allocation:100,feeBps:1,slipBps:2,stopPct:0,targetPct:0};
  let saved={};try{saved=JSON.parse(localStorage.getItem('market-lens-pro-settings')||'{}')||{};}catch{}
  const S={tab:'screener',mode:'demo',apiBaseUrl:String(saved.apiBaseUrl||''),liveFeed:'iex',lastDemoSymbol:'DEMO-SPY',universeFilter:saved.universeFilter||'all',scan:{status:'idle'},data:new Map(Object.entries(sampleData())),sources:new Map(),symbol:'DEMO-SPY',query:'',watch:new Set(saved.watch||[]),rules:saved.rules||preset.trend.map(x=>({...x})),sort:'symbol',ascending:true,showOnlyMatches:false,showWatch:false,chart:(()=>{const restored={...defaultSettings,...saved.chart};if(!saved.chart?.style||saved.chart.style==='line')restored.style='candles';return restored;})(),bt:{...defaultBacktest,...saved.bt},result:null,sweep:null,drawLine:false};
  for(const symbol of S.data.keys())S.sources.set(symbol,'SIMULATED');
  let chart=null,equityChart=null;
  const saveSettings=()=>{try{localStorage.setItem('market-lens-pro-settings',JSON.stringify({watch:[...S.watch],rules:S.rules,chart:S.chart,bt:S.bt,apiBaseUrl:S.apiBaseUrl,universeFilter:S.universeFilter}));}catch{}};
  function notice(message){document.querySelectorAll('.toast').forEach(x=>x.remove());const el=document.createElement('div');el.className='toast';el.textContent=message;document.body.append(el);setTimeout(()=>el.remove(),4500);}
  function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open('market-lens-pro-datasets',1);req.onupgradeneeded=()=>req.result.createObjectStore('symbols',{keyPath:'symbol'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  async function loadStored(){try{const db=await openDb(),tx=db.transaction('symbols','readonly'),req=tx.objectStore('symbols').getAll();const rows=await new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);});for(const item of rows){S.data.set(item.symbol,item.bars);S.sources.set(item.symbol,'IMPORTED');}db.close();if(rows.length){S.symbol=rows[0].symbol;render();}}catch{notice('Local database unavailable. Imports still work until this tab closes.');}}
  async function storeDataset(symbol,bars){try{const db=await openDb(),tx=db.transaction('symbols','readwrite');tx.objectStore('symbols').put({symbol,bars});await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});db.close();}catch{notice('Import loaded, but this browser could not save it for future visits.');}}
  async function removeImports(){try{const db=await openDb(),tx=db.transaction('symbols','readwrite');tx.objectStore('symbols').clear();await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});db.close();}catch{}S.data=new Map(Object.entries(sampleData()));S.sources=new Map([...S.data.keys()].map(x=>[x,'SIMULATED']));S.symbol='DEMO-SPY';S.result=null;S.sweep=null;render();}
  const bars=()=>aggregate(S.data.get(S.symbol)||[],S.chart.tf);
  const status=()=>S.mode==='live'?'ALPACA LIVE · '+String(S.liveFeed||'iex').toUpperCase():S.sources.get(S.symbol)==='SIMULATED'?'SIMULATED SAMPLE':S.sources.get(S.symbol)==='IMPORTED'?'IMPORTED OHLCV':'NO DATA';
  const isVisibleSymbol=symbol=>(S.mode==='live'?S.sources.get(symbol)==='ALPACA':S.sources.get(symbol)!=='ALPACA')&&(S.universeFilter!=='volatility'||VOLATILITY_UNIVERSE.includes(symbol));
  function destroyCharts(){if(chart){chart.remove();chart=null;}if(equityChart){equityChart.remove();equityChart=null;}}
  function shell(){
    const nav=(mobile=false)=>'<div class="'+(mobile?'mobile-nav':'nav')+'">'+Object.entries(tabNames).map(([k,n])=>'<button class="nav-btn '+(S.tab===k?'active':'')+'" data-tab="'+k+'"><span class="nav-icon">'+tabIcons[k]+'</span>'+n+'</button>').join('')+'</div>';
    $('#app').innerHTML='<div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">M</div><div><strong>MARKET LENS</strong><small>PRO WORKSTATION</small></div></div><div><div class="nav-label">Workspace</div>'+nav()+'</div><div class="sidebar-bottom">DATA NOTICE<br/>Your imported prices stay on this device. Simulated sample data is never live market data.<p>No account. No trades sent.</p></div></aside><div class="workspace"><header class="topbar"><div class="top-left"><strong>Market Lens Pro</strong><span class="workspace-label">/ Independent strategy laboratory</span></div><div class="top-actions"><span class="status"><span class="dot"></span>'+ (S.mode==='live'?'Alpaca data':'Local workspace') +'</span><span class="source-badge">'+status()+'</span><div class="mode-switch flex"><button class="btn small '+(S.mode==='demo'?'selected':'')+'" data-action="mode-demo">Demo</button><button class="btn small '+(S.mode==='live'?'selected':'')+'" data-action="mode-live">Live</button></div><button class="btn" data-action="import">Import CSV</button></div></header>'+nav(true)+'<main id="main" class="main"></main></div></div><input id="csv-file" type="file" accept=".csv,text/csv" multiple hidden/>';
  }
  const head=(name,desc,tools='')=>'<div class="headrow"><div><div class="eyebrow">Market Lens / '+name+'</div><h1>'+name+'</h1><p class="subtle">'+desc+'</p></div><div class="flex">'+tools+'</div></div>';
  const button=(label,action,variant='')=>'<button class="btn '+variant+'" data-action="'+action+'">'+label+'</button>';
  const select=(items,value,attr)=>'<select '+attr+'>'+items.map(([v,t])=>'<option value="'+esc(v)+'"'+(v===value?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select>';
  const timeframes=[['D','1 Day'],['W','1 Week'],['M','1 Month'],['2H','2 Hours']];
  const symbolSelect=()=>'<label class="control">Symbol '+select([...S.data.keys()].filter(isVisibleSymbol).sort().map(s=>[s,s]),S.symbol,'data-option="symbol"')+'</label>';
  const tfSelect=()=>'<label class="control">Timeframe '+select(timeframes,S.chart.tf,'data-option="tf"')+'</label>';
  const field=(name,key,type='number',min='',max='',step='any')=>'<label class="field">'+name+'<input type="'+type+'" data-bt="'+key+'" value="'+esc(S.bt[key])+'" '+(min!==''?'min="'+min+'"':'')+' '+(max!==''?'max="'+max+'"':'')+' step="'+step+'"/></label>';
  function metric(label,value,foot='',type=''){return '<div class="metric"><label>'+label+'</label><strong class="'+type+'">'+value+'</strong><small>'+foot+'</small></div>';}
  const sourceStrip=()=>S.sources.get(S.symbol)==='ALPACA'?'<div class="info-strip">Alpaca market data · '+esc(String(S.liveFeed||'IEX').toUpperCase())+' feed · REST refresh on demand. This is not a tick-by-tick WebSocket stream.</div>':S.sources.get(S.symbol)==='SIMULATED'?'<div class="info-strip warning"><strong>Simulated prices.</strong> These are generated examples for testing the interface; no price, return, or trading result represents a real ticker.</div>':(S.data.get(S.symbol)||[]).some(b=>b.approximateOhlc)?'<div class="info-strip warning">The imported CSV has Close-only bars. Open/high/low are approximated. Stop, target, and next-open fills are unreliable until full OHLCV data is imported.</div>':'';
  function screenerRows(){
    const list=[];
    for(const [symbol,history] of S.data){if(!isVisibleSymbol(symbol))continue;const evalResult=screenSymbol(history,S.rules),d=statsFor(aggregate(history,'D')),w=statsFor(aggregate(history,'W'));
      if(S.showOnlyMatches&&!evalResult.pass)continue;if(S.showWatch&&!S.watch.has(symbol))continue;if(S.query&&!symbol.toLowerCase().includes(S.query.toLowerCase()))continue;
      list.push({symbol,evalResult,d,w,source:S.sources.get(symbol)});}
    const value=r=>S.sort==='symbol'?r.symbol:S.sort==='rsi'?r.d.rsi:S.sort==='ret20'?r.d.ret20:S.sort==='price'?r.d.price:S.sort==='ema'?r.w.ema200===null?null:100*(r.w.price/r.w.ema200-1):r.d.drawdown;
    list.sort((a,b)=>{const x=value(a),y=value(b);if(x==null)return 1;if(y==null)return -1;return (typeof x==='string'?x.localeCompare(y):x-y)*(S.ascending?1:-1);});
    return list;
  }
  function screenerView(){
    const symbols=[...S.data.keys()].filter(isVisibleSymbol),all=symbols.map(symbol=>screenSymbol(S.data.get(symbol),S.rules)),matched=all.filter(x=>x.pass).length,rows=screenerRows();
    const presetKey=Object.entries(preset).find(([key,r])=>JSON.stringify(r)===JSON.stringify(S.rules)&&(key!=='volatility'||S.universeFilter==='volatility'))?.[0]||'custom';
    const rules=S.rules.map((r,i)=>'<div class="rule">'+select([['D','D'],['W','W'],['M','M'],['2H','2H']],r.tf,'data-rule="'+i+'" data-key="tf"')+select([['rsi','RSI'],['emaDist','% vs EMA200'],['ret20','20-bar %'],['drawdown','Drawdown %'],['atrPct','ATR %'],['price','Price'],['volume','Volume']],r.metric,'data-rule="'+i+'" data-key="metric"')+select([['<','<'],['<=','≤'],['>','>'],['>=','≥']],r.op,'data-rule="'+i+'" data-key="op"')+'<input type="number" step="any" data-rule="'+i+'" data-key="value" value="'+esc(r.value)+'"/><button data-action="remove-rule" data-index="'+i+'" aria-label="Remove filter">×</button></div>').join('');
    const table=rows.map(r=>{const dd=r.w.ema200==null?null:(r.w.price/r.w.ema200-1)*100;
      return '<tr class="'+(r.symbol===S.symbol?'chosen':'')+'" data-symbol="'+r.symbol+'"><td><button class="star '+(S.watch.has(r.symbol)?'on':'')+'" data-action="watch" data-symbol="'+r.symbol+'" aria-label="Toggle watchlist">'+(S.watch.has(r.symbol)?'★':'☆')+'</button><span class="table-table-label">'+r.symbol+'</span> <span class="muted">'+(r.source==='ALPACA'?'LIVE':r.source==='SIMULATED'?'DEMO':'CSV')+'</span></td><td>'+format(r.d.price)+'</td><td>'+format(r.d.rsi,1)+'</td><td>'+format(r.w.rsi,1)+'</td><td>'+format(r.d.rsi5,1)+'</td><td class="'+priceColor(dd)+'">'+pct(dd)+'</td><td class="'+priceColor(r.d.ret20)+'">'+pct(r.d.ret20)+'</td><td class="'+priceColor(r.d.drawdown)+'">'+pct(r.d.drawdown)+'</td><td>'+r.d.bars+'</td><td><span class="pill '+(r.evalResult.pass?'':'dim')+'" title="'+esc(r.evalResult.fails.join('; '))+'">'+(r.evalResult.pass?'MATCH':'NO MATCH')+'</span></td></tr>';
    }).join('');
    const scanStatus=S.scan.status==='loading'?'<div id="scan-status" class="info-strip">Scanning '+(S.mode==='live'?'the Alpaca market universe':'the Demo universe')+'…</div>':S.scan.status==='complete'?'<div id="scan-status" class="info-strip" data-scan-source="'+esc(S.scan.source||'DEMO')+'">'+(S.scan.source==='ALPACA'?'Live':'Demo')+' scan complete · '+S.scan.returned+'/'+S.scan.requested+' symbols loaded · '+S.scan.matched+' '+(S.scan.matched===1?'match':'matches')+(S.scan.missing?.length?' · '+S.scan.missing.length+' symbols returned no bars':'')+(S.scan.cached?' · served from 15-minute cache':'')+'</div>':S.scan.status==='fallback'?'<div id="scan-status" class="info-strip warning" data-scan-source="DEMO">Live scan failed; Demo mode restored. '+esc(S.scan.error||'Unknown error')+'</div>':'';
    return head('Screener','Custom filters across multiple timeframes. Missing history never counts as a match.',button('Open Chart Lab','view-charts','primary'))+
      '<div class="metrics">'+metric('Symbols loaded',all.length,S.mode==='live'?'Alpaca universe':'Demo and imported data')+metric('Matching filters',matched,'All visible symbols')+metric('Visible results',rows.length,'Search and match filter')+metric('Active conditions',S.rules.length,'AND logic; all must pass')+'</div>'+scanStatus+
      '<div class="panel"><div class="panel-header"><h2>Screen rules</h2><div class="flex"><label class="control">Preset '+select([['custom','Custom rules'],['trend','Trend pullback'],['original','Original strict W/D/2H'],['oversold','RSI oversold'],['momentum','Momentum'],['volatility','VXX / Volatility'],['all','Show all']],presetKey,'data-option="preset"')+'</label>'+button('+ Add rule','add-rule')+'</div></div><div class="panel-body"><div class="filters">'+(rules||'<span class="muted">No filters — showing all instruments.</span>')+'</div><div class="section-note" style="margin-top:12px">“Original strict” reproduces the weekly EMA200 and weekly/daily/two-hour RSI filter logic. RSI 5D is calculated from daily closes; daily bars cannot reconstruct true two-hour data. The VXX / Volatility preset narrows the universe to VXX, UVXY, SVXY, VIXY, VIXM, VXZ, SVIX, UVIX, ZIVB and ZVOL, using daily RSI, 252-session drawdown and % versus daily EMA200. Demo mode uses the clearly labeled synthetic DEMO-VXX proxy.</div></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Market results</h2><div class="flex">'+button(S.mode==='live'?'Refresh live scan':'Scan demo universe','scan-universe','small primary')+'<input class="textinput" data-input="search" placeholder="Search symbol…" value="'+esc(S.query)+'"/><label class="inline-check"><input type="checkbox" data-option="matches" '+(S.showOnlyMatches?'checked':'')+'/>Matches only</label><label class="inline-check"><input type="checkbox" data-option="watchonly" '+(S.showWatch?'checked':'')+'/>Watchlist</label><label class="control">Sort '+select([['symbol','Symbol'],['price','Price'],['rsi','RSI'],['ret20','20D return'],['ema','Weekly % EMA'],['drawdown','Drawdown']],S.sort,'data-option="sort"')+'</label>'+button(S.ascending?'↑':'↓','sort-order','small')+'</div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Symbol</th><th>Close</th><th>RSI D</th><th>RSI W</th><th title="5-period RSI calculated from daily closes; daily OHLC cannot reconstruct true 2-hour bars">RSI 5D</th><th>% vs W EMA200</th><th>20D return</th><th>DD</th><th>Bars</th><th>Result</th></tr></thead><tbody>'+table+'</tbody></table>'+(rows.length?'':'<div class="empty">No matching symbols. Change a filter or import more price history.</div>')+'</div></div>';
  }
  function chartControls(){
    const styles=[['candles','Candlesticks'],['bars','OHLC bars'],['line','Line'],['area','Area']];
    const box=(k,label)=>'<label><input type="checkbox" data-chart="'+k+'" '+(S.chart[k]?'checked':'')+'/>'+label+'</label>';
    return '<div class="chart-toolbar">'+symbolSelect()+tfSelect()+'<label class="control">Style '+select(styles,S.chart.style,'data-option="style"')+'</label><label class="control">Scale '+select([['false','Linear'],['true','Log']],String(S.chart.log),'data-option="log"')+'</label><div class="flex chart-actions">'+button('1M','range-1m','small')+button('3M','range-3m','small')+button('1Y','range-1y','small')+button('All','range-all','small')+button('Fit','range-fit','small')+'</div></div><div class="chart-readout" id="readout">Move over the chart to inspect OHLCV and indicators.</div><div class="chart-area" id="price-chart"></div><div class="chart-footer"><div class="indicator-options">'+box('ema20','EMA 20')+box('ema50','EMA 50')+box('ema200','EMA 200')+box('sma20','SMA 20')+box('bollinger','Bollinger')+box('volume','Volume')+box('rsi','RSI')+box('macd','MACD')+'<label>EMA A <input type="number" data-chart="ema20Len" min="2" max="500" value="'+S.chart.ema20Len+'"/></label><label>EMA B <input type="number" data-chart="ema50Len" min="2" max="500" value="'+S.chart.ema50Len+'"/></label><label>EMA C <input type="number" data-chart="ema200Len" min="2" max="500" value="'+S.chart.ema200Len+'"/></label><label>SMA <input type="number" data-chart="sma20Len" min="2" max="500" value="'+S.chart.sma20Len+'"/></label><label>Boll <input type="number" data-chart="bollPeriod" min="2" max="500" value="'+S.chart.bollPeriod+'"/></label><label>RSI period <input type="number" data-chart="rsiPeriod" min="2" max="100" value="'+S.chart.rsiPeriod+'"/></label></div><div class="flex">'+button(S.drawLine?'Click price to draw…':'Horizontal line','draw-line',S.drawLine?'selected small':'small')+button('Clear lines','clear-lines','small')+button('PNG','chart-png','small')+'</div></div>';
  }
  function chartsView(){
    const b=bars(),source=S.sources.get(S.symbol);
    return head('Chart Lab','Drag to pan, wheel/pinch to zoom, and drag the price or time axes. Customize indicators below.',button('Backtest this symbol','view-backtest','primary'))+
      '<div class="panel">'+chartControls()+'</div>'+sourceStrip()+
      '<div class="info-strip">Data: <strong>'+esc(S.symbol)+'</strong> · '+(source==='SIMULATED'?'simulated':'imported')+' · '+b.length+' '+S.chart.tf+' bars. Price scaling, crosshair, volume, indicator panes, and annotations are interactive. Charts use TradingView Lightweight Charts, not the full TradingView platform.</div>';
  }
  function btOptions(){
    return '<div class="form-grid"><label class="field">Strategy '+select([['ema-cross','EMA crossover'],['rsi-revert','RSI mean reversion'],['trend-rsi','Trend + RSI pullback'],['bollinger','Bollinger mean reversion'],['breakout','Price breakout']],S.bt.strategy,'data-bt="strategy"')+'</label><label class="field">Trade direction '+select([['long','Long'],['short','Short']],S.bt.side,'data-bt="side"')+'</label>'+field('Fast EMA','fast','number',2,500,1)+field('Slow / trend EMA','slow','number',3,500,1)+field('RSI length','rsiPeriod','number',2,100,1)+field('Buy RSI threshold','buyLevel','number',1,99,1)+field('Exit RSI threshold','sellLevel','number',1,99,1)+field('Lookback / band length','period','number',2,200,1)+field('Bollinger deviation','multiplier','number',.1,5,.1)+field('Starting capital ($)','capital','number',1,100000000,100)+field('Position allocation (%)','allocation','number',1,100,1)+field('Commission (bps/side)','feeBps','number',0,1000,.5)+field('Slippage (bps/side)','slipBps','number',0,1000,.5)+field('Short borrow cost (%/year)','borrowAnnualPct','number',0,100,0.1)+field('Stop loss (%)','stopPct','number',0,100,0.5)+field('Take profit (%)','targetPct','number',0,1000,0.5)+'</div>';
  }
  function resultCards(r){
    if(!r)return '<div class="empty"><strong>No backtest run yet</strong>Choose parameters and select Run backtest.</div>';
    const m=r.metrics;return '<div class="metrics" style="margin-bottom:0">'+metric('Net return',pct(m.returnPct),format(m.endEquity)+' ending equity',priceColor(m.returnPct))+metric('Max drawdown','-'+format(m.maxDD)+'%','Peak-to-trough','negative')+metric('Profit factor',format(m.profitFactor),'After modeled costs')+metric('Completed trades',String(m.trades),m.winPct==null?'No trades':format(m.winPct,1)+'% winners')+metric('CAGR',pct(m.cagrPct),'Based on elapsed time',priceColor(m.cagrPct))+metric('Sharpe',format(m.sharpe),'Annualized, no risk-free adjustment')+metric('Exposure',format(m.exposurePct)+'%','Bars with open position')+metric('Buy & hold',pct(m.buyHoldPct),'Raw price reference',priceColor(m.buyHoldPct))+'</div>';
  }
  function tradeTable(r){
    if(!r||!r.trades.length)return '<div class="empty">No completed trades for this strategy on the selected dataset.</div>';
    return '<div class="table-wrap"><table class="data-table"><thead><tr><th>Entry</th><th>Exit</th><th>Entry price</th><th>Exit price</th><th>Quantity</th><th>Net P&amp;L</th><th>Return</th><th>Bars</th><th>Reason</th></tr></thead><tbody>'+r.trades.slice().reverse().slice(0,300).map(t=>'<tr><td>'+dateLabel(t.entry)+'</td><td>'+dateLabel(t.exit)+'</td><td>'+format(t.buy)+'</td><td>'+format(t.sell)+'</td><td>'+format(t.qty,4)+'</td><td class="'+priceColor(t.pnl)+'">'+format(t.pnl)+'</td><td class="'+priceColor(t.pnlPct)+'">'+pct(t.pnlPct)+'</td><td>'+t.barsHeld+'</td><td>'+esc(t.reason)+'</td></tr>').join('')+'</tbody></table></div>';
  }
  function backtestView(){
    return head('Backtest','Signal generated on a finished bar; filled at the next bar’s open. One long position at a time.',symbolSelect()+tfSelect())+
      '<div class="panel"><div class="panel-header"><h2>Strategy settings</h2><div class="flex">'+button('Run backtest','run-backtest','primary')+button('Optimize parameters','view-optimize')+'</div></div><div class="panel-body">'+btOptions()+'<p class="section-note">Stop-first rule when stop and target are both hit inside the same bar. Costs are modeled on each side. Short borrow fees are approximate; the engine does not model margin calls, locate availability, dividends, partial fills, taxes, or corporate actions.</p></div></div>'+
      sourceStrip()+'<div class="panel"><div class="panel-header"><h2>Performance</h2><div class="flex">'+button('Export trades CSV','export-trades','small')+button('View trade markers','view-charts','small')+'</div></div><div class="panel-body">'+resultCards(S.result)+'</div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Equity curve vs. buy-and-hold</h2></div>'+(S.result?.curve?.length?'<div class="equity-legend"><span><i class="equity-swatch strategy"></i>Strategy</span><span><i class="equity-swatch benchmark"></i>Buy &amp; hold</span></div><div id="equity-chart" class="equity-plot"></div>':'<div class="empty">Run a backtest to generate an equity curve.</div>')+'</div>'+
      '<div class="panel"><div class="panel-header"><h2>Trade log</h2></div>'+tradeTable(S.result)+'</div>';
  }
  function optimizeView(){
    const rows=S.sweep||[];
    return head('Optimize','Parameter sweep with a 70% training / 30% chronological holdout split.',symbolSelect()+tfSelect())+
      '<div class="panel"><div class="panel-header"><h2>Run sweep</h2><div class="flex"><label class="control">Strategy '+select([['ema-cross','EMA cross'],['rsi-revert','RSI reversion'],['trend-rsi','Trend + RSI'],['bollinger','Bollinger'],['breakout','Breakout']],S.bt.strategy,'data-bt="strategy"')+'</label>'+button('Run 5–9 variations','run-sweep','primary')+button('Export CSV','export-sweep','small')+'</div></div><div class="panel-body"><p class="section-note">Each variation is trained on the first 70% of the dataset and independently simulated on the last 30%, using earlier bars only for indicator warm-up. The table sorts by holdout return. Choosing the best holdout result itself introduces selection bias; confirm on unseen data.</p></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Parameter ranking</h2><span class="muted">'+rows.length+' variations</span></div><div class="table-wrap">'+(rows.length?'<table class="data-table"><thead><tr><th>Parameters</th><th>Train return</th><th>Train DD</th><th>Test return</th><th>Test DD</th><th>Test trades</th><th>Test PF</th><th></th></tr></thead><tbody>'+rows.map((r,i)=>'<tr class="'+(i===0?'sweep-best':'')+'"><td>'+esc(Object.entries(r.params).map(([k,v])=>k+'='+v).join(', '))+'</td><td class="'+priceColor(r.train.returnPct)+'">'+pct(r.train.returnPct)+'</td><td>-'+format(r.train.maxDD)+'%</td><td class="'+priceColor(r.test.returnPct)+'">'+pct(r.test.returnPct)+'</td><td>-'+format(r.test.maxDD)+'%</td><td>'+r.test.trades+'</td><td>'+format(r.test.profitFactor)+'</td><td><button class="btn small" data-action="apply-sweep" data-index="'+i+'">Apply & test</button></td></tr>').join('')+'</tbody></table>':'<div class="empty"><strong>No sweep yet</strong>Choose a strategy and run a parameter sweep.</div>')+'</div></div>';
  }
  function dataView(){
    const imported=[...S.data].filter(([k])=>S.sources.get(k)==='IMPORTED');
    return head('Data Center','Import historical prices or configure the secure Alpaca market-wide scanner.',button('Browse files','import','primary'))+
      '<div class="panel"><div class="panel-header"><h2>Live market scanner · Alpaca</h2><span class="source-badge">Keys stay server-side</span></div><div class="panel-body"><label class="field">Cloudflare Worker API URL<input type="url" data-setting="apiBaseUrl" placeholder="https://market-lens-pro-api.your-subdomain.workers.dev" value="'+esc(S.apiBaseUrl)+'"/></label><div class="flex" style="margin-top:13px">'+button('Test backend','test-live','small')+button('Scan live universe & switch to Live','mode-live','primary')+button('Switch to Demo','mode-demo','small')+'</div><div class="info-strip">The live universe is '+LIVE_UNIVERSE.length+' curated symbols — not a full S&P 500 constituent list: '+LIVE_EQUITY_COUNT+' liquid US equities, '+LIVE_ETF_COUNT+' broad-market ETFs and '+LIVE_VOLATILITY_COUNT+' live volatility tickers. The volatility filter list has '+VOLATILITY_UNIVERSE.length+' entries, including the synthetic DEMO-VXX proxy; Demo mode scans '+DEMO_UNIVERSE.length+' synthetic symbols. Live volatility tickers include VXX, UVXY, SVXY, VIXY, VIXM, VXZ, SVIX, UVIX, ZIVB and ZVOL. The Worker requests 550 calendar days of daily bars in batches of '+ALPACA_BATCH_SIZE+' symbols ('+Math.ceil(LIVE_UNIVERSE.length/ALPACA_BATCH_SIZE)+' batches for the current universe), paginates if necessary, and caches completed scans for 15 minutes. The default feed is IEX; consolidated SIP data requires an eligible Alpaca subscription.</div><p class="section-note">Alpaca credentials remain in encrypted Cloudflare Worker secrets. The browser receives OHLCV only. If the live request fails, the app returns to Demo mode automatically. The current scanner uses daily bars over REST, not a streaming WebSocket.</p><p class="section-note">The setup guide is in <code>docs/ALPACA_SETUP.md</code>. No keys belong in this website, browser storage, or chat.</p></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Import historical data</h2><span class="source-badge">Browser only · IndexedDB</span></div><div class="panel-body"><div class="upload" id="dropzone"><strong>Drop one or more CSV files here</strong><p class="subtle">Or tap to browse. Multiple symbols are supported in a single file.</p>'+button('Choose CSV files','import')+'</div><div class="info-strip">Required columns: <code>Date,Open,High,Low,Close</code>. Optional: <code>Symbol,Volume</code>. For daily files, enter ISO dates like 2026-01-05. For true 2-hour screens, import timestamped intraday data. Data should be split-adjusted consistently. Close-only files are permitted but weaken fill accuracy.</div></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Saved imported symbols</h2><div class="flex">'+button('Reset to demo data','clear-imports','small')+button('Export sample CSV','export-sample','small')+'</div></div><div class="panel-body"><div class="data-list">'+(imported.length?imported.map(([symbol,b])=>'<div class="data-item"><div><strong>'+esc(symbol)+'</strong><br/><small>'+b.length+' bars · '+dateLabel(b[0].time)+' to '+dateLabel(b.at(-1).time)+'</small></div><button class="btn small" data-action="choose-symbol" data-symbol="'+esc(symbol)+'">Open chart</button></div>').join(''):'<div class="empty"><strong>No imported data yet.</strong>Four clearly labeled synthetic symbols are included to demonstrate the interface.</div>')+'</div></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Market data policy</h2></div><div class="panel-body"><p class="section-note">GitHub Pages serves the public frontend only. Alpaca credentials are stored as Cloudflare Worker secrets and are never sent to this browser. Live data requests go through the Worker proxy.</p><p class="section-note">Imported and demo data remain available in Demo mode. Backtesting is research-only and does not submit orders.</p></div></div>';
  }
  function render(){
    destroyCharts();shell();
    const views={screener:screenerView,charts:chartsView,backtest:backtestView,optimize:optimizeView,data:dataView};
    $('#main').innerHTML=views[S.tab]();
    if(S.tab==='charts')mountPriceChart();
    if(S.tab==='backtest'&&S.result?.curve?.length)mountEquity();
    saveSettings();
  }
  const colors={background:'#0e1826',text:'#a1b4ca',grid:'#233447',up:'#4ddfb1',down:'#f0788c',yellow:'#eac17c',blue:'#66b9ff',violet:'#b596ff'};
  function newChart(el,height=535,priceScaleWidth=55){
    return createChart(el,{autoSize:true,height,layout:{background:{type:'solid',color:colors.background},textColor:colors.text,fontFamily:'Inter, sans-serif',fontSize:11,panes:{separatorColor:'#314459',separatorHoverColor:'#456278'}},grid:{vertLines:{color:colors.grid},horzLines:{color:colors.grid}},crosshair:{mode:0},rightPriceScale:{borderColor:'#304357',minimumWidth:priceScaleWidth},timeScale:{borderColor:'#304357',rightOffset:10,barSpacing:8},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:{time:true,price:true}},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false}});
  }
  function mountPriceChart(){
    const b=bars(),el=$('#price-chart');if(!b.length){el.innerHTML='<div class="empty"><strong>No bars for this timeframe</strong>Import intraday OHLCV data to use 2-hour charts or filters.</div>';return;}
    chart=newChart(el);
    const baseOptions={priceLineVisible:false,lastValueVisible:true};
    const type=S.chart.style==='line'?LineSeries:S.chart.style==='area'?AreaSeries:S.chart.style==='bars'?BarSeries:CandlestickSeries;
    const style=S.chart.style==='candles'?{upColor:colors.up,downColor:colors.down,borderVisible:false,wickUpColor:colors.up,wickDownColor:colors.down}:S.chart.style==='bars'?{upColor:colors.up,downColor:colors.down}:{color:colors.blue,lineColor:colors.blue,topColor:'#278cb263',bottomColor:'#278cb200',lineWidth:2};
    const base=chart.addSeries(type,{...baseOptions,...style});
    const datapoints=b.map(x=>S.chart.style==='line'||S.chart.style==='area'?{time:x.time,value:x.close}:{time:x.time,open:x.open,high:x.high,low:x.low,close:x.close});
    base.setData(datapoints);
    const c=b.map(x=>x.close),ind=indicators(b,{rsiPeriod:S.chart.rsiPeriod,period:S.chart.bollPeriod});
    for(const [name,vals,color] of [['ema20',ema(c,S.chart.ema20Len),colors.yellow],['ema50',ema(c,S.chart.ema50Len),colors.blue],['ema200',ema(c,S.chart.ema200Len),colors.violet],['sma20',sma(c,S.chart.sma20Len),'#f7a75c']]){
      if(!S.chart[name])continue;
      const series=chart.addSeries(LineSeries,{color,lineWidth:2,priceLineVisible:false,lastValueVisible:true,title:name.toUpperCase()+'('+S.chart[name+'Len']+')'});
      series.setData(vals.flatMap((v,i)=>v==null?[]:[{time:b[i].time,value:v}]));
    }
    if(S.chart.bollinger){
      const basev=sma(c,S.chart.bollPeriod);
      for(const direction of [-1,1]){const ln=chart.addSeries(LineSeries,{color:'#758ead',lineWidth:1,priceLineVisible:false,title:direction>0?'Upper BB':'Lower BB'});ln.setData(basev.flatMap((v,i)=>{if(v==null)return [];const win=c.slice(i-S.chart.bollPeriod+1,i+1),std=Math.sqrt(win.reduce((sum,x)=>sum+(x-v)**2,0)/win.length);return [{time:b[i].time,value:v+direction*2*std}];}));}
    }
    if(S.chart.volume){const vol=chart.addSeries(HistogramSeries,{priceScaleId:'volume',priceLineVisible:false,lastValueVisible:false,priceFormat:{type:'volume'}});vol.setData(b.map(x=>({time:x.time,value:x.volume||0,color:x.close>=x.open?'#317c6c88':'#8a3c5388'})));vol.priceScale().applyOptions({scaleMargins:{top:.83,bottom:0}});}
    let pane=1;
    if(S.chart.rsi){
      const rs=chart.addSeries(LineSeries,{color:colors.violet,lineWidth:2,priceLineVisible:false,title:'RSI('+S.chart.rsiPeriod+')'},pane++);
      rs.setData(rsi(c,S.chart.rsiPeriod).flatMap((v,i)=>v==null?[]:[{time:b[i].time,value:v}]));
      for(const v of [30,50,70])rs.createPriceLine({price:v,color:v===50?'#536980':'#9c6a70',lineWidth:1,lineStyle:2,axisLabelVisible:false});
    }
    if(S.chart.macd){
      const m=chart.addSeries(LineSeries,{color:colors.blue,lineWidth:2,priceLineVisible:false,title:'MACD'},pane);
      const sig=chart.addSeries(LineSeries,{color:colors.yellow,lineWidth:1,priceLineVisible:false,title:'Signal'},pane);
      m.setData(ind.macd.flatMap((v,i)=>v==null?[]:[{time:b[i].time,value:v}]));
      sig.setData(ind.signal.flatMap((v,i)=>v==null?[]:[{time:b[i].time,value:v}]));
    }
    if(pane>1){try{chart.panes()[0].setHeight(S.chart.macd?310:360);}catch{}}
    if(S.chart.log)base.priceScale().applyOptions({mode:PriceScaleMode.Logarithmic});
    for(const p of S.chart.lines[S.symbol]||[])base.createPriceLine({price:p,color:'#e4b766',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'Level'});
    if(S.result&&S.resultSymbol===S.symbol&&S.resultTf===S.chart.tf){
      const marks=S.result.trades.flatMap(t=>[
        {time:t.entry,position:t.side==='short'?'aboveBar':'belowBar',color:t.side==='short'?colors.down:colors.up,shape:t.side==='short'?'arrowDown':'arrowUp',text:t.side==='short'?'SHORT':'BUY'},
        {time:t.exit,position:t.side==='short'?'belowBar':'aboveBar',color:t.pnl>=0?colors.up:colors.down,shape:t.side==='short'?'arrowUp':'arrowDown',text:'EXIT'}
      ]).sort((a,b)=>stamp(a.time)-stamp(b.time));
      createSeriesMarkers(base,marks);
    }
    chart.subscribeClick(param=>{if(!S.drawLine||!param.point)return;const p=base.coordinateToPrice(param.point.y);if(p==null||!Number.isFinite(p))return;const price=Number(p.toFixed(4));(S.chart.lines[S.symbol]??=[]).push(price);base.createPriceLine({price,color:'#e4b766',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'Level'});S.drawLine=false;saveSettings();notice('Added horizontal price level at '+format(price,4));});
    chart.subscribeCrosshairMove(param=>{const d=param.seriesData.get(base),el=$('#readout');if(!el||!d)return;const v=('close' in d?d.close:d.value),o='open'in d?d.open:null;
      el.innerHTML='<b>'+dateLabel(param.time||b.at(-1).time)+'</b><span>Open '+format(o)+'</span><span>High '+format('high' in d?d.high:null)+'</span><span>Low '+format('low' in d?d.low:null)+'</span><span>Close <b>'+format(v)+'</b></span>';});
    showRange(180);
  }
  function showRange(n){
    if(!chart)return;const total=bars().length;
    try{if(!n||n>=total)chart.timeScale().fitContent();else chart.timeScale().setVisibleLogicalRange({from:Math.max(0,total-n),to:total+3});}catch{}
  }
  function mountEquity(){
    const el=$('#equity-chart');if(!el)return;equityChart=newChart(el,275,92);
    const line=equityChart.addSeries(AreaSeries,{lineColor:colors.up,topColor:'#2aac765a',bottomColor:'#2aac7610',lineWidth:2,priceLineVisible:false,lastValueVisible:false,title:'Strategy'});
    line.setData(S.result.curve);
    const bb=equityChart.addSeries(LineSeries,{color:'#6c89a4',lineWidth:1,priceLineVisible:false,lastValueVisible:false,title:'Buy & hold'});
    const all=bars(),byTime=new Map(all.map(b=>[stamp(b.time),b])),first=byTime.get(stamp(S.result.curve[0].time));
    if(first)bb.setData(S.result.curve.map(p=>({time:p.time,value:S.bt.capital*(byTime.get(stamp(p.time))?.close||first.open)/first.open})));
    equityChart.timeScale().fitContent();
  }
  async function importFiles(files){
    let symbols=0,total=0,skipped=0;
    for(const file of files){try{const fallback=file.name.replace(/\.csv$/i,'').toUpperCase().replace(/[^A-Z0-9.^_-]/g,'').slice(0,20)||'IMPORT';const parsed=parseCsv(await file.text(),fallback);
      skipped+=parsed.skipped;
      for(const [s,b] of Object.entries(parsed.groups)){const mix=normalizeBars([...(S.sources.get(s)==='IMPORTED'?S.data.get(s):[]||[]),...b]);S.data.set(s,mix);S.sources.set(s,'IMPORTED');await storeDataset(s,mix);S.symbol=s;total+=b.length;symbols++;}}
      catch(err){notice('Cannot read '+file.name+': '+err.message);}
    }
    if(symbols){S.tab='data';S.result=null;S.sweep=null;render();notice('Loaded '+total+' bars across '+symbols+' symbol file sets. '+skipped+' invalid rows skipped.');}
  }
  function exportFile(name,contents,mime='text/csv'){
    const obj=new Blob([contents],{type:mime}),url=URL.createObjectURL(obj),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const runBt=()=>{const b=bars();if(b.length<40){notice('Need at least 40 bars for a meaningful backtest.');return false;}S.result=backtest(b,{...S.bt,timeframe:S.chart.tf});S.resultSymbol=S.symbol;S.resultTf=S.chart.tf;return true;};
  async function testLiveBackend(){
    let base=S.apiBaseUrl.trim();while(base.endsWith('/'))base=base.slice(0,-1);
    if(!base.startsWith('https://'))throw new Error('Enter the Cloudflare Worker URL in Data Center first.');
    const response=await fetch(base+'/api/health',{headers:{Accept:'application/json'}}),payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||'Worker health check failed ('+response.status+').');
    if(!payload.configured)throw new Error('Worker is reachable, but Alpaca secrets have not been configured yet.');
    S.liveFeed=payload.feed||'iex';notice('Alpaca backend is ready · '+String(S.liveFeed).toUpperCase()+' feed.');return payload;
  }
  function runDemoScan(){
    const symbols=[...S.data.keys()].filter(symbol=>S.sources.get(symbol)!=='ALPACA'&&isVisibleSymbol(symbol));
    const matches=symbols.filter(symbol=>screenSymbol(S.data.get(symbol),S.rules).pass);
    S.scan={status:'complete',source:'DEMO',requested:symbols.length,returned:symbols.length,matched:matches.length,missing:[],cached:false,at:new Date().toISOString()};
    S.result=null;S.sweep=null;S.tab='screener';render();
    notice('Demo scan complete: '+matches.length+' '+(matches.length===1?'match':'matches')+' across '+symbols.length+' symbols.');
  }
  async function fetchLiveUniverse(){
    let base=S.apiBaseUrl.trim();while(base.endsWith('/'))base=base.slice(0,-1);
    if(!base.startsWith('https://'))throw new Error('Enter the Cloudflare Worker URL in Data Center first.');
    S.scan={status:'loading',source:'ALPACA'};S.tab='screener';render();
    const response=await fetch(base+'/api/stocks/scan?feed='+encodeURIComponent(S.liveFeed||'iex'),{headers:{Accept:'application/json'}});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||payload.detail||'Alpaca market scan failed ('+response.status+').');
    const raw=payload.bars&&typeof payload.bars==='object'?payload.bars:{},parsed=[];
    for(const [symbol,items] of Object.entries(raw)){
      const liveBars=alpacaBars(items,'1Day');
      if(liveBars.length)parsed.push([symbol,liveBars]);
    }
    if(!parsed.length)throw new Error('Alpaca returned no daily bars for the bundled universe. Check the feed and subscription.');
    if(S.sources.get(S.symbol)!=='ALPACA')S.lastDemoSymbol=S.symbol;
    for(const [symbol,source] of S.sources)if(source==='ALPACA'){S.sources.delete(symbol);S.data.delete(symbol);}
    const loaded=[];
    for(const [symbol,liveBars] of parsed){S.data.set(symbol,liveBars);S.sources.set(symbol,'ALPACA');loaded.push(symbol);}
    S.mode='live';S.liveFeed=payload.feed||'iex';
    const visible=loaded.filter(isVisibleSymbol);
    if(!visible.includes(S.symbol))S.symbol=visible[0]||loaded[0];
    const matched=visible.filter(symbol=>screenSymbol(S.data.get(symbol),S.rules).pass).length;
    S.scan={status:'complete',source:'ALPACA',requested:payload.requested||LIVE_UNIVERSE.length,returned:loaded.length,matched,missing:payload.missing||[],cached:response.headers.get('X-Scan-Cache')==='HIT',at:new Date().toISOString()};
    S.result=null;S.sweep=null;S.tab='screener';render();
    notice('Live scan complete: '+matched+' '+(matched===1?'match':'matches')+' across '+visible.length+' visible symbols ('+loaded.length+'/'+S.scan.requested+' returned).');
  }
  async function switchToLive(){
    try{await fetchLiveUniverse();}
    catch(err){
      S.mode='demo';
      if(S.sources.get(S.symbol)==='ALPACA')S.symbol=S.lastDemoSymbol&&S.sources.get(S.lastDemoSymbol)!=='ALPACA'?S.lastDemoSymbol:'DEMO-SPY';
      S.scan={status:'fallback',source:'DEMO',error:err.message};
      S.result=null;S.sweep=null;S.tab='screener';render();
      notice('Live scan failed; switched back to Demo mode. '+err.message);
    }
  }
  const action={
    import:()=>$('#csv-file')?.click(),
    'mode-demo':()=>{S.mode='demo';if(S.sources.get(S.symbol)==='ALPACA')S.symbol=S.lastDemoSymbol&&S.sources.get(S.lastDemoSymbol)!=='ALPACA'?S.lastDemoSymbol:'DEMO-SPY';S.scan={status:'idle'};S.result=null;S.sweep=null;render();},
    'mode-live':()=>switchToLive(),
    'scan-universe':()=>S.mode==='live'?switchToLive():runDemoScan(),
    'test-live':()=>testLiveBackend().catch(err=>notice('Backend test failed: '+err.message)),
    'view-charts':()=>{S.tab='charts';render();},
    'view-backtest':()=>{S.tab='backtest';render();},
    'view-optimize':()=>{S.tab='optimize';render();},
    'add-rule':()=>{S.universeFilter='all';S.rules.push({metric:'rsi',tf:'D',op:'<',value:50});S.scan={status:'idle'};render();},
    'remove-rule':el=>{S.rules.splice(Number(el.dataset.index),1);render();},
    'watch':el=>{const sym=el.dataset.symbol;S.watch.has(sym)?S.watch.delete(sym):S.watch.add(sym);render();},
    'sort-order':()=>{S.ascending=!S.ascending;render();},
    'range-1m':()=>showRange(S.chart.tf==='D'?22:5),
    'range-3m':()=>showRange(S.chart.tf==='D'?66:14),
    'range-1y':()=>showRange(S.chart.tf==='D'?252:52),
    'range-all':()=>showRange(0),
    'range-fit':()=>showRange(180),
    'draw-line':()=>{S.drawLine=!S.drawLine;render();},
    'clear-lines':()=>{S.chart.lines[S.symbol]=[];render();},
    'chart-png':()=>{if(!chart)return;try{const canvas=chart.takeScreenshot();canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='market-lens-'+S.symbol+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}catch{notice('Chart image export is unsupported in this browser.');}},
    'run-backtest':()=>{if(runBt())render();},
    'run-sweep':()=>{if(bars().length<60){notice('A parameter sweep needs at least 60 bars.');return;}S.sweep=parameterSweep(bars(),{...S.bt,timeframe:S.chart.tf});render();},
    'apply-sweep':el=>{Object.assign(S.bt,S.sweep[Number(el.dataset.index)].params);if(runBt()){S.tab='backtest';render();}},
    'export-trades':()=>{if(!S.result){notice('Run a backtest before exporting.');return;}exportFile(S.symbol+'-trades.csv',csvDownload(S.result.trades.map(t=>({symbol:S.symbol,strategy:S.bt.strategy,...t}))));},
    'export-sweep':()=>{if(!S.sweep){notice('Run a parameter sweep first.');return;}exportFile(S.symbol+'-sweep.csv',csvDownload(S.sweep.map(r=>({params:JSON.stringify(r.params),trainReturn:r.train.returnPct,trainDrawdown:r.train.maxDD,trainTrades:r.train.trades,testReturn:r.test.returnPct,testDrawdown:r.test.maxDD,testTrades:r.test.trades,testProfitFactor:r.test.profitFactor}))));},
    'export-sample':()=>{const b=S.data.get('DEMO-SPY');exportFile('SIMULATED-DEMO-SPY.csv',csvDownload(b.map(x=>({Date:x.time,Symbol:'DEMO-SPY',Open:x.open,High:x.high,Low:x.low,Close:x.close,Volume:x.volume}))));},
    'clear-imports':()=>removeImports(),
    'choose-symbol':el=>{S.symbol=el.dataset.symbol;S.tab='charts';S.result=null;S.sweep=null;render();}
  };
  document.addEventListener('click',ev=>{
    const btn=ev.target.closest('[data-tab],[data-action]');if(btn){
      if(btn.dataset.tab){S.tab=btn.dataset.tab;render();return;}
      const handler=action[btn.dataset.action];if(handler){ev.stopPropagation();handler(btn);return;}
    }
    const row=ev.target.closest('tr[data-symbol]');if(row){S.symbol=row.dataset.symbol;S.tab='charts';S.result=null;S.sweep=null;render();}
    if(ev.target.closest('#dropzone'))$('#csv-file')?.click();
  });
  document.addEventListener('input',ev=>{
    const el=ev.target;if(el.dataset.setting){S[el.dataset.setting]=el.value;saveSettings();return;}if(el.dataset.input==='search'){S.query=el.value;const focus=el.selectionStart;render();const input=$('[data-input="search"]');if(input){input.focus();input.setSelectionRange(focus,focus);}}
  });
  document.addEventListener('change',async ev=>{
    const el=ev.target;
    if(el.id==='csv-file'){if(el.files?.length)await importFiles(el.files);el.value='';return;}
    if(el.dataset.option){
      const opt=el.dataset.option,val=el.value;
      if(opt==='preset'){if(val==='custom')return;S.rules=(preset[val]||[]).map(x=>({...x}));S.universeFilter=val==='volatility'?'volatility':'all';S.scan={status:'idle'};}
      else if(opt==='symbol'){S.symbol=val;S.result=null;S.sweep=null;}
      else if(opt==='tf'){S.chart.tf=val;S.result=null;S.sweep=null;}
      else if(opt==='style')S.chart.style=val;
      else if(opt==='log')S.chart.log=val==='true';
      else if(opt==='matches')S.showOnlyMatches=el.checked;
      else if(opt==='watchonly')S.showWatch=el.checked;
      else if(opt==='sort')S.sort=val;
      render();return;
    }
    if(el.dataset.rule!==undefined){const r=S.rules[Number(el.dataset.rule)];if(r){r[el.dataset.key]=el.dataset.key==='value'?Number(el.value):el.value;render();}return;}
    if(el.dataset.chart){const key=el.dataset.chart;S.chart[key]=el.type==='checkbox'?el.checked:el.type==='number'?Math.max(2,Math.round(Number(el.value)||14)):el.value;render();return;}
    if(el.dataset.bt){const key=el.dataset.bt;S.bt[key]=el.type==='number'?Number(el.value):el.value;S.result=null;S.sweep=null;saveSettings();return;}
  });
  document.addEventListener('dragover',ev=>{if(ev.target.closest('#dropzone')){ev.preventDefault();ev.target.closest('#dropzone').classList.add('dragging');}});
  document.addEventListener('drop',async ev=>{const drop=ev.target.closest('#dropzone');if(drop){ev.preventDefault();drop.classList.remove('dragging');await importFiles([...ev.dataTransfer.files].filter(f=>f.name.toLowerCase().endsWith('.csv')));}});
  render();
  await loadStored();
}
initApp().catch(err=>{document.getElementById('app').textContent='App startup failed: '+err.message;console.error(err);});
