import {test} from 'node:test';
import assert from 'node:assert/strict';
import {medianChartPoints,medianProjectionTimeline,medianDotSeriesOptions,medianDotPrimitive,createMedianDotLayer} from '../src/options-median-chart.js';

const levels=[{label:'6M',color:'#7bdac6',expiry:'2027-05-21',price:103,confidence:'standard'},
  {label:'1Y',color:'#f0bd77',expiry:'2027-11-19',price:108,confidence:'lower'}];

test('median dot rendering preserves supplied prices, exact expiry dates and confidence',()=>{
  const points=medianChartPoints([...levels,{label:'bad',price:NaN,expiry:'2027-10-01'},{price:50}],false);
  assert.deepEqual(points.map(p=>[p.time,p.price,p.title,p.caption]),[
    ['2027-05-21',103,'50/50 · 6M','2027-05-21 · $103.00'],
    ['2027-11-19',108,'50/50 · 1Y · Low conf.','2027-11-19 · $108.00']]);
  const intraday=medianChartPoints(levels,true);
  assert.equal(intraday[0].time,Date.parse('2027-05-21T20:00:00Z')/1000);
  assert.equal(intraday[0].caption,'2027-05-21 20:00 UTC · $103.00');
  assert.deepEqual(medianChartPoints([{price:100,expiry:'invalid'}]),[]);
});
test('projection uses blank future time slots and retains exact expiration on all timeframes',()=>{
  for(const tf of ['D','W','M','1m','5m','15m','2H','4H','8H']){
    const intraday=!['D','W','M'].includes(tf);
    const points=medianChartPoints(levels,intraday);
    const timeline=medianProjectionTimeline(intraday?Date.parse('2026-11-24T15:00:00Z')/1000:'2026-11-24',tf,points);
    assert.ok(timeline.length>2);
    assert.ok(timeline.every(row=>Object.keys(row).join(',')==='time'));
    assert.ok(timeline.every((row,i)=>i===0||row.time>timeline[i-1].time));
    for(const point of points)assert.ok(timeline.some(row=>row.time===point.time));
    assert.equal(timeline.at(-1).time,points.at(-1).time);
    if(intraday)assert.ok(timeline.length<400);
  }
  assert.deepEqual(medianProjectionTimeline('2026-11-24','D',[]),[]);
});
test('median series has no connecting line, standalone price line, crosshair dot or price axis label',()=>{
  assert.deepEqual(medianDotSeriesOptions,{lineVisible:false,pointMarkersVisible:false,crosshairMarkerVisible:false,priceLineVisible:false,lastValueVisible:false});
});
test('canvas primitive draws circles at the exact time and price coordinates, with time and price labels, no horizontal strokes',()=>{
  const points=medianChartPoints(levels);
  const calls=[],ctx={
    save(){},restore(){},beginPath(){},fill(){},measureText(text){return {width:text.length*6};},
    fillRect(...args){calls.push(['rect',...args]);},
    fillText(...args){calls.push(['text',...args]);},
    arc(...args){calls.push(['arc',...args]);}
  };
  const chart={timeScale:()=>({timeToCoordinate(time){return time===points[0].time?250:450;}})};
  const series={priceToCoordinate(price){return price===103?160:90;}};
  const primitive=medianDotPrimitive(chart,()=>points.map(point=>({point,series})));
  primitive.paneViews()[0].renderer().draw({useMediaCoordinateSpace(fn){fn({context:ctx,mediaSize:{width:600,height:300}});}});
  assert.deepEqual(calls.filter(call=>call[0]==='arc').map(call=>call.slice(1,4)),[[250,160,4.5],[450,90,4.5]]);
  assert.deepEqual(calls.filter(call=>call[0]==='text').map(call=>call[1]),points.flatMap(p=>[p.title,p.caption]));
  assert.ok(calls.filter(call=>call[0]==='rect').every(call=>call[4]===34));
});
test('layer stores values only at expiration and clears all projection slots when results disappear',async()=>{
  let timeline=[],range={from:0,to:10},data=[],refreshes=0;
  const scale={getVisibleLogicalRange:()=>range,setVisibleLogicalRange:value=>{range=value;},
    timeToIndex:time=>time==='2026-11-24'?10:timeline.findIndex(x=>x.time===time)+11};
  const series={setData(rows){data=rows;timeline=rows;}};
  const chart={timeScale:()=>scale,addSeries(_type,options){assert.equal(options.lineVisible,false);assert.equal(options.priceLineVisible,false);return series;}};
  const base={attachPrimitive(primitive){primitive.attached({requestUpdate:()=>refreshes++});}};
  const layer=createMedianDotLayer({chart,base,lineSeries:'line',lastTime:'2026-11-24',tf:'D'});
  layer.set('median',levels);
  await Promise.resolve();
  assert.deepEqual(data.filter(row=>'value' in row),levels.map(({expiry,price})=>({time:expiry,value:price})));
  assert.ok(data.length>2);
  assert.ok(range.to>scale.timeToIndex(levels.at(-1).expiry));
  layer.set('median',[]);
  assert.deepEqual(data,[]);
  assert.equal(layer.hasPoints(),false);
  assert.ok(refreshes>=2);
  layer.dispose();
  layer.set('median',levels);
  assert.deepEqual(data,[]);
});
