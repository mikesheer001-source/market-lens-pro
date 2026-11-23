import assert from 'node:assert/strict';
import test from 'node:test';
import {boxRate, expirationTime, expiryPnl, expiryStats, initialDebit, modelPrice, quoteEstimates, scenarioPnl} from '../src/options-payoff.js';
import worker from '../worker/index.js';
import {normalizeSnapshot, optionsRequest, standardContract} from '../worker/options.js';

const leg = (type,side,strike,entry,extra={}) => ({type,side,strike,entry,quantity:1,multiplier:100,...extra});

test('expiration extrema and breakevens include the strike kinks and unbounded tail', () => {
  const vertical = [leg('call','buy',100,4),leg('call','sell',110,1)];
  const debit = initialDebit(vertical,1);
  assert.equal(debit,302);
  assert.deepEqual(expiryStats(vertical,debit),{high:698,low:-302,roots:[103.02],flat:[]});
  assert.deepEqual(expiryStats([vertical[1]],-100),{high:100,low:-Infinity,roots:[111],flat:[]});
  assert.deepEqual(expiryStats([leg('put','buy',100,2),leg('call','buy',100,2)],400).roots,[96,104]);
  assert.deepEqual(expiryStats(vertical,0).flat,[[0,100]]);
});

test('scenario prices converge to payoff and mixed expiries retain time value after the first leg settles', () => {
  const first = Date.parse('2027-01-15T21:00:00Z');
  const later = Date.parse('2027-03-19T20:00:00Z');
  const legs = [leg('call','sell',100,1,{expiresAt:first}),leg('call','buy',100,4,{expiresAt:later})];
  const model = {iv:0.25,shift:0,rate:0.04,dividend:0};
  assert.ok(scenarioPnl(legs,100,first,300,model)>expiryPnl(legs,100,300));
  assert.ok(Math.abs(modelPrice(legs[0],100,1,0.2,0.05,0)-10.4506)<0.0001);
  assert.equal(scenarioPnl(legs,130,later,300,model),-300);
  assert.equal(expirationTime({expiry:'2027-01-15',root:'SPX'}),Date.parse('2027-01-15T14:30:00Z'));
  assert.equal(expirationTime({expiry:'2027-07-16',root:'SPXW'}),Date.parse('2027-07-16T20:00:00Z'));
});

test('quote estimates and box rates preserve net cash flow conventions', () => {
  const expiry = Date.parse('2027-01-15T21:00:00Z');
  const now = expiry - 30*86_400_000;
  const extra = {root:'XSP',expiresAt:expiry,quote:{bid:1,ask:2}};
  const long = [leg('call','buy',100,0,extra),leg('call','sell',110,0,extra),
    leg('put','buy',110,0,extra),leg('put','sell',100,0,extra)];
  const short = long.map(x=>({...x,side:x.side==='buy'?'sell':'buy'}));
  assert.deepEqual(quoteEstimates(long,1),{mid:4,natural:204});
  assert.equal(boxRate(long,995,now,expiry).payout,1000);
  assert.equal(boxRate(short,-995,now,expiry).payout,-1000);
  assert.ok(Math.abs(boxRate(long,995,now,expiry).annualized-0.061139)<0.000001);
  assert.equal(boxRate(long.map(x=>({...x,root:'SPY'})),995,now,expiry),null);
  assert.equal(quoteEstimates([leg('put','buy',100,1,{quote:{bid:null,ask:2}})],0),null);
});

const expiry = new Date(Date.now()+30*86_400_000).toISOString().slice(0,10);
const base = {symbol:'SPY'+expiry.slice(2).replaceAll('-','')+'C00500000',root_symbol:'SPY',
  expiration_date:expiry,type:'call',style:'american',strike_price:'500',size:'100',
  deliverables:[{type:'equity',amount:'100'}]};
const headers = {Authorization:'Bearer '+ 'x'.repeat(32)};
test('Worker routes are closed without a configured owner code and deny unauthorized requests', async () => {
  const url='https://test.example/api/options/chain?symbol=SPY';
  assert.equal((await worker.fetch(new Request(url),{})).status,503);
  const env={OPTIONS_OWNER_TOKEN:'x'.repeat(32)};
  assert.equal((await worker.fetch(new Request(url),env)).status,401);
  assert.equal((await worker.fetch(new Request(url,{headers}),env)).status,503);
  const withKeys={...env,ALPACA_API_KEY:'test',ALPACA_API_SECRET:'test'};
  const invalid=await worker.fetch(new Request(url+'%26feed=unknown',{headers}),withKeys);
  assert.equal(invalid.status,400);
  assert.equal(invalid.headers.get('cache-control'),'no-store');
});

test('chain filters adjusted deliverables and normalizes paged Alpaca snapshots with explicit feed', async () => {
  assert.equal(standardContract({...base,deliverables:[{type:'cash',amount:'100'}]},'SPY'),null);
  assert.equal(standardContract({...base,size:'10'},'SPY'),null);
  assert.equal(normalizeSnapshot({latestQuote:{ap:2}}).bid,null);
  const url = new URL('https://test.example/api/options/chain?symbol=SPY&feed=opra&center=500&width=0.1&expiry='+expiry);
  const fetcher = async target => {
    const params = target.searchParams;
    if (target.pathname==='/v2/options/contracts') return Response.json({option_contracts:[base]});
    assert.equal(params.get('feed'),'opra');
    assert.equal(params.get('expiration_date'),expiry);
    if (!params.has('page_token')) return Response.json({snapshots:{},next_page_token:'next'});
    return Response.json({snapshots:{[base.symbol]:{latestQuote:{bp:1,ap:2,t:'2026-11-20T18:00:00Z'},impliedVolatility:.25}}});
  };
  const result=await optionsRequest(url,{},fetcher);
  assert.equal(result.contracts.length,1);
  assert.equal(result.contracts[0].quote.bid,1);
  assert.equal(result.contracts[0].quote.iv,.25);
  await assert.rejects(optionsRequest(url,{},target=>target.pathname==='/v2/options/contracts' ?
    Promise.resolve(Response.json({option_contracts:[base]})) : Promise.resolve(new Response(null,{status:403}))),
  {status:403});
});

test('browser registry consumes an approval once and accepts retries from the same device', async () => {
  const {DatabaseSync} = await import('node:sqlite');
  const {deviceRegistry, deviceAuthorized, deviceDigest} = await import('../worker/options-device.js');
  const db = new DatabaseSync(':memory:');
  try {
    const storage={
      sql:{exec:(query,...args)=>{
        const statement=db.prepare(query);
        if (query.startsWith('SELECT')) return {toArray:()=>statement.all(...args)};
        statement.run(...args);
      }},
      transactionSync:fn=>fn()
    };
    const regular='a'.repeat(64), other='b'.repeat(64);
    const enroll=async token=>deviceRegistry(new Request('https://workspace.internal/internal/options-device',{
      method:'POST',headers:{'X-Device-Digest':await deviceDigest(token),'X-Approval-Digest':'c'.repeat(64)}
    }),storage).status;
    const registry={idFromName:name=>name,get:()=>({fetch:(url,init)=>deviceRegistry(new Request(url,init),storage)})};
    const env={WORKSPACES:registry};
    assert.equal(await deviceAuthorized('Bearer '+regular,env),false);
    assert.equal(await enroll(regular),204);
    assert.equal(await enroll(regular),204);
    assert.equal(await enroll(other),409);
    assert.equal(await deviceAuthorized('Bearer '+regular,env),true);
    assert.equal(await deviceAuthorized('Bearer '+other,env),false);
    assert.equal((await worker.fetch(new Request('https://test.example/internal/options-device'),env)).status,404);
    assert.equal((await worker.fetch(new Request('https://test.example/api/options/device',{
      method:'POST',headers:{'X-Options-Approval':'c'.repeat(64)}
    }),env)).status,401);
  } finally {
    db.close();
  }
});
