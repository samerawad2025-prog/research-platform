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
 console.log('PASS comparison: bounded public identifiers, eligibility recheck, no partial result, field allowlist')
}
main().catch(e=>{console.error(e);process.exitCode=1})
