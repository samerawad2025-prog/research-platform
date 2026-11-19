// Explicit one-off public read. No credentials, writes, submissions or AI.
const assert=require('node:assert/strict')
const base='https://research-platform-5zpu.vercel.app'
const id='frsp3vfhk6zq'
async function main(){
 for(const lang of ['en','ar']){
  const scope=lang==='ar'?'الدراسة الواحدة نقطة بداية':'One study is a starting point'
  const r=await fetch(base+'/api/public/reading-brief?'+new URLSearchParams({ids:id,lang}),{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)})
  const body=await r.text()
  assert.equal(r.status,200,'single-source export '+lang)
  assert.equal(r.headers.get('cache-control'),'no-store')
  assert.ok(r.headers.get('content-disposition').includes(lang+'.txt'))
  assert.ok(body.includes(scope))
  assert.ok(body.includes(base+'/research/'+id+'#abstract-en'))
  assert.ok(!body.includes('/confirm/'))
  console.log('PASS single-source public export '+lang)
 }
 const r=await fetch(base+'/api/public/reading-brief?ids='+id+'&lang=en&unexpected=1',{signal:AbortSignal.timeout(20000)})
 assert.equal(r.status,400,'unexpected parameters rejected')
 console.log('PASS strict query validation; credential-free public exports work')
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
