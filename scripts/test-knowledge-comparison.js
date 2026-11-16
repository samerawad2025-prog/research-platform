const assert=require('node:assert/strict')
const {handleComparison,validateComparison,providerSources,generateComparison}=require('../lib/knowledge/comparison')
const ids=['abcdefghjkmn','abcdefghjkmp','abcdefghjkmq']
const contexts=ids.map((public_id,i)=>({public_id,hash:'h'+i,paper_id:'PRIVATE',permission_id:12,
 source:{title:'Synthetic '+i,abstract:i===0?'The study surveyed 40 farms.':i===1?'The study interviewed 15 farmers.':'The study examined water use.',abstract_ar:'شملت الدراسة مزارع محلية.',contact:'PRIVATE'}}))
const ref=(i,quote)=>({study:'S'+(i+1),source:'abstract',quote:quote||contexts[i].source.abstract})
const good={insufficient:false,claims:[{kind:'comparison',text:'The studies used different samples and methods.',evidence:[ref(0),ref(1)]}]}
const env={PUBLIC_RESEARCH:'enabled',RESEARCH_KNOWLEDGE:'enabled',SUBMISSION_TOKEN_SECRET:'synthetic-test-only'}
function setup({missing=-1,changed=-1,withdrawn=-1,quota=true,error=false,output=good}={}){
 let generations=0,reads=0;const calls=[]
 return {calls,count:()=>generations,readCount:()=>reads,
  supabase:{rpc:async(name,args)=>{
   calls.push({name,args})
   if(name==='consume_submission_rate_limit')return {data:quota}
   assert.equal(name,'knowledge_source');reads++
   const index=ids.indexOf(args.p_public_id)
   return error?{error:{message:'PRIVATE'}}:{data:index===missing||(index===withdrawn&&reads>2)?null:{...contexts[index],hash:index===changed&&reads>2?'changed':contexts[index].hash}}
  }},
  generate:async args=>{generations++;assert.ok(!JSON.stringify(args).includes('PRIVATE'));return output}}
}
async function main(){
 const body={action:'ask',ids:ids.slice(0,2),language:'en',question:'How did the methods differ?'}
 assert.equal(validateComparison(good,contexts).covered,2)
 assert.ok(!JSON.stringify(validateComparison(good,contexts)).includes('PRIVATE'))
 for(const change of [
  o=>o.claims[0].evidence[0].quote='Invented findings.',
  o=>o.claims[0].evidence[0].study='S4',
  o=>o.claims[0].evidence[0].study='S2',
  o=>o.claims[0].evidence[0].source='private_file',
  o=>o.claims[0].evidence=[ref(0)],
  o=>o.claims[0].evidence=[ref(0),ref(0)],
  o=>o.claims[0].kind='consensus',
  o=>o.claims[0].text='',
  o=>o.insufficient=true,
  o=>o.claims=Array(5).fill(o.claims[0])
 ]){
  const copy=JSON.parse(JSON.stringify(good));change(copy)
  assert.throws(()=>validateComparison(copy,contexts))
 }
 assert.deepEqual(validateComparison({insufficient:true,claims:[]},contexts),{insufficient:true,claims:[],covered:0})
 const separate={insufficient:false,claims:[0,1].map(i=>({kind:'study',text:'Reported method.',evidence:[ref(i)]}))}
 assert.equal(validateComparison(separate,contexts).covered,2)
 assert.throws(()=>validateComparison({...separate,claims:separate.claims.slice(0,1)},contexts),'one study is not cross-study coverage')
 const units=contexts.map(c=>({...c,source:{abstract:'The area was 40 m².'}}))
 assert.throws(()=>validateComparison({insufficient:false,claims:[{kind:'comparison',text:'Area.',evidence:[ref(0,'The area was 40 m2.'),ref(1,'The area was 40 m2.')]}]},units))
 for(const invalid of [
  {...body,ids:[ids[0]]},{...body,ids:[ids[0],ids[0]]},{...body,ids:[...ids,ids[0]]},
  {...body,ids:[ids[0],'private-token']},{...body,question:'a'},{...body,question:'x'.repeat(601)},
  {...body,language:'xx'},{...body,source:'injected'}
 ]){
  const f=setup();assert.equal((await handleComparison({...f,env,body:invalid})).status,400);assert.equal(f.calls.length,0)
 }
 let f=setup(),r=await handleComparison({...f,env,body})
 assert.equal(r.status,200);assert.equal(f.count(),1);assert.equal(f.readCount(),4)
 assert.ok(f.calls.some(c=>c.args.p_key==='knowledge-ai-global'&&c.args.p_limit===50))
 assert.ok(f.calls.some(c=>c.args.p_key?.startsWith('knowledge-ai-client:')&&c.args.p_limit===10))
 assert.ok(!JSON.stringify(r).includes('PRIVATE'))
 f=setup();r=await handleComparison({...f,env,body:{action:'source',ids:body.ids,language:'ar'}})
 assert.deepEqual(r.body,{available:true,count:2});assert.equal(f.count(),0)
 for(const options of [{missing:1},{quota:false},{error:true}]){
  f=setup(options);r=await handleComparison({...f,env,body});assert.ok(r.status>=400);assert.equal(f.count(),0)
 }
 f=setup({withdrawn:1});r=await handleComparison({...f,env,body});assert.equal(r.status,409);assert.ok(!r.body.claims)
 f=setup({changed:1});r=await handleComparison({...f,env,body});assert.equal(r.status,409);assert.ok(!r.body.claims)
 f=setup({output:{insufficient:false,claims:[{kind:'comparison',text:'Bad',evidence:[ref(0,'Invented'),ref(1)]}]}})
 r=await handleComparison({...f,env,body});assert.equal(r.status,503);assert.ok(!r.body.claims)
 f=setup();assert.equal((await handleComparison({...f,env:{},body})).status,404);assert.equal(f.calls.length,0)
 f=setup();r=await handleComparison({...f,env,body:{...body,ids}});assert.equal(r.body.count,3);assert.equal(r.body.covered,2)
 const huge={rpc:async(name,args)=>({data:name==='consume_submission_rate_limit'?true:{...contexts[0],public_id:args.p_public_id,source:{abstract:'x'.repeat(31000)}}})}
 let hugeCalls=0
 r=await handleComparison({supabase:huge,env,body,generate:async()=>{hugeCalls++;return good}})
 assert.equal(r.status,413);assert.equal(hugeCalls,0)
 f=setup();r=await handleComparison({...f,env,body,generate:async()=>{const e=Error('private provider detail');e.status=429;throw e}})
 assert.equal(r.status,429);assert.equal(r.body.reason,'rate_limit');assert.ok(!JSON.stringify(r).includes('private provider'))
 const gEnv={AI_PROVIDER:'gemini',GEMINI_DATA_TERMS:'unpaid',GEMINI_API_KEY:'synthetic',GEMINI_MODEL:'gemini-3.5-flash-lite'}
 let requests=0
 const fetchImpl=async(_,opts)=>{
  requests++;const sent=JSON.parse(opts.body)
  assert.ok(!JSON.stringify(sent).includes('PRIVATE'));assert.ok(!sent.tools&&!sent.cachedContent)
  assert.ok(sent.systemInstruction.parts[0].text.includes('at least two distinct studies'))
  assert.equal(sent.generationConfig.maxOutputTokens,4096)
  return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(good)}]}}]})}
 }
 await generateComparison({source:providerSources(contexts.slice(0,2)),question:body.question,language:'ar',env:gEnv,fetchImpl})
 assert.equal(requests,1)
 await assert.rejects(()=>generateComparison({source:providerSources(contexts),question:'test',language:'en',env:{...gEnv,VERCEL_ENV:'preview'},fetchImpl}))
 assert.equal(requests,1)
 console.log('PASS multi-study reader: permissions, source identity, citations, coverage, quotas, freshness and provider isolation')
}
main().catch(e=>{console.error(e);process.exitCode=1})
