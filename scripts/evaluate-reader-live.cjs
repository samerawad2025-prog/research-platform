// One explicit evaluation: three public questions, no retry, keys or private data.
const assert=require('node:assert/strict')
const cards=require('../content/research-directions.json')
const base='https://research-platform-5zpu.vercel.app',publicId='frsp3vfhk6zq'
const norm=s=>s.normalize('NFC').replace(/\s+/g,' ').trim()
async function post(body){
 const r=await fetch(base+'/api/knowledge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(40000),cache:'no-store'})
 const data=await r.json()
 return {status:r.status,data}
}
async function main(){
 const ready=await post({action:'source',publicId,language:'en'})
 assert.equal(ready.status,200,'eligible source')
 const denied=await post({action:'source',publicId:'3tgtqz6e69bf',language:'en'})
 assert.equal(denied.status,404,'unpermitted source remains unavailable')
 const brief=await fetch(base+'/api/public/reading-brief?ids='+publicId+'&lang=en',{signal:AbortSignal.timeout(20000)})
 assert.equal(brief.status,200)
 const text=norm(await brief.text())
 for(const e of cards[0].evidence)assert.ok(text.includes(norm(e.quote)),'reviewed direction evidence matches live source')
 console.log('PASS eligibility and existing direction quotations')
 const cases=[
  {id:'method',language:'en',question:'What research method was used, and how many participants were in each stakeholder group?',insufficient:false},
  {id:'proposal-ar',language:'ar',question:'ما الذي تقترحه الدراسة للتعافي، وهل يذكر الملخص أن هذا الإطار طُبّق واختُبرت فعاليته؟',insufficient:null},
  {id:'missing-detail',language:'en',question:'What exact calendar dates were the fifteen stakeholder interviews conducted on?',insufficient:true}
 ]
 for(const item of cases){
  const start=Date.now()
  const result=await post({action:'ask',publicId,language:item.language,question:item.question})
  console.log('EVALUATION '+JSON.stringify({case:item.id,status:result.status,elapsedMs:Date.now()-start,answer:result.data}))
  assert.equal(result.status,200,'provider response '+item.id)
  if(item.insufficient!==null)assert.equal(result.data.insufficient,item.insufficient,'answerability '+item.id)
  for(const c of result.data.claims||[])assert.ok(text.includes(norm(c.quote)),'verbatim evidence '+item.id)
 }
 console.log('PASS structural checks; semantic assessment still requires reviewing the printed public answers')
}
main().catch(e=>{console.error('FAIL '+e.message);process.exitCode=1})
