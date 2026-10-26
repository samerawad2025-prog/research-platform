const assert = require('node:assert/strict')
const { sourceHash, validCard, loadDirections } = require('../lib/public/directions')
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
 assert.deepEqual(require('../content/research-directions.json'),[],'pilot starts without invented published cards')
 console.log('PASS research directions: evidence, review, withdrawal, freshness, failure and deduplication')
}
main().catch(e=>{console.error(e);process.exitCode=1})
