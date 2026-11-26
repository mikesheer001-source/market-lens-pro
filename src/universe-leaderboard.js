const finite=Number.isFinite;
function median(values){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}
function average(values){return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;}
function pushFinite(target,value){if(finite(value))target.push(value);}
export function createUniverseLeaderboardAccumulator(){
  const strategies=new Map();
  let symbolsAnalyzed=0;
  function add(symbol,comparison){
    if(!comparison?.rows)return;
    symbolsAnalyzed++;
    for(const row of comparison.rows){
      if(!row?.strategy||row.kind==='example-indicator')continue;
      let item=strategies.get(row.id);
      if(!item){
        item={id:row.id,name:row.name,strategy:row.strategy,kind:row.kind||'preset',
          symbols:new Set(),trainSharpe:[],testSharpe:[],returnPct:[],maxDD:[],
          trades:[],rollingSharpe:[],validatedSymbols:new Set(),positiveOos:0,assessableOos:0};
        strategies.set(row.id,item);
      }
      item.symbols.add(symbol);
      pushFinite(item.trainSharpe,row.trainMetrics?.sharpe??row.metrics?.sharpe);
      pushFinite(item.testSharpe,row.validation?.enoughTestBars?row.testMetrics?.sharpe:null);
      pushFinite(item.returnPct,row.metrics?.returnPct);
      pushFinite(item.maxDD,row.metrics?.maxDD);
      pushFinite(item.trades,row.metrics?.trades);
      pushFinite(item.rollingSharpe,row.rolling?.meanSharpe);
      if(row.validation?.validated===true||row.validation?.singleSplitValidated===true||
        row.rolling?.validated===true)item.validatedSymbols.add(symbol);
      const test=row.validation?.enoughTestBars?row.testMetrics?.sharpe:null;
      if(finite(test)){item.assessableOos++;if(test>0)item.positiveOos++;}
    }
  }
  function finalize(meta={}){
    const rows=[...strategies.values()].map(item=>({
      id:item.id,name:item.name,strategy:item.strategy,kind:item.kind,
      symbols:item.symbols.size,
      medianTrainSharpe:median(item.trainSharpe),meanTrainSharpe:average(item.trainSharpe),
      medianOosSharpe:median(item.testSharpe),meanOosSharpe:average(item.testSharpe),
      assessableOos:item.assessableOos,positiveOos:item.positiveOos,
      positiveOosPct:item.assessableOos?100*item.positiveOos/item.assessableOos:null,
      medianReturnPct:median(item.returnPct),medianMaxDD:median(item.maxDD),
      medianTrades:median(item.trades),medianRollingOosSharpe:median(item.rollingSharpe),
      validatedSymbols:item.validatedSymbols.size
    })).sort((a,b)=>{
      const x=a.medianTrainSharpe,y=b.medianTrainSharpe;
      if(finite(x)!==finite(y))return finite(x)?-1:1;
      if(finite(x)&&x!==y)return y-x;
      return a.name.localeCompare(b.name);
    });
    return {version:1,symbolsAnalyzed,runAt:new Date().toISOString(),...meta,rows};
  }
  return {add,finalize,get symbolsAnalyzed(){return symbolsAnalyzed;}};
}
