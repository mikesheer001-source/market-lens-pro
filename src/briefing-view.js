// Round 13 — presentation-only Daily Briefing, using existing graphite UI classes.
export function renderBriefingView({snapshot:b,history=[],loading=false,error='',
  strategies=[],selection='none',head,button,select,metric,esc,format,pct}){
  const strategySelect='<label class="control">Strategy '+select([
    ['none','No strategy selected'],...strategies.map(x=>[x.id,x.name])
  ],selection,'data-option="briefing-strategy"')+'</label>';
  const controls=strategySelect+button(loading?'Refreshing live scan…':'Generate / refresh briefing',
    'generate-briefing','primary')+(b?button('Copy briefing as text','copy-briefing','small'):'');
  const status=(error?'<div class="info-strip warning" role="alert">'+esc(error)+'</div>':'')+
    (loading?'<div class="info-strip" id="briefing-status" role="status">Fetching live Alpaca daily bars and building briefing…</div>':'');
  const source=(label,date)=>'<p class="briefing-source">Source: '+esc(label)+
    ' · bar date: '+esc(date||'unavailable')+'</p>';
  const historyBody=history.length?history.map((entry,i)=>{
    const previous=history[i+1],
      matchDelta=previous?entry.scan.matched-previous.scan.matched:null,
      longDelta=previous?entry.strategy.long.length-previous.strategy.long.length:null;
    const delta=n=>n==null?'':n>0?' (+'+n+' vs prior saved day)':n<0?' ('+n+' vs prior saved day)':' (unchanged)';
    return '<details class="briefing-history-row" data-briefing-date="'+esc(entry.date)+'"><summary>'+
      '<strong>'+esc(entry.date)+'</strong> · '+entry.scan.matched+' matches'+delta(matchDelta)+
      ' · '+entry.strategy.long.length+' LONG'+delta(longDelta)+' · '+esc(entry.regime.name)+
      ' · VXX '+(entry.vxx.close==null?'N/A':'$'+format(entry.vxx.close))+'</summary>'+
      '<div class="briefing-history-details"><p>Saved '+esc(entry.generatedAt)+' · '+
      esc(entry.source)+' · VXX 20D '+pct(entry.vxx.return20)+
      ' · VXX bar '+esc(entry.vxx.barDate||'unavailable')+'</p>'+
      '<p>Matches: '+esc(entry.matches.map(x=>x.symbol).join(', ')||'None')+'</p>'+
      '<p>LONG: '+esc(entry.strategy.long.map(x=>x.symbol).join(', ')||'None')+
      ' · Flips: '+esc(entry.strategy.flips.map(x=>x.symbol+' '+x.from+' → '+x.to).join(', ')||'None')+
      ' · Alerts: '+entry.alerts.items.length+' · Stale: '+entry.stale.items.length+
      '</p></div></details>';
  }).join(''):'<p class="section-note">No saved daily briefings in the last seven calendar days.</p>';
  const historySection='<section class="panel" id="briefing-history"><div class="panel-header">'+
    '<h2>Last 7 calendar days</h2><span class="muted">One snapshot per New York date · stored locally</span>'+
    '</div><div class="panel-body">'+historyBody+'</div></section>';
  const heading=head('Briefing','One-page daily market research from Alpaca OHLCV; never generated from Demo prices.',controls);
  if(!b)return heading+status+
    '<div class="info-strip warning">No live briefing generated in this session. '+
    'Use Generate / refresh briefing to load actual Alpaca OHLCV. Previous snapshots appear below.</div>'+
    historySection;
  const matchTable=b.matches.length?'<div class="table-wrap"><table class="data-table briefing-table">'+
    '<thead><tr><th>Symbol</th><th>Daily close</th><th>RSI 5D</th><th>Source</th>'+
    '<th>Bar date</th></tr></thead><tbody>'+b.matches.map(x=>'<tr data-briefing-match="'+
      esc(x.symbol)+'"><td>'+esc(x.symbol)+'</td><td>$'+format(x.price)+'</td>'+
      '<td>'+format(x.rsi5,1)+'</td><td>'+esc(x.source)+'</td><td>'+esc(x.barDate||'—')+
      '</td></tr>').join('')+'</tbody></table></div>':
      '<p class="section-note">No symbols match the current Screener conditions.</p>';
  const longRows=b.strategy.name?(b.strategy.long.length?b.strategy.long.map(x=>
    '<div class="briefing-line"><strong>'+esc(x.symbol)+'</strong> · LONG'+
    '<small>'+esc(x.source)+' · bar '+esc(x.barDate||'unknown')+'</small></div>').join(''):
    '<p class="section-note">No LONG positions for the selected strategy.</p>'):
    '<p class="section-note">Select a strategy to calculate LONG positions. Not evaluated is not FLAT.</p>';
  const flips=!b.strategy.name?'<p class="section-note">Select a strategy to compare scan-to-scan flips.</p>':
    !b.strategy.baselineAvailable?'<p class="section-note">No preceding comparable scan; flips cannot be verified yet.</p>':
    b.strategy.flips.length?b.strategy.flips.map(x=>'<div class="briefing-line">'+
      esc(x.symbol)+' '+esc(x.from)+' → '+esc(x.to)+' · '+esc(x.source)+
      ' · bar '+esc(x.barDate||'unknown')+'</div>').join(''):
    '<p class="section-note">No position flips since the preceding comparable scan.</p>';
  const activeAlerts=b.alerts.items.length?b.alerts.items.map(x=>'<div class="briefing-line">'+
    '<strong>'+esc(x.symbol)+'</strong> · '+esc(x.detail)+' · '+esc(x.status)+
    '<small>'+esc(x.source)+' · bar '+esc(x.barDate||'unknown')+'</small></div>').join(''):
    '<p class="section-note">No currently active or unread triggered alerts.</p>';
  const warnings=b.stale.items.length?b.stale.items.map(x=>'<div class="briefing-line">'+
    '<strong>'+esc(x.symbol)+'</strong> · '+esc(x.reason)+
    '<small>'+esc(x.source)+' · last bar '+esc(x.barDate||'missing')+'</small></div>').join(''):
    '<p class="section-note">No older or missing bars relative to the expected NYSE daily session.</p>';
  const panel=(id,title,label,date,body,extra='')=>'<section class="panel" id="'+id+'">'+
    '<div class="panel-header"><h2>'+title+'</h2>'+extra+'</div><div class="panel-body">'+
    source(label,date)+body+'</div></section>';
  return heading+status+
    '<div id="briefing-metadata" class="info-strip">US market date <strong>'+esc(b.date)+'</strong>'+
    ' · generated '+esc(b.generatedAt)+' · scan '+esc(b.scanAt||'unknown')+' · '+
    esc(b.source)+' · Research only; daily close is not a live last-trade price.</div>'+
    '<div class="metrics">'+metric('Symbols loaded',b.scan.loaded+'/'+b.scan.requested,
      b.scan.scope+' in current Screener scope')+
      metric('Scan matches',b.scan.matched,'Current Screener filter rules')+
      metric('LONG positions',b.strategy.name?b.strategy.long.length:'—',
        b.strategy.name||'No selected strategy')+
      metric('Stale warnings',b.stale.items.length,'Expected session '+(b.stale.expected||'unknown'))+
    '</div>'+
    panel('briefing-scan','Daily scan matches',b.scan.source,b.scan.barDate,matchTable,
      '<span class="muted">'+b.scan.matched+' matches</span>')+
    panel('briefing-signals','Strategy LONG / flips',b.strategy.source,b.strategy.barDate,
      '<h3>LONG ('+b.strategy.long.length+')</h3>'+longRows+
      '<h3>Flipped since preceding scan ('+b.strategy.flips.length+')</h3>'+flips,
      '<span class="muted">'+esc(b.strategy.name||'Not selected')+'</span>')+
    panel('briefing-regime','Contango regime read',b.regime.source,b.regime.barDate,
      '<div class="vol-regime">'+esc(b.regime.name)+'</div>'+
      '<p>VXZ − VXX 20D spread: '+pct(b.regime.relativeReturn20)+
      ' · SVXY/VXX ratio change: '+pct(b.regime.ratioTrend20)+'</p>'+
      '<p class="section-note">'+esc(b.regime.method)+'</p>',
      '<span class="source-badge">NOT VIX FUTURES CONTANGO</span>')+
    panel('briefing-vxx','VXX fact',b.vxx.source,b.vxx.barDate,
      '<div class="metrics">'+metric('VXX daily close',b.vxx.close==null?'—':'$'+format(b.vxx.close),
      'Actual Alpaca daily bar')+metric('VXX 20D return',pct(b.vxx.return20),
      'Close vs 20 sessions earlier')+'</div>')+
    panel('briefing-alerts','Active alerts',b.alerts.source,b.alerts.barDate,activeAlerts,
      '<span class="muted">'+b.alerts.items.length+' active or unread</span>')+
    panel('briefing-stale','Stale-data warnings',b.stale.source,b.stale.barDate,warnings,
      '<span class="muted">'+b.stale.items.length+' older or missing</span>')+
    historySection;
}
