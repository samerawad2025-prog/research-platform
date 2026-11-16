const assert=require('node:assert/strict')
const {rememberKnowledgeChoice,readKnowledgeChoice,forgetKnowledgeChoice}=require('../lib/submission/knowledgeChoice')
async function main(){
 const values=new Map(),storage={setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)||null,removeItem:k=>values.delete(k)}
 const token='a'.repeat(64),other='b'.repeat(64),choice={language:'ar',hash:'c'.repeat(64)}
 assert.equal(await rememberKnowledgeChoice(token,choice,storage,100),true)
 assert.deepEqual(await readKnowledgeChoice(token,storage,101),{choice})
 assert.equal(await readKnowledgeChoice(other,storage,101),null)
 assert.ok(![...values.keys()].some(k=>k.includes(token)),'raw private token is not stored')
 assert.equal(await readKnowledgeChoice(token,storage,86400100),null)
 assert.equal(values.size,0)
 assert.equal(await rememberKnowledgeChoice(token,{language:'xx',hash:'bad'},storage),false)
 await rememberKnowledgeChoice(token,null,storage,100)
 assert.deepEqual(await readKnowledgeChoice(token,storage,101),{choice:null})
 await forgetKnowledgeChoice(token,storage);assert.equal(values.size,0)
 const blocked={setItem:()=>{throw Error('blocked')},getItem:()=>{throw Error('blocked')},removeItem:()=>{throw Error('blocked')}}
 assert.equal(await rememberKnowledgeChoice(token,choice,blocked),false)
 assert.equal(await readKnowledgeChoice(token,blocked),null)
 await forgetKnowledgeChoice(token,blocked)
 console.log('PASS consent handoff: explicit choice, paper isolation, expiry, decline, cleanup and unavailable storage')
}
main().catch(e=>{console.error(e);process.exitCode=1})
