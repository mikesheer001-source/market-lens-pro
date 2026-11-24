import {MAX_LEGS, PRESETS, boxRate, expirationTime, expiryPnl, expiryStats, initialDebit,
  netGreeks, quoteEstimates, scenarioPnl} from './options-payoff.js';
import {nearestStrike, strikeDomain, strikeTargets, groupStrikeTargets} from './options-strike-ruler.js';
import {OPTIONS_DEVICE_KEY, getOptionsDevice, optionsApiUrl, requestOptions} from './options-api.js';

const DAY = 86_400_000;
const PENDING_KEY = 'market-lens-options-device-pending-v1';
const devicePattern = /^[a-f0-9]{64}$/;
export const optionsApprovalLink = () => new URLSearchParams(location.hash.slice(1)).get('options-setup');
const randomDevice = () => Array.from(crypto.getRandomValues(new Uint8Array(32)),
  byte => byte.toString(16).padStart(2,'0')).join('');

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
const shortPrice = new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
const expiryFormat = new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const monthFormat = new Intl.DateTimeFormat('en-US',{month:'short',year:'2-digit',timeZone:'UTC'});
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const strikeLabel = leg => shortPrice.format(leg.strike)+(leg.type==='call'?'C':'P');

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
function graph({width, price, high, low, points, expiry, pointAt, focus, marker, roots}) {
  const w = width, h = width < 480 ? 275 : 345, l = width < 480 ? 58 : 72, r = 20, t = 24, b = 42;
  const axisMoney = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2});
  const x = v => l + (w-l-r) * (v-low)/(high-low);
  const min = Math.min(0,...points.flatMap(p => [p.at,p.end]));
  const max = Math.max(0,...points.flatMap(p => [p.at,p.end]));
  const padding = Math.max(1,(max-min)*0.11);
  const y = v => t + (h-t-b) * (max+padding-v)/(max-min+2*padding);
  const path = key => points.map((p,i) => (i?'L':'M')+x(p.x).toFixed(1)+' '+y(p[key]).toFixed(1)).join(' ');
  const zero = y(0);
  const area = path('end')+' L'+x(high)+' '+zero+' L'+x(low)+' '+zero+' Z';
  const clip = (id, top, height) => '<clipPath id="options-'+id+'"><rect x="'+l+'" y="'+top+'" width="'+(w-l-r)+'" height="'+height+'"/></clipPath>';
  const ticks = (n, min, max) => Array.from({length:n},(_,i) => min+(max-min)*i/(n-1));
  const yGrid = [...new Set(ticks(5,min,max))].map(v =>
    '<line x1="'+l+'" x2="'+(w-r)+'" y1="'+y(v)+'" y2="'+y(v)+'"/>'+
    '<text x="'+(l-8)+'" y="'+(y(v)+4)+'" text-anchor="end">'+esc(axisMoney.format(v))+'</text>').join('');
  const xGrid = ticks(width < 480 ? 4 : 6,low,high).map(v =>
    '<line y1="'+t+'" y2="'+(h-b)+'" x1="'+x(v)+'" x2="'+x(v)+'"/>'+
    '<text x="'+x(v)+'" y="'+(h-b+20)+'" text-anchor="middle">'+esc(axisMoney.format(v))+'</text>').join('');
  const spotLine = v => '<line y1="'+t+'" y2="'+(h-b)+'" x1="'+x(v)+'" x2="'+x(v)+'" class="options-reference"/>';
  return '<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Profit and loss versus underlying price">'+
    '<defs>'+clip('gain',t,zero-t)+clip('loss',zero,h-b-zero)+'</defs>'+
    '<g class="options-grid">'+yGrid+xGrid+'</g><line x1="'+l+'" x2="'+(w-r)+'" y1="'+y(0)+'" y2="'+y(0)+'" class="options-zero"/>'+
    (price >= low && price <= high ? spotLine(price) : '')+
    ['gain','loss'].map(kind => '<g class="options-'+kind+'" clip-path="url(#options-'+kind+')">'+
      '<path d="'+area+'" class="options-area"/><path d="'+path('end')+'" class="options-end"/></g>').join('')+
    roots.filter(value => value > low && value < high).map(value =>
      '<line x1="'+x(value)+'" x2="'+x(value)+'" y1="'+t+'" y2="'+(h-b)+'" class="options-breakeven"><title>'+
      esc('Breakeven '+dollars(value))+'</title></line>').join('')+
    (expiry ? '' : '<path d="'+path('at')+'" class="options-at"/>')+
    '<circle cx="'+x(focus)+'" cy="'+y(pointAt)+'" r="5" class="options-marker">'+
    '<title>'+esc(dollars(focus)+' underlying · '+dollars(pointAt)+' P&L')+'</title></circle>'+
    '<text x="'+(w-r)+'" y="'+(h-6)+'" text-anchor="end">Underlying price</text></svg>'+
    '<div class="options-chart-legend"><span class="end">'+esc(marker)+'</span>'+
    (expiry?'':'<span class="at">Selected date model</span>')+'</div>';
}

export function createOptionsBuilder({onPositionsChange=()=>{}}={}) {
  let root, timer, pending, generation = 0;
  let ownerToken = getOptionsDevice(), feed = 'indicative', expirations = [], chain = [], feedVerified = false, nextPoll = 0;
  let message = '', spotSource = '', drag, rollFrom, resize, groupAnchor = null;
  const chains = new Map();
  const state = {
    symbol:'SPY', price:'', width:'0.15', expiry:'', legs:[], fee:'0', package:'', preset:'',
    iv:'25', shift:'0', rate:'4', dividend:'0', focus:50, time:100, chartRange:18, view:'graph'
  };
  const $ = name => root.querySelector('[data-ob="'+name+'"]');
  const manualExpiry = days => localDate(Date.now()+DAY*days);
  const active = () => root?.isConnected;
  // Only expose committed position geometry; never expose tokens, quote credentials or model prices.
  const chartPositions=()=>({symbol:state.symbol,legs:state.legs.map(({strike,side,type})=>
    ({strike:numeric(strike),side,type}))});
  let lastChartPositions='';
  function publishChartPositions(){
    const snapshot=chartPositions(),key=JSON.stringify(snapshot);
    if(key!==lastChartPositions){lastChartPositions=key;onPositionsChange(snapshot);}
  }
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
    drag = null;
    chain = [];
    chains.clear();
    rollFrom = null;
    expirations = [];
    feedVerified = false;
    state.legs = state.legs.map(leg => ({...leg,quote:null}));
    nextPoll = 0;
  }
  async function approveBrowser(code) {
    if (!devicePattern.test(code)) return setMessage('This setup link is invalid.');
    const device = ownerToken || getOptionsDevice(PENDING_KEY) || randomDevice();
    try {
      localStorage.setItem(PENDING_KEY,device);
    } catch {
      return setMessage('Enable site storage in this browser, then reopen the private setup link.');
    }
    cancel();
    const current = generation;
    pending = new AbortController();
    setMessage('Connecting to Alpaca quotes…');
    try {
      const response = await fetch(optionsApiUrl('device',root.dataset.worker),{method:'POST',headers:{
        Authorization:'Bearer '+device,'X-Options-Approval':code
      },signal:pending.signal,cache:'no-store'});
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Browser setup could not be completed. Reopen your setup link to retry.');
      }
      localStorage.setItem(OPTIONS_DEVICE_KEY,device);
      localStorage.removeItem(PENDING_KEY);
      ownerToken = device;
      history.replaceState(history.state,'',location.pathname+location.search);
      if (current === generation) void refreshChain({discover:true});
    } catch (error) {
      if (current === generation && error.name !== 'AbortError') setMessage(error.message);
    } finally { endRequest(current); }
  }
  async function request(path,params,signal) {
    try {
      return await requestOptions(path,params,signal,{worker:root.dataset.worker,token:ownerToken,feed});
    } catch(error) {
      if (error.status===429) nextPoll=Date.now()+1000*error.retryAfter;
      throw error;
    }
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
    if (!ownerToken) return setMessage('Use your quote link to load Alpaca prices.');
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
      chains.set(state.expiry, data);
      const rolled = rollLegs(data);
      feedVerified = chain.some(row => Number.isFinite(Date.parse(row.quote?.time)));
      renderChain();
      setMessage(feedVerified ? feedName(feed)+' · '+chain.length+' contracts' :
        'No timestamped '+feedName(feed)+' quotes in this strike range.');
      if (rolled) setMessage(message+' · '+rolled);
      setLegQuotes(Object.fromEntries(chain.filter(row => row.quote).map(row => [row.symbol,row.quote])));
      renderRuler();
      refreshMarks();
    } catch (error) {
      if (current === generation && error.name !== 'AbortError') {
        chain = [];
        renderChain();
        renderRuler();
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

  function selectExpiry(date) {
    if (date === state.expiry) return;
    rollFrom ??= state.expiry;
    state.expiry = date;
    chain = [];
    renderExpiry();
    renderChain();
    renderRuler();
    void refreshChain();
  }
  function rollLegs(contracts) {
    const previous = rollFrom;
    rollFrom = null;
    if (!previous || previous === state.expiry) return '';
    let moved = 0, repriced = false, unavailable = 0;
    state.legs = state.legs.map(leg => {
      if (leg.expiry !== previous) return leg;
      if (!leg.symbol) {
        moved++;
        return {...leg,expiry:state.expiry};
      }
      const row = contracts.find(row => row.type === leg.type && row.root === leg.root && row.strike === Number(leg.strike));
      if (!row) {
        unavailable++;
        return leg;
      }
      moved++;
      repriced = true;
      return marketLeg(row,leg.side,leg.quantity);
    });
    if (repriced) state.package = $('package').value = '';
    if (moved) renderLegs();
    return [moved ? moved+' moved to '+state.expiry : '', unavailable ? unavailable+' kept their original date because the contract was unavailable' : ''].filter(Boolean).join(' · ');
  }
  function renderExpiry() {
    $('expiry').innerHTML = expirations.length ? expirations.map(date => option(date,date,date===state.expiry)).join('') :
      option('','No expirations loaded');
    const strip = $('expiry-strip');
    const left = strip.scrollLeft;
    const hadFocus = strip.contains(document.activeElement);
    const groups = new Map();
    for (const date of expirations) {
      const month = date.slice(0,7);
      if (!groups.has(month)) groups.set(month,[]);
      groups.get(month).push(date);
    }
    strip.innerHTML = groups.size ? [...groups.values()].map(dates =>
      '<div class="options-month"><span>'+esc(monthFormat.format(new Date(dates[0]+'T00:00Z')))+'</span><div>'+
      dates.map(date => '<button type="button" data-expiry-day="'+esc(date)+'" aria-label="'+esc(expiryFormat.format(new Date(date+'T00:00Z')))+
        '" aria-pressed="'+(date===state.expiry)+'">'+esc(Number(date.slice(-2)))+'</button>').join('')+'</div></div>').join('') :
      '<span class="muted">Expirations appear when quotes load. Manual dates are available in Positions.</span>';
    strip.scrollLeft = left;
    const selected = strip.querySelector('[aria-pressed="true"]');
    if (selected) {
      if (hadFocus) selected.focus({preventScroll:true});
      const bounds = strip.getBoundingClientRect(), chip = selected.getBoundingClientRect();
      if (chip.left < bounds.left || chip.right > bounds.right) strip.scrollLeft += chip.left - bounds.left;
    }
  }
  function strategyAnchor() {
    const strikes=state.legs.map(leg=>numeric(leg.strike)).filter(value=>value>0);
    return groupAnchor ?? (numeric(state.price)>0?numeric(state.price):strikes.length?strikes.reduce((sum,n)=>sum+n,0)/strikes.length:null);
  }
  function rulerDomain() {
    const strikes=state.legs.map(leg=>numeric(leg.strike)).filter(value=>value>0);
    const anchor=strategyAnchor();if(anchor>0)strikes.push(anchor);
    return strikeDomain(numeric(state.price),strikes,chain);
  }
  const positionPct = (strike,{low,high}) => 7 + 86 * clamp((strike-low)/(high-low),0,1);

  function renderRuler(focusIndex) {
    if (drag) return;
    const ruler = $('ruler');
    const domain = rulerDomain();
    $('position-count').textContent = state.legs.length;
    if (!domain) {
      ruler.innerHTML = '<div class="options-ruler-empty">Enter an underlying price or add a position to set the strike range.</div>';
      return;
    }
    const {low,high} = domain;
    const spot = numeric(state.price), anchor = strategyAnchor();
    const visible = state.legs.map((leg,i)=>({leg,i})).filter(({leg}) => numeric(leg.strike) > 0);
    const lanes = {buy:[],sell:[]};
    const markers = {buy:[],sell:[]};
    const width = Math.max(1,ruler.clientWidth);
    for (const {leg,i} of visible) {
      const side = leg.side==='sell'?'sell':'buy';
      const x = positionPct(Number(leg.strike),domain);
      const center = clamp(x*width/100,Math.min(36,width/2),Math.max(width-36,width/2));
      const occupied = lanes[side];
      let lane = occupied.findIndex(used => used.every(value => Math.abs(value-center) >= 76));
      if (lane < 0) lane = occupied.push([])-1;
      occupied[lane].push(center);
      markers[side].push('<div class="options-strike-marker" style="--strike-x:'+x+'%;--strike-lane:'+lane+'">'+
        '<button type="button" class="options-strike-chip '+side+'" data-strike-leg="'+i+'" aria-label="Move leg '+(i+1)+' strike, '+esc(strikeLabel(leg))+'">'+
        '<span data-flip="'+i+'">'+(side==='buy'?'B':'S')+' · </span><span>'+esc(strikeLabel(leg))+'</span><small>'+esc(leg.expiry?.slice(5) ?? '')+'</small></button></div>');
    }
    const ticks = Array.from({length:7},(_,i) => low+(high-low)*i/6).map((value,i) =>
      '<span class="options-tick'+(i%2?' options-tick-minor':'')+'" style="--strike-x:'+positionPct(value,domain)+'%">'+
      esc(shortPrice.format(value))+'</span>').join('');
    ruler.innerHTML = '<div class="options-strike-scale">'+
      '<div class="options-strike-lanes buy" style="--ruler-lanes:'+lanes.buy.length+'">'+markers.buy.join('')+'</div>'+
      '<div class="options-strike-axis">'+ticks+
      (spot > 0 ? '<span class="options-strike-spot" style="--strike-x:'+positionPct(spot,domain)+'%" title="'+esc('Underlying '+dollars(spot))+'"></span>' : '')+
      (anchor>0&&visible.length===state.legs.length&&visible.length?'<button type="button" class="options-group-handle" data-shift-group style="--strike-x:'+positionPct(anchor,domain)+'%" aria-label="Move all option strikes" title="Drag to shift all legs together; arrow keys also work"><span aria-hidden="true">↔</span> <span data-group-value>'+esc(shortPrice.format(anchor))+'</span></button>':'')+
      '</div><div class="options-strike-lanes sell" style="--ruler-lanes:'+lanes.sell.length+'">'+markers.sell.join('')+'</div></div>';
    if (focusIndex != null) ruler.querySelector('[data-strike-leg="'+focusIndex+'"]')?.focus({preventScroll:true});
  }

  function updatePositions(focusIndex) {
    renderLegs();
    renderRuler(focusIndex);
    refreshMarks();
  }

  function removeLeg(i) {
    const leg = state.legs[i];
    if (!leg) return;
    state.legs.splice(i,1);
    if(!state.legs.length)groupAnchor=null;
    setMessage('Removed leg '+(i+1)+' ('+strikeLabel(leg)+').');
    updatePositions();
  }
  function flipLeg(i) {
    const leg = state.legs[i];
    if (!leg) return;
    leg.side = leg.side==='buy' ? 'sell' : 'buy';
    setMessage('Leg '+(i+1)+' is now '+(leg.side==='buy'?'buy':'sell')+'.');
    updatePositions();
  }
  function contractsFor(leg) {
    return chains.get(leg.expiry) || (chain[0]?.expiry===leg.expiry?chain:[]);
  }
  function targetsFor(leg,domain) {
    return strikeTargets(leg,contractsFor(leg),domain);
  }
  function groupTargets(domain,anchor) {
    return groupStrikeTargets(state.legs,contractsFor,domain,anchor);
  }
  function groupPreview(target,legs=state.legs) {
    return legs.map((leg,i)=>changedLeg(leg,target.rows[i]));
  }
  function commitGroup(target,restoreFocus=false) {
    if(target?.delta){
      const repriced=state.legs.some(leg=>leg.symbol);
      cancel();
      state.legs=groupPreview(target);
      groupAnchor=target.strike;
      if(repriced)state.package=$('package').value='';
      setMessage('Shifted all '+state.legs.length+' legs by '+(target.delta>0?'+':'')+dollars(target.delta)+'. Spacing preserved. '+(repriced?'Listed premiums refreshed from loaded quotes.':'Manual premiums retain your assumptions.'));
    }else setMessage('No shared strike shift available. Load a wider chain if needed.');
    updatePositions();
    if(restoreFocus)$('ruler').querySelector('[data-shift-group]')?.focus({preventScroll:true});
  }
  function changedLeg(leg,row) {
    if (row.strike === Number(leg.strike)) return leg;
    return leg.symbol ? marketLeg(row,leg.side,leg.quantity) : {...leg,strike:row.strike};
  }
  function commitStrike(i,row,restoreFocus) {
    if (!row || !state.legs[i]) return;
    const prior = state.legs[i];
    const next = changedLeg(prior,row);
    if (prior !== next) {
      state.legs[i] = next;
      if (prior.symbol && state.package !== '') state.package = $('package').value = '';
      setMessage((prior.symbol ? 'Listed' : 'Manual')+' strike set to '+strikeLabel(next)+'.');
    }
    updatePositions(restoreFocus ? i : undefined);
  }
  function startDrag(event) {
    if (event.target.closest('[data-flip]')) return;
    const group=event.target.closest('[data-shift-group]');
    if(group&&!drag&&(event.pointerType!=='mouse'||event.button===0)){
      const domain=rulerDomain(),anchor=strategyAnchor();
      drag={kind:'group',pointer:event.pointerId,domain,anchor,targets:groupTargets(domain,anchor),
        legs:state.legs.slice(),marker:group,startX:event.clientX,startY:event.clientY,width:$('ruler').getBoundingClientRect().width};
      $('ruler').setPointerCapture(event.pointerId);
      group.classList.add('is-dragging');event.preventDefault();return;
    }
    const marker = event.target.closest('[data-strike-leg]');
    if (!marker || drag || event.button !== 0) return;
    const i = Number(marker.dataset.strikeLeg);
    const leg = state.legs[i], domain = rulerDomain();
    const targets = targetsFor(leg,domain);
    drag = {pointer:event.pointerId,i,leg,marker,domain,targets,startX:event.clientX,
      startY:event.clientY,width:$('ruler').getBoundingClientRect().width};
    $('ruler').setPointerCapture(event.pointerId);
    marker.classList.add('is-dragging');
    event.preventDefault();
  }
  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointer) return;
    const {startX,startY,width,leg,domain,targets,marker} = drag;
    const dx = event.clientX-startX, dy = event.clientY-startY;
    if(drag.kind==='group'){
      if(!drag.intent&&Math.max(Math.abs(dx),Math.abs(dy))>=5)drag.intent=Math.abs(dy)>Math.abs(dx)*1.5?'vertical':'horizontal';
      if(!drag.intent)return;
      const shift=drag.intent==='vertical'?-dy:dx;
      const target=nearestStrike(targets,drag.anchor+shift/Math.max(1,width*.86)*(domain.high-domain.low));
      if(!target||target===drag.target)return;
      drag.target=target;drag.groupPreview=groupPreview(target,drag.legs);
      marker.style.setProperty('--strike-x',positionPct(target.strike,domain)+'%');
      marker.querySelector('[data-group-value]').textContent=shortPrice.format(target.strike);
      drag.groupPreview.forEach((leg,i)=>{
        const chip=$('ruler').querySelector('[data-strike-leg="'+i+'"]');
        if(chip){chip.parentElement.style.setProperty('--strike-x',positionPct(Number(leg.strike),domain)+'%');chip.children[1].textContent=strikeLabel(leg);}
      });
      refreshMarks();return;
    }
    // A vertical gesture may remove a leg only by moving away from the axis.
    if (!drag.intent && Math.max(Math.abs(dx),Math.abs(dy)) >= 8)
      drag.intent = Math.abs(dy)>Math.abs(dx)*1.5 ? 'vertical' : 'horizontal';
    if (drag.intent==='vertical') {
      const outward = leg.side==='buy' ? -dy : dy;
      const shift = Math.max(0,outward)*(leg.side==='buy' ? -1 : 1);
      marker.classList.toggle('is-swiping',outward>0);
      marker.style.translate = '0px '+shift+'px';
      marker.style.opacity = String(Math.max(0.2,1-Math.max(0,outward)/120));
      return;
    }
    if (!drag.intent || !targets.length) return;
    if (!drag.preview && Math.abs(dx)<3) return;
    const price = Number(leg.strike)+dx/Math.max(1,width*.86)*(domain.high-domain.low);
    const row = nearestStrike(targets,price);
    if (!row || row===drag.row) return;
    drag.row = row;
    drag.preview = changedLeg(leg,row);
    const x = positionPct(row.strike,domain);
    marker.parentElement.style.setProperty('--strike-x',x+'%');
    marker.children[0].textContent = (leg.side==='buy'?'B':'S')+' · ';
    marker.children[1].textContent = strikeLabel(drag.preview);
    refreshMarks();
  }
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointer) return;
    if(drag.kind==='group'){
      const {target,intent}=drag;drag=null;
      if(event.type==='pointerup'&&intent)return commitGroup(target);
      renderRuler();refreshMarks();return;
    }
    const {i,row,intent,leg,startX,startY,targets} = drag;
    const dx = event.clientX-startX, dy = event.clientY-startY;
    const outward = leg.side==='buy' ? -dy : dy;
    drag = null;
    if (event.type==='pointerup' && intent==='vertical' && outward>40 && outward>Math.abs(dx)*1.5)
      return removeLeg(i);
    if (event.type==='pointerup' && intent==='horizontal' && !targets.length)
      setMessage('Load contracts for this leg’s expiration to drag its strike.');
    if (event.type==='pointerup' && intent==='horizontal' && row) commitStrike(i,row,false);
    else {
      renderRuler();
      refreshMarks();
    }
  }
  function keyboardStrike(event) {
    if(event.target.closest('[data-shift-group]')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
      event.preventDefault();const anchor=strategyAnchor(),targets=groupTargets(rulerDomain(),anchor);
      const lower=['ArrowLeft','ArrowDown'].includes(event.key);
      const row=lower?targets.findLast(t=>t.strike<anchor):targets.find(t=>t.strike>anchor);
      if(row)commitGroup(row,true);else setMessage('No further shared strike shift available in the loaded chain.');
      return;
    }
    const marker = event.target.closest('[data-strike-leg]');
    if (!marker || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const i = Number(marker.dataset.strikeLeg), leg = state.legs[i];
    const targets = targetsFor(leg,rulerDomain());
    const row = event.key==='ArrowLeft' ? targets.findLast(row=>row.strike<Number(leg.strike)) :
      targets.find(row=>row.strike>Number(leg.strike));
    if (row) commitStrike(i,row,true);
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
    updatePositions();
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
      try { farChain = await loadChain(second,pending.signal); if (current === generation) chains.set(second,farChain); }
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
    groupAnchor=null;
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
    updatePositions();
  }

  function refreshMarks() {
    if (!active()) return;
    publishChartPositions();
    const fee = numeric(state.fee);
    const validFee = fee >= 0 && fee != null && fee <= 10000;
    const legs = state.legs.map((position,i) => {
      const leg = drag?.groupPreview?.[i] ?? (drag?.i === i && drag.preview ? drag.preview : position);
      return {...leg,strike:numeric(leg.strike),quantity:numeric(leg.quantity),entry:numeric(leg.entry),expiresAt:expirationTime(leg)};
    });
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
      const payoffGreeks = $('payoff-greeks');
      if (payoffGreeks) payoffGreeks.textContent = '';
      $('plot').hidden = false;
      $('plot').textContent = text;
      $('grid').innerHTML = '';
      $('range').hidden = true;
    };
    if (!legs.length) return showEmpty('Add legs to see your strategy payoff.');
    if (legs.some(leg => !(leg.strike > 0 && leg.strike <= 1e6) ||
      !Number.isInteger(leg.quantity) || leg.quantity < 1 || leg.quantity > 10000 || !Number.isFinite(leg.expiresAt)))
      return showEmpty('Enter a valid strike, expiration, and quantity for every leg.');
    if (!validFee) return showEmpty('Enter a valid fee per contract.');
    const entryPackage = (drag?.preview?.symbol && drag.preview !== drag.leg)||(drag?.target?.delta&&state.legs.some(leg=>leg.symbol)) ? '' : state.package;
    const pkg = numeric(entryPackage);
    if (entryPackage !== '' && (pkg == null || Math.abs(pkg)>1e9)) return showEmpty('Enter a valid signed package price.');
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
      $('plot').hidden = false;
      $('plot').textContent = 'Enter valid IV, rate, and dividend inputs for mixed expirations.';
      $('range').hidden = true;
      $('grid').innerHTML = '';
      return;
    }
    const strikes = legs.map(leg => leg.strike);
    const center = price > 0 && price <= 1e6 ? price : (Math.min(...strikes)+Math.max(...strikes))/2;
    const span = Math.max(center * state.chartRange / 100, .01);
    const low = Math.max(0,center-span);
    const high = center+span;
    const focus = low + (high-low)*state.focus/100;
    const terminal = x => single ? expiryPnl(legs,x,debit) : scenarioPnl(legs,x,expiry,debit,model);
    const pnlAt = (x,when) => when===expiry ? terminal(x) : scenarioPnl(legs,x,when,debit,model);
    const prices = [...new Set([...Array.from({length:81},(_,i) => low+(high-low)*i/80),...strikes.filter(strike => strike>low && strike<high)])].sort((a,b)=>a-b);
    const points = prices.map(x => ({x,end:terminal(x),at:allowFuture ? pnlAt(x,at) : terminal(x)}));
    const pointAt = allowFuture ? pnlAt(focus,at) : terminal(focus);
    const width = clamp($('plot').clientWidth || root.clientWidth-28,280,1060);
    $('plot').innerHTML = graph({width,price,high,low,points,expiry:!allowFuture,pointAt,focus,roots:stats?.roots || [],
      marker:single?'Expiration payoff':'First expiry model'});
    $('range').hidden = false;
    $('date-output').textContent = (allowFuture || at === expiry ? usTime(at) : usTime(expiry)) +
      (!validModel ? ' · Enter valid model inputs for earlier dates' : '');
    $('price-output').textContent = dollars(focus)+' underlying · '+dollars(pointAt)+' P&L';
    $('scenario-time').disabled = expiry <= now;
    $('range-output').textContent = '±'+state.chartRange+'%';
    $('iv-output').textContent = (shift > 0 ? '+' : '')+num(shift,0)+' pp';
    $('plot').hidden = state.view === 'table';
    $('grid').hidden = state.view !== 'table';
    const datesGrid = validModel ? [...new Set([start,Math.round((expiry+start)/2),expiry])] : [expiry];
    const gridPrices = Array.from({length:9},(_,i) => high-(high-low)*i/8);
    $('grid').innerHTML = '<table class="data-table"><caption>Scenario P&L in dollars</caption><thead><tr><th>Underlying</th>'+
      datesGrid.map(time=>'<th>'+esc(usTime(time))+'</th>').join('')+'</tr></thead><tbody>'+
      gridPrices.map(x=>'<tr><th>'+dollars(x)+'</th>'+datesGrid.map(time=>{
        const pnl = pnlAt(x,time);
        return '<td class="'+(pnl>=0?'positive':'negative')+'">'+dollars(pnl)+'</td>';
      }).join('')+'</tr>').join('')+'</tbody></table>';
    const totals = netGreeks(legs);
    const greekText = totals.liveLegs ? 'Live Greeks · '+FIELDS.map(key =>
      key.charAt(0).toUpperCase()+key.slice(1)+' '+num(totals[key])).join(' · ') :
      'Live Greeks unavailable — load the chain to refresh.';
    $('greeks').textContent = legs.length ? greekText : '';
    const payoffGreeks = $('payoff-greeks');
    if (payoffGreeks) payoffGreeks.textContent = legs.length ? greekText : '';
  }

  function action(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const flip = event.target.closest('[data-flip]');
    if (flip) return flipLeg(Number(flip.dataset.flip));
    const {ob,remove,chain:chainIndex,side,expiryDay,scenarioView,quickType} = button.dataset;
    if (expiryDay) selectExpiry(expiryDay);
    if (scenarioView) {
      state.view = scenarioView;
      for (const control of root.querySelectorAll('[data-scenario-view]'))
        control.setAttribute('aria-pressed',String(control.dataset.scenarioView === scenarioView));
      refreshMarks();
    }
    if (quickType) {
      const spot = numeric(state.price);
      const row = spot > 0 && nearestStrike(chain.filter(row => row.type===quickType),spot);
      const side = button.dataset.quickSide === 'sell' ? 'sell' : 'buy';
      addLeg(row ? marketLeg(row,side) : manualLeg({side,type:quickType}));
      if (!row) $('positions').open = true;
    }
    if (ob==='manual') addLeg(manualLeg());
    if (ob==='preset-apply') void applyPreset();
    if (ob==='refresh-chain') void refreshChain({discover:!expirations.length});
    if (ob==='refresh-legs') void poll(true);
    if (ob==='use-mid' || ob==='use-natural') {
      if (state.legs.some(leg => !(leg.quote?.ask > 0 && leg.quote.bid != null && leg.quote.bid >= 0 && leg.quote.bid <= leg.quote.ask))) return;
      state.legs.forEach(leg => {
        const {bid,ask} = leg.quote;
        leg.entry = ob==='use-mid' ? ((bid+ask)/2).toFixed(4) : String(leg.side==='buy'?ask:bid);
      });
      state.package = $('package').value = '';
      updatePositions();
    }
    if (ob==='clear') {
      groupAnchor=null;
      state.legs = [];
      state.package = $('package').value = '';
      updatePositions();
    }
    if (remove !== undefined) removeLeg(Number(remove));
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
      renderRuler();
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
      groupAnchor=null;
      state.price = $('price').value = '';
      $('spot-source').textContent = spotSource = '';
      state.expiry = '';
      state.legs = [];
      state.package = $('package').value = '';
      resetQuotes();
      renderExpiry();
      renderChain();
      updatePositions();
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
    if (ob==='expiry' && event.type==='change') selectExpiry(el.value);
    if (['price','fee','package','width','iv','rate','dividend','shift','preset'].includes(ob) && state[ob] !== el.value) {
      state[ob] = el.value;
      if (ob==='price') {
        groupAnchor=null;
        $('spot-source').textContent = spotSource = 'Manual reference';
        renderRuler();
      }
      if (ob==='shift') $('scenario-iv').value = el.value;
      if (ob!=='preset') refreshMarks();
    }
    if (ob==='chart-range' || ob==='scenario-iv') {
      if (ob==='chart-range') state.chartRange = Number(el.value);
      else state.shift = $('shift').value = el.value;
      refreshMarks();
    }
    if (ob==='scenario-price' || ob==='scenario-time') {
      state[ob==='scenario-price'?'focus':'time'] = Number(el.value);
      refreshMarks();
    }
  }
  function mount(host, worker) {
    root = host;
    host.dataset.worker = worker;
    root.innerHTML = '<header class="options-page-head"><div><h1>Options Builder</h1>'+
      '<p data-ob="status" role="status" class="options-status">'+esc(message)+'</p></div>'+
      '<a class="btn" href="#options-positions">Positions <span data-ob="position-count">0</span></a></header>'+
      '<section class="panel options-workbench"><div class="panel-body">'+
      '<div class="options-fields options-toolbar"><label class="field options-ticker">Ticker<input data-ob="symbol" maxlength="10" value="'+esc(state.symbol)+'"></label>'+
      '<label class="field options-spot">Underlying reference price<input data-ob="price" type="number" min="0.01" step="any" value="'+esc(state.price)+'"><small data-ob="spot-source">'+esc(spotSource)+'</small></label>'+
      '<label class="field options-preset">Strategy preset<select data-ob="preset">'+option('','Choose a preset')+
      Object.keys(PRESETS).map(name=>option(name,name,state.preset===name)).join('')+'</select></label>'+
      '<button type="button" class="btn" data-ob="preset-apply">Apply preset</button></div>'+
      '<div class="options-expirations"><h2>Expiration</h2><div class="options-date-strip" data-ob="expiry-strip" role="group" aria-label="Available expirations"></div></div>'+
      '<div class="options-ruler-head"><h2>Strikes</h2><p>Drag the gold price handle to shift all legs · Drag individual legs sideways · Swipe buys up or sells down to remove · Tap B/S to flip</p></div>'+
      '<div class="options-quick-add buy" role="group" aria-label="Add buy legs"><button type="button" class="btn small" data-quick-type="call" data-quick-side="buy">+ Buy Call</button>'+
      '<button type="button" class="btn small" data-quick-type="put" data-quick-side="buy">+ Buy Put</button></div>'+
      '<div data-ob="ruler" class="options-ruler" role="group" aria-label="Strike ruler"></div>'+
      '<div class="options-quick-add sell" role="group" aria-label="Add sell legs"><button type="button" class="btn small" data-quick-type="call" data-quick-side="sell">+ Sell Call</button>'+
      '<button type="button" class="btn small" data-quick-type="put" data-quick-side="sell">+ Sell Put</button></div></div>'+
      '<div class="panel-body options-payoff">'+
      '<div class="options-payoff-head"><h2>Payoff</h2><div class="options-view-switch" role="group" aria-label="Payoff view">'+
      ['graph','table'].map(view => '<button type="button" data-scenario-view="'+view+'" aria-pressed="'+(state.view===view)+'">'+
      (view==='graph'?'Graph':'Table')+'</button>').join('')+'</div></div>'+
      '<div class="options-metrics" data-ob="metrics"></div><div class="subtle options-payoff-greeks" data-ob="payoff-greeks"></div><div class="options-plot" data-ob="plot"></div>'+
      '<div class="table-wrap options-scenario-table" data-ob="grid" hidden></div>'+
      '<div class="options-ranges" data-ob="range" hidden>'+
      '<label class="field options-date-control">Scenario date <output data-ob="date-output"></output><input data-ob="scenario-time" type="range" min="0" max="100" value="'+state.time+'"></label>'+
      '<label class="field">Price range <output data-ob="range-output"></output><input data-ob="chart-range" type="range" min="5" max="80" value="'+state.chartRange+'"></label>'+
      '<label class="field">IV shift <output data-ob="iv-output"></output><input data-ob="scenario-iv" type="range" min="-50" max="150" value="'+esc(state.shift)+'"></label>'+
      '<label class="field options-date-control">Scenario underlying price <output data-ob="price-output"></output><input data-ob="scenario-price" type="range" min="0" max="100" value="'+state.focus+'"></label></div>'+
      '<details><summary>Pricing assumptions</summary><div class="options-fields options-assumptions">'+
      '<label class="field">Fallback IV (%)<input data-ob="iv" type="number" min="0.01" step="any" value="'+esc(state.iv)+'"></label>'+
      '<label class="field">IV shift (points)<input data-ob="shift" type="number" step="any" value="'+esc(state.shift)+'"></label>'+
      '<label class="field">Risk-free rate (%)<input data-ob="rate" type="number" step="any" value="'+esc(state.rate)+'"></label>'+
      '<label class="field">Dividend yield (%)<input data-ob="dividend" type="number" min="0" step="any" value="'+esc(state.dividend)+'"></label></div>'+
      '<p class="section-note">Pre-expiry uses European Black–Scholes with per-leg quoted IV when available. It estimates P&L through the first expiration and assumes settlement at the scenario price. Exercise and assignment, exit fees, and exchange schedule exceptions are outside the model.</p>'+
      '</details></div></section>'+
      '<details class="panel options-positions" id="options-positions" data-ob="positions" open><summary>Positions</summary><div class="panel-header"><div class="flex">'+
      '<button type="button" class="btn small" data-ob="refresh-legs">Refresh prices</button>'+
      '<button type="button" class="btn small" data-ob="clear">Clear</button>'+
      '<button type="button" class="btn small primary" data-ob="manual">Add manual leg</button></div></div>'+
      '<div class="table-wrap"><table class="data-table options-legs"><thead><tr><th>Side</th><th>Type</th><th>Strike</th><th>Expiration</th>'+
      '<th>Contracts</th><th>Entry per unit</th><th>Bid / ask</th><th></th></tr></thead><tbody data-ob="legs"></tbody></table></div>'+
      '<div class="panel-body"><div class="options-fields"><label class="field">Entry fee per contract<input data-ob="fee" type="number" min="0" step="any" value="'+esc(state.fee)+'"></label>'+
      '<label class="field">Net package premium in dollars<input data-ob="package" type="number" step="any" placeholder="Optional · credit is negative" value="'+esc(state.package)+'"></label></div>'+
      '<div class="options-estimates muted" data-ob="estimates"></div><div class="subtle" data-ob="greeks"></div></div></details>'+
      '<div class="panel" id="options-chain"><div class="panel-header"><h2>Options chain</h2></div><div class="panel-body options-fields">'+
      '<label class="field">Expiration<select data-ob="expiry"></select></label>'+
      '<label class="field">Strike window<select data-ob="width">'+[['0.05','±5%'],['0.10','±10%'],['0.15','±15%'],['0.30','±30%'],['0.6','±60%']].map(([v,label])=>option(v,label,v===state.width)).join('')+
      '</select></label><button type="button" class="btn" data-ob="refresh-chain">Load chain</button>'+
      '<label class="field">Options feed<select data-ob="feed">'+option('opra','Real-time OPRA',feed==='opra')+
      option('indicative','Indicative',feed==='indicative')+'</select></label></div>'+
      '<div class="table-wrap options-chain"><table class="data-table"><thead><tr><th>Type</th><th>Strike</th><th>Bid / ask</th><th>Quote time</th><th>IV</th><th>Open interest</th><th></th></tr></thead><tbody data-ob="chain"></tbody></table></div></div>';
    root.addEventListener('click',action);
    root.addEventListener('input',control);
    root.addEventListener('change',control);
    const ruler = $('ruler');
    ruler.addEventListener('pointerdown',startDrag);
    ruler.addEventListener('pointermove',moveDrag);
    ruler.addEventListener('pointerup',endDrag);
    ruler.addEventListener('pointercancel',endDrag);
    ruler.addEventListener('lostpointercapture',endDrag);
    ruler.addEventListener('keydown',keyboardStrike);
    let width = host.clientWidth;
    resize = new ResizeObserver(() => {
      if (!active() || root.clientWidth === width) return;
      width = root.clientWidth;
      renderRuler();
      refreshMarks();
    });
    resize.observe(host);
    renderExpiry();
    renderChain();
    updatePositions();
    timer = setInterval(poll,20_000);
    const code = optionsApprovalLink();
    if (code !== null) void approveBrowser(code);
    else if (ownerToken) void refreshChain({discover:!expirations.length});
    else setMessage('Use your quote link to load Alpaca prices.');

  }
  return {mount,chartPositions,openApproval() {
    const code = optionsApprovalLink();
    if (active() && code !== null) void approveBrowser(code);
  },unmount() {
    clearInterval(timer);
    resize?.disconnect();
    cancel();
    drag = null;
    root = null;
  }};
}
