// Explicit, public HTTP smoke test. No secrets, browser execution, writes or AI calls.
const assert=require('node:assert/strict')
const ORIGIN='https://research-platform-5zpu.vercel.app'
const ids=(process.env.PUBLIC_SMOKE_IDS||'').split(',')
if(ids.length!==2||new Set(ids).size!==2||ids.some(id=>!/^[a-z0-9]{12}$/.test(id)))throw Error('Provide two public record IDs')
async function read(path,lang='en'){
 const response=await fetch(ORIGIN+path,{
  headers:{Cookie:'sarp_lang='+lang,'User-Agent':'SARP-explicit-public-validation'},
  redirect:'error',signal:AbortSignal.timeout(20000),cache:'no-store'
 })
 const body=await response.text()
 return {response,body}
}
async function main(){
 let r=await read('/research')
 assert.equal(r.response.status,200,'catalogue status')
 for(const id of ids)assert.ok(r.body.includes('/research/'+id),'catalogue includes selected public record')
 console.log('PASS live catalogue and selected public links')
 for(const lang of ['en','ar']){
  r=await read('/research/compare?ids='+ids.join(',')+'&q=research',lang)
  assert.equal(r.response.status,200,'comparison status')
  assert.ok(r.body.includes(lang==='ar'?'خطط لدراسة تكمّل ما سبق':'Plan a follow-up study'),'planning section rendered')
  assert.ok(r.body.includes(lang==='ar'?'تنزيل خطة البحث':'Download research plan'),'plan action rendered')
  for(const id of ids)assert.ok(r.body.includes('/research/'+id),'comparison source links')
  console.log('PASS live comparison and planning controls '+lang)
  r=await read('/api/public/reading-brief?'+new URLSearchParams({ids:ids.join(','),q:'research',lang}),lang)
  assert.equal(r.response.status,200,'brief status')
  assert.ok(r.response.headers.get('content-type').startsWith('text/plain'))
  assert.equal(r.response.headers.get('cache-control'),'no-store')
  assert.ok(r.response.headers.get('content-disposition').includes('sarp-reading-brief-'+lang+'.txt'))
  for(const id of ids)assert.ok(r.body.includes(ORIGIN+'/research/'+id),'brief canonical source links')
  assert.ok(!r.body.includes('/confirm/'),'no private confirmation route')
  console.log('PASS live reading brief '+lang)
 }
 r=await read('/api/public/reading-brief?ids=invalid&lang=en')
 assert.equal(r.response.status,400,'invalid selection rejected')
 assert.ok(!r.response.headers.has('content-disposition'))
 console.log('PASS live invalid export rejected')
 console.log('COMPLETE: public HTTP validation only; no browser interaction or Gemini evaluation claimed')
}
main().catch(error=>{console.error('FAIL public validation:',error.message);process.exitCode=1})
