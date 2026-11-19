const assert=require('node:assert/strict')
const {readingBrief}=require('../lib/public/readingBrief')
const ids=['abcdefghjkmn','abcdefghjkmp'],env={PUBLIC_RESEARCH:'enabled',PUBLIC_SITE_ORIGIN:'https://example.invalid'}
let reads=0,missing=false,broken=false
const sb={rpc:async(_,args)=>{reads++;return broken?{error:{}}:{data:missing?null:{public_id:args.p_public_id,title:'Synthetic study',title_ar:'دراسة تجريبية',year:2026,abstract:'Water use was measured on 40 farms.',abstract_ar:'شملت الدراسة 40 مزرعة.',private_token:'PRIVATE',email:'PRIVATE'}}}}
async function main(){
 const params=new URLSearchParams({ids:ids.join(','),q:'water farms',lang:'en'}),now=new Date('2026-11-17T00:00:00Z')
 let r=await readingBrief({sb,params,env,now})
 assert.equal(r.status,200);assert.equal(reads,2)
 assert.ok(r.body.includes('Water use was measured on 40 farms.'));assert.ok(r.body.includes(env.PUBLIC_SITE_ORIGIN+'/research/'+ids[0]+'#abstract-en'))
 assert.ok(!r.body.includes('PRIVATE'));assert.ok(r.body.includes(now.toISOString()))
 assert.equal(r.headers['Cache-Control'],'no-store');assert.ok(r.headers['Content-Disposition'].endsWith('en.txt"'))
 const ar=new URLSearchParams({ids:ids.join(','),q:'مزرعة',lang:'ar'})
 r=await readingBrief({sb,params:ar,env,now});assert.equal(r.status,200);assert.ok(r.body.includes('دراسة تجريبية'));assert.ok(r.body.includes('#abstract-ar'))
 r=await readingBrief({sb,params:new URLSearchParams({ids:ids.join(',')}),env,now});assert.equal(r.status,200);assert.ok(r.body.includes('No question specified.'))
 // A single public study is enough for a plan, but still requires a fresh read.
 const single=new URLSearchParams({ids:ids[0],lang:'en'})
 const before=reads
 r=await readingBrief({sb,params:single,env,now});assert.equal(r.status,200);assert.equal(reads,before+1)
 assert.ok(r.body.includes('Water use was measured on 40 farms.'))
 assert.ok(r.body.includes('شملت الدراسة 40 مزرعة.'))
 assert.ok(r.body.includes('One study is a starting point'))
 assert.ok(!r.body.includes('PRIVATE'));assert.ok(!r.body.includes('Do these studies'))
 single.set('lang','ar');r=await readingBrief({sb,params:single,env,now});assert.equal(r.status,200)
 assert.ok(r.body.includes('الدراسة الواحدة نقطة بداية'))
 missing=true;assert.equal((await readingBrief({sb,params:single,env,now})).status,404)
 missing=false;broken=true;assert.equal((await readingBrief({sb,params:single,env,now})).status,503);broken=false
 const mismatch={rpc:async()=>({data:{public_id:ids[1],title:'Wrong source'}})}
 assert.equal((await readingBrief({sb:mismatch,params:single,env,now})).status,404)
 const noAbstract={rpc:async()=>({data:{public_id:ids[0],title:'Only metadata'}})}
 r=await readingBrief({sb:noAbstract,params:single,env,now});assert.equal(r.status,200)
 assert.ok(r.body.includes('غير مذكور في السجل العام'))
 missing=true;r=await readingBrief({sb,params,env,now});assert.equal(r.status,404);assert.ok(!r.body.includes('Synthetic'));assert.ok(!r.headers['Content-Disposition'])
 missing=false;broken=true;assert.equal((await readingBrief({sb,params,env,now})).status,503);broken=false
 for(const bad of ['ids=',params+'&lang=ar',params+'&token=private','ids=private&lang=en',params+'&q=other',params+'&unknown=x']){
  assert.equal((await readingBrief({sb,params:new URLSearchParams(bad),env,now})).status,400)
 }
 assert.equal((await readingBrief({sb,params,env:{},now})).status,404)
 assert.equal((await readingBrief({sb,params,env:{PUBLIC_RESEARCH:'enabled'},now})).status,503)
 console.log('PASS reading brief: bilingual evidence, safe links, no private fields, fresh eligibility and unavailable sources')
}
main().catch(e=>{console.error(e);process.exitCode=1})
