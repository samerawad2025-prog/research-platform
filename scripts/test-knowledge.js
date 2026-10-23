const assert = require('node:assert/strict')
const {handleKnowledge,handleKnowledgeAdmin,validateOutput}=require('../lib/knowledge/core')
const {generate,generationProfile}=require('../lib/knowledge/gemini')
const env={RESEARCH_KNOWLEDGE:'enabled',PUBLIC_RESEARCH:'enabled',ADMIN_REVIEW:'enabled',SUBMISSION_TOKEN_SECRET:'synthetic-test-secret'}
const publicId='abcdefghjkmn',paperId='22222222-2222-4222-8222-222222222222',actor='11111111-1111-4111-8111-111111111111'
const context={public_id:publicId,paper_id:paperId,permission_id:1,hash:'source-hash',source:{title:'Synthetic study',abstract:'The study surveyed 40 farms. Water use fell by 12 percent.'}}
const good={insufficient:false,claims:[{text:'The study included 40 farms.',source:'abstract',quote:'The study surveyed 40 farms.'}]}
function fixture(overrides={}){
  const calls=[];let generated=0
  const sb={auth:{getUser:async()=>({data:{user:{id:actor}}})},rpc:async(name,args)=>{
    calls.push({name,args})
    if(overrides[name])return overrides[name](args)
    return {data:name==='consume_submission_rate_limit'?true:name==='knowledge_source'?context:name==='knowledge_admin'?{source:context,draft:{id:'v1',source_hash:context.hash}}:name==='knowledge_permission'?{granted:true}:{ok:true},error:null}
  }}
  return{calls,supabase:sb,generate:async()=>{generated++;return good},count:()=>generated}
}
async function run(){
  assert.equal(validateOutput(good,context).claims.length,1)
  assert.throws(()=>validateOutput({insufficient:false,claims:[{text:'Invented',source:'abstract',quote:'There were 500 farms.'}]},context))
  assert.throws(()=>validateOutput({claims:[{text:'No',source:'private_file',quote:'The study surveyed 40 farms.'}]},context))
  assert.deepEqual(validateOutput({insufficient:true,claims:[{text:'ignored'}]},context),{insufficient:true,claims:[]})
  let f=fixture()
  let r=await handleKnowledge({...f,env:{},body:{}})
  assert.equal(r.status,404);assert.equal(f.calls.length,0)
  f=fixture({knowledge_source:()=>({data:null})})
  r=await handleKnowledge({...f,env,body:{action:'ask',publicId,question:'What did it study?',language:'en'}})
  assert.equal(r.status,404);assert.equal(f.count(),0)
  f=fixture({consume_submission_rate_limit:()=>({data:false})})
  r=await handleKnowledge({...f,env,body:{action:'ask',publicId,question:'What did it study?',language:'en'}})
  assert.equal(r.status,429);assert.equal(f.count(),0)
  f=fixture()
  r=await handleKnowledge({...f,env,body:{action:'ask',publicId,question:'What did it study?',language:'ar'}})
  assert.equal(r.status,200);assert.equal(f.count(),1)
  assert.ok(!JSON.stringify(r.body).includes('paper_id'));assert.ok(!JSON.stringify(r.body).includes('permission_id'))
  let reads=0
  f=fixture({knowledge_source:()=>({data:++reads===1?context:null})})
  r=await handleKnowledge({...f,env,body:{action:'ask',publicId,question:'What did it study?',language:'en'}})
  assert.equal(r.status,409);assert.ok(!r.body.claims)
  f=fixture()
  r=await handleKnowledge({...f,env,body:{action:'permission',token:'a'.repeat(64),language:'en',granted:true,hash:'b'.repeat(64)}})
  assert.equal(r.status,200)
  assert.ok(!JSON.stringify(f.calls).includes('a'.repeat(64)),'raw credential never sent to DB')
  f=fixture({knowledge_admin:()=>({error:{message:'admin:forbidden'}})})
  r=await handleKnowledgeAdmin({...f,env,token:'valid-synthetic-token-long-enough',body:{action:'generate',paperId}})
  assert.equal(r.status,403);assert.equal(f.count(),0)
  f=fixture()
  r=await handleKnowledgeAdmin({...f,env,token:'valid-synthetic-token-long-enough',body:{action:'publish',paperId,versionId:'v1',reviewed:false}})
  assert.equal(r.status,400);assert.equal(f.calls.filter(c=>c.name==='knowledge_publish').length,0)
  const gEnv={AI_PROVIDER:'gemini',GEMINI_DATA_TERMS:'unpaid',GEMINI_API_KEY:'synthetic-never-valid',GEMINI_MODEL:'gemini-3.5-flash-lite'}
  let requests=0
  const fetchImpl=async(url,opts)=>{requests++;assert.ok(!url.includes(gEnv.GEMINI_API_KEY));assert.equal(opts.headers['x-goog-api-key'],gEnv.GEMINI_API_KEY);return{ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(good)}]}}]})}}
  await assert.rejects(()=>generate({context,question:'test',language:'en',env:{...gEnv,VERCEL_ENV:'preview'},fetchImpl}))
  assert.equal(requests,0)
  assert.deepEqual(await generate({context,question:'test',language:'en',env:gEnv,fetchImpl}),good)
  assert.equal(requests,1)
  assert.equal(generationProfile(gEnv,false).model,'gemini-3.5-flash-lite')
  assert.equal(generationProfile(gEnv,true).thinkingLevel,'medium')
  assert.equal(generationProfile(gEnv,false).thinkingLevel,'low')
  const split={...gEnv,GEMINI_READER_MODEL:'gemini-3.8-flash',GEMINI_ARTICLE_MODEL:'gemini-3.6-flash'}
  assert.equal(generationProfile(split,false).model,'gemini-3.8-flash')
  assert.equal(generationProfile(split,true).model,'gemini-3.6-flash')
  assert.equal(gEnv.GEMINI_MODEL,'gemini-3.5-flash-lite','extraction setting is independent')
  const bodies=[]
  for(const article of [false,true]){
    await generate({context,question:'What is reported?',language:'ar',article,env:split,fetchImpl:async(url,opts)=>{
      const body=JSON.parse(opts.body);bodies.push(body)
      assert.ok(url.includes(article?'gemini-3.6-flash':'gemini-3.8-flash'))
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,article?'medium':'low')
      assert.equal('temperature' in body.generationConfig,false)
      assert.equal(body.generationConfig.maxOutputTokens,article?8192:4096)
      assert.ok(!body.tools && !body.cachedContent,'no search, external storage or tools added')
      assert.ok(body.systemInstruction.parts[0].text.includes('proposed framework'))
      return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'not output'},{text:JSON.stringify(good)}]}}]})}
    })
  }
  let rejectedCalls=0
  for(const override of [{GEMINI_READER_MODEL:'gemini-4-argon'},{GEMINI_READER_MODEL:'typo'},{GEMINI_READER_THINKING_LEVEL:'minimal'}]){
    await assert.rejects(()=>generate({context,question:'test',language:'en',env:{...gEnv,...override},fetchImpl:async()=>{rejectedCalls++}}))
  }
  assert.equal(rejectedCalls,0)
  await assert.rejects(()=>generate({context,question:'test',env:gEnv,fetchImpl:async()=>({ok:true,json:async()=>({candidates:[{finishReason:'MAX_TOKENS'}]})})}),/incomplete/)
  console.log('PASS knowledge: permissions, quotation checks, withdrawal during generation, quotas, auth, explicit review and provider isolation')
}
run().catch(e=>{console.error(e);process.exitCode=1})
