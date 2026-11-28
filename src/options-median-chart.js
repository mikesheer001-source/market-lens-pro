// Rendering only. Prices and expiration selection are supplied unchanged by options-median.js.
const dayMs=86_400_000;
const isoDay=ms=>new Date(ms).toISOString().slice(0,10);
const dateMs=time=>typeof time==='number'?time*1000:Date.parse(time+'T00:00:00Z');
const expiryMs=expiry=>typeof expiry==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(expiry)?Date.parse(expiry+'T00:00:00Z'):NaN;
const projectionTime=(ms,intraday)=>intraday?(ms+20*3_600_000)/1000:isoDay(ms);
export function medianChartPoints(levels,intraday=false){
  return levels.filter(level=>Number.isFinite(level.price)&&level.price>0&&Number.isFinite(expiryMs(level.expiry)))
    .map(level=>({...level,time:projectionTime(expiryMs(level.expiry),intraday),
      title:(level.probability==null?'50/50':level.probability+'% above')+' · '+level.label+(level.confidence==='lower'?' · Low conf.':''),
      caption:level.expiry+(intraday?' 20:00 UTC':'')+' · $'+level.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}))
    .sort((a,b)=>dateMs(a.time)-dateMs(b.time));
}
// These are whitespace dates, not price bars. Use weekday slots on daily/intraday
// charts and period starts on weekly/monthly charts, plus the exact contract dates.
// Intraday future spacing is intentionally condensed to days, not invented minute bars.
export function medianProjectionTimeline(lastTime,tf,points,tailSlots=0){
  if(!points.length)return [];
  const intraday=!['D','W','M'].includes(tf),last=dateMs(lastTime);
  const firstDay=Math.floor(last/dayMs)*dayMs;
  const end=Math.max(...points.map(p=>expiryMs(p.expiry)));
  if(!Number.isFinite(last)||!Number.isFinite(end))return [];
  const times=new Map();
  for(let ms=firstDay;ms<=end;ms+=dayMs){
    const day=new Date(ms),weekday=day.getUTCDay();
    if(tf==='W'?weekday!==1:tf==='M'?day.getUTCDate()!==1:weekday===0||weekday===6)continue;
    const time=projectionTime(ms,intraday);
    if(dateMs(time)>last)times.set(dateMs(time),time);
  }
  for(const point of points)times.set(dateMs(point.time),point.time);
  // Extend with whitespace dates, never synthetic candles.
  for(let ms=end+dayMs,remaining=tailSlots;remaining>0;ms+=dayMs){
    const day=new Date(ms),weekday=day.getUTCDay();
    if(tf==='W'?weekday!==1:tf==='M'?day.getUTCDate()!==1:weekday===0||weekday===6)continue;
    const time=projectionTime(ms,intraday);
    times.set(dateMs(time),time);
    remaining--;
  }
  return [...times].sort(([a],[b])=>a-b).map(([,time])=>({time}));
}

export const medianDotSeriesOptions=Object.freeze({
  lineVisible:false,pointMarkersVisible:false,crosshairMarkerVisible:false,
  priceLineVisible:false,lastValueVisible:false
});

// Canvas primitive: labels are part of the chart (including PNG export), with
// coordinates obtained from the actual time and price scales on every draw.
export function medianDotPrimitive(chart,readPoints){
  let requestUpdate=()=>{};
  const renderer={draw(target){
    target.useMediaCoordinateSpace(({context:ctx,mediaSize:{width,height}})=>{
      const visible=readPoints().flatMap(({point,series})=>{
        const x=chart.timeScale().timeToCoordinate(point.time),y=series.priceToCoordinate(point.price);
        return x==null||y==null||!Number.isFinite(x)||!Number.isFinite(y)?[]:[{point,x,y}];
      });
      if(!visible.length)return;
      ctx.save();
      ctx.font='600 11px system-ui, sans-serif';ctx.textBaseline='top';
      const labels=[];
      for(const {point,x,y} of visible){
        const w=Math.ceil(Math.max(ctx.measureText(point.title).width,ctx.measureText(point.caption).width))+12,h=34;
        const clamp=(n,min,max)=>Math.min(Math.max(min,max),Math.max(min,n));
        const candidates=[[x+9,y-h-4],[x-w-9,y-h-4],[x+9,y+6],[x-w-9,y+6],[x-w/2,y-h-9],[x-w/2,y+9]]
          .map(([left,top])=>({left:clamp(left,2,width-w-2),top:clamp(top,2,height-h-2),w,h}));
        const overlaps=(a,b)=>a.left<b.left+b.w+3&&a.left+a.w+3>b.left&&a.top<b.top+b.h+3&&a.top+a.h+3>b.top;
        const coversDot=box=>visible.some(dot=>dot.x+5>box.left&&dot.x-5<box.left+box.w&&dot.y+5>box.top&&dot.y-5<box.top+box.h);
        const box=candidates.find(candidate=>!coversDot(candidate)&&!labels.some(label=>overlaps(candidate,label)))||
          candidates.find(candidate=>!coversDot(candidate))||candidates[0];
        labels.push(box);
        ctx.fillStyle='#19221e';ctx.fillRect(box.left,box.top,box.w,box.h);
        ctx.fillStyle=point.color;ctx.fillText(point.title,box.left+6,box.top+4);
        ctx.fillStyle='#dce8df';ctx.fillText(point.caption,box.left+6,box.top+18);
      }
      for(const {point,x,y} of visible){
        ctx.beginPath();ctx.arc(x,y,4.5,0,2*Math.PI);ctx.fillStyle=point.color;ctx.fill();
      }
      ctx.restore();
    });
  }};
  const views=[{zOrder:()=> 'normal',renderer:()=>renderer}];
  return {attached({requestUpdate:update}){requestUpdate=update;},detached(){requestUpdate=()=>{};},
    paneViews:()=>views,refresh:()=>requestUpdate()};
}

// Separate primitive for probability paths so the established 50/50 dot renderer
// remains unchanged. Paths connect only the same survival quantile across horizons.
export function probabilityLinePrimitive(chart,readPoints){
  let requestUpdate=()=>{};
  const renderer={draw(target){
    target.useMediaCoordinateSpace(({context:ctx})=>{
      const projected=readPoints().flatMap(({point,series})=>{
        if(point.probability==null)return [];
        const x=chart.timeScale().timeToCoordinate(point.time),y=series.priceToCoordinate(point.price);
        return x==null||y==null||!Number.isFinite(x)||!Number.isFinite(y)?[]:[{point,x,y}];
      });
      const groups=new Map();
      for(const p of projected){
        const key=p.point.projectionGroup+':'+p.point.probability;
        if(!groups.has(key))groups.set(key,[]);
        groups.get(key).push(p);
      }
      if(!groups.size)return;
      ctx.save();
      for(const group of groups.values()){
        group.sort((a,b)=>dateMs(a.point.time)-dateMs(b.point.time));
        ctx.beginPath();ctx.strokeStyle=group[0].point.color;ctx.lineWidth=2;
        ctx.setLineDash?.([6,4]);
        for(let i=0;i<group.length;i++){
          const p=group[i];
          if(i&&p.point.months-group[i-1].point.months===(p.point.months===12?6:3))ctx.lineTo(p.x,p.y);
          else ctx.moveTo(p.x,p.y);
        }
        ctx.stroke();
      }
      ctx.setLineDash?.([]);
      ctx.restore();
    });
  }};
  const views=[{zOrder:()=> 'normal',renderer:()=>renderer}];
  return {attached({requestUpdate:update}){requestUpdate=update;},detached(){requestUpdate=()=>{};},
    paneViews:()=>views,refresh:()=>requestUpdate()};
}

export function createMedianDotLayer({chart,base,lineSeries,lastTime,tf,onInitialView,onView,mirrorBase=null,mirrorPane=1}){
  const instances=new Map();
  const all=()=>[...instances.values()].flatMap(({series,points})=>points.map(point=>({series,point})));
  function makePrimitive(readPoints){
    const dotPrimitive=medianDotPrimitive(chart,readPoints);
    const linePrimitive=probabilityLinePrimitive(chart,readPoints);
    return {
      attached({requestUpdate}){dotPrimitive.attached({requestUpdate});linePrimitive.attached({requestUpdate});},
      detached(){dotPrimitive.detached();linePrimitive.detached();},
      paneViews(){return [...dotPrimitive.paneViews(),...linePrimitive.paneViews()];},
      refresh(){dotPrimitive.refresh();linePrimitive.refresh();}
    };
  }
  const primitive=makePrimitive(all);
  const mirrorPrimitive=mirrorBase?makePrimitive(()=>[...instances.values()].flatMap(({mirror,points})=>mirror?points.map(point=>({series:mirror,point})):[])):null;
  base.attachPrimitive(primitive);
  if(mirrorPrimitive)mirrorBase.attachPrimitive(mirrorPrimitive);
  const refresh=()=>{primitive.refresh();mirrorPrimitive?.refresh();};
  let first=true,queued=false,disposed=false,tailSlots=0,tailQueued=false;
  const timeScale=chart.timeScale();
  function renderDates(){
    const dates=medianProjectionTimeline(lastTime,tf,all().map(({point})=>point),tailSlots);
    for(const item of instances.values()){
      const values=new Map(item.points.map(point=>[point.time,point.price]));
      const data=dates.map(({time})=>values.has(time)?{time,value:values.get(time)}:{time});
      item.series.setData(data);item.mirror?.setData(data);
    }
  }
  function ensureFutureDates(range){
    if(disposed||!range||!Number.isFinite(range.to))return;
    const points=all().map(({point})=>point);
    if(!points.length)return;
    const end=Math.max(...points.map(p=>timeScale.timeToIndex(p.time)??-1));
    if(end<0)return;
    // Keep native crosshair dates available past the right edge.
    const needed=Math.min(20000,Math.max(0,Math.ceil(range.to-end)+2));
    if(needed<=tailSlots)return;
    tailSlots=needed;
    const prior=timeScale.getVisibleLogicalRange();
    renderDates();
    if(prior)timeScale.setVisibleLogicalRange(prior);
    refresh();
  }
  function onVisibleRange(){
    if(disposed||tailQueued)return;
    tailQueued=true;
    queueMicrotask(()=>{
      tailQueued=false;
      if(!disposed)ensureFutureDates(timeScale.getVisibleLogicalRange());
    });
  }
  timeScale.subscribeVisibleLogicalRangeChange?.(onVisibleRange);
  function show(){
    const points=all().map(({point})=>point);
    if(!points.length)return false;
    const end=Math.max(...points.map(p=>timeScale.timeToIndex(p.time)??-1));
    const last=timeScale.timeToIndex(lastTime);
    if(last==null||end<0)return false;
    // Keep recent candles beside the projected dates and enough space for a label.
    const range={from:Math.max(0,last-60),to:end+Math.max(3,Math.ceil((end-last+60)*.08))};
    ensureFutureDates(range);
    timeScale.setVisibleLogicalRange(range);
    // A persisted manual price range can clip both the latest candle and dots.
    // Explicitly fit the shared price scale whenever the projection is revealed.
    base.priceScale().setAutoScale(true);
    mirrorBase?.priceScale().setAutoScale(true);
    onView?.();
    refresh();
    return true;
  }
  function set(id,levels){
    if(disposed)return;
    const points=medianChartPoints(levels,!['D','W','M'].includes(tf)).map(p=>p.probability==null?p:{...p,projectionGroup:id});
    let entry=instances.get(id);
    if(!entry&&!points.length)return;
    if(!entry){
      const options={...medianDotSeriesOptions,color:'#7bdac6'};
      entry={series:chart.addSeries(lineSeries,options),mirror:mirrorBase?chart.addSeries(lineSeries,options,mirrorPane):null,points:[]};
      instances.set(id,entry);
    }
    // Don't reset the time scale on periodic quote refreshes with the same dates.
    const unchanged=JSON.stringify(entry.points)===JSON.stringify(points);
    if(unchanged)return;
    const priorRange=timeScale.getVisibleLogicalRange();
    entry.points=points;
    renderDates();
    if(priorRange){
      ensureFutureDates(priorRange);
      timeScale.setVisibleLogicalRange(priorRange);
    }
    refresh();
    if(first&&!queued&&all().length){
      queued=true;
      queueMicrotask(()=>{
        queued=false;if(disposed||!all().length)return;
        first=false;if(!onInitialView?.(show))show();
      });
    }
  }
  return {set,show,dispose(){
    if(disposed)return;
    disposed=true;
    timeScale.unsubscribeVisibleLogicalRangeChange?.(onVisibleRange);
    base.detachPrimitive(primitive);
    if(mirrorPrimitive)mirrorBase.detachPrimitive(mirrorPrimitive);
    for(const {series,mirror} of instances.values()){chart.removeSeries(series);if(mirror)chart.removeSeries(mirror);}
    instances.clear();
  },hasPoints:()=>all().length>0};
}
