// Market Lens Pine v5 subset: a bounded, browser-only interpreter (no eval or dynamic JS).
// Unsupported Pine constructs are errors, not silently skipped or approximated.
export class PineError extends Error {
  constructor(line,message){super('line '+line+': '+message);this.name='PineError';this.line=line;}
}
const fail=(line,message)=>{throw new PineError(line,message);};
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const truth=v=>v!==null&&v!==undefined&&v!==false&&v!==0&&!Number.isNaN(v);
const legalFns=new Set([
  'ta.ema','ta.sma','ta.rsi','ta.macd','ta.stoch','ta.atr','ta.bb','ta.cross',
  'ta.crossover','ta.crossunder','ta.highest','ta.lowest','ta.change',
  'input.int','input.float','input.bool','plot','plotshape',
  'strategy.entry','strategy.exit','strategy.close','na','nz',
  'math.abs','math.max','math.min','math.round'
]);
const minArgs={
  'ta.ema':2,'ta.sma':2,'ta.rsi':2,'ta.macd':4,'ta.stoch':4,'ta.atr':1,
  'ta.bb':3,'ta.cross':2,'ta.crossover':2,'ta.crossunder':2,
  'ta.highest':2,'ta.lowest':2,'ta.change':1,
  'input.int':1,'input.float':1,'input.bool':1,
  'plot':1,'plotshape':1,'strategy.entry':2,'strategy.exit':1,'strategy.close':1,
  'na':1,'nz':1,'math.abs':1,'math.max':2,'math.min':2,'math.round':1
};
const help={
  'ta.rsi':'ta.rsi needs a series and a length',
  'ta.ema':'ta.ema needs a series and a length',
  'ta.sma':'ta.sma needs a series and a length',
  'ta.macd':'ta.macd needs a source, fast length, slow length, and signal length',
  'ta.stoch':'ta.stoch needs a source, high, low, and length',
  'ta.bb':'ta.bb needs a series, a length, and a multiplier'
};
const precedence={or:1,and:2,'==':3,'!=':3,'>':3,'<':3,'>=':3,'<=':3,'+':4,'-':4,'*':5,'/':5,'%':5};
let nextId=1;
function tokens(src,line){
  const out=[];let i=0;
  while(i<src.length){
    const rest=src.slice(i),ws=rest.match(/^\s+/);if(ws){i+=ws[0].length;continue;}
    const number=rest.match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if(number){out.push({type:'number',value:Number(number[0])});i+=number[0].length;continue;}
    const id=rest.match(/^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*/);
    if(id){out.push({type:'name',value:id[0]});i+=id[0].length;continue;}
    if(src[i]==='"'||src[i]==="'"){
      const quote=src[i++];let value='',closed=false;
      while(i<src.length){const c=src[i++];if(c===quote){closed=true;break;}
        if(c==='\\'&&i<src.length){const n=src[i++];value+=n==='n'?'\n':n==='t'?'\t':n;}
        else value+=c;}
      if(!closed)fail(line,'Unclosed string literal');
      out.push({type:'string',value});continue;
    }
    const op=rest.match(/^(?:==|!=|<=|>=|:=|=>)/);
    if(op){out.push({type:'symbol',value:op[0]});i+=op[0].length;continue;}
    if('()+-*/%!,=<>?:[]'.includes(src[i])){
      out.push({type:'symbol',value:src[i++]});continue;
    }
    fail(line,'Unexpected character "'+src[i]+'"');
  }
  out.push({type:'end',value:'<end>'});return out;
}
function expression(src,line){
  const ts=tokens(src,line);let pos=0;
  const peek=()=>ts[pos],take=()=>ts[pos++];
  const expect=v=>{if(peek().value!==v)fail(line,'Expected "'+v+'" but found "'+peek().value+'"');take();};
  function atom(){
    const t=take();
    if(t.type==='number'||t.type==='string')return {type:'literal',value:t.value,line};
    if(t.value==='true'||t.value==='false')return {type:'literal',value:t.value==='true',line};
    if(t.value==='na')return {type:'literal',value:null,line};
    if(t.value==='not'||t.value==='!'||t.value==='-'||t.value==='+')
      return {type:'unary',op:t.value,arg:parse(6),line};
    if(t.value==='('){const node=parse(0);expect(')');return node;}
    if(t.type==='name')return {type:'name',value:t.value,line};
    fail(line,'Expected a number, variable, or function; got "'+t.value+'"');
  }
  function parse(min=0){
    let left=atom();
    while(true){
      if(peek().value==='(' && min<=7){
        if(left.type!=='name')fail(line,'Only named built-in functions may be called');
        const name=left.value;take();const args=[],named={};
        while(peek().value!==')'){
          if(peek().type==='end')fail(line,'Unclosed function call');
          if(peek().type==='name'&&ts[pos+1]?.value==='='){
            const key=take().value;take();if(Object.hasOwn(named,key))fail(line,'Duplicate argument '+key);
            named[key]=parse(0);
          }else args.push(parse(0));
          if(peek().value!==',')break;take();
        }
        expect(')');
        if(!legalFns.has(name)&&name!=='strategy'&&name!=='indicator')fail(line,'Unsupported function "'+name+'". Check the supported Pine v5 subset.');
        if(legalFns.has(name)&&args.length+Object.keys(named).length<(minArgs[name]||0))fail(line,help[name]||name+' needs at least '+minArgs[name]+' argument(s)');
        left={type:'call',name,args,named,id:nextId++,line};continue;
      }
      if(peek().value==='['&&min<=7){take();const offset=parse(0);expect(']');left={type:'history',arg:left,offset,line};continue;}
      if(peek().value==='?'&&min===0){take();const yes=parse(0);expect(':');const no=parse(0);left={type:'ternary',condition:left,yes,no,line};continue;}
      const op=peek().value,rank=precedence[op];
      if(!rank||rank<min)break;
      take();left={type:'binary',op,left,right:parse(rank+1),line};
    }
    return left;
  }
  const ast=parse(0);
  if(peek().type!=='end')fail(line,'Unexpected token "'+peek().value+'"');
  return ast;
}
function stripComment(text){
  let quote=null,escaped=false;
  for(let i=0;i<text.length-1;i++){
    const c=text[i];
    if(escaped){escaped=false;continue;}
    if(c==='\\'&&quote){escaped=true;continue;}
    if(quote){if(c===quote)quote=null;continue;}
    if(c==="'"||c==='"'){quote=c;continue;}
    if(c==='/'&&text[i+1]==='/')return text.slice(0,i);
  }
  return text;
}
function literal(node){
  if(node?.type==='literal')return node.value;
  if(node?.type==='unary'&&(node.op==='-'||node.op==='+')){const v=literal(node.arg);return node.op==='-'?-Number(v):Number(v);}
  fail(node?.line||1,'Input defaults and declaration settings must be constants');
}
function arg(node,index,name){
  return (name&&node.named[name])||node.args[index];
}
function walk(node,visitor){
  if(!node)return;visitor(node);
  if(node.type==='binary'){walk(node.left,visitor);walk(node.right,visitor);}
  else if(node.type==='unary'||node.type==='history'){walk(node.arg,visitor);if(node.offset)walk(node.offset,visitor);}
  else if(node.type==='ternary'){walk(node.condition,visitor);walk(node.yes,visitor);walk(node.no,visitor);}
  else if(node.type==='call'){for(const a of node.args)walk(a,visitor);for(const a of Object.values(node.named))walk(a,visitor);}
}
export function compilePine(source){
  if(typeof source!=='string'||source.length>32000)fail(1,'Script must be text under 32,000 characters');
  nextId=1;const lines=source.split(/\r?\n/);
  if(lines.length>400)fail(1,'Script must have at most 400 lines');
  const rows=[];
  for(let i=0;i<lines.length;i++){
    if(/^\s*\/\/@version=/.test(lines[i])){
      if(!/^\s*\/\/@version=5\s*$/.test(lines[i]))fail(i+1,'Only //@version=5 is supported');
      continue;
    }
    if(lines[i].includes('\t'))fail(i+1,'Use spaces, not tabs, for indented if blocks');
    const text=stripComment(lines[i]).trimEnd();if(!text.trim())continue;
    rows.push({line:i+1,indent:text.length-text.trimStart().length,text:text.trimStart()});
  }
  if(!rows.length)fail(1,'Add indicator() or strategy() at the top of your script');
  const first=expression(rows[0].text,rows[0].line);
  if(first.type!=='call'||!['indicator','strategy'].includes(first.name)||rows[0].indent)fail(rows[0].line,'Start with indicator("Name") or strategy("Name")');
  const mode=first.name,title=String(literal(arg(first,0,'title')||{type:'literal',value:'Untitled Pine script'}));
  const overlay=first.named.overlay?Boolean(literal(first.named.overlay)):mode==='strategy';
  const inputs=[];
  function readBlock(start,indent){
    const statements=[];let p=start;
    while(p<rows.length){
      const row=rows[p];if(row.indent<indent)break;
      if(row.indent>indent)fail(row.line,'Unexpected indentation; only if blocks may be indented');
      const text=row.text;
      if(/^else\b/.test(text))break;
      if(/^if\s+/.test(text)){
        const cond=expression(text.slice(3),row.line),next=rows[p+1];
        if(!next||next.indent<=indent)fail(row.line,'An if statement needs an indented body');
        const body=readBlock(p+1,next.indent);p=body.next;
        let otherwise=[];
        if(rows[p]?.indent===indent&&rows[p].text==='else'){
          const after=rows[p+1];if(!after||after.indent<=indent)fail(rows[p].line,'else needs an indented body');
          const branch=readBlock(p+1,after.indent);otherwise=branch.statements;p=branch.next;
        }
        statements.push({type:'if',cond,body:body.statements,otherwise,line:row.line});continue;
      }
      let statement;
      const tuple=text.match(/^\[([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+)\]\s*=\s*(.+)$/);
      const assign=text.match(/^(var\s+)?(?:(?:float|int|bool)\s+)?([A-Za-z_]\w*)\s*(:=|=)\s*(.+)$/);
      if(tuple){
        statement={type:'tuple',names:tuple[1].split(',').map(x=>x.trim()),value:expression(tuple[2],row.line),line:row.line};
      }else if(assign){
        const name=assign[2],value=expression(assign[4],row.line);
        statement={type:'set',name,value,persistent:!!assign[1],line:row.line};
        if(value.type==='call'&&value.name.startsWith('input.')){
          if(indent!==0)fail(row.line,'Declare input controls at top level');
          if(inputs.some(x=>x.name===name))fail(row.line,'Duplicate input '+name);
          const kind=value.name.split('.')[1];
          const def=literal(arg(value,0,'defval'));
          const titleArg=arg(value,1,'title');
          const label=titleArg?String(literal(titleArg)):name;
          if(kind==='bool'&&typeof def!=='boolean')fail(row.line,'input.bool requires a true or false default');
          if(kind!=='bool'&&!finite(def))fail(row.line,'Numeric input default must be a number');
          const min=value.named.minval?Number(literal(value.named.minval)):undefined;
          const max=value.named.maxval?Number(literal(value.named.maxval)):undefined;
          const step=value.named.step?Number(literal(value.named.step)):undefined;
          inputs.push({name,type:kind,title:label,default:def,min,max,step,line:row.line});
        }
      }else{
        const expr=expression(text,row.line);
        if(expr.type!=='call')fail(row.line,'Expected an assignment, plot(), or strategy order');
        if(expr.name==='indicator'||expr.name==='strategy')fail(row.line,'Only one top-level indicator() or strategy() declaration is allowed');
        if(!['plot','plotshape','strategy.entry','strategy.exit','strategy.close'].includes(expr.name))
          fail(row.line,'Assign '+expr.name+' to a variable, or call a supported plot/order statement');
        statement={type:'expr',value:expr,line:row.line};
      }
      walk(statement.value||statement.cond,n=>{
        if(n.type==='call'){
          if(!legalFns.has(n.name))fail(n.line,'Unsupported function '+n.name);
          if(n.name.startsWith('strategy.')&&mode!=='strategy')fail(n.line,'strategy.* orders require strategy(), not indicator()');
        }
      });
      statements.push(statement);p++;
    }
    return {statements,next:p};
  }
  const parsed=readBlock(1,0);
  if(parsed.next!==rows.length)fail(rows[parsed.next].line,'Unexpected else or indentation');
  const orderCount=JSON.stringify(parsed.statements).match(/"name":"strategy\.(?:entry|exit|close)"/g)?.length||0;
  if(mode==='strategy'&&!orderCount)fail(rows[0].line,'A strategy needs at least one strategy.entry(), strategy.exit(), or strategy.close()');
  return {mode,title,overlay,inputs,statements:parsed.statements,source};
}
function clampPeriod(value,line){
  const period=Number(value);
  if(!Number.isInteger(period)||period<1||period>5000)fail(line,'Indicator length must be an integer between 1 and 5000');
  return period;
}
function safeColor(name){
  const palette={'color.green':'#49d79d','color.lime':'#59dd93','color.red':'#ee887f','color.orange':'#e7ac66',
    'color.yellow':'#f1cc78','color.blue':'#73b8d3','color.aqua':'#6ecfc2','color.white':'#e5efe9',
    'color.gray':'#99aa9d','color.silver':'#b8c8bb','color.teal':'#6ecfc2',
    'color.fuchsia':'#d28e79','color.purple':'#cb9e6e','color.navy':'#789aac'};
  return palette[name]||((typeof name==='string'&&/^#[\da-f]{6}$/i.test(name))?name:'#6ecfc2');
}
export function executePine(programOrSource,bars,overrides={}){
  const program=typeof programOrSource==='string'?compilePine(programOrSource):programOrSource;
  if(!Array.isArray(bars)||bars.length>6000)fail(1,'Run a script on no more than 6,000 bars');
  const series=new Map(),nodeOutput=new Map(),callState=new Map(),plots=new Map(),shapes=new Map();
  const signals={buy:Array(bars.length).fill(false),sell:Array(bars.length).fill(false),closeLong:Array(bars.length).fill(false),closeShort:Array(bars.length).fill(false),stop:Array(bars.length).fill(null),limit:Array(bars.length).fill(null)};
  const entryDirections=new Map();
  let i=0,operations=0;
  const inputs=Object.fromEntries(program.inputs.map(spec=>{
    let val=Object.hasOwn(overrides,spec.name)?overrides[spec.name]:spec.default;
    val=spec.type==='bool'?val===true||val==='true':Number(val);
    if(spec.type==='int')val=Math.round(val);
    if(spec.type!=='bool'&&!finite(val))fail(spec.line,spec.name+' must be numeric');
    if(spec.min!==undefined&&val<spec.min)fail(spec.line,spec.name+' must be at least '+spec.min);
    if(spec.max!==undefined&&val>spec.max)fail(spec.line,spec.name+' must be at most '+spec.max);
    return [spec.name,val];
  }));
  function get(name,back=0,line=1){
    const j=i-back;
    if(name==='bar_index')return j>=0?j:null;
    if(name==='strategy.long')return 'long';
    if(name==='strategy.short')return 'short';
    if(name.startsWith('color.'))return safeColor(name);
    if(name.startsWith('location.'))return name;
    if(['open','high','low','close','volume','time','hl2','hlc3'].includes(name)){
      if(j<0||j>=bars.length)return null;
      const b=bars[j];if(name==='hl2')return (b.high+b.low)/2;if(name==='hlc3')return (b.high+b.low+b.close)/3;
      return b[name];
    }
    if(Object.hasOwn(inputs,name))return inputs[name];
    if(!series.has(name))fail(line,'Unknown variable "'+name+'". Define it before using it.');
    return j<0?null:series.get(name)[j]??null;
  }
  function set(name,value){let a=series.get(name);if(!a){a=[];series.set(name,a);}a[i]=value;}
  function state(node){let s=callState.get(node.id);if(!s){s={args:[],out:[],extra:{}};callState.set(node.id,s);}return s;}
  function emaCurrent(values,length,slot){
    if(!slot.values||slot.len!==length){slot.values=[];slot.len=length;}
    const arr=slot.values;
    const k=arr.length;let out=null;
    if(k+1>=length){
      const prev=arr[k-1];
      if(k===length-1){const seed=values.slice(-length);out=seed.every(finite)?seed.reduce((a,b)=>a+b,0)/length:null;}
      else if(finite(prev)&&finite(values[k]))out=prev+(values[k]-prev)*(2/(length+1));
    }
    arr.push(out);return out;
  }
  function runTa(node,args,st){
    const name=node.name,k=i;
    const n=()=>clampPeriod(args[1],node.line);
    const history=(idx,offset=1)=>st.args[idx]?.[k-offset]??null;
    const window=(idx,len)=>st.args[idx]?.slice(Math.max(0,k-len+1),k+1)||[];
    const full=arr=>arr.length&&arr.every(finite);
    if(name==='ta.sma'){const len=n(),v=window(0,len);return v.length===len&&full(v)?v.reduce((a,b)=>a+b,0)/len:null;}
    if(name==='ta.ema'){
      const len=n();if(st.extra.len!==len){st.extra={len,seed:[],last:null};}
      const e=st.extra;if(!finite(args[0]))return e.last=null;
      if(e.last===null){e.seed.push(args[0]);if(e.seed.length<len)return null;e.last=e.seed.slice(-len).reduce((a,b)=>a+b,0)/len;}
      else e.last+=(args[0]-e.last)*2/(len+1);
      return e.last;
    }
    if(name==='ta.rsi'){
      const len=n(),e=st.extra;
      if(e.len!==len){st.extra={len,gain:0,loss:0};}
      const x=st.extra,prev=history(0),cur=args[0];if(!finite(prev)||!finite(cur))return null;
      const up=Math.max(0,cur-prev),down=Math.max(0,prev-cur);
      if(k<=len){x.gain+=up;x.loss+=down;if(k<len)return null;x.gain/=len;x.loss/=len;}
      else {x.gain=(x.gain*(len-1)+up)/len;x.loss=(x.loss*(len-1)+down)/len;}
      return x.loss===0?(x.gain===0?50:100):100-100/(1+x.gain/x.loss);
    }
    if(name==='ta.highest'||name==='ta.lowest'){
      const len=n(),v=window(0,len);return v.length===len&&full(v)?(name==='ta.highest'?Math.max(...v):Math.min(...v)):null;
    }
    if(name==='ta.change'){const len=clampPeriod(args[1]??1,node.line);const previous=history(0,len);return finite(args[0])&&finite(previous)?args[0]-previous:null;}
    if(name==='ta.cross'||name==='ta.crossover'||name==='ta.crossunder'){
      const a=args[0],b=args[1],pa=history(0),pb=history(1);
      if(![a,b,pa,pb].every(finite))return false;
      const up=pa<=pb&&a>b,down=pa>=pb&&a<b;
      return name==='ta.cross'?(up||down):name==='ta.crossover'?up:down;
    }
    if(name==='ta.atr'){
      const len=clampPeriod(args[0],node.line),b=bars[k],prev=bars[k-1];
      const tr=Math.max(b.high-b.low,prev?Math.abs(b.high-prev.close):0,prev?Math.abs(b.low-prev.close):0);
      const e=st.extra;if(e.len!==len){st.extra={len,sum:0,last:null};}
      const x=st.extra;
      if(k<len){x.sum+=tr;if(k===len-1)x.last=x.sum/len;}
      else if(x.last!==null)x.last=(x.last*(len-1)+tr)/len;
      return x.last;
    }
    if(name==='ta.stoch'){
      const len=clampPeriod(args[3],node.line),hi=window(1,len),lo=window(2,len);
      if(hi.length!==len||lo.length!==len||!full(hi)||!full(lo)||!finite(args[0]))return null;
      const high=Math.max(...hi),low=Math.min(...lo);return high===low?0:100*(args[0]-low)/(high-low);
    }
    if(name==='ta.bb'){
      const len=n(),mult=Number(args[2]),values=window(0,len);
      if(values.length!==len||!full(values)||!finite(mult))return [null,null,null];
      const basis=values.reduce((a,b)=>a+b,0)/len;
      const sigma=Math.sqrt(values.reduce((sum,x)=>sum+(x-basis)**2,0)/len);
      return [basis,basis+mult*sigma,basis-mult*sigma];
    }
    if(name==='ta.macd'){
      const fast=clampPeriod(args[1],node.line),slow=clampPeriod(args[2],node.line),sig=clampPeriod(args[3],node.line);
      const ex=st.extra;
      if(!ex.fast||ex.fast.len!==fast||ex.slow.len!==slow||ex.sig.len!==sig){
        st.extra={fast:{len:fast,values:[]},slow:{len:slow,values:[]},sig:{len:sig,values:[]},source:[],macd:[]};}
      const e=st.extra;e.source.push(args[0]);
      const f=emaCurrent(e.source,fast,e.fast),s=emaCurrent(e.source,slow,e.slow);
      const macd=finite(f)&&finite(s)?f-s:null;
      e.macd.push(macd);
      const validMacd=e.macd.filter(finite);
      const signal=emaCurrent(validMacd,sig,e.sig);
      return [macd,signal,finite(macd)&&finite(signal)?macd-signal:null];
    }
    return null;
  }
  function call(node){
    const st=state(node),args=node.args.map(evalNode),named=Object.fromEntries(Object.entries(node.named).map(([key,val])=>[key,evalNode(val)]));
    // Arguments are evaluated once per bar, including under boolean conditions.
    args.forEach((v,index)=>{(st.args[index] ||= [])[i]=v;});
    const getArg=(index,key,defaultValue)=>Object.hasOwn(named,key)?named[key]:(args[index]??defaultValue);
    const name=node.name;let value=null;
    if(name.startsWith('input.'))value=inputsFromCall(node,args);
    else if(name.startsWith('ta.'))value=runTa(node,args,st);
    else if(name==='na')value=args[0]===null||args[0]===undefined||Number.isNaN(args[0]);
    else if(name==='nz')value=args[0]===null||args[0]===undefined||Number.isNaN(args[0])?(args[1]??0):args[0];
    else if(name==='math.abs')value=Math.abs(args[0]);
    else if(name==='math.max')value=Math.max(...args);
    else if(name==='math.min')value=Math.min(...args);
    else if(name==='math.round')value=Math.round(args[0]);
    else if(name==='plot'||name==='plotshape'){
      const store=name==='plot'?plots:shapes;
      let record=store.get(node.id);
      if(!record){record={title:String(getArg(1,'title',name==='plot'?'Plot':'Signal')),color:safeColor(getArg(2,'color','#6ecfc2')),values:[],line:node.line};
        store.set(node.id,record);}
      record.values[i]=name==='plot'?(finite(args[0])?args[0]:null):truth(args[0]);
      if(name==='plotshape')record.position=String(getArg(3,'location','location.belowbar'));
      value=null;
    }else if(name.startsWith('strategy.')){
      if(program.mode!=='strategy')fail(node.line,'strategy.* requires strategy()');
      if(truth(getArg(name==='strategy.entry'?2:name==='strategy.exit'?2:1,'when',true))){
        if(name==='strategy.entry'){
          const dir=String(getArg(1,'direction','long')),orderId=String(getArg(0,'id','Entry'));
          if(dir==='long')signals.buy[i]=true;
          else if(dir==='short')signals.sell[i]=true;
          else fail(node.line,'strategy.entry direction must be strategy.long or strategy.short');
          entryDirections.set(orderId,dir);
        }else if(name==='strategy.close'){
          const direction=entryDirections.get(String(getArg(0,'id','Entry')))||'long';
          if(direction==='long')signals.closeLong[i]=true;else signals.closeShort[i]=true;
        }else {
          const stop=getArg(2,'stop',null),limit=getArg(3,'limit',null);
          if(finite(stop)&&stop>0)signals.stop[i]=stop;
          if(finite(limit)&&limit>0)signals.limit[i]=limit;
          if(!finite(stop)&&!finite(limit)){
            const direction=entryDirections.get(String(getArg(1,'from_entry','Entry')))||'long';
            if(direction==='long')signals.closeLong[i]=true;else signals.closeShort[i]=true;
          }
        }
      }
      value=null;
    }else fail(node.line,'Unsupported function '+name);
    st.out[i]=value;nodeOutput.set(node.id,st.out);return value;
  }
  function inputsFromCall(node,args){
    for(const spec of program.inputs)if(spec.line===node.line&&node.name==='input.'+spec.type)return inputs[spec.name];
    fail(node.line,'input.* must be assigned to a top-level variable');
  }
  function evalNode(node){
    if(++operations>3000000)fail(node.line,'Script exceeded its calculation limit. Simplify the script or reduce bars.');
    if(node.type==='literal')return node.value;
    if(node.type==='name')return get(node.value,0,node.line);
    if(node.type==='history'){
      const offset=Math.floor(Number(evalNode(node.offset)));
      if(!Number.isInteger(offset)||offset<0||offset>6000)fail(node.line,'History offset must be between 0 and 6000');
      if(node.arg.type==='name')return get(node.arg.value,offset,node.line);
      if(node.arg.type==='call')return nodeOutput.get(node.arg.id)?.[i-offset]??null;
      fail(node.line,'History indexing supports a series variable or function call');
    }
    if(node.type==='unary'){const a=evalNode(node.arg);if(node.op==='not'||node.op==='!')return !truth(a);return finite(a)?node.op==='-'?-a:a:null;}
    if(node.type==='ternary')return truth(evalNode(node.condition))?evalNode(node.yes):evalNode(node.no);
    if(node.type==='binary'){
      const a=evalNode(node.left),b=evalNode(node.right);
      if(node.op==='and')return truth(a)&&truth(b);
      if(node.op==='or')return truth(a)||truth(b);
      if(a===null||b===null||a===undefined||b===undefined)return false;
      switch(node.op){
        case '+':return a+b;case '-':return a-b;case '*':return a*b;
        case '/':return b===0?null:a/b;case '%':return b===0?null:a%b;
        case '>':return a>b;case '<':return a<b;case '>=':return a>=b;case '<=':return a<=b;
        case '==':return a===b;case '!=':return a!==b;
      }
    }
    if(node.type==='call')return call(node);
    fail(node.line,'Unsupported expression');
  }
  function evaluateStatements(statements){
    for(const stmt of statements){
      if(stmt.type==='if'){evaluateStatements(truth(evalNode(stmt.cond))?stmt.body:stmt.otherwise);continue;}
      if(stmt.type==='set'){
        if(stmt.persistent&&i>0&&series.has(stmt.name))continue;
        set(stmt.name,evalNode(stmt.value));
      }else if(stmt.type==='tuple'){
        const tuple=evalNode(stmt.value);if(!Array.isArray(tuple)||tuple.length<stmt.names.length)
          fail(stmt.line,'Tuple assignment needs a multi-value function such as ta.macd() or ta.bb()');
        stmt.names.forEach((name,index)=>set(name,tuple[index]));
      }else evalNode(stmt.value);
    }
  }
  for(i=0;i<bars.length;i++){
    for(const [name,arr] of series)arr[i]=i>0?arr[i-1]:null;
    try{evaluateStatements(program.statements);}catch(error){
      if(error instanceof PineError)throw error;
      fail(1,error.message||'Script could not be evaluated');
    }
  }
  return {
    mode:program.mode,title:program.title,overlay:program.overlay,
    inputs:program.inputs,plots:[...plots.values()].map(p=>({...p,values:Array.from({length:bars.length},(_,i)=>p.values[i]??null)})),
    shapes:[...shapes.values()].map(p=>({...p,values:Array.from({length:bars.length},(_,i)=>p.values[i]??false)})),
    signals,barCount:bars.length
  };
}
export function sweepPine(programOrSource,bars,backtest,backtestOptions={},settings={}){
  const program=typeof programOrSource==='string'?compilePine(programOrSource):programOrSource;
  if(program.mode!=='strategy')fail(1,'Parameter sweeps require a strategy() script');
  const candidates=program.inputs.filter(x=>x.type==='int'||x.type==='float').slice(0,2);
  if(!candidates.length)fail(1,'Add input.int() or input.float() to create sweep parameters');
  const variants=[{}];for(const p of candidates){
    const v=Number(Object.hasOwn(settings,p.name)?settings[p.name]:p.default),step=p.step||Math.max(1,Math.abs(v)*.25);
    const choices=[v-step,v,v+step].map(x=>p.type==='int'?Math.round(x):Math.round(x*10000)/10000)
      .filter(x=>(p.min===undefined||x>=p.min)&&(p.max===undefined||x<=p.max));
    const next=[];for(const existing of variants)for(const val of [...new Set(choices)])next.push({...existing,[p.name]:val});
    variants.splice(0,variants.length,...next.slice(0,9));
  }
  const holdout=Math.max(2,Math.floor(bars.length*.7));
  return variants.map(params=>{
    const cfg={...settings,...params},evaluated=executePine(program,bars,cfg);
    const opts={...backtestOptions,customSignals:evaluated.signals};
    const train=backtest(bars,{...opts,endIndex:holdout-1});
    const test=backtest(bars,{...opts,startIndex:holdout});
    return {params,train:train.metrics,test:test.metrics};
  }).sort((a,b)=>b.test.returnPct-a.test.returnPct);
}
