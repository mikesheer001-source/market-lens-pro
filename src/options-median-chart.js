// Rendering only. Prices and expiration selection are supplied unchanged by options-median.js.
const dayMs=86_400_000;
const isoDay=ms=>new Date(ms).toISOString().slice(0,10);
const dateMs=time=>typeof time==='number'?time*1000:Date.parse(time+'T00:00:00Z');
const expiryMs=expiry=>typeof expiry==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(expiry)?Date.parse(expiry+'T00:00:00Z'):NaN;
const projectionTime=(ms,intraday)=>intraday?(ms+20*3_600_000)/1000:isoDay(ms);
export function medianChartPoints(levels,intraday=false){
  return levels.filter(level=>Number.isFinite(level.price)&&level.price>0&&Number.isFinite(expiryMs(level.expiry)))
    .map(level=>({...level,time:projectionTime(expiryMs(level.expiry),intraday),
      title:'50/50 · '+level.label+(level.confidence==='lower'?' · Low conf.':''),
      caption:level.expiry+(intraday?' 20:00 UTC':'')+' · $'+level.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}))
    .sort((a,b)=>dateMs(a.time)-dateMs(b.time));
}
// These are whitespace dates, not price bars. Use weekday slots on daily/intraday
// charts and period starts on weekly/monthly charts, plus the exact contract dates.
// Intraday future spacing is intentionally condensed to days, not invented minute bars.
export function medianProjectionTimeline(lastTime,tf,points){
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
        return x==null||y==null||!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>width||y<0||y>height?[]:[{point,x,y}];
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

export function createMedianDotLayer({chart,base,lineSeries,lastTime,tf,onInitialView,onView}){
  const instances=new Map();
  const all=()=>[...instances.values()].flatMap(({series,points})=>points.map(point=>({series,point})));
  const primitive=medianDotPrimitive(chart,all);
  base.attachPrimitive(primitive);
  let first=true,queued=false,disposed=false;
  const timeScale=chart.timeScale();
  function show(){
    const points=all().map(({point})=>point);
    if(!points.length)return false;
    const end=Math.max(...points.map(p=>timeScale.timeToIndex(p.time)??-1));
    const last=timeScale.timeToIndex(lastTime);
    if(last==null||end<0)return false;
    // Keep recent candles beside the projected dates and enough space for a label.
    timeScale.setVisibleLogicalRange({from:Math.max(0,last-60),to:end+Math.max(3,Math.ceil((end-last+60)*.08))});
    // A persisted manual price range can clip both the latest candle and dots.
    // Explicitly fit the shared price scale whenever the projection is revealed.
    base.priceScale().setAutoScale(true);
    onView?.();
    primitive.refresh();
    return true;
  }
  function set(id,levels){
    if(disposed)return;
    const points=medianChartPoints(levels,!['D','W','M'].includes(tf));
    let entry=instances.get(id);
    if(!entry&&!points.length)return;
    if(!entry){entry={series:chart.addSeries(lineSeries,{...medianDotSeriesOptions,color:'#7bdac6'}),points:[]};instances.set(id,entry);}
    // Don't reset the time scale on periodic quote refreshes with the same dates.
    const unchanged=JSON.stringify(entry.points)===JSON.stringify(points);
    if(unchanged)return;
    const priorRange=timeScale.getVisibleLogicalRange();
    entry.points=points;
    const dates=medianProjectionTimeline(lastTime,tf,all().map(({point})=>point));
    for(const item of instances.values()){
      const values=new Map(item.points.map(point=>[point.time,point.price]));
      item.series.setData(dates.map(({time})=>values.has(time)?{time,value:values.get(time)}:{time}));
    }
    if(priorRange)timeScale.setVisibleLogicalRange(priorRange);
    primitive.refresh();
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
    base.detachPrimitive(primitive);
    for(const {series} of instances.values())chart.removeSeries(series);
    instances.clear();
  },hasPoints:()=>all().length>0};
}
