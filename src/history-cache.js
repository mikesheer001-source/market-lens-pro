// App-scoped memoization for immutable historical snapshots. The app replaces
// arrays on import/refresh/prepend; WeakMaps let superseded histories be freed.
export function createHistoryCache(engine){
  const frames=new WeakMap(),summaries=new WeakMap();
  function aggregate(bars,tf){
    let map=frames.get(bars);
    if(!map){map=new Map();frames.set(bars,map);}
    if(!map.has(tf))map.set(tf,engine.aggregate(bars,tf));
    return map.get(tf);
  }
  function statsFor(bars){
    if(!summaries.has(bars))summaries.set(bars,engine.statsFor(bars));
    return summaries.get(bars);
  }
  function screenSymbol(bars,rules){
    return engine.screenStats(tf=>statsFor(aggregate(bars,tf)),rules);
  }
  return {aggregate,statsFor,screenSymbol};
}

// Schedule at most one update per animation frame, always using the latest
// event. flush() commits a final drag position before pointerup persistence.
export function frameLatest(callback,{request=requestAnimationFrame,cancel=cancelAnimationFrame}={}){
  let frame=null,args=null;
  const run=()=>{frame=null;if(args){const current=args;args=null;callback(...current);}};
  const schedule=(...next)=>{args=next;if(frame===null)frame=request(run);};
  schedule.flush=()=>{if(frame!==null)cancel(frame);run();};
  schedule.cancel=()=>{if(frame!==null)cancel(frame);frame=null;args=null;};
  return schedule;
}
