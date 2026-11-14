const assert=require('node:assert/strict')
const {cleanQuestion,queryTerms,passage,discover,LIMITS}=require('../lib/public/discovery')
const id='abcdefghjkmn',other='abcdefghjkmp'
const rec={public_id:id,title:'Water use',abstract:'The study surveyed 40 farms. Water use was measured in summer.'}
async function main(){
 assert.equal(cleanQuestion(['  water  farms ','ignored']),'water farms')
 assert.equal(cleanQuestion('x'.repeat(300)).length,200)
 assert.deepEqual(queryTerms('How can water use on farms be studied?'),['water','use','farms','studied'])
 assert.deepEqual(queryTerms('كيف تؤثر المِيَاه في الزراعة؟'),['تؤثر','المياه','الزراعة'])
 assert.deepEqual(queryTerms('how can the?'),[])
 assert.equal(queryTerms('one two three four five six seven eight').length,LIMITS.terms)
 const p=passage('A source line. Water use was measured.',['water'])
 assert.ok(rec.abstract.includes('Water use'))
 assert.equal(p.text,'A source line. Water use was measured.')
 assert.equal(passage('No relevant text.',['water']),null)
 let calls=[],withdrawn=false,failed=false
 const sb={rpc:async(name,args)=>{
  calls.push({name,args})
  if(failed)return {error:{message:'offline'}}
  if(name==='public_catalogue')return {data:{ok:true,total:2,items:[{...rec,snippet:rec.abstract},{public_id:other,title:'Water only',snippet:'Water.'}]}}
  return {data:args.p_public_id===id?(withdrawn?null:rec):{public_id:other,title:'Water only',abstract:'A different study.'}}
 }}
 let r=await discover(sb,'How is water used on farms?')
 assert.equal(r.items[0].publicId,id,'more matched concepts rank first')
 assert.deepEqual(r.items[0].matched,['water','farms'])
 assert.equal(r.items[1].excerpts.length,0,'title-only matches are honest')
 assert.ok(r.items[0].excerpts.every(p=>rec[p.field].includes(p.text)),'passages are verbatim')
 assert.equal(calls.filter(c=>c.name==='public_record').length,2,'candidates deduplicate')
 withdrawn=true;r=await discover(sb,'water');assert.ok(!r.items.some(x=>x.publicId===id))
 failed=true;r=await discover(sb,'water');assert.equal(r.unavailable,true);assert.deepEqual(r.items,[])
 calls=[];await discover(sb,'how can the');assert.equal(calls.length,0)
 const many=Array.from({length:40},(_,i)=>({public_id:'abcdefghj'+['k','m'][Math.floor(i/20)]+['k','m','n','p'][Math.floor(i%20/5)]+['a','b','c','d','e'][i%5],title:'Water farms',snippet:'Water farms.'}))
 let reads=0
 const bounded={rpc:async(name,args)=>name==='public_catalogue'?{data:{ok:true,total:100,items:many}}:(reads++,{data:{public_id:args.p_public_id,title:'Water farms',abstract:'Water farms.'}})}
 r=await discover(bounded,'water farms')
 assert.equal(reads,LIMITS.candidates);assert.equal(r.items.length,LIMITS.results);assert.equal(r.limited,true)
 assert.equal((await discover(null,'water')).unavailable,true)
 console.log('PASS question discovery: language, verbatim passages, ranking, withdrawal, failures and bounded reads')
}
main().catch(e=>{console.error(e);process.exitCode=1})
