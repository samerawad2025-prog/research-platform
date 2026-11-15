const assert=require('node:assert/strict')
const {comparisonIds,loadComparison}=require('../lib/public/comparison')
const a='abcdefghjkmn',b='abcdefghjkmp',c='abcdefghjkmq'
async function main(){
 assert.deepEqual(comparisonIds([a,b]),[])
 assert.deepEqual(comparisonIds(a+','+a),[a])
 for(const raw of [a+',private-token',a+','+b+','+c+','+a,'',null])assert.deepEqual(comparisonIds(raw),[])
 let calls=0,hidden=false,failed=false
 const sb={rpc:async(name,args)=>{calls++;assert.equal(name,'public_record');return failed?{error:{}}:{data:hidden?null:{public_id:args.p_public_id,title:'Synthetic',abstract:'Reported evidence.',private_token:'never render',email:'never render'}}}}
 assert.equal((await loadComparison(sb,a)).state,'choose');assert.equal(calls,0)
 let r=await loadComparison(sb,a+','+b);assert.equal(r.state,'ready');assert.equal(calls,2)
 assert.ok(!JSON.stringify(r).includes('never render'))
 hidden=true;r=await loadComparison(sb,a+','+b);assert.equal(r.state,'missing');assert.deepEqual(r.records,[])
 hidden=false;failed=true;r=await loadComparison(sb,a+','+b);assert.equal(r.state,'unavailable');assert.deepEqual(r.records,[])
 const mismatch={rpc:async()=>({data:{public_id:c,title:'Wrong record'}})}
 assert.equal((await loadComparison(mismatch,a+','+b)).state,'missing')
 const evidence={rpc:async(_,args)=>({data:{public_id:args.p_public_id,title:'Water study',
   abstract:args.p_public_id===a?'Water use was measured on 40 farms.':'Employment was measured.',
   abstract_ar:'شملت الدراسة 40 مزرعة.'}})}
 r=await loadComparison(evidence,a+','+b,'How is water used on farms?')
 assert.equal(r.question,'How is water used on farms?')
 assert.equal(r.records[0].excerpts.length,1)
 assert.equal(r.records[0].excerpts[0].text,'Water use was measured on 40 farms.')
 assert.equal(r.records[1].excerpts.length,0,'missing evidence stays missing')
 r=await loadComparison(evidence,a+','+b,'كيف شملت الدراسة مزرعة؟')
 assert.ok(r.records.every(p=>p.excerpts.some(e=>e.field==='abstract_ar')))
 r=await loadComparison(evidence,a+','+b,'how can the')
 assert.deepEqual(r.terms,[])
 assert.ok(r.records.every(p=>p.excerpts.length===0))
 r=await loadComparison(evidence,a+','+b,'x'.repeat(250))
 assert.equal(r.question.length,200)
 r=await loadComparison(mismatch,a+','+b,'water')
 assert.equal(r.state,'missing');assert.equal(r.question,undefined)
 console.log('PASS comparison: bounded public identifiers, eligibility recheck, no partial result, field allowlist')
}
main().catch(e=>{console.error(e);process.exitCode=1})
