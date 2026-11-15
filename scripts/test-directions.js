const assert = require('node:assert/strict')
const { sourceHash, validCard, loadDirections, loadRelatedDirections } = require('../lib/public/directions')
const id = 'abcdefghjkmn', other = 'abcdefghjkmp'
const source = { title:'Synthetic study', abstract:'The study surveyed 40 farms. Follow-up was limited to one season.' }
const copy = x => JSON.parse(JSON.stringify(x))
const text = { question:'What changes in a second season?', opportunity:'Compare repeated observations.', method:'Repeat the survey.', constraints:'Seasonal access and consent.', supervisor:'Is follow-up feasible?' }
const card = { id:'season-follow-up', reviewed:true, reviewedAt:'2026-10-26', en:text, ar:text,
 evidence:[{ publicId:id, field:'abstract', kind:'stated_limitation', quote:'Follow-up was limited to one season.', sourceHash:sourceHash(source) }] }
async function main() {
 let calls=0, current=source, failure=false
 const db={rpc:async(name,args)=>{calls++;assert.equal(name,'public_record');assert.ok([id,other].includes(args.p_public_id));if(failure)throw Error('offline');return {data:current,error:null}}}
 assert.ok(validCard(card))
 let result=await loadDirections(db,[card])
 assert.equal(result.cards.length,1);assert.equal(result.cards[0].sourceCount,1)
 assert.equal(result.cards[0].evidence[0].sourceHash,undefined)
 for(const mutate of [
 c=>c.reviewed=false,c=>c.reviewedAt='2026-02-30',c=>c.en.question='',
 c=>c.evidence=[null],c=>c.evidence[0].publicId='private-token',
 c=>c.evidence[0].field='email',c=>c.evidence[0].kind='invented',
 c=>c.evidence[0].sourceHash='bad'
 ]) { const c=copy(card);mutate(c);const before=calls;assert.equal((await loadDirections(db,[c])).cards.length,0);assert.equal(calls,before) }
 let c=copy(card);c.evidence[0].quote='A finding never reported here.'
 assert.equal((await loadDirections(db,[c])).cards.length,0)
 c=copy(card);c.evidence[0].quote='Follow-up  was\nlimited to one season.'
 assert.equal((await loadDirections(db,[c])).cards.length,1)
 c=copy(card);c.evidence.push(copy(c.evidence[0]));calls=0
 result=await loadDirections(db,[c,c]);assert.equal(result.cards.length,1);assert.equal(result.cards[0].sourceCount,1);assert.equal(calls,1)
 current={...source,abstract:source.abstract+' Updated.'}
 assert.equal((await loadDirections(db,[card])).cards.length,0,'changed source requires editorial review')
 current=null
 assert.equal((await loadDirections(db,[card])).cards.length,0,'withdrawn or private source hides direction on next request')
 current=source;failure=true
 result=await loadDirections(db,[card]);assert.equal(result.cards.length,0);assert.equal(result.unavailable,true)
 failure=false
 c=copy(card);c.evidence.push({...c.evidence[0],publicId:other})
 const mixed={rpc:async(_,args)=>({data:args.p_public_id===id?source:null})}
 assert.equal((await loadDirections(mixed,[c])).cards.length,0,'one missing source hides the whole card')
 assert.deepEqual(await loadDirections(db,[]),{cards:[],unavailable:false})
 assert.deepEqual(await loadDirections(db,null),{cards:[],unavailable:false})
 calls=0;current=source;failure=false
 const related=await loadRelatedDirections(db,id,[card])
 assert.equal(related.length,1)
 assert.equal(related[0].question,card.en.question)
 assert.equal(related[0].questionAr,card.ar.question)
 assert.equal(related[0].evidence,undefined,'compact links omit source internals')
 assert.equal(calls,1,'related links recheck their source')
 calls=0
 assert.deepEqual(await loadRelatedDirections(db,other,[card]),[])
 assert.deepEqual(await loadRelatedDirections(db,'private-token',[card]),[])
 assert.equal(calls,0,'unrelated or invalid IDs trigger no source reads')
 const linked=copy(card);linked.evidence.push({...linked.evidence[0],publicId:other})
 assert.deepEqual(await loadRelatedDirections(mixed,id,[linked]),[],'missing co-source hides the related link')
 current={...source,abstract:'Changed'}
 assert.deepEqual(await loadRelatedDirections(db,id,[card]),[])
 current=null
 assert.deepEqual(await loadRelatedDirections(db,id,[card]),[])
 current=source;failure=true
 assert.deepEqual(await loadRelatedDirections(db,id,[card]),[])
 failure=false;calls=0
 const many=Array.from({length:5},(_,i)=>({...copy(card),id:'direction-'+i}))
 assert.equal((await loadRelatedDirections(db,id,many)).length,3)
 assert.equal(calls,1,'related cards share one source read')
 const unitSource={title:'Units',abstract:'The area was 40 m².'}
 const unitCard=copy(card);unitCard.evidence[0]={...unitCard.evidence[0],quote:'The area was 40 m2.',sourceHash:sourceHash(unitSource)}
 const unitDb={rpc:async()=>({data:unitSource})}
 assert.equal((await loadDirections(unitDb,[unitCard])).cards.length,0,'preserve meaningful unit distinctions')
 const registry=require('../content/research-directions.json')
 assert.ok(Array.isArray(registry) && registry.length<=8)
 assert.ok(registry.every(validCard),'published definitions must satisfy the editorial schema')
 assert.equal(new Set(registry.map(c=>c.id)).size,registry.length,'card identifiers are unique')
 console.log('PASS research directions: evidence, review, withdrawal, freshness, failure and deduplication')
}
main().catch(e=>{console.error(e);process.exitCode=1})
