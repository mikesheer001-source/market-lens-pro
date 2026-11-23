import {MAX_LEGS, PRESETS, boxRate, expirationTime, expiryPnl, expiryStats, initialDebit,
  quoteEstimates, scenarioPnl} from './options-payoff.js';
import {DEFAULT_ALPACA_WORKER} from './live-history.js';

const DAY = 86_400_000;
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;');
const currency = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const dollars = n => n === Infinity ? 'Unlimited' : n === -Infinity ? 'Unbounded' :
  n == null ? '—' : currency.format(n);
const num = (n, digits = 2) => n == null ? '—' : Number(n).toFixed(digits);
const pct = n => n == null ? '—' : num(n * 100) + '%';
const premium = n => n == null ? '—' : dollars(Math.abs(n)) + (n < 0 ? ' credit' : ' debit');
const localDate = (t = Date.now()) => new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',dateStyle:'short'}).format(t);
const usTime = t => new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',
  month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(t));
const numeric = v => v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v);
const index = symbol => ['SPX','SPXW','XSP'].includes(symbol);
const maxLegMessage = 'The builder supports up to eight legs.';
const FIELDS = ['delta','gamma','theta','vega','rho'];
const feedName = feed => feed === 'opra' ? 'Real-time OPRA' : 'Indicative';

function option(value, label = value, selected = false) {
  return '<option value="'+esc(value)+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>';
}
function expiryLabel(leg) {
  if (!leg.root || !index(leg.root)) return '';
  return leg.root === 'SPX' ? 'SPX AM' : leg.root+' PM';
}
function quoteAge(quote) {
  const time = Date.parse(quote?.time);
  if (!Number.isFinite(time)) return 'No quote';
  return usTime(time) + (Date.now() - time > 120_000 ? ' · 2m+ old' : '');
}
function quoteCells(leg) {
  const q = leg.quote;
  return q ? esc(dollars(q.bid)+' / '+dollars(q.ask))+'<small>'+esc(quoteAge(q))+'</small>' : '—';
}
function graph({price, high, low, points, expiry, pointAt, focus, marker}) {
  const w = 760, h = 310, l = 78, r = 22, t = 22, b = 46;
  const x = v => l + (w-l-r) * (v-low)/(high-low);
  const min = Math.min(0,...points.flatMap(p => [p.at,p.end]));
  const max = Math.max(0,...points.flatMap(p => [p.at,p.end]));
  const padding = Math.max(1,(max-min)*0.11);
  const y = v => t + (h-t-b) * (max+padding-v)/(max-min+2*padding);
  const path = key => points.map((p,i) => (i?'L':'M')+x(p.x).toFixed(1)+' '+y(p[key]).toFixed(1)).join(' ');
  const yGrid = Array.from({length:5},(_,i) => min+(max-min)*i/4).map(v =>
    '<line x1="'+l+'" x2="'+(w-r)+'" y1="'+y(v)+'" y2="'+y(v)+'"/>'+
    '<text x="'+(l-8)+'" y="'+(y(v)+4)+'" text-anchor="end">'+esc(dollars(v))+'</text>').join('');
  const xGrid = Array.from({length:6},(_,i) => low+(high-low)*i/5).map(v =>
    '<line y1="'+t+'" y2="'+(h-b)+'" x1="'+x(v)+'" x2="'+x(v)+'"/>'+
    '<text x="'+x(v)+'" y="'+(h-b+20)+'" text-anchor="middle">'+esc(dollars(v))+'</text>').join('');
  const spotLine = v => '<line y1="'+t+'" y2="'+(h-b)+'" x1="'+x(v)+'" x2="'+x(v)+'" class="options-reference"/>';
  return '<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Profit and loss versus underlying price">'+
    '<g class="options-grid">'+yGrid+xGrid+'</g><line x1="'+l+'" x2="'+(w-r)+'" y1="'+y(0)+'" y2="'+y(0)+'" class="options-zero"/>'+
    (price >= low && price <= high ? spotLine(price) : '')+
    '<path d="'+path('end')+'" class="options-end"/>'+
    (expiry ? '' : '<path d="'+path('at')+'" class="options-at"/>')+
    '<circle cx="'+x(focus)+'" cy="'+y(pointAt)+'" r="5" class="options-marker">'+
    '<title>'+esc(dollars(focus)+' underlying · '+dollars(pointAt)+' P&L')+'</title></circle>'+
    '<text x="'+(w-r)+'" y="'+(h-6)+'" text-anchor="end">Underlying price</text></svg>'+
    '<div class="options-chart-legend"><span class="end">'+esc(marker)+'</span>'+
    (expiry?'':'<span class="at">Selected date model</span>')+'</div>';
}

export function createOptionsBuilder() {
  let root, timer, pending, generation = 0;
  let ownerToken = '', feed = 'indicative', expirations = [], chain = [], feedVerified = false, nextPoll = 0;
  let message = '', spotSource = '';
  const state = {
    symbol:'SPY', price:'', width:'0.15', expiry:'', legs:[], fee:'0', package:'', preset:'',
    iv:'25', shift:'0', rate:'4', dividend:'0', focus:50, time:0
  };
  const $ = name => root.querySelector('[data-ob="'+name+'"]');
  const manualExpiry = days => localDate(Date.now()+DAY*days);
  const active = () => root?.isConnected;
  const setMessage = value => {
    message = value;
    if (active()) $('status').textContent = message;
  };
  const cancel = () => {
    generation++;
    pending?.abort();
    pending = null;
  };
  function resetQuotes() {
    cancel();
    chain = [];
    expirations = [];
    feedVerified = false;
    state.legs = state.legs.map(leg => ({...leg,quote:null}));
    nextPoll = 0;
  }
  async function request(path, params, signal) {
    const base = ['localhost','127.0.0.1'].includes(location.hostname) ?
      root.dataset.worker : DEFAULT_ALPACA_WORKER;
    const url = new URL('/api/options/'+path,base || DEFAULT_ALPACA_WORKER);
    url.search = new URLSearchParams({feed,...params}).toString();
    const response = await fetch(url,{headers:{Authorization:'Bearer '+ownerToken},signal,cache:'no-store'});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 429) nextPoll = Date.now()+1000*(Number(response.headers.get('Retry-After')) || 60);
      throw new Error(data.error || 'Quote request failed (HTTP '+response.status+').');
    }
    if (data.feed !== feed) throw new Error('The quote source changed. Reconnect to refresh.');
    return data;
  }
  function endRequest(current) {
    if (generation === current) pending = null;
  }
  async function loadChain(expiry, signal) {
    return (await request('chain',{
      symbol:state.symbol,expiry,center:state.price,width:state.width
    },signal)).contracts || [];
  }
  async function refreshChain({discover = false} = {}) {
    if (!ownerToken) return setMessage('Enter the owner access code to access Alpaca quotes.');
    if (Date.now() < nextPoll) return setMessage('The quote rate limit was reached. Retry after '+usTime(nextPoll)+'.');
    cancel();
    const current = generation;
    pending = new AbortController();
    const {signal} = pending;
    setMessage('Loading Alpaca '+(discover?'expirations…':'chain…'));
    try {
      if (discover) {
        const data = await request('expirations',{symbol:state.symbol},signal);
        if (current !== generation) return;
        expirations = data.expirations || [];
        state.expiry = expirations.includes(state.expiry) ? state.expiry : expirations[0] || '';
        if (data.underlying?.value) {
          state.price = String(data.underlying.value);
          $('price').value = state.price;
          $('spot-source').textContent = spotSource = data.underlying.feed+' · '+quoteAge({time:data.underlying.time});
        }
        renderExpiry();
      }
      if (!state.expiry || !(numeric(state.price) > 0)) {
        setMessage(expirations.length ? 'Enter an underlying reference price to load the chain.' :
          'No supported expirations returned for '+state.symbol+'.');
        return;
      }
      const data = await loadChain(state.expiry,signal);
      if (current !== generation) return;
      chain = data;
      feedVerified = chain.some(row => Number.isFinite(Date.parse(row.quote?.time)));
      renderChain();
      setMessage(feedVerified ? feedName(feed)+' · '+chain.length+' contracts' :
        'No timestamped '+feedName(feed)+' quotes in this strike range.');
      setLegQuotes(Object.fromEntries(chain.filter(row => row.quote).map(row => [row.symbol,row.quote])));
      refreshMarks();
    } catch (error) {
      if (current === generation && error.name !== 'AbortError') {
        chain = [];
        renderChain();
        setMessage(error.message);
      }
    } finally { endRequest(current); }
  }
  function setLegQuotes(quotes, clearMissing = false) {
    for (const leg of state.legs) {
      if (leg.symbol && (Object.hasOwn(quotes,leg.symbol) || clearMissing)) {
        leg.quote = quotes[leg.symbol] ?? null;
        const row = $('legs').querySelector('[data-quote-row="'+state.legs.indexOf(leg)+'"]');
        if (row) row.innerHTML = quoteCells(leg);
      }
    }
  }
  async function poll(force = false) {
    if (!active() || !ownerToken || pending || document.hidden || Date.now() < nextPoll) return;
    const symbols = [...new Set(state.legs.map(leg => leg.symbol).filter(Boolean))];
    if (!symbols.length || !feedVerified) {
      if (force) await refreshChain({discover:!expirations.length});
      return;
    }
    const current = ++generation;
    pending = new AbortController();
    try {
      const data = await request('snapshots',{symbols:symbols.join(',')},pending.signal);
      if (current !== generation) return;
      setLegQuotes(data.quotes || {},true);
      refreshMarks();
      if (force) setMessage(feedName(feed)+' · selected leg quotes refreshed');
    } catch (error) {
      if (current === generation && error.name !== 'AbortError')
        setMessage(error.message+' Displayed marks retain their last quote times.');
    } finally { endRequest(current); }
  }

  function renderExpiry() {
    $('expiry').innerHTML = expirations.length ? expirations.map(date => option(date,date,date===state.expiry)).join('') :
      option('','Connect to load expirations');
  }
  function renderChain() {
    const body = $('chain');
    body.innerHTML = chain.length ? chain.map((row,i) => {
      const q = row.quote;
      const wide = q?.ask > 0 && (q.bid === 0 || (q.ask-q.bid)/q.ask >= .25);
      return '<tr><td>'+esc(row.type==='call'?'Call':'Put')+'</td><td>'+dollars(row.strike)+
        '<small>'+esc(expiryLabel(row))+'</small></td><td>'+dollars(q?.bid)+' / '+dollars(q?.ask)+
        (wide?'<small class="options-wide">Wide spread</small>':'')+'</td><td>'+esc(quoteAge(q))+'</td>'+
        '<td>'+pct(q?.iv)+'</td><td>'+num(row.openInterest,0)+(row.openInterestDate?'<small>'+esc(row.openInterestDate)+'</small>':'')+
        '</td><td><button type="button" class="btn small" data-chain="'+i+'" data-side="buy">Buy</button> '+
        '<button type="button" class="btn small" data-chain="'+i+'" data-side="sell">Sell</button></td></tr>';
    }).join('') : '<tr><td colspan="7" class="muted">No chain loaded.</td></tr>';
  }
  function addLeg(leg) {
    if (state.legs.length >= MAX_LEGS) return setMessage(maxLegMessage);
    state.legs.push(leg);
    renderLegs();
    refreshMarks();
  }
  function manualLeg({side='buy',type='call',strike,expiry=state.expiry || manualExpiry(30),quantity=1} = {}) {
    return {side,type,strike:strike ?? numeric(state.price) ?? '',expiry,quantity,entry:'',
      root:index(state.symbol)? state.symbol : '',multiplier:100};
  }
  function marketLeg(row,side,quantity=1) {
    const q = row.quote;
    const entry = q?.ask > 0 && q?.bid != null && q.bid >= 0 && q.bid <= q.ask ? Number(((q.bid+q.ask)/2).toFixed(4)) : '';
    return {...row,side,quantity,entry};
  }
  function renderLegs() {
    const val = (leg,key) => esc(leg[key]);
    const field = (i,key,html) => html.replace(' data-field', ' data-field="'+key+'" data-leg="'+i+'" aria-label="Leg '+(i+1)+' '+key+'"');
    $('legs').innerHTML = state.legs.length ? state.legs.map((leg,i) => '<tr>'+
      '<td>'+field(i,'side','<select data-field>'+option('buy','Buy',leg.side==='buy')+option('sell','Sell',leg.side==='sell')+'</select>')+'</td>'+
      '<td>'+field(i,'type','<select data-field>'+option('call','Call',leg.type==='call')+option('put','Put',leg.type==='put')+'</select>')+'</td>'+
      '<td>'+field(i,'strike','<input data-field type="number" min="0.01" max="1000000" step="any" value="'+val(leg,'strike')+'">')+'</td>'+
      '<td>'+field(i,'expiry','<input data-field type="date" value="'+val(leg,'expiry')+'">')+
      (state.symbol==='SPX'?field(i,'root','<select data-field>'+option('SPX','SPX AM',leg.root==='SPX')+option('SPXW','SPXW PM',leg.root==='SPXW')+'</select>'):'')+'</td>'+
      '<td>'+field(i,'quantity','<input data-field type="number" min="1" max="10000" step="1" value="'+val(leg,'quantity')+'">')+'</td>'+
      '<td>'+field(i,'entry','<input data-field type="number" min="0" max="1000000" step="any" value="'+val(leg,'entry')+'">')+'</td>'+
      '<td data-quote-row="'+i+'">'+quoteCells(leg)+'</td>'+
      '<td><button type="button" class="btn small" data-remove="'+i+'" aria-label="Remove leg '+(i+1)+'">Remove</button></td></tr>').join('') :
      '<tr><td colspan="8" class="muted">Add a manual leg, choose a preset, or select a contract from the chain.</td></tr>';
  }
  async function applyPreset() {
    const definition = PRESETS[state.preset];
    if (!definition) return;
    const spot = numeric(state.price);
    if (!(spot > 0 && spot <= 1e6)) return setMessage('Enter the underlying reference price before applying a preset.');
    cancel();
    const first = state.expiry || manualExpiry(30);
    const second = expirations.find(date => date > first) || localDate(Date.parse(first+'T16:00:00Z')+DAY*30);
    let farChain = [];
    if (chain.length && definition.some(leg => leg[4]) && expirations.includes(second)) {
      const current = generation;
      pending = new AbortController();
      try { farChain = await loadChain(second,pending.signal); }
      catch (error) { if (current === generation) setMessage(error.message); }
      finally { endRequest(current); }
      if (current !== generation) return;
    }
    const requiredOffsets = definition.map(leg => leg[2]);
    const candidates = chain.filter(row => !index(state.symbol) || row.root === state.symbol ||
      (state.symbol === 'SPX' && row.root === 'SPXW'));
    const group = candidates.some(row => row.root === 'SPXW') ?
      candidates.filter(row => row.root === 'SPXW') : candidates;
    const strikes = [...new Set(group.map(row => row.strike))].sort((a,b) => a-b);
    const minAtm = Math.max(0,-Math.min(...requiredOffsets));
    const maxAtm = Math.min(strikes.length-1,strikes.length-1-Math.max(...requiredOffsets));
    const plausible = strikes.map((value,i) => ({value,i})).slice(minAtm,maxAtm+1).sort((a,b) =>
      Math.abs(a.value-spot)-Math.abs(b.value-spot));
    const step = Math.max(0.05,Math.round(spot*0.025*20)/20);
    const middle = plausible.find(({i}) => definition.every(([,type,offset,,later]) =>
      (later ? farChain : group).some(row => row.strike===strikes[i+offset] && row.type===type &&
        (!group[0] || row.root === group[0].root))));
    state.legs = definition.map(([side,type,offset,quantity=1,later]) => {
      if (middle) {
        const row = (later ? farChain : group).find(row => row.strike===strikes[middle.i+offset] &&
          row.type===type && row.root===group[0].root);
        return marketLeg(row,side,quantity);
      }
      return manualLeg({side,type,strike:Number(Math.max(.01,spot+offset*step).toFixed(2)),expiry:later?second:first,quantity});
    });
    setMessage(middle ? 'Preset applied using listed strikes. Entry premiums are editable.' :
      'Manual preset applied. Enter the leg premiums or a net package price.');
    state.package = $('package').value = '';
    renderLegs();
    refreshMarks();
  }

  function refreshMarks() {
    if (!active()) return;
    const fee = numeric(state.fee);
    const validFee = fee >= 0 && fee != null && fee <= 10000;
    const legs = state.legs.map(leg => ({...leg,strike:numeric(leg.strike),quantity:numeric(leg.quantity),
      entry:numeric(leg.entry),expiresAt:expirationTime(leg)}));
    const price = numeric(state.price);
    const estimates = validFee ? quoteEstimates(legs,fee) : null;
    $('estimates').innerHTML = estimates ?
      '<span>Quote midpoint <strong>'+premium(estimates.mid)+'</strong></span>'+
      '<span>Buy at ask / sell at bid <strong>'+premium(estimates.natural)+'</strong></span>'+
      '<button type="button" class="btn small" data-ob="use-mid">Use midpoint as entry</button>'+
      '<button type="button" class="btn small" data-ob="use-natural">Use bid/ask as entry</button>' :
      '<span>Both sides of every leg’s quote are needed for package estimates.</span>';
    const showEmpty = text => {
      $('metrics').innerHTML = '';
      $('greeks').textContent = '';
      $('plot').textContent = text;
      $('grid').innerHTML = '';
      $('range').hidden = true;
    };
    if (!legs.length) return showEmpty('Add legs to see your strategy payoff.');
    if (legs.some(leg => !(leg.strike > 0 && leg.strike <= 1e6) ||
      !Number.isInteger(leg.quantity) || leg.quantity < 1 || leg.quantity > 10000 || !Number.isFinite(leg.expiresAt)))
      return showEmpty('Enter a valid strike, expiration, and quantity for every leg.');
    if (!validFee) return showEmpty('Enter a valid fee per contract.');
    const pkg = numeric(state.package);
    if (state.package !== '' && (pkg == null || Math.abs(pkg)>1e9)) return showEmpty('Enter a valid signed package price.');
    if (pkg == null && legs.some(leg => leg.entry == null || leg.entry < 0 || leg.entry > 1e6))
      return showEmpty('Enter the premium for each leg or a signed package price.');
    const debit = pkg == null ? initialDebit(legs,fee) : pkg + legs.reduce((sum,leg) => sum+fee*leg.quantity,0);
    const dates = legs.map(leg => leg.expiresAt);
    const expiry = Math.min(...dates);
    const single = dates.every(t => t === expiry);
    const now = Date.now();
    const start = Math.min(now,expiry);
    const at = Math.round(start+(expiry-start)*state.time/100);
    const iv = numeric(state.iv), shift = numeric(state.shift), rate = numeric(state.rate), dividend = numeric(state.dividend);
    const validModel = [iv,shift,rate,dividend].every(v => v != null) && iv > 0 && iv <= 500 &&
      Math.abs(shift)<=500 && Math.abs(rate)<=100 && dividend>=0 && dividend<=100;
    const model = {iv:iv/100,shift:shift/100,rate:rate/100,dividend:dividend/100};
    const stats = single ? expiryStats(legs,debit) : null;
    const box = boxRate(legs,debit,now,expiry);
    const allowFuture = validModel && at !== expiry;
    const metrics = [['Net entry incl. fees',premium(debit)],
      ['Max profit',stats ? dollars(stats.high) : 'Model-dependent'],
      ['Max loss',stats ? dollars(stats.low === -Infinity ? -Infinity : Math.max(0,-stats.low)) : 'Model-dependent'],
      ['Breakevens',stats ? [...stats.roots.map(dollars),...stats.flat.map(([a,b]) =>
        dollars(a)+(b===Infinity?'+':'–'+dollars(b)))].join(', ') || 'None' : 'Model-dependent']];
    if (box) {
      metrics.push(['Settlement cash flow',dollars(box.payout)],['Days to settlement',num(Math.max(0,box.days),1)],
        [box.payout > 0 ? 'Annualized lending yield' : 'Annualized borrowing cost',pct(box.annualized)]);
      if (estimates) metrics.push(['Annualized at quote midpoint',pct(boxRate(legs,estimates.mid,now,expiry)?.annualized)]);
    }
    $('metrics').innerHTML = metrics.map(([label,value]) => '<div><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>').join('');
    if (!validModel && !single) {
      $('plot').textContent = 'Enter valid IV, rate, and dividend inputs for mixed expirations.';
      $('range').hidden = true;
      $('grid').innerHTML = '';
      return;
    }
    const strikes = legs.map(leg => leg.strike);
    const center = price > 0 && price <= 1e6 ? price : (Math.min(...strikes)+Math.max(...strikes))/2;
    const span = Math.max(center*.18, (Math.max(...strikes)-Math.min(...strikes))*.25, .1);
    const low = Math.max(0,Math.min(center-span,Math.min(...strikes)-span/2));
    const high = Math.max(center+span,Math.max(...strikes)+span/2);
    const focus = low + (high-low)*state.focus/100;
    const terminal = x => single ? expiryPnl(legs,x,debit) : scenarioPnl(legs,x,expiry,debit,model);
    const pnlAt = (x,when) => when===expiry ? terminal(x) : scenarioPnl(legs,x,when,debit,model);
    const prices = [...new Set([...Array.from({length:81},(_,i) => low+(high-low)*i/80),...strikes])].sort((a,b)=>a-b);
    const points = prices.map(x => ({x,end:terminal(x),at:allowFuture ? pnlAt(x,at) : terminal(x)}));
    const pointAt = allowFuture ? pnlAt(focus,at) : terminal(focus);
    $('plot').innerHTML = graph({price,high,low,points,expiry:!allowFuture,pointAt,focus,
      marker:single?'Expiration payoff':'First expiry model'});
    $('range').hidden = false;
    $('date-output').textContent = (allowFuture || at === expiry ? usTime(at) : usTime(expiry)) +
      (!validModel ? ' · Enter valid model inputs for earlier dates' : '');
    $('price-output').textContent = dollars(focus)+' underlying · '+dollars(pointAt)+' P&L';
    $('scenario-time').disabled = expiry <= now;
    const datesGrid = validModel ? [...new Set([start,Math.round((expiry+start)/2),expiry])] : [expiry];
    const gridPrices = Array.from({length:9},(_,i) => high-(high-low)*i/8);
    $('grid').innerHTML = '<table class="data-table"><caption>Scenario P&L in dollars</caption><thead><tr><th>Underlying</th>'+
      datesGrid.map(time=>'<th>'+esc(usTime(time))+'</th>').join('')+'</tr></thead><tbody>'+
      gridPrices.map(x=>'<tr><th>'+dollars(x)+'</th>'+datesGrid.map(time=>{
        const pnl = pnlAt(x,time);
        return '<td class="'+(pnl>=0?'positive':'negative')+'">'+dollars(pnl)+'</td>';
      }).join('')+'</tr>').join('')+'</tbody></table>';
    const aggregated = FIELDS.map(key => {
      const total = legs.every(leg => Number.isFinite(leg.quote?.greeks?.[key])) ?
        legs.reduce((sum,leg)=>sum+leg.quote.greeks[key]*leg.quantity*leg.multiplier*(leg.side==='buy'?1:-1),0) : null;
      return key.charAt(0).toUpperCase()+key.slice(1)+' '+num(total);
    });
    $('greeks').textContent = legs.some(leg => leg.quote) ? 'Quote Greeks · '+aggregated.join(' · ') : '';
  }

  function action(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const {ob,remove,chain:chainIndex,side} = button.dataset;
    if (ob==='manual') addLeg(manualLeg());
    if (ob==='preset-apply') void applyPreset();
    if (ob==='refresh-chain') void refreshChain({discover:!expirations.length});
    if (ob==='refresh-legs') void poll(true);
    if (ob==='disconnect') {
      ownerToken = '';
      resetQuotes();
      renderExpiry();
      renderChain();
      renderLegs();
      refreshMarks();
      $('owner-code').value = '';
      setMessage('Owner quotes disconnected.');
    }
    if (ob==='use-mid' || ob==='use-natural') {
      if (state.legs.some(leg => !(leg.quote?.ask > 0 && leg.quote.bid != null && leg.quote.bid >= 0 && leg.quote.bid <= leg.quote.ask))) return;
      state.legs.forEach(leg => {
        const {bid,ask} = leg.quote;
        leg.entry = ob==='use-mid' ? ((bid+ask)/2).toFixed(4) : String(leg.side==='buy'?ask:bid);
      });
      state.package = $('package').value = '';
      renderLegs();
      refreshMarks();
    }
    if (ob==='clear') {
      state.legs = [];
      state.package = $('package').value = '';
      renderLegs();
      refreshMarks();
    }
    if (remove !== undefined) {
      state.legs.splice(Number(remove),1);
      renderLegs();
      refreshMarks();
    }
    if (chainIndex !== undefined && chain[chainIndex]) addLeg(marketLeg(chain[chainIndex],side));
  }
  function control(event) {
    const el = event.target;
    const {ob,field,leg:row} = el.dataset;
    if (field && state.legs[row]) {
      const leg = state.legs[row];
      if (leg[field] === el.value) return;
      leg[field] = el.value;
      if (['strike','type','expiry','root'].includes(field)) {
        leg.symbol = null;
        leg.quote = null;
        const cell = $('legs').querySelector('[data-quote-row="'+row+'"]');
        cell.textContent = '—';
      }
      refreshMarks();
      return;
    }
    if (ob==='symbol' && event.type==='change') {
      const next = el.value.toUpperCase().trim();
      el.value = next;
      if (next === state.symbol) return;
      if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(next)) {
        el.value = state.symbol;
        return setMessage('Enter a valid U.S. ticker.');
      }
      state.symbol = next;
      state.price = $('price').value = '';
      $('spot-source').textContent = spotSource = '';
      state.expiry = '';
      state.legs = [];
      state.package = $('package').value = '';
      resetQuotes();
      renderExpiry();
      renderChain();
      renderLegs();
      refreshMarks();
      if (ownerToken) void refreshChain({discover:true});
    }
    if (ob==='feed' && event.type==='change' && el.value !== feed) {
      feed = el.value;
      resetQuotes();
      renderLegs();
      renderChain();
      renderExpiry();
      refreshMarks();
      if (ownerToken) void refreshChain({discover:true});
    }
    if (ob==='expiry' && event.type==='change' && el.value !== state.expiry) {
      state.expiry = el.value;
      void refreshChain();
    }
    if (['price','fee','package','width','iv','rate','dividend','shift','preset'].includes(ob) && state[ob] !== el.value) {
      state[ob] = el.value;
      if (ob==='price') $('spot-source').textContent = spotSource = 'Manual reference';
      if (ob!=='preset') refreshMarks();
    }
    if (ob==='scenario-price' || ob==='scenario-time') {
      state[ob==='scenario-price'?'focus':'time'] = Number(el.value);
      refreshMarks();
    }
  }
  function mount(host, worker) {
    root = host;
    host.dataset.worker = worker;
    root.innerHTML = '<div class="headrow"><div><h1>Options Builder</h1>'+
      '<p class="subtle">Build and price multi-leg strategies for U.S. stocks, ETFs, SPX, and XSP.</p></div></div>'+
      '<div class="panel options-controls"><div class="panel-header"><h2>Strategy</h2></div><div class="panel-body">'+
      '<div class="options-fields"><label class="field">Ticker<input data-ob="symbol" maxlength="10" value="'+esc(state.symbol)+'"></label>'+
      '<label class="field">Underlying reference price<input data-ob="price" type="number" min="0.01" step="any" value="'+esc(state.price)+'"><small data-ob="spot-source">'+esc(spotSource)+'</small></label>'+
      '<label class="field">Strategy preset<select data-ob="preset">'+option('','Choose a preset')+
      Object.keys(PRESETS).map(name=>option(name,name,state.preset===name)).join('')+'</select></label>'+
      '<button type="button" class="btn" data-ob="preset-apply">Apply preset</button><a class="btn" href="#options-chain">View chain</a></div>'+
      '<details class="options-owner"><summary>Connect Alpaca owner quotes</summary>'+
      '<form class="options-fields" data-ob="connect"><label class="field">Owner access code<input data-ob="owner-code" type="password" autocomplete="off" aria-describedby="options-owner-help"></label>'+
      '<label class="field">Options feed<select data-ob="feed">'+option('opra','Real-time OPRA',feed==='opra')+
      option('indicative','Indicative',feed==='indicative')+'</select></label>'+
      '<button type="submit" class="btn primary">Connect</button><button type="button" class="btn" data-ob="disconnect">Disconnect</button></form>'+
      '<p id="options-owner-help" class="section-note">Use the separate Worker access code. Indicative quotes are modified and trades are delayed.</p></details>'+
      '<p class="options-status muted" role="status" data-ob="status">'+esc(message)+'</p></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Legs</h2><div class="flex">'+
      '<button type="button" class="btn small" data-ob="refresh-legs">Refresh prices</button>'+
      '<button type="button" class="btn small" data-ob="clear">Clear</button>'+
      '<button type="button" class="btn small primary" data-ob="manual">Add manual leg</button></div></div>'+
      '<div class="table-wrap"><table class="data-table options-legs"><thead><tr><th>Side</th><th>Type</th><th>Strike</th><th>Expiration</th>'+
      '<th>Contracts</th><th>Entry per unit</th><th>Bid / ask</th><th></th></tr></thead><tbody data-ob="legs"></tbody></table></div>'+
      '<div class="panel-body"><div class="options-fields"><label class="field">Entry fee per contract<input data-ob="fee" type="number" min="0" step="any" value="'+esc(state.fee)+'"></label>'+
      '<label class="field">Net package premium in dollars<input data-ob="package" type="number" step="any" placeholder="Optional · credit is negative" value="'+esc(state.package)+'"></label></div>'+
      '<div class="options-estimates muted" data-ob="estimates"></div><div class="subtle" data-ob="greeks"></div></div></div>'+
      '<div class="panel"><div class="panel-header"><h2>Payoff</h2></div><div class="panel-body">'+
      '<div class="options-metrics" data-ob="metrics"></div><div class="options-plot" data-ob="plot"></div>'+
      '<div class="options-ranges" data-ob="range" hidden><label class="field">Scenario date<input data-ob="scenario-time" type="range" min="0" max="100" value="'+state.time+'"><output data-ob="date-output"></output></label>'+
      '<label class="field">Scenario underlying price<input data-ob="scenario-price" type="range" min="0" max="100" value="'+state.focus+'"><output data-ob="price-output"></output></label></div>'+
      '<details><summary>Pricing assumptions and scenario table</summary><div class="options-fields options-assumptions">'+
      '<label class="field">Fallback IV (%)<input data-ob="iv" type="number" min="0.01" step="any" value="'+esc(state.iv)+'"></label>'+
      '<label class="field">IV shift (points)<input data-ob="shift" type="number" step="any" value="'+esc(state.shift)+'"></label>'+
      '<label class="field">Risk-free rate (%)<input data-ob="rate" type="number" step="any" value="'+esc(state.rate)+'"></label>'+
      '<label class="field">Dividend yield (%)<input data-ob="dividend" type="number" min="0" step="any" value="'+esc(state.dividend)+'"></label></div>'+
      '<p class="section-note">Pre-expiry uses European Black–Scholes with per-leg quoted IV when available. It estimates P&L through the first expiration and assumes settlement at the scenario price. Exercise and assignment, exit fees, and exchange schedule exceptions are outside the model.</p>'+
      '<div class="table-wrap" data-ob="grid"></div></details></div></div>'+
      '<div class="panel" id="options-chain"><div class="panel-header"><h2>Options chain</h2></div><div class="panel-body options-fields">'+
      '<label class="field">Expiration<select data-ob="expiry"></select></label>'+
      '<label class="field">Strike window<select data-ob="width">'+[['0.05','±5%'],['0.10','±10%'],['0.15','±15%'],['0.30','±30%'],['0.6','±60%']].map(([v,label])=>option(v,label,v===state.width)).join('')+
      '</select></label><button type="button" class="btn" data-ob="refresh-chain">Load chain</button></div>'+
      '<div class="table-wrap options-chain"><table class="data-table"><thead><tr><th>Type</th><th>Strike</th><th>Bid / ask</th><th>Quote time</th><th>IV</th><th>Open interest</th><th></th></tr></thead><tbody data-ob="chain"></tbody></table></div></div>';
    root.addEventListener('click',action);
    root.addEventListener('input',control);
    root.addEventListener('change',control);
    $('connect').addEventListener('submit',event => {
      event.preventDefault();
      const code = $('owner-code').value.trim();
      if (!code && !ownerToken) return setMessage('Enter the owner access code.');
      if (code && !/^[A-Za-z0-9_-]{32,128}$/.test(code)) return setMessage('Enter a valid owner access code.');
      if (code && code !== ownerToken) {
        resetQuotes();
        renderChain();
        renderLegs();
        refreshMarks();
      }
      ownerToken = code || ownerToken;
      $('owner-code').value = '';
      void refreshChain({discover:true});
    });
    renderExpiry();
    renderChain();
    renderLegs();
    refreshMarks();
    timer = setInterval(poll,20_000);
  }
  return {mount,unmount() {
    clearInterval(timer);
    cancel();
    root = null;
  }};
}
