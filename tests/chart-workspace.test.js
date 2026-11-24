import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CHART_WORKSPACE_KEY,CHART_WORKSPACE_DEFAULTS,normalizeChartWorkspace,readChartWorkspace,writeChartWorkspace,chartAlertLevels,chartOptionLevels,matchingTradeMarkers} from '../src/chart-workspace.js';

test('chart controls are opt-in and existing Pine and trade overlays retain defaults',()=>{
  assert.deepEqual(normalizeChartWorkspace(),CHART_WORKSPACE_DEFAULTS);
  assert.equal(CHART_WORKSPACE_DEFAULTS.watchlist,false);
  assert.equal(CHART_WORKSPACE_DEFAULTS.trades,true);
  assert.equal(CHART_WORKSPACE_DEFAULTS.pine,true);
  assert.deepEqual(normalizeChartWorkspace({alerts:true,pine:false,strikes:'yes',bogus:true}),{...CHART_WORKSPACE_DEFAULTS,alerts:true,pine:false});
});
test('chart visibility survives reload independently of shared workspace settings',()=>{
  const map=new Map(),storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
  const prefs={...readChartWorkspace(storage),strikes:true,trades:false};
  writeChartWorkspace(storage,prefs);
  storage.setItem('market-lens-pro-settings',JSON.stringify({chart:{strikes:false,trades:true}}));
  assert.deepEqual(readChartWorkspace(storage),prefs);
  assert.ok(map.has(CHART_WORKSPACE_KEY));
  map.set(CHART_WORKSPACE_KEY,'{broken');
  assert.deepEqual(readChartWorkspace(storage),CHART_WORKSPACE_DEFAULTS);
});
test('only valid daily price alerts for the chart symbol become price lines',()=>{
  const alert={symbol:'SPY',metric:'price',op:'>',threshold:500};
  assert.deepEqual(chartAlertLevels([alert,{...alert,threshold:490,op:'<',active:true},{...alert,symbol:'VXX'},
    {...alert,type:'signal'},{...alert,metric:'rsi'},{...alert,threshold:NaN},{...alert,threshold:0}], 'SPY'),
    [{price:500,label:'Daily alert > 500',active:false},{price:490,label:'Daily alert < 490',active:true}]);
});
test('option strike levels group valid committed positions and never cross symbols',()=>{
  const positions={symbol:'SPY',legs:[{strike:500,type:'call',side:'buy'},{strike:490,type:'put',side:'sell'},
    {strike:500,type:'put',side:'buy'},{strike:500,type:'call',side:'buy'},{strike:null,type:'call',side:'buy'}]};
  assert.deepEqual(chartOptionLevels(positions,'SPY'),[{price:490,label:'Strike SP'},{price:500,label:'Strike BC/BP'}]);
  assert.deepEqual(chartOptionLevels(positions,'QQQ'),[]);
  assert.deepEqual(chartOptionLevels(null,'SPY'),[]);
});
test('trade marker timestamps must exist in the displayed bar series',()=>{
  const markers=[{time:'2026-01-01',text:'BUY'},{time:'2026-01-02',text:'EXIT'},{time:'2026-01-05',text:'BUY'}];
  assert.deepEqual(matchingTradeMarkers(markers,[{time:'2026-01-02'},{time:'2026-01-05'}]),markers.slice(1));
  assert.deepEqual(matchingTradeMarkers([{time:200,text:'BUY'}],[{time:200}]),[{time:200,text:'BUY'}]);
});
